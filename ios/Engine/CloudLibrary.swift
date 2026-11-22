// CloudLibrary.swift
// The library's second place on iPad: Library inside the Documents folder of the app's iCloud container, which the
// Files app shows as iCloud Drive > FormMorpheus. The reasons are in ios/HASHOUT_LOG.md (v0.23.0).

import Foundation

enum CloudLibrary {
    enum State: String {
        case checking
        case ready
        case signedOut
        case unavailable
    }

    private static let lock = NSLock()
    private static var state = State.checking
    private static var folder: URL? = nil
    private static var started = false
    private static var observer: NSObjectProtocol? = nil
    private static let firstCheck = DispatchGroup()
    private static let choiceKey = "formmorpheus.libraryPlace"

    static func start() {
        let first: Bool = lock.withLock {
            if started { return false }
            started = true
            firstCheck.enter()
            return true
        }
        if !first { return }
        observer = NotificationCenter.default.addObserver(forName: .NSUbiquityIdentityDidChange, object: nil, queue: nil) { _ in
            CloudLibrary.check(first: false)
        }
        check(first: true)
    }

    private static func check(first: Bool) {
        DispatchQueue.global(qos: .userInitiated).async {
            let fm = FileManager.default
            var next = State.signedOut
            var found: URL? = nil
            if fm.ubiquityIdentityToken != nil {
                next = .unavailable
                if let root = fm.url(forUbiquityContainerIdentifier: nil) {
                    let lib = root.appendingPathComponent("Documents", isDirectory: true).appendingPathComponent("Library", isDirectory: true)
                    if (try? fm.createDirectory(at: lib, withIntermediateDirectories: true)) != nil {
                        found = lib
                        next = .ready
                    }
                }
            }
            CloudLibrary.lock.withLock {
                CloudLibrary.state = next
                CloudLibrary.folder = found
            }
            if first { CloudLibrary.firstCheck.leave() }
        }
    }

    static var chosen: Bool {
        return UserDefaults.standard.string(forKey: choiceKey) == "icloud"
    }

    static func choose(_ cloud: Bool) {
        if cloud {
            UserDefaults.standard.set("icloud", forKey: choiceKey)
        } else {
            UserDefaults.standard.removeObject(forKey: choiceKey)
        }
    }

    static func current(wait: Bool = true) -> (state: State, folder: URL?) {
        if wait && !Thread.isMainThread { _ = firstCheck.wait(timeout: .now() + 10) }
        return lock.withLock { (state, state == .ready ? folder : nil) }
    }

    static func activeFolder() -> URL? {
        if !chosen { return nil }
        return current().folder
    }

    static var writableRoots: [URL] {
        if let f = current(wait: false).folder { return [f] }
        return []
    }

    static func message(_ s: State) -> String {
        switch s {
        case .ready: return ""
        case .checking: return "iCloud Drive is still being checked. Try again in a moment."
        case .signedOut: return "iCloud Drive is off on this iPad, or no one is signed in to iCloud. Turn it on in the Settings app, under your name, then iCloud, and try again."
        case .unavailable: return "iCloud Drive is on, but this app cannot reach its folder there. In the Settings app, under your name, then iCloud, check that iCloud Drive is allowed for FormMorpheus, and try again."
        }
    }

    private static func inside(_ url: URL) -> Bool {
        guard let f = current(wait: false).folder else { return false }
        return EngineConfig.isInside(url, f)
    }

    private static func pending(_ url: URL) -> Bool {
        let status = (try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?.ubiquitousItemDownloadingStatus
        guard let s = status else { return false }
        return s != .current
    }

    static func makeLocal(_ url: URL) {
        guard inside(url), pending(url) else { return }
        try? FileManager.default.startDownloadingUbiquitousItem(at: url)
        var failure: NSError? = nil
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &failure) { _ in }
    }

    static func fetchMissing(_ dirs: [URL]) {
        guard chosen, let top = current(wait: false).folder else { return }
        let mine = dirs.filter { EngineConfig.isInside($0, top) }
        if mine.isEmpty { return }
        DispatchQueue.global(qos: .utility).async {
            let fm = FileManager.default
            for dir in mine {
                for name in EngineFS.names(dir) {
                    if name.hasPrefix(".") && name.hasSuffix(".icloud") && name.count > 8 {
                        let real = String(name.dropFirst().dropLast(7))
                        try? fm.startDownloadingUbiquitousItem(at: dir.appendingPathComponent(real))
                        continue
                    }
                    let u = dir.appendingPathComponent(name)
                    if CloudLibrary.pending(u) { try? fm.startDownloadingUbiquitousItem(at: u) }
                }
            }
        }
    }
}
