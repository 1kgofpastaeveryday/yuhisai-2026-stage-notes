import XCTest

@MainActor
final class DimmerRemoteUITests: XCTestCase {
    func testMockFader() {
        let app = XCUIApplication()
        app.launchArguments = ["-mockState", "active"]
        app.launch()
        exerciseFader(app)
    }

    func testMockAbsoluteFader() {
        let app = XCUIApplication()
        app.launchArguments = ["-mockState", "activeAbsolute"]
        app.launch()
        let fader = app.descendants(matching: .any)["fader"]
        XCTAssertTrue(fader.waitForExistence(timeout: 5))
        let bar = fader.frame
        let origin = app.coordinate(withNormalizedOffset: .zero)
        // The bar sits between the percentage and the device information.
        XCTAssertGreaterThan(bar.minY, 150)
        XCTAssertLessThan(bar.maxY, app.frame.height - 150)
        // Touching its middle jumps straight to about 50%.
        fader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let half = percent(fader)
        XCTAssertEqual(Double(half), 50, accuracy: 3)
        // A tap above the bar toggles off and back on.
        let above = origin.withOffset(CGVector(dx: bar.midX, dy: bar.minY - 30))
        above.tap()
        XCTAssertEqual(percent(fader), 0)
        above.tap()
        XCTAssertEqual(percent(fader), half)
        // Near the bottom of the bar is near 0%; a tap below it toggles.
        fader.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98)).tap()
        XCTAssertLessThan(percent(fader), 5)
        origin.withOffset(CGVector(dx: bar.midX, dy: bar.maxY + 30)).tap()
        XCTAssertEqual(percent(fader), 0)
    }

    func testMockOfflineOffersVenueWiFi() {
        let app = XCUIApplication()
        app.launchArguments = ["-mockState", "offline", "-serverURL", "ws://<HOST>:8765/ws"]
        app.launch()
        let button = app.buttons["joinVenueWiFi"]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        XCTAssertTrue(button.isHittable)
        // Connected: no Wi-Fi button.
        app.terminate()
        app.launchArguments = ["-mockState", "active"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["fader"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["joinVenueWiFi"].exists)
    }

    func testRemainingDimmerScenarios() {
        let app = XCUIApplication()
        for scenario in ["unassigned", "off", "overridden", "locked"] {
            app.launchArguments = ["-mockState", scenario]
            app.launch()
            let fader = app.descendants(matching: .any)["fader"]
            if scenario == "unassigned" {
                XCTAssertTrue(app.staticTexts["B31EJ4"].waitForExistence(timeout: 5))
                XCTAssertFalse(fader.exists)
            } else {
                XCTAssertTrue(fader.waitForExistence(timeout: 5))
                if scenario == "off" { XCTAssertEqual(percent(fader), 0) }
                if scenario == "overridden" { XCTAssertTrue(app.staticTexts["照明卓の操作が優先されています。"].exists) }
                if scenario == "locked" {
                    XCTAssertTrue(app.staticTexts["照明卓で直接操作されています。"].exists)
                    let before = fader.value as? String
                    fader.tap()
                    XCTAssertEqual(fader.value as? String, before)
                }
            }
            app.terminate()
        }
    }
    func testMulti2() { exerciseMulti("multi2", names: ["中央", "右"]) }
    func testMulti4() { exerciseMulti("multi4", names: ["中央", "右", "左", "奥"]) }
    private func exerciseMulti(_ scenario: String, names: [String]) {
        let app = XCUIApplication()
        app.launchArguments = ["-mockState", scenario]
        app.launch()
        let strips = names.map { app.descendants(matching: .any)["strip-" + $0] }
        for (index, strip) in strips.enumerated() {
            XCTAssertTrue(strip.waitForExistence(timeout: 5))
            XCTAssertEqual(strip.label, names[index])
        }
        XCTAssertEqual(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "strip-")).count, names.count)
        let values = strips.map { $0.value as? String }
        strips[0].tap()
        XCTAssertEqual(percent(strips[0]), 0)
        for i in 1..<strips.count { XCTAssertEqual(strips[i].value as? String, values[i]) }
        strips[0].tap()
        XCTAssertEqual(strips[0].value as? String, values[0])
    }
    func testPublicOfflineHidesWiFi() {
        let app = XCUIApplication()
        app.launchArguments = ["-mockState", "offline", "-serverURL", "wss://<HOST>/ws"]
        app.launch()
        XCTAssertTrue(app.staticTexts["サーバーから切断されています。"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["joinVenueWiFi"].exists)
    }

    private func exerciseFader(_ app: XCUIApplication) {
        let fader = app.descendants(matching: .any)["fader"]
        XCTAssertTrue(fader.waitForExistence(timeout: 5))
        let before = percent(fader)
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        // 100 pt of the default 500 pt full travel = +20%.
        let end = start.withOffset(CGVector(dx: 0, dy: -100))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
        let after = percent(fader)
        XCTAssertEqual(Double(after - before), 20, accuracy: 3)
        print("FADER before=\(before) after=\(after)")
        fader.tap()
        XCTAssertEqual(fader.value as? String, "0%")
        fader.tap()
        XCTAssertEqual(percent(fader), after)
    }

    private func percent(_ fader: XCUIElement) -> Int {
        Int((fader.value as? String ?? "").replacingOccurrences(of: "%", with: "")) ?? -1000
    }

    private func action(_ path: String) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:8766/" + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let result = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        print("LIVE \(path): \(String(decoding: data, as: UTF8.self))")
        return result
    }

    func testLiveFader() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["DIMMER_LIVE_TEST"] == "1",
                          "Run e2e/run-live.mjs to enable the live backend test.")
        let app = XCUIApplication()
        app.launchArguments = ["-serverURL", "ws://127.0.0.1:8765/ws"]
        app.launch()
        let fader = app.descendants(matching: .any)["fader"]
        XCTAssertTrue(fader.waitForExistence(timeout: 8))
        XCTAssertEqual(percent(fader), 0)
        XCTAssertGreaterThan(app.staticTexts["中央"].frame.minY, 60)
        XCTAssertLessThan(app.staticTexts["127.0.0.1:8765"].frame.maxY, app.frame.height - 20)
        _ = try await action("snapshot?name=control")
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        // 100 pt of the default 500 pt full travel = +20%.
        let end = start.withOffset(CGVector(dx: 0, dy: -100))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
        let after = percent(fader)
        XCTAssertEqual(Double(after), 20, accuracy: 3)
        try await Task.sleep(for: .milliseconds(600))
        let drag = try await action("read")
        XCTAssertEqual(Double(drag["channel"] as! Int) / 255 * 100, Double(after), accuracy: 1)
        _ = try await action("snapshot?name=drag")
        fader.tap()
        XCTAssertEqual(fader.value as? String, "0%")
        try await Task.sleep(for: .milliseconds(600))
        let off = try await action("read")
        XCTAssertEqual(off["channel"] as? Int, 0)
        fader.tap()
        try await Task.sleep(for: .milliseconds(600))
        let on = try await action("read")
        XCTAssertEqual(on["channel"] as? Int, drag["channel"] as? Int)
        XCTAssertEqual(percent(fader), after)

        _ = try await action("override")
        XCTAssertTrue(app.staticTexts["照明卓の操作が優先されています。"].waitForExistence(timeout: 3))
        _ = try await action("snapshot?name=overridden")
        _ = try await action("clearOverride")
        let overrideBanner = app.staticTexts["照明卓の操作が優先されています。"]
        XCTAssertTrue(overrideBanner.waitForNonExistence(timeout: 3))
        _ = try await action("direct")
        XCTAssertTrue(app.staticTexts["照明卓で直接操作されています。"].waitForExistence(timeout: 3))
        _ = try await action("snapshot?name=locked")

        let disconnect = app.staticTexts["サーバーから切断されています。"]
        var time = Date()
        let stopped = try await action("stop")
        XCTAssertTrue(disconnect.waitForExistence(timeout: max(0.1, 5 - Date().timeIntervalSince(time))))
        print("LIVE graceful disconnect seconds=\(Date().timeIntervalSince(time))")
        XCTAssertEqual(stopped["channel"] as? Int, 0)
        XCTAssertEqual(stopped["slider"] as? Int, 0)
        _ = try await action("snapshot?name=graceful-stop")
        time = Date()
        _ = try await action("restart")
        XCTAssertTrue(disconnect.waitForNonExistence(timeout: max(0.1, 3 - Date().timeIntervalSince(time))))
        print("LIVE restart seconds=\(Date().timeIntervalSince(time))")
        XCTAssertTrue(fader.exists)
        XCTAssertEqual(percent(fader), 0)
        XCTAssertFalse(app.staticTexts["照明卓で直接操作されています。"].exists)
        _ = try await action("snapshot?name=restarted")

        // Set a nonzero value so SIGKILL also proves the output remains unchanged.
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
        try await Task.sleep(for: .milliseconds(600))
        time = Date()
        _ = try await action("kill")
        XCTAssertTrue(disconnect.waitForExistence(timeout: max(0.1, 5 - Date().timeIntervalSince(time))))
        print("LIVE hard-kill disconnect seconds=\(Date().timeIntervalSince(time))")
        _ = try await action("snapshot?name=hard-kill")
        time = Date()
        _ = try await action("restart")
        XCTAssertTrue(disconnect.waitForNonExistence(timeout: max(0.1, 3 - Date().timeIntervalSince(time))))
        print("LIVE restart after kill seconds=\(Date().timeIntervalSince(time))")
        _ = try await action("idleStart")
        try await Task.sleep(for: .seconds(31))
        XCTAssertFalse(disconnect.exists)
        let idle = try await action("idleEnd")
        XCTAssertEqual(idle["sameConnection"] as? Bool, true)
        _ = try await action("snapshot?name=idle")
    }
}
