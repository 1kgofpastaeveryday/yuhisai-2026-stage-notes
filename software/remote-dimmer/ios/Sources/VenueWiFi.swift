import NetworkExtension
import SwiftUI

/// The venue's dedicated lighting Wi-Fi (owner 2026-10-16: a dedicated SSID/passphrase,
/// built into the app from Config/Venue.xcconfig). iOS asks the operator to confirm the join.
enum VenueWiFi {
    static var ssid: String? { value("VenueWiFiSSID") }
    static var passphrase: String? { value("VenueWiFiPassphrase") }

    private static func value(_ key: String) -> String? {
        guard let text = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !text.isEmpty, !text.hasPrefix("$(") else { return nil }
        return text
    }

    /// True when the phone is on the network afterwards (joined now or already there).
    static func join() async -> Bool {
        guard let ssid, let passphrase else { return false }
        let configuration = NEHotspotConfiguration(ssid: ssid, passphrase: passphrase, isWEP: false)
        // Keep the network, so the phone rejoins it by itself next time.
        configuration.joinOnce = false
        do {
            try await NEHotspotConfigurationManager.shared.apply(configuration)
            return true
        } catch let error as NSError where error.domain == NEHotspotConfigurationErrorDomain
                    && error.code == NEHotspotConfigurationError.alreadyAssociated.rawValue {
            return true
        } catch {
            return false
        }
    }
}

/// Shown with the "disconnected from the server" banner (owner 2026-10-16).
struct VenueWiFiButton: View {
    @State private var joining = false

    var body: some View {
        if VenueWiFi.ssid != nil {
            Button {
                joining = true
                Task {
                    _ = await VenueWiFi.join()
                    joining = false
                }
            } label: {
                Text("会場照明用Wi-Fiに接続する")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.textPrimary)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Theme.track, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.borderMuted, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(joining)
            .accessibilityIdentifier("joinVenueWiFi")
        }
    }
}
