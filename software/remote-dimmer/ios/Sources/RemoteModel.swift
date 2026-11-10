import Foundation
import Observation

enum ServerLink: Equatable { case connected, reconnecting }
enum Blocker: Equatable { case serverUnreachable, qlcDisconnected, lockedByDirectQLC }

@MainActor @Observable
final class LocalFixture: Identifiable {
    let id: String
    var level: Int
    var active: Bool
    var overridden: Bool
    var faderMode: String
    var lastNonZeroLevel: Int
    var dragging = false
    var inputGeneration = 0
    var lastLocalChange = ContinuousClock.now - .seconds(1)
    var serverLevel: Int
    @ObservationIgnored var echoTask: Task<Void, Never>?
    init(_ state: FixtureState) {
        id = state.name; level = state.level; serverLevel = state.level
        active = state.active; overridden = state.overridden; faderMode = state.faderMode
        lastNonZeroLevel = state.level > 0 ? state.level : 255
    }
    func cancelDrag() { dragging = false; inputGeneration += 1; echoTask?.cancel() }
    func reconcile() {
        echoTask?.cancel()
        guard !dragging else { return }
        let deadline = lastLocalChange + .milliseconds(500)
        if ContinuousClock.now >= deadline {
            level = serverLevel
            if level > 0 { lastNonZeroLevel = level }
        } else {
            echoTask = Task { [weak self] in
                do { try await ContinuousClock().sleep(until: deadline) } catch { return }
                self?.reconcile()
            }
        }
    }
}

@MainActor @Observable
final class RemoteModel {
    var server: ServerLink = .reconnecting
    var fixtures: [LocalFixture] = []
    var qlcConnected = true
    var foregroundActive = true
    var deviceID = ""
    private(set) var serverURL = ServerAddress.resolve()
    private(set) var isMock = false
    @ObservationIgnored private var connection: ServerConnection?
    var serverAddress: String { (serverURL.host ?? "") + (serverURL.port.map { ":\($0)" } ?? "") }
    var offersVenueWiFi: Bool { server == .reconnecting && ServerAddress.isPrivateIPv4(serverURL.host ?? "") }
    func start() {
        guard !isMock, connection == nil else { return }
        connection = ServerConnection(url: serverURL, model: self)
        if foregroundActive { connection?.reconnectImmediately() }
    }
    func foreground() {
        foregroundActive = true
        guard !isMock else { return }
        disconnected()
        serverURL = ServerAddress.resolve()
        connection?.retarget(to: serverURL)
        connection?.reconnectImmediately(force: true)
    }
    func background() {
        foregroundActive = false
        disconnected()
        connection?.suspend()
    }
    func disconnected() {
        server = .reconnecting
        for fixture in fixtures { fixture.cancelDrag() }
    }
    func receive(_ message: ServerState) {
        guard foregroundActive else { return }
        server = .connected
        qlcConnected = message.qlc == "connected"
        let previous = Dictionary(uniqueKeysWithValues: fixtures.map { ($0.id, $0) })
        let names = Set(message.fixtures.map(\.name))
        for fixture in fixtures where !names.contains(fixture.id) { fixture.cancelDrag() }
        // Crossing 1 ↔ 2+ swaps the whole touch surface (ControlPanel ↔ MultiPanel), which may
        // vanish without delivering a cancel. End every drag so no flag stays stuck "dragging".
        if (fixtures.count > 1) != (message.fixtures.count > 1) {
            for fixture in fixtures { fixture.cancelDrag() }
        }
        fixtures = message.fixtures.map { state in
            guard let local = previous[state.name] else { return LocalFixture(state) }
            if (local.active && !state.active) || !qlcConnected || local.faderMode != state.faderMode { local.cancelDrag() }
            local.active = state.active; local.overridden = state.overridden; local.faderMode = state.faderMode
            local.serverLevel = state.level
            local.reconcile()
            return local
        }
        connection?.discardInvalidMutations()
    }
    func blocker(_ fixture: LocalFixture? = nil) -> Blocker? {
        if server != .connected { return .serverUnreachable }
        if !qlcConnected { return .qlcDisconnected }
        if let fixture, !fixture.active { return .lockedByDirectQLC }
        return nil
    }
    func canOperate(_ name: String) -> Bool {
        foregroundActive && fixtures.contains { $0.id == name && blocker($0) == nil }
    }
    func setLevel(_ level: Int, fixture: LocalFixture) {
        guard fixtures.contains(where: { $0 === fixture }), canOperate(fixture.id) else { return }
        fixture.level = min(max(level, 0), 255)
        if fixture.level > 0 { fixture.lastNonZeroLevel = fixture.level }
        fixture.lastLocalChange = .now
        connection?.setLevel(fixture.level, fixture: fixture.id)
        if !isMock { fixture.reconcile() }
    }
    func toggle(_ fixture: LocalFixture) {
        guard fixtures.contains(where: { $0 === fixture }), canOperate(fixture.id) else { return }
        connection?.toggle(on: fixture.level == 0, fixture: fixture.id)
        if fixture.level > 0 { fixture.lastNonZeroLevel = fixture.level; fixture.level = 0 }
        else { fixture.level = fixture.lastNonZeroLevel }
        fixture.lastLocalChange = .now
        if !isMock { fixture.reconcile() }
    }
    func dragBegan(_ fixture: LocalFixture) {
        guard fixtures.contains(where: { $0 === fixture }), canOperate(fixture.id) else { return }
        fixture.dragging = true; fixture.echoTask?.cancel()
    }
    func dragEnded(_ fixture: LocalFixture) {
        guard fixtures.contains(where: { $0 === fixture }), fixture.dragging else { return }
        fixture.dragging = false
        if canOperate(fixture.id) { connection?.setLevel(fixture.level, fixture: fixture.id) }
        if !isMock { fixture.reconcile() }
    }
    enum MockScenario: String, CaseIterable {
        case unassigned, active, activeAbsolute, off, overridden, locked, offline, multi2, multi4
    }
    func apply(_ scenario: MockScenario) {
        isMock = true; deviceID = "B31EJ4"; foregroundActive = true; server = .connected
        var states: [FixtureState] = []
        switch scenario {
        case .unassigned: break
        case .active: states = [.init(name: "中央", level: 178)]
        case .activeAbsolute: states = [.init(name: "中央", level: 178, faderMode: "absolute")]
        case .off: states = [.init(name: "中央", level: 0)]
        case .overridden: states = [.init(name: "中央", level: 178, overridden: true)]
        case .locked: states = [.init(name: "中央", level: 102, active: false, overridden: true)]
        case .offline: states = [.init(name: "中央", level: 178, active: false)]; server = .reconnecting
        case .multi2: states = [.init(name: "中央", level: 178), .init(name: "右", level: 102, overridden: true)]
        case .multi4: states = [.init(name: "中央", level: 178), .init(name: "右", level: 0), .init(name: "左", level: 102, active: false, overridden: true), .init(name: "奥", level: 178, faderMode: "absolute")]
        }
        fixtures = states.map(LocalFixture.init)
        if scenario == .off { fixtures.first?.lastNonZeroLevel = 178 }
    }
    func applyLaunchScenario(_ defaults: UserDefaults = .standard) {
        if let name = defaults.string(forKey: "mockState"), let scenario = MockScenario(rawValue: name) { apply(scenario) }
    }
}

/// Where the lighting server is. The address is not typed in the app (owner 2026-10-15);
/// it can be changed in the iOS Settings app (owner 2026-10-16), host or host:port.
/// Order: `-serverURL` launch argument (development) > Settings > Info.plist default.
enum ServerAddress {
    static let defaultPort = 8765
    static func isPrivateIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0.isASCII && $0.isNumber }) }),
              parts.allSatisfy({ Int($0).map { (0...255).contains($0) } == true }) else { return false }
        let n = parts.map { Int($0)! }
        return n[0] == 10 || (n[0] == 172 && (16...31).contains(n[1])) || (n[0] == 192 && n[1] == 168)
    }

    static func resolve(defaults: UserDefaults = .standard, bundle: Bundle = .main) -> URL {
        if let value = defaults.string(forKey: "serverURL"), let url = webSocketURL(value) { return url }
        if let value = defaults.string(forKey: "serverAddress"), let url = webSocketURL(value) { return url }
        if let value = bundle.object(forInfoDictionaryKey: "DimmerServerURL") as? String,
           let url = webSocketURL(value) { return url }
        return URL(string: "wss://<HOST>/ws")!
    }

    /// Accepts a full ws:// or wss:// URL, or host[:port]; anything else is nil.
    static func webSocketURL(_ text: String) -> URL? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.contains(" ") else { return nil }
        if value.contains("://") {
            guard let url = URL(string: value), ["ws", "wss"].contains(url.scheme ?? ""),
                  url.host?.isEmpty == false else { return nil }
            return url
        }
        guard let url = URL(string: "ws://" + value), url.host?.isEmpty == false,
              url.path.isEmpty, url.query == nil else { return nil }
        return URL(string: "ws://\(url.host!):\(url.port ?? defaultPort)/ws")
    }
}
