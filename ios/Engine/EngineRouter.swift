// EngineRouter.swift
// The Swift engine's front door. The scheme handler (ios/Web/SchemeHandler.swift) builds an APIRequest from
// fm://localhost/api/... and calls EngineRouter.shared.handle(_:). The interface keeps calling fetch('/api/...').
//
// Contract (ios/IOS_CONTRACT in the planning notes):
//   final class EngineRouter { static let shared: EngineRouter; func handle(_ request: APIRequest) async -> APIResponse }
//   404 {"detail":"Not Found"} when no group matches; 403 {"detail":...} from the Host and Origin guard.
//
// The groups, asked in this order; each returns nil when no route of its own matches:
//   SystemRoutes     ""            /health  /capabilities  /system/library
//   LibraryRoutes    /library      list, open, save, rename, duplicate, copy-to, delete, poster, preview, tags, stacks
//   CharactersRoutes /characters   saved characters: list, open, save, rename, delete, poster
//   ScenesRoutes     /scenes       saved scenes: list, open, save, rename, delete, poster
//   BrushesRoutes    /brushes      libraries as folders, .order.json, import and export files, the migration
//   FontsRoutes      /fonts        imported fonts with the signature check
//   TrashRoutes      /trash        Recently Deleted (30 days)
//   RecoveryRoutes   /recovery     snapshots, heartbeat, the lease that replaces the live socket
//   IdeasRoutes      /ideas        Send an idea
//   FilesRoutes      /files        read a movie by path
//   SaveToRoutes     /save-to      save an export into a folder of the app's own tree
//   JobsRoutes       /jobs         (ios/Export) export jobs
//   ExportsRoutes    /exports      (ios/Export) the Exports folder
//   AudioEncodeRoutes /audio-encode (ios/Export) sound encoders
//   TranscodeRoutes  /transcode    video the window cannot decode, converted with AVFoundation
//   VoiceRoutes      /voice        AI Voice: status, the voice app on the network, the online key, speak and sounds, listening (on-device speech recognition)
// Not ported, on purpose: /proxy (a desktop-only ffmpeg and network helper), /penlink
// (Pen Link is hidden on iPad), /files/stat and /files/source (the source link's automatic update; the
// window offers Update from Source... instead). Those requests answer 404, as the desktop does for an unknown route.
//
// Storage root: EngineConfig.dataDir, the Documents folder, so the Files app shows
// Library, Characters, Scenes, Brushes, Fonts, Ideas, Recently Deleted, Recovery and Exports like the desktop data folder.
// Nothing is seeded: the backend seeds no stock brushes or example movies (starter brushes are built into the interface).

import Foundation

final class EngineRouter {
    static let shared = EngineRouter()

    /// True when the shell passes `APIRequest.path` still percent-encoded, so the engine decodes each segment.
    /// The shell builds the path from URL.path, which is already decoded, so this is false.
    static var decodesPath = false

    private let groups: [APIRoutes]

    private init() {
        CloudLibrary.start()
        EngineConfig.ensureTree()
        groups = [
            SystemRoutes(),
            LibraryRoutes(),
            CharactersRoutes(),
            ScenesRoutes(),
            BrushesRoutes(),
            FontsRoutes(),
            TrashRoutes(),
            RecoveryRoutes(),
            IdeasRoutes(),
            FilesRoutes(),
            SaveToRoutes(),
            JobsRoutes(),
            ExportsRoutes(),
            AudioEncodeRoutes(),
            TranscodeRoutes(),
            VoiceRoutes(),
        ]
        EngineMaintenance.start()
    }

    /// Call once at launch to build the folders and start the sweeps before the first request.
    func start() {
        // Touching `shared` is enough: the initialiser does the work.
    }

    func handle(_ request: APIRequest) async -> APIResponse {
        if let denied = EngineRouter.guardRequest(request) { return denied }
        for group in groups {
            if let response = await group.handle(request) { return response }
        }
        return APIResponse.error(404, "Not Found")
    }

    // MARK: Host and Origin guard

    // The desktop engine answers only to loopback hosts and refuses a state-changing request from a foreign origin.
    // Here the scheme handler is the only way in, so the same checks are a second lock: a Host that is present must be
    // localhost, and a POST, PUT or DELETE that carries an Origin must carry the app's own (fm://localhost).
    // "null" is let through because WebKit writes an opaque origin that way and the page itself can be one.
    private static let hosts: Set<String> = ["localhost", "127.0.0.1", "[::1]"]
    private static let safeMethods: Set<String> = ["GET", "HEAD", "OPTIONS"]

    private static func hostName(_ raw: String) -> String {
        let s = raw.trimmingCharacters(in: .whitespaces).lowercased()
        if s.hasPrefix("[") {
            if let end = s.firstIndex(of: "]") { return String(s[s.startIndex...end]) }
            return s
        }
        if let colon = s.lastIndex(of: ":") { return String(s[s.startIndex..<colon]) }
        return s
    }

    static func guardRequest(_ request: APIRequest) -> APIResponse? {
        if let host = request.header("host"), !host.isEmpty, !hosts.contains(hostName(host)) {
            return APIResponse.error(403, "This engine only answers to the app itself (loopback hosts).")
        }
        if !safeMethods.contains(request.method.uppercased()), let origin = request.header("origin") {
            let o = origin.trimmingCharacters(in: .whitespaces).lowercased()
            if o != "fm://localhost" && o != "null" && !o.isEmpty {
                return APIResponse.error(403, "That origin is not allowed to change anything here.")
            }
        }
        return nil
    }
}

// MARK: - Sweeps

/// What the desktop engine does on a timer: leftover part files hourly, Recently Deleted daily.
enum EngineMaintenance {
    private static var timer: DispatchSourceTimer? = nil

    static func start() {
        if timer != nil { return }
        let t = DispatchSource.makeTimerSource(queue: EngineWork.queue)
        var tick = 0
        t.schedule(deadline: .now() + 5, repeating: 3600)
        t.setEventHandler {
            _ = PartSweep.sweep()
            if tick % 24 == 0 { _ = TrashStore.shared.sweep() }
            tick += 1
        }
        t.resume()
        timer = t
    }
}

/// Leftover ".name.part" files: a write that was killed half way leaves its temporary file behind (the real file is
/// untouched, since every write goes to a part file and is renamed into place). Never swept while young.
enum PartSweep {
    static let minAgeSeconds = 3600.0

    @discardableResult
    static func sweep(now: Date = Date()) -> Int {
        let top = EngineConfig.dataDir
        let cut = now.timeIntervalSince1970 - minAgeSeconds
        var gone = 0
        if let e = FileManager.default.enumerator(atPath: top.path) {
            while let rel = e.nextObject() as? String {
                let parts = rel.split(separator: "/").map { String($0) }
                guard let name = parts.last else { continue }
                if parts.count == 1 && name == "Jobs" {
                    e.skipDescendants()   // export jobs have their own sweep
                    continue
                }
                if name.hasPrefix(".") && name.hasSuffix(".part") {
                    let u = top.appendingPathComponent(rel)
                    if EngineFS.isFile(u), let st = EngineFS.stat(u), st.modified < cut {
                        EngineFS.remove(u)
                        gone += 1
                    }
                }
            }
        }
        // snapshots nobody answered for a month would otherwise pile up for ever
        let old = now.timeIntervalSince1970 - 30 * 86400
        let rec = top.appendingPathComponent("Recovery", isDirectory: true)
        for n in EngineFS.names(rec) where !n.hasPrefix(".") {
            let u = rec.appendingPathComponent(n)
            if EngineFS.isFile(u), let st = EngineFS.stat(u), st.modified < old {
                EngineFS.remove(u)
                gone += 1
            }
        }
        return gone
    }
}
