// PencilController: everything the Apple Pencil adds beyond web pointer events.
//
//   - attaches PencilTouchObserver to the web view and sends its samples to the page, one `pencil` message per frame
//   - UIPencilInteraction: double tap and squeeze (iPadOS 17.5+), with the hover pose
//   - UIHoverGestureRecognizer: hover pose (distance, altitude, azimuth, roll), at most one `hoverPose` per frame
//   - haptics on request (`haptic` message): UICanvasFeedbackGenerator and UIImpactFeedbackGenerator
//   - the system's Pencil preferences, sent as `pencilPrefs`, so Settings can say "follow system"
//   - a clock exchange (`pencilClockPing` -> `pencilClock`) so the page can turn touch timestamps into performance.now()
//
// The shell calls `PencilController.shared.attach(to: webView)` once, right after it creates the web view.
// Page to native messages used here: pencilClockPing, pencilPrefsRequest, pencilConfig, haptic.
// Native to page messages sent here: pencil, hoverPose, squeeze, doubleTap, pencilPrefs, pencilClock.

import UIKit
import WebKit

@MainActor
private final class DisplayLinkProxy: NSObject {
    weak var target: PencilController?

    @objc func tick(_ link: CADisplayLink) {
        target?.tick()
    }
}

@MainActor
final class PencilController: NSObject, UIPencilInteractionDelegate, UIGestureRecognizerDelegate {
    static let shared = PencilController()

    private weak var webView: WKWebView?
    private var observer: PencilTouchObserver?
    private var hoverRecognizer: UIHoverGestureRecognizer?
    private var interaction: UIPencilInteraction?
    private var link: CADisplayLink?
    private let proxy = DisplayLinkProxy()
    private var bridgeRegistered = false

    private var sequence = 0
    private var lastActivity: CFTimeInterval = 0
    private var wasTouching = false
    private var lastPoint = CGPoint.zero

    private var hoverEnabled = true
    private var hoverPending: [String: Any]?

    private var canvasFeedback: UICanvasFeedbackGenerator?
    private var impactFeedback: [Int: UIImpactFeedbackGenerator] = [:]

    private override init() {
        super.init()
        proxy.target = self
    }

    // MARK: Attach

    /// Call once after the web view exists. Calling it again with the same web view does nothing.
    func attach(to webView: WKWebView) {
        if self.webView === webView { return }
        detach()
        self.webView = webView

        let observer = PencilTouchObserver(target: nil, action: nil)
        observer.onActivity = { [weak self] in self?.wake() }
        webView.addGestureRecognizer(observer)
        self.observer = observer

        let hover = UIHoverGestureRecognizer(target: self, action: #selector(hoverChanged(_:)))
        hover.delegate = self
        webView.addGestureRecognizer(hover)
        self.hoverRecognizer = hover

        let pencil = UIPencilInteraction(delegate: self)
        pencil.isEnabled = true
        webView.addInteraction(pencil)
        self.interaction = pencil

        let displayLink = CADisplayLink(target: proxy, selector: #selector(DisplayLinkProxy.tick(_:)))
        displayLink.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        displayLink.isPaused = true
        displayLink.add(to: .main, forMode: .common)
        self.link = displayLink

        registerBridge()
        NotificationCenter.default.addObserver(self, selector: #selector(appDidBecomeActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        sendPrefs()
    }

    func detach() {
        link?.invalidate()
        link = nil
        if let observer = observer { observer.view?.removeGestureRecognizer(observer) }
        if let hover = hoverRecognizer { hover.view?.removeGestureRecognizer(hover) }
        if let pencil = interaction { webView?.removeInteraction(pencil) }
        observer = nil
        hoverRecognizer = nil
        interaction = nil
        canvasFeedback = nil
        impactFeedback.removeAll()
        NotificationCenter.default.removeObserver(self)
        webView = nil
    }

    @objc private func appDidBecomeActive() {
        sendPrefs()
    }

    // MARK: Bridge

    private func register(_ type: String, _ body: @escaping @MainActor (PencilController, [String: Any]) -> Void) {
        Bridge.shared.on(type) { [weak self] payload in
            guard let self = self else { return }
            if Thread.isMainThread {
                MainActor.assumeIsolated { body(self, payload) }
            } else {
                Task { @MainActor in body(self, payload) }
            }
        }
    }

    private func registerBridge() {
        if bridgeRegistered { return }
        bridgeRegistered = true
        register("pencilClockPing") { me, payload in
            // The answer carries the uptime at the moment we read it; the page halves the round trip.
            me.send("pencilClock", ["id": payload["id"] ?? 0, "up": ProcessInfo.processInfo.systemUptime * 1000])
        }
        register("pencilPrefsRequest") { me, _ in
            me.sendPrefs()
        }
        register("pencilConfig") { me, payload in
            if let hover = payload["hover"] as? Bool { me.hoverEnabled = hover }
            if let observe = payload["observe"] as? Bool { me.observer?.isEnabled = observe }
        }
        register("haptic") { me, payload in
            let kind = payload["kind"] as? String ?? "impactLight"
            let intensity = CGFloat((payload["intensity"] as? NSNumber)?.doubleValue ?? 1)
            var point = me.lastPoint
            if let x = payload["x"] as? NSNumber, let y = payload["y"] as? NSNumber {
                point = CGPoint(x: x.doubleValue, y: y.doubleValue)
            }
            me.playHaptic(kind: kind, at: point, intensity: intensity)
        }
    }

    private func send(_ type: String, _ payload: [String: Any]) {
        Bridge.shared.send(type, payload)
    }

    // MARK: Frame loop

    private func wake() {
        lastActivity = CACurrentMediaTime()
        link?.isPaused = false
    }

    fileprivate func tick() {
        let now = CACurrentMediaTime()
        if let observer = observer {
            let touching = observer.isTouching
            if touching && !wasTouching { canvasFeedback?.prepare() }
            wasTouching = touching
            if observer.hasData {
                let drained = observer.drain()
                sequence += 1
                // JSON cannot carry NaN or infinity, and a bad number must not cost the whole message.
                let finite: ([Double]) -> [Double] = { $0.map { $0.isFinite ? $0 : 0 } }
                var payload: [String: Any] = ["k": sequence, "s": finite(drained.samples), "u": finite(drained.updates)]
                if drained.predictedChanged { payload["p"] = finite(drained.predicted) }
                if drained.samples.count >= PencilWire.sampleStride {
                    let n = drained.samples.count - PencilWire.sampleStride
                    lastPoint = CGPoint(x: drained.samples[n + 3], y: drained.samples[n + 4])
                }
                send("pencil", payload)
                lastActivity = now
            }
        }
        if let pose = hoverPending {
            hoverPending = nil
            send("hoverPose", pose)
            lastActivity = now
        }
        // Nothing for a second and no touch down: let the display link sleep.
        if now - lastActivity > 1.0 && observer?.isTouching != true {
            observer?.failIfIdle(force: true)
            link?.isPaused = true
        }
    }

    // MARK: Hover

    @objc private func hoverChanged(_ recognizer: UIHoverGestureRecognizer) {
        guard hoverEnabled, let view = recognizer.view else { return }
        let state: String
        switch recognizer.state {
        case .began: state = "began"
        case .changed: state = "changed"
        case .ended, .cancelled, .failed: state = "ended"
        default: return
        }
        let point = recognizer.location(in: view)
        lastPoint = point
        // A trackpad or mouse pointer also hovers; it has no height and no tilt. The page decides what to do with `pencil`.
        let altitude = Double(recognizer.altitudeAngle)
        let height = Double(recognizer.zOffset)
        let isPencil = height > 0 || altitude < Double.pi / 2 - 0.001
        hoverPending = [
            "state": state,
            "x": Double(point.x),
            "y": Double(point.y),
            "z": height,
            "altitude": altitude,
            "azimuth": Double(recognizer.azimuthAngle(in: view)),
            "roll": Double(recognizer.rollAngle),
            "pencil": isPencil,
            "t": ProcessInfo.processInfo.systemUptime * 1000,
        ]
        wake()
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        return true
    }

    // MARK: Double tap and squeeze

    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
        send("doubleTap", gesturePayload(phase: "ended", pose: tap.hoverPose, time: tap.timestamp))
    }

    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        send("squeeze", gesturePayload(phase: phaseName(squeeze.phase), pose: squeeze.hoverPose, time: squeeze.timestamp))
    }

    private func gesturePayload(phase: String, pose: UIPencilHoverPose?, time: TimeInterval) -> [String: Any] {
        var payload: [String: Any] = ["phase": phase, "t": time * 1000, "hasPose": pose != nil]
        if let pose = pose {
            payload["x"] = Double(pose.location.x)
            payload["y"] = Double(pose.location.y)
            payload["z"] = Double(pose.zOffset)
            payload["altitude"] = Double(pose.altitudeAngle)
            payload["azimuth"] = Double(pose.azimuthAngle)
            payload["roll"] = Double(pose.rollAngle)
        }
        return payload
    }

    private func phaseName(_ phase: UIPencilInteraction.Phase) -> String {
        switch phase {
        case .began: return "began"
        case .changed: return "changed"
        case .ended: return "ended"
        case .cancelled: return "cancelled"
        @unknown default: return "ended"
        }
    }

    // MARK: System preferences

    private func actionName(_ action: UIPencilPreferredAction) -> String {
        switch action {
        case .ignore: return "ignore"
        case .switchEraser: return "switchEraser"
        case .switchPrevious: return "switchPrevious"
        case .showColorPalette: return "showColorPalette"
        case .showInkAttributes: return "showInkAttributes"
        case .showContextualPalette: return "showContextualPalette"
        case .runSystemShortcut: return "runSystemShortcut"
        @unknown default: return "ignore"
        }
    }

    private func sendPrefs() {
        send("pencilPrefs", [
            "tap": actionName(UIPencilInteraction.preferredTapAction),
            "squeeze": actionName(UIPencilInteraction.preferredSqueezeAction),
            "pencilOnly": UIPencilInteraction.prefersPencilOnlyDrawing,
            "hoverPreview": UIPencilInteraction.prefersHoverToolPreview,
        ])
    }

    // MARK: Haptics

    private func impactStyle(_ kind: String) -> UIImpactFeedbackGenerator.FeedbackStyle {
        // The page's generic kinds (tap, select, snap, success, warning, error) and the explicit impact names.
        switch kind {
        case "impactMedium", "success": return .medium
        case "impactHeavy", "error": return .heavy
        case "impactSoft", "select": return .soft
        case "impactRigid", "warning": return .rigid
        default: return .light
        }
    }

    private func playHaptic(kind: String, at point: CGPoint, intensity: CGFloat) {
        guard let view = webView else { return }
        switch kind {
        case "alignment", "snap":
            if canvasFeedback == nil { canvasFeedback = UICanvasFeedbackGenerator(view: view) }
            canvasFeedback?.alignmentOccurred(at: point)
        case "pathCompleted":
            if canvasFeedback == nil { canvasFeedback = UICanvasFeedbackGenerator(view: view) }
            canvasFeedback?.pathCompleted(at: point)
        default:
            let style = impactStyle(kind)
            if impactFeedback[style.rawValue] == nil {
                impactFeedback[style.rawValue] = UIImpactFeedbackGenerator(style: style, view: view)
            }
            impactFeedback[style.rawValue]?.impactOccurred(intensity: min(1, max(0, intensity)), at: point)
        }
    }
}
