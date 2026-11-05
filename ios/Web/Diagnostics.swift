import Foundation
import UIKit
import os

/// Native side of Diagnostics. The page sends {type: 'diag', payload: {...probe results...}}.
/// This adds the device facts, writes one JSON file to Documents/Diagnostics and shows the share sheet.
enum Diagnostics {
    static func register() {
        Bridge.shared.on("diag") { payload in
            Diagnostics.handle(pagePayload: payload)
        }
    }

    // MARK: Handling

    private static func handle(pagePayload: [String: Any]) {
        let report: [String: Any] = [
            "generatedAt": isoString(Date()),
            "app": appFacts(),
            "native": nativeFacts(),
            "page": sanitize(pagePayload)
        ]
        guard let url = write(report) else {
            Bridge.shared.send("diagSaved", ["ok": false])
            return
        }
        Bridge.shared.send("diagSaved", ["ok": true, "name": url.lastPathComponent])
        // Only the full report opens the share sheet. A follow-up (the Pencil test run afterwards) is saved to
        // Documents/Diagnostics without a second sheet.
        if (pagePayload["final"] as? Bool) == true {
            present(url)
        }
    }

    // MARK: Facts

    private static func appFacts() -> [String: Any] {
        let info = Bundle.main.infoDictionary ?? [:]
        var facts: [String: Any] = [
            "bundleIdentifier": Bundle.main.bundleIdentifier ?? "",
            "version": info["CFBundleShortVersionString"] as? String ?? "",
            "build": info["CFBundleVersion"] as? String ?? ""
        ]
        #if DEBUG
        facts["configuration"] = "Debug"
        #else
        facts["configuration"] = "Release"
        #endif
        return facts
    }

    private static func nativeFacts() -> [String: Any] {
        let process = ProcessInfo.processInfo
        var facts: [String: Any] = [
            "deviceModelIdentifier": modelIdentifier(),
            "systemName": UIDevice.current.systemName,
            "systemVersion": UIDevice.current.systemVersion,
            "operatingSystemVersion": process.operatingSystemVersionString,
            "physicalMemoryBytes": NSNumber(value: process.physicalMemory),
            "availableMemoryBytes": os_proc_available_memory(),
            "activeProcessorCount": process.activeProcessorCount,
            "thermalState": thermalName(process.thermalState),
            "lowPowerMode": process.isLowPowerModeEnabled
        ]

        var scene: UIWindowScene?
        for candidate in UIApplication.shared.connectedScenes {
            if let windowScene = candidate as? UIWindowScene {
                scene = windowScene
                if candidate.activationState == .foregroundActive { break }
            }
        }
        if let screen = scene?.screen {
            let screenFacts: [String: Any] = [
                "widthPoints": Double(screen.bounds.width),
                "heightPoints": Double(screen.bounds.height),
                "scale": Double(screen.scale),
                "nativeScale": Double(screen.nativeScale),
                "maximumFramesPerSecond": screen.maximumFramesPerSecond
            ]
            facts["screen"] = screenFacts
        }
        if let size = scene?.coordinateSpace.bounds.size {
            let windowFacts: [String: Any] = ["width": Double(size.width), "height": Double(size.height)]
            facts["windowSizePoints"] = windowFacts
        }

        if let home = try? URL(fileURLWithPath: NSHomeDirectory()).resourceValues(forKeys: [
            .volumeAvailableCapacityForImportantUsageKey,
            .volumeTotalCapacityKey
        ]) {
            if let free = home.volumeAvailableCapacityForImportantUsage {
                facts["diskFreeBytes"] = NSNumber(value: free)
            }
            if let total = home.volumeTotalCapacity {
                facts["diskTotalBytes"] = total
            }
        }
        return facts
    }

    /// The machine identifier, for example "iPad16,5".
    private static func modelIdentifier() -> String {
        var system = utsname()
        uname(&system)
        let mirror = Mirror(reflecting: system.machine)
        var identifier = ""
        for child in mirror.children {
            guard let value = child.value as? Int8, value != 0 else { continue }
            identifier.append(Character(UnicodeScalar(UInt8(bitPattern: value))))
        }
        return identifier
    }

    private static func thermalName(_ state: ProcessInfo.ThermalState) -> String {
        switch state {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "unknown"
        }
    }

    // MARK: Writing

    private static func write(_ report: [String: Any]) -> URL? {
        guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return nil
        }
        let folder = documents.appendingPathComponent("Diagnostics", isDirectory: true)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd-HHmmss"
        let name = "diagnostics-" + formatter.string(from: Date()) + ".json"
        let file = folder.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            guard JSONSerialization.isValidJSONObject(report) else { return nil }
            let data = try JSONSerialization.data(
                withJSONObject: report,
                options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            )
            try data.write(to: file, options: [.atomic])
            return file
        } catch {
            NSLog("Diagnostics write failed: %@", String(describing: error))
            return nil
        }
    }

    /// Makes any value safe for JSONSerialization: NaN and infinity become null, unknown types become text.
    private static func sanitize(_ value: Any) -> Any {
        if value is NSNull { return value }
        if let number = value as? NSNumber {
            let double = number.doubleValue
            if double.isNaN || double.isInfinite { return NSNull() }
            return number
        }
        if let text = value as? String { return text }
        if let dictionary = value as? [String: Any] {
            var clean: [String: Any] = [:]
            for (key, item) in dictionary { clean[key] = sanitize(item) }
            return clean
        }
        if let array = value as? [Any] {
            return array.map { sanitize($0) }
        }
        return String(describing: value)
    }

    private static func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        return formatter.string(from: date)
    }

    // MARK: Sharing

    private static func present(_ file: URL) {
        DispatchQueue.main.async {
            guard let top = topViewController() else { return }
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            // iPad requires an anchor for the popover.
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = top.view
                popover.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
            top.present(sheet, animated: true)
        }
    }

    /// The view controller to present from (shared with FileBridge).
    static func topViewController() -> UIViewController? {
        var window: UIWindow?
        for candidate in UIApplication.shared.connectedScenes {
            guard let scene = candidate as? UIWindowScene, scene.activationState == .foregroundActive else { continue }
            window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first
            if window != nil { break }
        }
        var top = window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}
