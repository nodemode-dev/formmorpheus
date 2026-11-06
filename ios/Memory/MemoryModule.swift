import Foundation
import UIKit
import os

/// Native side of the memory budgets (phase 60).
///
/// - Forwards UIApplication.didReceiveMemoryWarningNotification to the page as `memoryWarning`.
/// - Tells the page the device's physical memory and what the app may still allocate (`memoryInfo`):
///   once when the page says `ready`, and whenever it asks with `memoryInfoRequest`.
///
/// The page side is frontend/src/platform/ipad-memory.ts. The web view restart after a killed content
/// process is handled by WebViewController, which sends `contentProcessRecovered`; the page opens the
/// newest recovery snapshot when that arrives.
enum MemoryModule {
    private static var registered = false
    private static var observers: [NSObjectProtocol] = []

    /// Call once at launch from AppModules.registerAll(). Cheap: it only adds observers and handlers.
    static func register() {
        if registered { return }
        registered = true

        let center = NotificationCenter.default
        let warning = center.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: OperationQueue.main
        ) { _ in
            var payload = MemoryModule.info()
            payload["time"] = NSNumber(value: Date().timeIntervalSince1970)
            Bridge.shared.send("memoryWarning", payload)
        }
        observers.append(warning)

        Bridge.shared.on("memoryInfoRequest") { _ in
            Bridge.shared.send("memoryInfo", MemoryModule.info())
        }
        Bridge.shared.on("ready") { _ in
            Bridge.shared.send("memoryInfo", MemoryModule.info())
        }
    }

    /// Bytes of physical memory and the bytes this app may still allocate before the system ends it.
    /// os_proc_available_memory() is the app's own allowance; the web view's content process has its own
    /// limit that no API reports, so the page treats this as a hint only.
    static func info() -> [String: Any] {
        var out: [String: Any] = [:]
        out["physicalMemory"] = NSNumber(value: ProcessInfo.processInfo.physicalMemory)
        out["availableMemory"] = NSNumber(value: os_proc_available_memory())
        return out
    }
}
