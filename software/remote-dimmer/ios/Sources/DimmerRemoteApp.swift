import SwiftUI

@main
struct DimmerRemoteApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: RemoteModel = {
        let model = RemoteModel()
        model.applyLaunchScenario()
        return model
    }()

    var body: some Scene {
        WindowGroup {
            ContentView(deviceID: model.deviceID, localIP: LocalNetwork.wifiIPv4())
                .environment(model)
                .preferredColorScheme(.dark)
                // Operators hold the phone for a whole slot; never let it dim or lock.
                .onAppear {
                    UIApplication.shared.isIdleTimerDisabled = true
                    // Hosted unit tests must not start the app's LAN connection.
                    if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil {
                        model.start()
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        // Re-apply on every return: onAppear runs only once per launch.
                        UIApplication.shared.isIdleTimerDisabled = true
                        model.foreground()
                    } else { model.background() }
                }
        }
    }
}
