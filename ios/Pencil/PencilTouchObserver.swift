// PencilTouchObserver: watches Apple Pencil touches on the web view without taking them.
//
// It is a gesture recognizer that never recognizes anything. cancelsTouchesInView and the two delay flags are
// false, the delegate lets every other recognizer run beside it, and it cannot be prevented by one. So the web view
// sees exactly the touches it would see without us; we only copy numbers out of them.
//
// What it records, for touches whose type is .pencil: position in the web view (points), the touch timestamp
// (system uptime in ms), force over maximum force, altitude, azimuth, barrel roll (Pencil Pro), which of those are
// still estimates, the coalesced touches, the predicted touches, and the later updates to the estimates.
//
// Wire format (all numbers, no objects):
//   sample row, stride 12:  id, phase, t, x, y, force, altitude, azimuth, roll, estimatedMask, expectingMask, updateIndex
//   update row, stride 7:   updateIndex, t, force, altitude, azimuth, roll, expectingMask
//   phase: 0 began, 1 moved, 2 ended, 3 cancelled.  Masks: 1 force, 2 azimuth, 4 altitude, 8 location, 16 roll.
//   updateIndex is -1 when the touch has none.

import UIKit
import UIKit.UIGestureRecognizerSubclass

enum PencilWire {
    static let sampleStride = 12
    static let updateStride = 7
    static let began = 0.0
    static let moved = 1.0
    static let ended = 2.0
    static let cancelled = 3.0
}

final class PencilTouchObserver: UIGestureRecognizer, UIGestureRecognizerDelegate {
    /// Real samples since the last drain (coalesced touches included, oldest first).
    private(set) var samples: [Double] = []
    /// Predicted samples from the most recent move; replaced on every move, cleared on lift.
    private(set) var predicted: [Double] = []
    /// Estimate updates since the last drain.
    private(set) var updates: [Double] = []
    /// True when `predicted` changed since the last drain.
    private var predictedDirty = false

    /// Called when there is something to send, so the controller can start its display link.
    var onActivity: (@MainActor () -> Void)?

    private var ids: [ObjectIdentifier: Int] = [:]
    private var nextId = 1
    private var active = Set<ObjectIdentifier>()
    /// Update indexes whose final values have not arrived yet.
    private var pending = Set<Int>()

    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        requiresExclusiveTouchType = false
        allowedTouchTypes = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
        delegate = self
    }

    var hasData: Bool { return !samples.isEmpty || !updates.isEmpty || predictedDirty }

    /// Hands over what was collected and empties the buffers. Reuses capacity so a frame does not allocate much.
    func drain() -> (samples: [Double], predicted: [Double], updates: [Double], predictedChanged: Bool) {
        let out = (samples: samples, predicted: predicted, updates: updates, predictedChanged: predictedDirty)
        samples.removeAll(keepingCapacity: true)
        updates.removeAll(keepingCapacity: true)
        predictedDirty = false
        return out
    }

    /// True while a Pencil touch is down.
    var isTouching: Bool { return !active.isEmpty }

    // MARK: Touches

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesBegan(touches, with: event)
        guard let view = self.view else { return }
        for touch in touches where touch.type == .pencil {
            let key = ObjectIdentifier(touch)
            ids[key] = nextId
            nextId += 1
            active.insert(key)
            append(touch, id: ids[key] ?? 0, phase: PencilWire.began, view: view)
        }
        wake()
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesMoved(touches, with: event)
        guard let view = self.view else { return }
        for touch in touches where touch.type == .pencil {
            let key = ObjectIdentifier(touch)
            guard let id = ids[key] else { continue }
            let list = event.coalescedTouches(for: touch) ?? [touch]
            for t in list { append(t, id: id, phase: PencilWire.moved, view: view) }
            predicted.removeAll(keepingCapacity: true)
            for t in event.predictedTouches(for: touch) ?? [] {
                predicted.append(contentsOf: row(t, id: id, phase: PencilWire.moved, view: view))
            }
            predictedDirty = true
        }
        wake()
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesEnded(touches, with: event)
        finish(touches, phase: PencilWire.ended)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesCancelled(touches, with: event)
        finish(touches, phase: PencilWire.cancelled)
    }

    private func finish(_ touches: Set<UITouch>, phase: Double) {
        guard let view = self.view else { return }
        for touch in touches where touch.type == .pencil {
            let key = ObjectIdentifier(touch)
            guard let id = ids[key] else { continue }
            append(touch, id: id, phase: phase, view: view)
            ids[key] = nil
            active.remove(key)
        }
        if active.isEmpty {
            predicted.removeAll(keepingCapacity: true)
            predictedDirty = true
        }
        wake()
        failIfIdle()
    }

    /// Late values for estimated properties (force, azimuth, altitude, roll arrive some milliseconds after the touch).
    override func touchesEstimatedPropertiesUpdated(_ touches: Set<UITouch>) {
        guard self.view != nil else { return }
        for touch in touches where touch.type == .pencil {
            guard let index = touch.estimationUpdateIndex else { continue }
            let expecting = touch.estimatedPropertiesExpectingUpdates
            let maxForce = touch.maximumPossibleForce
            let force = maxForce > 0 ? Double(touch.force / maxForce) : 0
            updates.append(contentsOf: [
                index.doubleValue,
                touch.timestamp * 1000,
                force,
                Double(touch.altitudeAngle),
                Double(touch.azimuthAngle(in: self.view)),
                Double(touch.rollAngle),
                mask(expecting),
            ])
            if expecting.isEmpty { pending.remove(index.intValue) }
        }
        wake()
        failIfIdle()
    }

    override func reset() {
        super.reset()
        // UIKit resets us after .failed; the buffers belong to the controller and keep their contents until drained.
        ids.removeAll()
        active.removeAll()
    }

    // The recognizer fails once every Pencil touch is up and no estimate is still on its way.
    func failIfIdle(force: Bool = false) {
        guard state == .possible else { return }
        if active.isEmpty && (pending.isEmpty || force) {
            pending.removeAll()
            state = .failed
        }
    }

    // MARK: Never in anyone's way

    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { return false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { return false }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        return true
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRequireFailureOf otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        return false
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        return false
    }

    // MARK: Rows

    private func wake() {
        onActivity?()
    }

    private func append(_ touch: UITouch, id: Int, phase: Double, view: UIView) {
        let r = row(touch, id: id, phase: phase, view: view)
        samples.append(contentsOf: r)
        if r[10] != 0 && r[11] >= 0 { pending.insert(Int(r[11])) }
    }

    private func row(_ touch: UITouch, id: Int, phase: Double, view: UIView) -> [Double] {
        let location = touch.location(in: view)
        let maxForce = touch.maximumPossibleForce
        let force = maxForce > 0 ? Double(touch.force / maxForce) : 0
        let index: Double = touch.estimationUpdateIndex?.doubleValue ?? -1
        return [
            Double(id),
            phase,
            touch.timestamp * 1000,
            Double(location.x),
            Double(location.y),
            force,
            Double(touch.altitudeAngle),
            Double(touch.azimuthAngle(in: view)),
            Double(touch.rollAngle),
            mask(touch.estimatedProperties),
            mask(touch.estimatedPropertiesExpectingUpdates),
            index,
        ]
    }

    private func mask(_ p: UITouch.Properties) -> Double {
        var m = 0
        if p.contains(.force) { m |= 1 }
        if p.contains(.azimuth) { m |= 2 }
        if p.contains(.altitude) { m |= 4 }
        if p.contains(.location) { m |= 8 }
        if p.contains(.roll) { m |= 16 }
        return Double(m)
    }
}
