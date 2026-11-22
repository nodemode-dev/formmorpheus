// FilesRoutes.swift
// /api/files/read: streams a movie file from an absolute path the system handed the app (Open With, a Files tap).
// A port of backend/app/routers/files.py. On iPad the path must lie inside a folder the app may read: Documents,
// the temporary folder, the caches folder, and anything added to EngineConfig.extraReadableRoots (the inbox of
// opened documents). The scheme handler already limits who can call the engine, so there is no Host check here.

import Foundation

final class FilesRoutes: APIRoutes {
    let prefix = "/files"
    private let table = RouteTable()

    init() {
        table.add("GET", "/files/read") { [unowned self] c in try self.read(c) }
    }

    func handle(_ request: APIRequest) async -> APIResponse? {
        if !table.handles(request) { return nil }
        return await EngineWork.run { return self.table.dispatch(request) }
    }

    /// Folders where the shell and the document scene stage files for the page: <tmp>/Opened and Documents/Inbox.
    private func stagedRoots() -> [URL] {
        return [
            URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true).appendingPathComponent("Opened", isDirectory: true),
            EngineConfig.dataDir.appendingPathComponent("Inbox", isDirectory: true),
        ]
    }

    private func readableRoots() -> [URL] {
        var roots: [URL] = [EngineConfig.dataDir, URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)]
        if let caches = EngineFS.fm.urls(for: .cachesDirectory, in: .userDomainMask).first { roots.append(caches) }
        return roots + EngineConfig.extraReadableRoots
    }

    private func read(_ c: RouteContext) throws -> APIResponse {
        let path = try c.requiredQuery("path")
        if !path.hasPrefix("/") { throw EngineError(400, "The path must be absolute.") }
        let target = URL(fileURLWithPath: EngineConfig.remapStale(path))
        // Files staged for import (opened from Files, or picked and kept) may have any extension; anywhere else only movies.
        let staged = stagedRoots().contains { EngineConfig.isInside(target, $0) }
        if !staged && !path.lowercased().hasSuffix(EngineConfig.projectExt) {
            throw EngineError(400, "Only FormMorpheus movie files can be opened by path.")
        }
        if !EngineFS.isFile(target) { throw EngineError(404, "No file at that path.") }
        var allowed = staged
        for root in readableRoots() where EngineConfig.isInside(target, root) { allowed = true }
        if !allowed { throw EngineError(403, "Files can only be opened by the app itself.") }
        if let st = EngineFS.stat(target), st.size > Int64(EngineConfig.maxProjectBytes) {
            throw EngineError(413, "The movie is too large to open.")
        }
        guard let data = try? Data(contentsOf: target, options: .mappedIfSafe) else {
            throw EngineError(404, "No file at that path.")
        }
        var r = APIResponse.data(data, contentType: "application/octet-stream")
        r.headers["Cache-Control"] = "no-store"
        return r
    }
}
