import UIKit

/// Files the system hands the app: a tap in Files, AirDrop, Open In, a drag onto the window.
///
/// Decisions (also in ios/HASHOUT_LOG.md):
///  - A movie (.fmo) that is already inside the app's Library opens by its Library name.
///  - A movie from anywhere else is COPIED into the Library (a free name, "Name 2" and so on) and opens from there; the
///    original is never touched. The interface autosaves into the Library, so editing a copy cannot damage a file in
///    iCloud Drive or on a share. A second tap on the same file reuses the copy when the bytes are identical.
///  - Pictures, videos, sounds, brushes, fonts and other files the interface reads are copied to a temporary inbox and
///    sent as an import into the open movie.
///  - Access to the original is held only while it is copied (security scoped, coordinated for iCloud placeholders).
enum DocumentOpening {
    /// Called from the scene delegate (willConnectTo and openURLContexts). `send` delivers a bridge message to this
    /// scene's page now, or when it has loaded.
    static func handle(_ contexts: Set<UIOpenURLContext>, send: @escaping (String, [String: Any]) -> Void) {
        let urls = contexts.map { $0.url }.filter { $0.isFileURL }
        guard !urls.isEmpty else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            for url in urls {
                if let message = stage(url) {
                    DispatchQueue.main.async { send("openURL", message) }
                }
            }
        }
    }

    /// Clears the inbox of files opened in earlier runs. Called once at launch.
    static func cleanInbox() {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: inbox.path) else { return }
        let cutoff = Date().addingTimeInterval(-24 * 60 * 60)
        for name in names {
            let url = inbox.appendingPathComponent(name)
            let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            if let modified = modified, modified < cutoff {
                try? fm.removeItem(at: url)
            }
        }
    }

    // MARK: Staging

    /// <tmp>/Opened. The engine may read any file under the temporary folder (FilesRoutes).
    private static var inbox: URL {
        return URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true).appendingPathComponent("Opened", isDirectory: true)
    }

    private static func stage(_ url: URL) -> [String: Any]? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer {
            if scoped { url.stopAccessingSecurityScopedResource() }
        }
        let name = url.lastPathComponent
        let ext = url.pathExtension.lowercased()
        let isMovie = ext == "fmo"

        if isMovie, EngineConfig.isInside(url, EngineConfig.libraryDir) {
            return ["kind": "library", "name": url.deletingPathExtension().lastPathComponent]
        }

        let fm = FileManager.default
        let folder = inbox.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            NSLog("DocumentOpening: no inbox: %@", String(describing: error))
            return nil
        }
        let staged = folder.appendingPathComponent(name)
        guard copyCoordinated(from: url, to: staged) else {
            try? fm.removeItem(at: folder)
            return nil
        }

        if isMovie {
            defer { try? fm.removeItem(at: folder) }
            let stem = url.deletingPathExtension().lastPathComponent
            if let existing = identicalLibraryCopy(of: staged, stem: stem) {
                return ["kind": "library", "name": existing]
            }
            let target = EngineFS.freePath(EngineConfig.libraryDir, stem: stem, ext: ".fmo")
            do {
                try fm.moveItem(at: staged, to: target)
            } catch {
                NSLog("DocumentOpening: copy into the Library failed: %@", String(describing: error))
                return nil
            }
            return ["kind": "library", "name": target.deletingPathExtension().lastPathComponent]
        }
        return ["kind": "import", "path": staged.path, "name": name]
    }

    /// Copies with file coordination, so an iCloud Drive placeholder is downloaded first.
    private static func copyCoordinated(from source: URL, to destination: URL) -> Bool {
        var coordinationError: NSError?
        var copied = false
        let coordinator = NSFileCoordinator(filePresenter: nil)
        coordinator.coordinate(readingItemAt: source, options: [], error: &coordinationError) { readable in
            do {
                try FileManager.default.copyItem(at: readable, to: destination)
                copied = true
            } catch {
                NSLog("DocumentOpening: copy failed: %@", String(describing: error))
            }
        }
        if let error = coordinationError {
            NSLog("DocumentOpening: coordination failed: %@", String(describing: error))
        }
        return copied
    }

    /// The Library name of a movie that already holds exactly these bytes (the same file opened twice), if any.
    private static func identicalLibraryCopy(of file: URL, stem: String) -> String? {
        let fm = FileManager.default
        let library = EngineConfig.libraryDir
        var folders: [URL] = [library]
        if let names = try? fm.contentsOfDirectory(atPath: library.path) {
            for name in names {
                let sub = library.appendingPathComponent(name, isDirectory: true)
                if EngineFS.isDir(sub) { folders.append(sub) }
            }
        }
        for folder in folders {
            let candidate = folder.appendingPathComponent(stem + ".fmo")
            if fm.fileExists(atPath: candidate.path), fm.contentsEqual(atPath: candidate.path, andPath: file.path) {
                return stem
            }
        }
        return nil
    }
}
