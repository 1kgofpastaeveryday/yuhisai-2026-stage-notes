import Foundation
import OSLog

struct FixtureState: Decodable, Equatable {
    let name: String
    let level: Int
    let active: Bool
    let overridden: Bool
    let faderMode: String

    init(name: String, level: Int, active: Bool = true, overridden: Bool = false, faderMode: String = "relative") {
        self.name = name; self.level = level; self.active = active
        self.overridden = overridden; self.faderMode = faderMode
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        name = try c.decode(String.self, forKey: .name)
        level = try c.decode(Int.self, forKey: .level)
        active = try c.decode(Bool.self, forKey: .active)
        overridden = try c.decode(Bool.self, forKey: .overridden)
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, (0...255).contains(level) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid fixture"))
        }
        faderMode = (try? c.decode(String.self, forKey: .faderMode)) == "absolute" ? "absolute" : "relative"
    }
    private enum Key: String, CodingKey { case name, level, active, overridden, faderMode }
}

struct ServerState: Decodable {
    let fixtures: [FixtureState]
    let qlc: String
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        qlc = try c.decode(String.self, forKey: .qlc)
        if c.contains(.fixtures) {
            // Validate every entry, including entries beyond the display limit.
            let all = try c.decode([FixtureState].self, forKey: .fixtures)
            guard Set(all.map(\.name)).count == all.count else {
                throw DecodingError.dataCorruptedError(forKey: .fixtures, in: c, debugDescription: "Duplicate fixture")
            }
            fixtures = Array(all.prefix(4))
        } else if let name = try c.decodeIfPresent(String.self, forKey: .fixture) {
            let level = try c.decode(Int.self, forKey: .level)
            guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, (0...255).contains(level) else {
                throw DecodingError.dataCorruptedError(forKey: .fixture, in: c, debugDescription: "Invalid fixture")
            }
            fixtures = [FixtureState(name: name, level: level,
                active: try c.decode(Bool.self, forKey: .active),
                overridden: try c.decode(Bool.self, forKey: .overridden),
                faderMode: (try? c.decode(String.self, forKey: .faderMode)) == "absolute" ? "absolute" : "relative")]
        } else { fixtures = [] }
    }
    private enum Key: String, CodingKey { case fixtures, fixture, level, active, overridden, faderMode, qlc }
}

/// Queue policy is shared by the socket writer and deterministic unit tests.
enum SendQueue {
    static func append(_ fields: [String: Any], to messages: inout [[String: Any]]) {
        if fields["type"] as? String == "set",
           let index = messages.lastIndex(where: { $0["fixture"] as? String == fields["fixture"] as? String }),
           messages[index]["type"] as? String == "set" {
            messages[index] = fields
        } else { messages.append(fields) }
    }
    static func readyIndex(_ messages: [[String: Any]], lastSet: [String: ContinuousClock.Instant], now: ContinuousClock.Instant) -> Int? {
        var seen = Set<String>()
        for (i, fields) in messages.enumerated() {
            guard let name = fields["fixture"] as? String else { return i }
            guard seen.insert(name).inserted else { continue }
            if fields["type"] as? String != "set" || lastSet[name].map({ now >= $0 + .nanoseconds(33_333_334) }) != false { return i }
        }
        return nil
    }
}

@MainActor
final class ServerConnection {
    private var url: URL
    private weak var model: RemoteModel?
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var heartbeatTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var writerTask: Task<Void, Never>?
    private var outgoing: AsyncStream<Void>.Continuation?
    private var messages: [[String: Any]] = []
    private var lastSet: [String: ContinuousClock.Instant] = [:]
    private var seq = 0
    private var suspended = false
    private var pingStarted: ContinuousClock.Instant?
    private static let logger = Logger(subsystem: "<REDACTED>", category: "protocol")

    init(url: URL, model: RemoteModel) { self.url = url; self.model = model }
    func retarget(to newURL: URL) { url = newURL }
    func reconnectImmediately(force: Bool = false) {
        if let socket { disconnected(socket) }
        retryTask?.cancel(); retryTask = nil
        suspended = false
        connect()
    }
    private func connect() {
        guard !suspended else { return }
        guard let identity = try? DeviceIdentity.load() else {
            model?.disconnected()
            retryTask = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
                self?.connect()
            }
            return
        }
        model?.deviceID = identity.id
        let ws = URLSession.shared.webSocketTask(with: url)
        socket = ws; seq = 0; lastSet.removeAll()
        let stream = AsyncStream<Void>(bufferingPolicy: .bufferingNewest(1)) { outgoing = $0 }
        ws.resume()
        writerTask = Task { [weak self] in
            do {
                for await _ in stream {
                    guard let self else { return }
                    while !self.messages.isEmpty {
                        guard !Task.isCancelled, self.socket === ws else { return }
                        guard let index = SendQueue.readyIndex(self.messages, lastSet: self.lastSet, now: .now) else {
                            // Wake promptly for a newly queued fixture without sharing its throttle.
                            try await Task.sleep(for: .milliseconds(1))
                            continue
                        }
                        var fields = self.messages.remove(at: index)
                        let type = fields["type"] as? String
                        if type != "hello" {
                            guard let name = fields["fixture"] as? String, self.model?.canOperate(name) == true else { continue }
                            self.seq += 1; fields["seq"] = self.seq
                        }
                        let data = try JSONSerialization.data(withJSONObject: fields)
                        try await ws.send(.string(String(decoding: data, as: UTF8.self)))
                        guard self.socket === ws, !Task.isCancelled else { return }
                        if type == "set", let name = fields["fixture"] as? String { self.lastSet[name] = .now }
                    }
                }
            } catch { self?.disconnected(ws) }
        }
        enqueue(["type": "hello", "device": identity.id, "key": identity.key, "proto": 2,
                 "app": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"])
        receiveTask = Task { [weak self] in
            do {
                while !Task.isCancelled {
                    let message = try await ws.receive()
                    guard let self, self.socket === ws else { return }
                    let data: Data
                    switch message {
                    case .string(let text): data = Data(text.utf8)
                    case .data(let bytes): data = bytes
                    @unknown default: continue
                    }
                    do {
                        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
                        switch envelope.type {
                        case "state": self.model?.receive(try JSONDecoder().decode(ServerState.self, from: data))
                        case "rejected", "shutdown": self.disconnected(ws); return
                        default: break
                        }
                    } catch { Self.logger.error("Ignoring invalid server message") }
                }
            } catch { self?.disconnected(ws) }
        }
        // A pending ping has its own 4 s deadline. Check at 100 ms resolution,
        // independently of receive(), so a silent or stalled socket cannot stay active.
        heartbeatTask = Task { [weak self] in
            var nextPing = ContinuousClock.now + .seconds(2)
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
                guard let self, self.socket === ws else { return }
                let now = ContinuousClock.now
                if let started = self.pingStarted {
                    if now - started >= .seconds(4) { self.disconnected(ws); return }
                } else if now >= nextPing {
                    self.pingStarted = now
                    nextPing = now + .seconds(2)
                    ws.sendPing { [weak self] error in
                        Task { @MainActor in
                            guard let self, self.socket === ws else { return }
                            if error != nil { self.disconnected(ws) }
                            else { self.pingStarted = nil }
                        }
                    }
                }
            }
        }
    }

    private struct Envelope: Decodable { let type: String }

    func suspend() {
        suspended = true
        retryTask?.cancel()
        if let socket { disconnected(socket) }
        retryTask?.cancel()
        retryTask = nil
        messages.removeAll()
    }

    func discardInvalidMutations() {
        messages.removeAll { fields in
            guard let name = fields["fixture"] as? String else { return false }
            return model?.canOperate(name) != true
        }
    }


    private func disconnected(_ ws: URLSessionWebSocketTask) {
        guard socket === ws else { return }
        socket = nil
        model?.disconnected()
        receiveTask?.cancel()
        heartbeatTask?.cancel()
        writerTask?.cancel()
        outgoing?.finish()
        outgoing = nil
        messages.removeAll()
        pingStarted = nil
        ws.cancel(with: .goingAway, reason: nil)
        guard !suspended else { return }
        retryTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(1)) } catch { return }
            self?.connect()
        }
    }

    private func enqueue(_ fields: [String: Any]) {
        SendQueue.append(fields, to: &messages)
        outgoing?.yield(())
    }
    func setLevel(_ level: Int, fixture: String) {
        guard socket != nil, model?.canOperate(fixture) == true else { return }
        enqueue(["type": "set", "fixture": fixture, "level": level])
    }
    func toggle(on: Bool, fixture: String) {
        guard socket != nil, model?.canOperate(fixture) == true else { return }
        enqueue(["type": on ? "on" : "off", "fixture": fixture])
    }
}
