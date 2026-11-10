import SwiftUI

/// The level bar between the name/percentage and the device information. It stays clear of
/// the top edge (Notification Center) and the bottom edge (home gesture); the owner marked
/// this range on a real phone (2026-10-16). Purely visual: the modes below handle touches.
struct LevelBar: View {
    let level: Int
    let enabled: Bool

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottom) {
                Theme.track
                Rectangle()
                    .fill(enabled ? Theme.fill : Theme.borderMuted)
                    .frame(height: proxy.size.height * CGFloat(level) / 255)
            }
        }
    }
}

/// Relative mode (default): a drag anywhere on the screen moves the level by finger travel,
/// one bar height = 0-255, so the fill moves exactly with the finger without jumping when
/// touched (owner 2026-10-16: "the most intuitive"). A tap anywhere toggles.
struct RelativeSurface: View {
    let level: Int
    let enabled: Bool
    /// Finger travel in points for a full 0-255 swipe: the bar's height.
    let travel: CGFloat
    let onChange: (Int) -> Void
    let onToggle: () -> Void
    let onDragBegan: () -> Void
    let onDragEnded: () -> Void
    @GestureState private var dragStartLevel: Int?

    var body: some View {
        Theme.screen
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 9)
                    .updating($dragStartLevel) { _, startLevel, _ in
                        if startLevel == nil { startLevel = level }
                    }
                    .onChanged { value in
                        guard enabled, travel > 0 else { return }
                        onDragBegan()
                        let delta = Int((-value.translation.height / travel * 255).rounded())
                        onChange(min(max((dragStartLevel ?? level) + delta, 0), 255))
                    }
                    .exclusively(before: TapGesture().onEnded {
                        guard enabled else { return }
                        onToggle()
                    })
            )
            .onChange(of: dragStartLevel) { old, new in
                // GestureState also resets when iOS cancels a drag.
                if old != nil && new == nil { onDragEnded() }
            }
            .modifier(FaderAccessibility(level: level, enabled: enabled, onChange: onChange, onToggle: onToggle))
    }
}

/// Absolute mode (owner 2026-10-16: wants the speed of jumping straight to a level).
/// The touched height in the bar is the level at once; the caller turns taps outside the
/// bar into on/off.
struct AbsoluteFader: View {
    let level: Int
    let enabled: Bool
    let onChange: (Int) -> Void
    let onToggle: () -> Void
    let onDragBegan: () -> Void
    let onDragEnded: () -> Void
    @GestureState private var touching = false

    var body: some View {
        GeometryReader { proxy in
            let height = proxy.size.height
            LevelBar(level: level, enabled: enabled)
                .contentShape(Rectangle())
                .gesture(
                    // minimumDistance 0: the level follows the finger from the moment it lands.
                    DragGesture(minimumDistance: 0)
                        .updating($touching) { _, state, _ in state = true }
                        .onChanged { value in
                            guard enabled, height > 0 else { return }
                            onDragBegan()
                            let ratio = 1 - value.location.y / height
                            onChange(Int((min(max(ratio, 0), 1) * 255).rounded()))
                        }
                )
        }
        .onChange(of: touching) { old, new in
            // Also fires when iOS cancels the touch.
            if old && !new { onDragEnded() }
        }
        .modifier(FaderAccessibility(level: level, enabled: enabled, onChange: onChange, onToggle: onToggle))
    }
}

private struct FaderAccessibility: ViewModifier {
    let level: Int
    let enabled: Bool
    let onChange: (Int) -> Void
    let onToggle: () -> Void

    func body(content: Content) -> some View {
        content
            .accessibilityElement(children: .ignore)
            .accessibilityIdentifier("fader")
            .accessibilityLabel("明るさ")
            .accessibilityValue("\(Int((Double(level) / 255 * 100).rounded()))%")
            .accessibilityAdjustableAction { direction in
                guard enabled else { return }
                switch direction {
                case .increment: onChange(min(level + 13, 255))
                case .decrement: onChange(max(level - 13, 0))
                @unknown default: break
                }
            }
            .accessibilityAction {
                guard enabled else { return }
                onToggle()
            }
    }
}

/// Independent sibling touch views accept concurrent fingers without a shared recognizer.
struct StripTouchSurface: UIViewRepresentable {
    let level: Int
    let enabled: Bool
    let absolute: Bool
    let barFrame: CGRect
    let generation: Int
    let onChange: (Int) -> Void
    let onToggle: () -> Void
    let onBegan: () -> Void
    let onEnded: () -> Void
    func makeUIView(context: Context) -> TouchView { TouchView() }
    func updateUIView(_ view: TouchView, context: Context) {
        if view.config?.generation != generation || !enabled { view.cancel() }
        view.config = self
    }
    final class TouchView: UIView {
        var config: StripTouchSurface?
        private var touch: UITouch?
        private var start = CGPoint.zero
        private var initialLevel = 0
        private var dragged = false
        private var inBar = false
        override init(frame: CGRect) {
            super.init(frame: frame)
            isMultipleTouchEnabled = true
            isExclusiveTouch = false
            backgroundColor = .clear
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        func cancel() { touch = nil; dragged = false }
        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard touch == nil, let config, config.enabled, let first = touches.first else { return }
            touch = first; start = first.location(in: self); initialLevel = config.level; dragged = false
            inBar = config.barFrame.contains(start)
            if config.absolute && inBar { config.onBegan(); update(first) }
        }
        private func update(_ touch: UITouch) {
            guard let config, config.enabled, config.barFrame.height > 0 else { return }
            let point = touch.location(in: self)
            if config.absolute {
                guard inBar else { return }
                config.onChange(Int((min(max(1 - (point.y - config.barFrame.minY) / config.barFrame.height, 0), 1) * 255).rounded()))
            } else {
                if !dragged && hypot(point.x - start.x, point.y - start.y) >= 9 {
                    dragged = true; config.onBegan()
                }
                if dragged { config.onChange(min(max(initialLevel + Int((-(point.y - start.y) / config.barFrame.height * 255).rounded()), 0), 255)) }
            }
        }
        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let touch, touches.contains(touch) else { return }
            if let config, config.absolute && !inBar && hypot(touch.location(in: self).x - start.x, touch.location(in: self).y - start.y) >= 9 { dragged = true }
            update(touch)
        }
        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let touch, touches.contains(touch), let config else { return }
            if config.enabled {
                if config.absolute && inBar { update(touch); config.onEnded() }
                else if dragged { if !config.absolute { update(touch); config.onEnded() } }
                else { config.onToggle() }
            }
            cancel()
        }
        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let touch, touches.contains(touch) else { return }
            config?.onEnded(); cancel()
        }
    }
}
