import SwiftUI

/// Fixed dark palette: operators sit in a dark auditorium, so the screen must not
/// light up the room regardless of the system appearance setting.
enum Theme {
    static let screen = Color(hex: 0x1F1F1E)
    static let borderMuted = Color(hex: 0x444441)
    static let textPrimary = Color(hex: 0xF1EFE8)

    static let fill = Color(hex: 0x8A4F0E)
    /// The empty part of the absolute-mode bar, so its extent is visible at 0%.
    static let track = Color(hex: 0x2E2D2B)

    static let warningBackground = Color(hex: 0x412402)
    static let warningText = Color(hex: 0xFAC775)
    static let dangerBackground = Color(hex: 0x501313)
    static let dangerText = Color(hex: 0xF7C1C1)
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}
