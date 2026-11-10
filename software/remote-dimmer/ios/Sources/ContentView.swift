import SwiftUI

struct ContentView: View {
    @Environment(RemoteModel.self) private var model
    let deviceID: String
    let localIP: String?

    var body: some View {
        Group {
            if model.fixtures.count > 1 {
                MultiPanel(deviceID: deviceID, localIP: localIP)
            } else if let fixture = model.fixtures.first {
                ControlPanel(fixture: fixture, deviceID: deviceID, localIP: localIP)
            } else {
                VStack(spacing: 0) {
                    if let banner = Banner(blocker: model.blocker(), overridden: false) {
                        banner.padding(.horizontal, 24)
                    }
                    if model.offersVenueWiFi {
                        VenueWiFiButton()
                            .padding(.horizontal, 24)
                            .padding(.top, 12)
                    }
                    Spacer()
                    // No explanatory copy (owner, 2026-10-16): the missing fader already says "unassigned".
                    VStack(spacing: 12) {
                        Text("端末ID").font(.subheadline)
                        // 95% of the screen width (owner, 2026-10-16): oversized font scaled down to fit.
                        Text(deviceID)
                            .font(.system(size: 200, weight: .medium, design: .monospaced))
                            .lineLimit(1)
                            .minimumScaleFactor(0.1)
                            .containerRelativeFrame(.horizontal) { width, _ in width * 0.95 }
                    }
                    Spacer()
                    // The ID is already shown large above; IP and server stay visible for troubleshooting.
                    InfoList(deviceID: deviceID, localIP: localIP, server: model.serverAddress, showsID: false)
                        .padding(.horizontal, 24)
                }
                .padding(.top, 16)
                .padding(.bottom, 16)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.screen.ignoresSafeArea())
        .foregroundStyle(Theme.textPrimary)

    }
}

private struct ControlPanel: View {
    @Environment(RemoteModel.self) private var model
    let fixture: LocalFixture
    let deviceID: String
    let localIP: String?
    /// Measured height of the level bar; the relative drag scale.
    @State private var barHeight: CGFloat = 0

    var body: some View {
        GeometryReader { bounds in
            Group {
                if fixture.faderMode == "absolute" {
                    absoluteLayout
                } else {
                    relativeLayout
                }
            }
            .frame(width: bounds.size.width, height: bounds.size.height)
        }
        // Name and generation: a new fixture also starts at generation 0, so replacing A with
        // B must still rebuild the view and drop A's touch (cross-review 2026-10-29).
        .id("\(fixture.id)#\(fixture.inputGeneration)")
        .defersSystemGestures(on: .vertical)
        .sensoryFeedback(.impact(weight: .medium), trigger: fixture.level > 0)
    }

    private var relativeLayout: some View {
        let generation = fixture.inputGeneration
        return ZStack {
            RelativeSurface(level: fixture.level, enabled: model.canOperate(fixture.id), travel: barHeight,
                            onChange: { if generation == fixture.inputGeneration { model.setLevel($0, fixture: fixture) } }, onToggle: { if generation == fixture.inputGeneration { model.toggle(fixture) } },
                            onDragBegan: { if generation == fixture.inputGeneration { model.dragBegan(fixture) } }, onDragEnded: { if generation == fixture.inputGeneration { model.dragEnded(fixture) } })
                .ignoresSafeArea()
            VStack(spacing: 16) {
                header
                    .padding(.horizontal, 24)
                LevelBar(level: fixture.level, enabled: model.canOperate(fixture.id))
                    .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { barHeight = $0 }
                    .allowsHitTesting(false)
                info
                    .padding(.horizontal, 24)
                    .allowsHitTesting(false)
            }
            .padding(.vertical, 16)
            .foregroundStyle(Theme.textPrimary)
        }
    }

    private var absoluteLayout: some View {
        let generation = fixture.inputGeneration
        return ZStack {
            // Everything outside the bar is the on/off tap area.
            Theme.screen
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { if generation == fixture.inputGeneration { model.toggle(fixture) } }
            VStack(spacing: 16) {
                header
                    .padding(.horizontal, 24)
                AbsoluteFader(level: fixture.level, enabled: model.canOperate(fixture.id),
                              onChange: { if generation == fixture.inputGeneration { model.setLevel($0, fixture: fixture) } }, onToggle: { if generation == fixture.inputGeneration { model.toggle(fixture) } },
                              onDragBegan: { if generation == fixture.inputGeneration { model.dragBegan(fixture) } }, onDragEnded: { if generation == fixture.inputGeneration { model.dragEnded(fixture) } })
                info
                    .padding(.horizontal, 24)
                    .allowsHitTesting(false)
            }
            .padding(.vertical, 16)
            .foregroundStyle(Theme.textPrimary)
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            // Only the Wi-Fi button takes touches here; the rest lets them through to the fader.
            Text(fixture.id).font(.system(size: 28, weight: .medium))
                .allowsHitTesting(false)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text("\(Int((Double(fixture.level) / 255 * 100).rounded()))")
                    .font(.system(size: 52, weight: .medium)).monospacedDigit()
                Text("%").font(.system(size: 22, weight: .medium))
            }
            .allowsHitTesting(false)
            // The banner slot is always reserved, so the bar below (the relative drag scale)
            // keeps its height when a banner appears mid-operation (owner 2026-10-16).
            ZStack {
                Text(" ").font(.footnote).padding(.vertical, 10).frame(maxWidth: .infinity).hidden()
                if let banner = Banner(blocker: model.blocker(fixture), overridden: fixture.overridden) {
                    banner
                }
            }
            .allowsHitTesting(false)
            if model.offersVenueWiFi {
                VenueWiFiButton()
            }
        }
    }

    private var info: some View {
        InfoList(deviceID: deviceID, localIP: localIP, server: model.serverAddress, showsID: true)
    }
}

struct Banner: View {
    let text: String
    let foreground: Color
    let background: Color

    init?(blocker: Blocker?, overridden: Bool) {
        let danger = (Theme.dangerText, Theme.dangerBackground)
        let message: String
        let colors: (Color, Color)
        switch blocker {
        case .serverUnreachable:
            message = "サーバーから切断されています。"
            colors = danger
        case .qlcDisconnected:
            // Not the operator's concern (owner, 2026-10-16): the greyed-out fader is enough.
            return nil
        case .lockedByDirectQLC:
            message = "照明卓で直接操作されています。"
            colors = danger
        case nil:
            guard overridden else { return nil }
            message = "照明卓の操作が優先されています。"
            colors = (Theme.warningText, Theme.warningBackground)
        }
        text = message
        foreground = colors.0
        background = colors.1
    }

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(background, in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct InfoList: View {
    let deviceID: String
    let localIP: String?
    let server: String
    let showsID: Bool

    var body: some View {
        VStack(spacing: 0) {
            if showsID {
                row("端末ID") {
                    Text(deviceID)
                        .font(.system(size: 15, weight: .medium, design: .monospaced))
                        .tracking(2)
                }
            }
            row("この端末の IP") {
                Text(localIP ?? "取得できません")
                    .font(.system(.subheadline, design: .monospaced))
            }
            row("サーバー") {
                Text(server)
                    .font(.system(.subheadline, design: .monospaced))
            }
        }
    }

    private func row<Value: View>(_ label: String, @ViewBuilder value: () -> Value) -> some View {
        VStack(spacing: 0) {
            Rectangle().fill(Theme.borderMuted).frame(height: 0.5)
            HStack {
                Text(label)
                    .font(.subheadline)
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                value()
            }
            .padding(.vertical, 9)
        }
    }
}

private struct MultiPanel: View {
    @Environment(RemoteModel.self) private var model
    let deviceID: String
    let localIP: String?
    var body: some View {
        VStack(spacing: 16) {
            if model.server != .connected {
                Banner(blocker: .serverUnreachable, overridden: false)
                if model.offersVenueWiFi { VenueWiFiButton() }
            }
            HStack(spacing: 4) {
                ForEach(model.fixtures) { fixture in
                    FixtureStrip(fixture: fixture)
                        .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            InfoList(deviceID: deviceID, localIP: localIP, server: model.serverAddress, showsID: true)
                .allowsHitTesting(false)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
        .defersSystemGestures(on: .vertical)
    }
}

private struct FixtureStrip: View {
    @Environment(RemoteModel.self) private var model
    let fixture: LocalFixture
    @State private var barFrame: CGRect = .zero
    private var enabled: Bool { model.canOperate(fixture.id) }
    var body: some View {
        ZStack {
            VStack(spacing: 12) {
                Text(fixture.id)
                    .font(.system(size: 26, weight: .medium))
                    .lineLimit(2).minimumScaleFactor(0.4)
                    .frame(height: 64)
                Text("\(Int((Double(fixture.level) / 255 * 100).rounded()))%")
                    .font(.system(size: 32, weight: .medium)).monospacedDigit()
                    .minimumScaleFactor(0.5).lineLimit(1)
                ZStack {
                    if model.server == .connected, let banner = Banner(blocker: model.blocker(fixture), overridden: fixture.overridden) {
                        Text(banner.text).font(.system(size: 11))
                            .foregroundStyle(banner.foreground)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(banner.background)
                    }
                }
                .frame(height: 76)
                LevelBar(level: fixture.level, enabled: enabled)
                    .onGeometryChange(for: CGRect.self, of: { $0.frame(in: .named(fixture.id)) }) { barFrame = $0 }
            }
            .allowsHitTesting(false)
            // Each sibling owns a separate UIView and its own touch identity. There is no
            // parent pan recognizer or exclusive gesture shared between strips.
            StripTouchSurface(level: fixture.level, enabled: enabled, absolute: fixture.faderMode == "absolute",
                barFrame: barFrame, generation: fixture.inputGeneration,
                onChange: { model.setLevel($0, fixture: fixture) }, onToggle: { model.toggle(fixture) },
                onBegan: { model.dragBegan(fixture) }, onEnded: { model.dragEnded(fixture) })
        }
        .coordinateSpace(name: fixture.id)
        .sensoryFeedback(.impact(weight: .medium), trigger: fixture.level > 0)
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("strip-\(fixture.id)")
        .accessibilityLabel(fixture.id)
        .accessibilityValue("\(Int((Double(fixture.level) / 255 * 100).rounded()))%")
        .accessibilityAdjustableAction { direction in
            guard enabled else { return }
            switch direction {
            case .increment: model.setLevel(fixture.level + 13, fixture: fixture)
            case .decrement: model.setLevel(fixture.level - 13, fixture: fixture)
            @unknown default: break
            }
        }
        .accessibilityAction { model.toggle(fixture) }
    }
}
