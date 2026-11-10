import XCTest
@testable import DimmerRemote

@MainActor
final class ProtocolTests: XCTestCase {
    private func decode(_ fixtures: String, extra: String = "") throws -> ServerState {
        try JSONDecoder().decode(ServerState.self, from: Data("{\"qlc\":\"connected\",\"fixtures\":\(fixtures)\(extra)}".utf8))
    }
    private func entry(_ name: String = "中央", level: Int = 178, mode: String = "relative") -> String {
        "{\"name\":\"\(name)\",\"level\":\(level),\"active\":true,\"overridden\":false,\"faderMode\":\"\(mode)\"}"
    }
    func testAuthoritativeArrayAndFallback() throws {
        XCTAssertTrue(try decode("[]", extra: ",\"fixture\":\"legacy\",\"level\":999").fixtures.isEmpty)
        let legacy = try JSONDecoder().decode(ServerState.self, from: Data("{\"qlc\":\"connected\",\"fixture\":\"中央\",\"level\":42,\"active\":true,\"overridden\":false}".utf8))
        XCTAssertEqual(legacy.fixtures.first?.level, 42)
        XCTAssertEqual(try decode("[\(entry(mode: "future"))]").fixtures.first?.faderMode, "relative")
        XCTAssertEqual(try decode("[\((0..<6).map { entry("F\($0)") }.joined(separator: ","))]").fixtures.count, 4)
        XCTAssertThrowsError(try decode("null"))
        XCTAssertThrowsError(try decode("[\(entry()),\(entry())]"))
    }
    func testInvalidEntryKeepsPreviousState() throws {
        let model = RemoteModel()
        model.receive(try decode("[\(entry())]"))
        for invalid in [entry(level: 256), entry(""), "{\"name\":\"right\"}", "false", entry().replacingOccurrences(of: "true", with: "1")] {
            do { model.receive(try decode("[\(entry()),\(invalid)]")); XCTFail("accepted invalid entry") }
            catch { }
            XCTAssertEqual(model.fixtures.map(\.id), ["中央"])
            XCTAssertEqual(model.fixtures[0].level, 178)
            XCTAssertEqual(model.server, .connected)
        }
    }
    func testReassignmentPreservesSurvivingGesture() throws {
        let model = RemoteModel()
        model.receive(try decode("[\(entry()),\(entry("右"))]"))
        let center = model.fixtures[0]
        model.dragBegan(center)
        model.setLevel(90, fixture: center)
        model.receive(try decode("[\(entry("右")),\(entry(level: 20)),\(entry("奥"))]"))
        XCTAssertTrue(model.fixtures[1] === center)
        XCTAssertTrue(center.dragging)
        XCTAssertEqual(center.level, 90)
        model.background()
        XCTAssertFalse(center.dragging)
        XCTAssertFalse(model.canOperate(center.id))
        model.setLevel(1, fixture: center)
        XCTAssertEqual(center.level, 90)
        model.foreground()
        XCTAssertFalse(model.canOperate(center.id))
    }
    func testCrossingSingleMultiBoundaryEndsDrags() throws {
        let model = RemoteModel()
        model.receive(try decode("[\(entry())]"))
        let center = model.fixtures[0]
        model.dragBegan(center)
        let generation = center.inputGeneration
        model.receive(try decode("[\(entry()),\(entry("右"))]"))
        XCTAssertTrue(model.fixtures[0] === center)
        XCTAssertFalse(center.dragging)
        XCTAssertGreaterThan(center.inputGeneration, generation)
        model.dragBegan(center)
        model.receive(try decode("[\(entry())]"))
        XCTAssertFalse(center.dragging)
    }

    func testRemovedFixtureCannotControlReassignedName() throws {
        let model = RemoteModel()
        model.receive(try decode("[\(entry())]"))
        let removed = model.fixtures[0]
        model.dragBegan(removed)
        model.receive(try decode("[]"))
        XCTAssertFalse(removed.dragging)
        model.receive(try decode("[\(entry(level: 42))]"))
        model.setLevel(1, fixture: removed)
        model.toggle(removed)
        XCTAssertEqual(model.fixtures[0].level, 42)
    }
    func testEchoReconciliationPerFixture() async throws {
        let model = RemoteModel()
        model.receive(try decode("[\(entry()),\(entry("右"))]"))
        let first = model.fixtures[0], second = model.fixtures[1]
        model.setLevel(10, fixture: first)
        model.dragBegan(second)
        model.setLevel(40, fixture: second)
        model.receive(try decode("[\(entry(level: 20)),\(entry("右", level: 80))]"))
        XCTAssertEqual(first.level, 10)
        try await Task.sleep(for: .milliseconds(550))
        XCTAssertEqual(first.level, 20)
        XCTAssertEqual(second.level, 40)
        model.dragEnded(second)
        XCTAssertEqual(second.level, 80)
    }
    func testQueuePreservesOffAndCoalescesPerFixture() {
        var queue: [[String: Any]] = []
        func add(_ type: String, _ name: String, _ value: Int = 0) {
            SendQueue.append(["type": type, "fixture": name, "level": value], to: &queue)
        }
        add("set", "F", 1); add("off", "F"); add("set", "F", 2)
        XCTAssertEqual(queue.map { $0["type"] as! String }, ["set", "off", "set"])
        add("set", "G", 4); add("set", "F", 3)
        XCTAssertEqual(queue.count, 4)
        XCTAssertEqual(queue[2]["level"] as? Int, 3)
        let now = ContinuousClock.now
        XCTAssertEqual(SendQueue.readyIndex(queue, lastSet: ["F": now], now: now), 3)
        XCTAssertEqual(SendQueue.readyIndex(queue, lastSet: ["F": now], now: now + .milliseconds(34)), 0)
    }
    func testIdentityValidation() {
        XCTAssertTrue(DeviceIdentity.validID("B31EJ4"))
        for value in ["b31ej4", "IIIIII", "OOOOOO", "ABC", "ＡBCDEF"] { XCTAssertFalse(DeviceIdentity.validID(value)) }
        let key = String(repeating: "A", count: 43)
        XCTAssertTrue(DeviceIdentity.validKey(key))
        for value in [key + "=", String(repeating: "A", count: 42), String(repeating: "A", count: 42) + "B", String(repeating: "/", count: 43)] { XCTAssertFalse(DeviceIdentity.validKey(value)) }
    }
    func testServerDefaultAndPrivateIPv4() {
        let defaults = UserDefaults(suiteName: "ProtocolTests")!
        defaults.removePersistentDomain(forName: "ProtocolTests")
        XCTAssertEqual(ServerAddress.resolve(defaults: defaults, bundle: .main).absoluteString, "wss://<HOST>/ws")
        XCTAssertEqual(ServerAddress.resolve(defaults: defaults, bundle: Bundle(for: ProtocolTests.self)).absoluteString, "wss://<HOST>/ws")
        defaults.set("<HOST>", forKey: "serverAddress")
        XCTAssertEqual(ServerAddress.resolve(defaults: defaults).host, "<HOST>")
        defaults.removePersistentDomain(forName: "ProtocolTests")
        for host in ["<HOST>", "<HOST>", "<HOST>", "<HOST>"] { XCTAssertTrue(ServerAddress.isPrivateIPv4(host)) }
        for host in ["<HOST>", "<HOST>", "127.0.0.1", "<HOST>", "192.168.0.256", "10.0.1", "10..0.1", "::1"] { XCTAssertFalse(ServerAddress.isPrivateIPv4(host)) }
    }
}
