// TranscodeRoutes.swift
// /api/transcode on iPad: the desktop's request and answer shapes (backend/app/routers/transcode.py), done with
// AVFoundation instead of ffmpeg. Only video is converted here. The reasons are in ios/HASHOUT_LOG.md (v0.23.0).

import Foundation
import AVFoundation
import CoreMedia
import UIKit

final class TranscodeJob: @unchecked Sendable {
    let id: String
    let kind: String
    let name: String
    let folder: URL
    var state = "running"
    var progress = 0.0
    var error = ""
    var mime = ""
    var alpha = false
    var result: URL? = nil
    var session: AVAssetExportSession? = nil
    let created = Date()
    var touched = Date()

    init(id: String, kind: String, name: String, folder: URL) {
        self.id = id
        self.kind = kind
        self.name = name
        self.folder = folder
    }
}

private struct TranscodeFailure: Error {
    let message: String
}

final class TranscodeRoutes: APIRoutes, @unchecked Sendable {
    let prefix = "/transcode"
    private let table = RouteTable()
    private let lock = NSLock()
    private var jobs: [String: TranscodeJob] = [:]

    static let maxBytes = 2 * 1024 * 1024 * 1024
    static let maxKept = 30
    static let abandonSeconds: TimeInterval = 1800

    init() {
        table.add("GET", "/transcode/capabilities") { _ in
            let r: [String: Any] = ["ffmpeg": false, "heif": false, "video": true, "engine": "avfoundation"]
            return APIResponse.json(r)
        }
        table.add("POST", "/transcode") { [unowned self] c in try self.start(c) }
        table.add("GET", "/transcode/{id}") { [unowned self] c in self.describe(try self.job(c)) }
        table.add("GET", "/transcode/{id}/result") { [unowned self] c in try self.result(c) }
        table.add("DELETE", "/transcode/{id}") { [unowned self] c in try self.cancel(c) }
    }

    func handle(_ request: APIRequest) async -> APIResponse? {
        if !table.handles(request) { return nil }
        return await EngineWork.run { return self.table.dispatch(request) }
    }

    // MARK: routes

    private func start(_ c: RouteContext) throws -> APIResponse {
        let kind = try c.requiredQuery("kind")
        if !["video", "audio", "image"].contains(kind) { throw EngineError(400, "Unknown kind.") }
        if kind == "audio" {
            throw EngineError(503, "This iPad cannot convert a sound its web view cannot decode. Convert it to WAV, AAC or MP3 first, then import that.")
        }
        if kind == "image" {
            throw EngineError(503, "This iPad cannot convert this picture. Export it as PNG or JPEG first, then import that.")
        }
        let body = try c.limited(TranscodeRoutes.maxBytes, "That video is too large to convert on this iPad (the limit is 2 GB). Export a shorter or smaller copy first.")
        if body.isEmpty { throw EngineError(400, "The file is empty.") }
        let name = c.query("name") ?? "import"
        let id = EngineText.hex(16)
        let folder = ExportPaths.jobsDir.appendingPathComponent("import-\(id)", isDirectory: true)
        let src = folder.appendingPathComponent("in" + TranscodeRoutes.suffix(name))
        do {
            try EngineFS.fm.createDirectory(at: folder, withIntermediateDirectories: true)
            try body.write(to: src)
        } catch {
            EngineFS.remove(folder)
            throw EngineError(500, "The video could not be stored for converting.")
        }
        let job = TranscodeJob(id: id, kind: kind, name: name, folder: folder)
        lock.withLock { jobs[id] = job }
        prune()
        Task.detached(priority: .userInitiated) { [self] in
            await self.convert(job, src: src)
        }
        return describe(job)
    }

    private func job(_ c: RouteContext) throws -> TranscodeJob {
        let id = c.param("id")
        guard let j = lock.withLock({ jobs[id] }) else { throw EngineError(404, "No transcode by that id.") }
        let now = Date()
        lock.withLock { j.touched = now }
        EngineFS.setModified(j.folder, now)
        return j
    }

    private func describe(_ j: TranscodeJob) -> APIResponse {
        let body: [String: Any] = lock.withLock {
            var p = j.progress
            if j.state == "running", let s = j.session { p = min(0.99, Double(s.progress)) }
            return ["id": j.id, "kind": j.kind, "state": j.state, "progress": (p * 10000).rounded() / 10000,
                    "error": j.error, "mime": j.mime, "alpha": j.alpha]
        }
        return APIResponse.json(body)
    }

    private func result(_ c: RouteContext) throws -> APIResponse {
        let j = try job(c)
        let (state, url, mime) = lock.withLock { (j.state, j.result, j.mime) }
        guard state == "done", let u = url, EngineFS.isFile(u), let data = try? Data(contentsOf: u, options: [.alwaysMapped]) else {
            throw EngineError(409, "The conversion is not finished.")
        }
        return APIResponse.data(data, contentType: mime)
    }

    private func cancel(_ c: RouteContext) throws -> APIResponse {
        let id = c.param("id")
        guard let j = lock.withLock({ jobs.removeValue(forKey: id) }) else { throw EngineError(404, "No transcode by that id.") }
        let session: AVAssetExportSession? = lock.withLock {
            if j.state == "running" { j.state = "cancelled" }
            return j.session
        }
        session?.cancelExport()
        EngineFS.remove(j.folder)
        let r: [String: Any] = ["id": id, "state": "cancelled"]
        return APIResponse.json(r)
    }

    private func prune() {
        let now = Date()
        let gone: [TranscodeJob] = lock.withLock {
            var out: [TranscodeJob] = []
            for j in jobs.values where j.state != "running" && now.timeIntervalSince(j.touched) > TranscodeRoutes.abandonSeconds {
                out.append(j)
            }
            for j in out { jobs.removeValue(forKey: j.id) }
            let done = jobs.values.filter { $0.state != "running" }.sorted { $0.created < $1.created }
            let extra = done.count - TranscodeRoutes.maxKept
            if extra > 0 {
                for j in done.prefix(extra) {
                    jobs.removeValue(forKey: j.id)
                    out.append(j)
                }
            }
            return out
        }
        for j in gone { EngineFS.remove(j.folder) }
    }

    // MARK: converting

    private func convert(_ j: TranscodeJob, src: URL) async {
        let token = await TranscodeBackground.begin()
        do {
            try await export(j, src: src)
        } catch {
            let text = (error as? TranscodeFailure)?.message ?? "This iPad could not convert \(j.name): \(error.localizedDescription)"
            lock.withLock {
                if j.state == "running" {
                    j.state = "failed"
                    j.error = text
                    j.touched = Date()
                }
                j.session = nil
            }
        }
        EngineFS.remove(src)
        await TranscodeBackground.end(token)
    }

    private func export(_ j: TranscodeJob, src: URL) async throws {
        let asset = AVURLAsset(url: src)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        guard let track = tracks.first else {
            throw TranscodeFailure(message: "\(j.name) has no video this iPad can read.")
        }
        let formats = try await track.load(.formatDescriptions)
        let look = TranscodeRoutes.inspect(formats.first)
        let alpha = look.alpha && !look.hevc
        let preset = alpha ? AVAssetExportPresetHEVCHighestQualityWithAlpha : AVAssetExportPresetHighestQuality
        let type: AVFileType = alpha ? .mov : .mp4
        guard let session = AVAssetExportSession(asset: asset, presetName: preset), session.supportedFileTypes.contains(type) else {
            throw TranscodeFailure(message: "This iPad cannot convert \(j.name) into a video the window can play.")
        }
        let out = j.folder.appendingPathComponent(alpha ? "out.mov" : "out.mp4")
        session.outputURL = out
        session.outputFileType = type
        session.shouldOptimizeForNetworkUse = true
        let going: Bool = lock.withLock {
            if j.state != "running" { return false }
            j.session = session
            return true
        }
        if !going { return }
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            session.exportAsynchronously {
                cont.resume()
            }
        }
        let size = EngineFS.stat(out)?.size ?? 0
        let finished = session.status == .completed && size > 0
        let reason = session.error?.localizedDescription ?? ""
        let now = Date()
        lock.withLock {
            j.session = nil
            if j.state != "running" { return }
            j.touched = now
            if finished {
                j.result = out
                j.mime = alpha ? "video/quicktime" : "video/mp4"
                j.alpha = alpha
                j.progress = 1
                j.state = "done"
            } else {
                j.state = "failed"
                j.error = reason.isEmpty ? "This iPad could not convert \(j.name)." : "This iPad could not convert \(j.name): \(reason)"
            }
        }
        EngineFS.setModified(j.folder, now)
    }

    static func inspect(_ format: CMFormatDescription?) -> (hevc: Bool, alpha: Bool) {
        guard let f = format else { return (false, false) }
        let sub = CMFormatDescriptionGetMediaSubType(f)
        let hevc = sub == fourCC("hvc1") || sub == fourCC("hev1")
        var alpha = false
        if let flag = CMFormatDescriptionGetExtension(f, extensionKey: kCMFormatDescriptionExtension_ContainsAlphaChannel) as? NSNumber {
            alpha = flag.boolValue
        }
        if let depth = CMFormatDescriptionGetExtension(f, extensionKey: kCMFormatDescriptionExtension_Depth) as? NSNumber, depth.intValue == 32 {
            alpha = true
        }
        return (hevc, alpha)
    }

    static func fourCC(_ s: String) -> FourCharCode {
        var v: FourCharCode = 0
        for u in s.utf8 { v = (v << 8) | FourCharCode(u) }
        return v
    }

    static func suffix(_ name: String) -> String {
        let ext = EngineText.prefix(EngineText.splitName(name).ext, 12)
        return EngineText.matches("^\\.[A-Za-z0-9]+$", ext) ? ext : ".bin"
    }
}

enum TranscodeBackground {
    static func begin() async -> BackgroundToken {
        return await MainActor.run { () -> BackgroundToken in
            let token = BackgroundToken()
            token.identifier = UIApplication.shared.beginBackgroundTask(withName: "formmorpheus convert") {
                if token.identifier != UIBackgroundTaskIdentifier.invalid {
                    UIApplication.shared.endBackgroundTask(token.identifier)
                    token.identifier = UIBackgroundTaskIdentifier.invalid
                }
            }
            return token
        }
    }

    static func end(_ token: BackgroundToken) async {
        await MainActor.run {
            if token.identifier != UIBackgroundTaskIdentifier.invalid {
                UIApplication.shared.endBackgroundTask(token.identifier)
                token.identifier = UIBackgroundTaskIdentifier.invalid
            }
        }
    }
}
