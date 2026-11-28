// ScenesRoutes.swift
// /api/scenes: the person's own scenery, one .fmo each in Documents/Scenes, beside Characters.
// A port of backend/app/routers/scenes.py and services/scenes.py, which mirror the Characters library: the same entry
// shape, the zip check, the part file and atomic replace, rename with {to}, and delete to Recently Deleted (restored to Scenes).

import Foundation

final class ScenesStore {
    static let shared = ScenesStore()

    let lock = NSRecursiveLock()

    static let ext = EngineConfig.projectExt
    static let kind = "scene"

    private init() {}

    var root: URL { return EngineConfig.folder("Scenes") }

    func cleanName(_ name: String) throws -> String {
        var stem = name
        if name.lowercased().hasSuffix(ScenesStore.ext) { stem = String(name.dropLast(ScenesStore.ext.count)) }
        stem = EngineText.stripDots(EngineText.strip(EngineText.replaceBad(stem, with: "-")))
        if stem.isEmpty || EngineText.length(stem) > 180 {
            throw EngineError(400, "That scene name cannot be used.")
        }
        return stem
    }

    func stem(_ url: URL) -> String {
        return String(url.lastPathComponent.dropLast(ScenesStore.ext.count))
    }

    func files() -> [URL] {
        let folder = root
        return EngineFS.names(folder)
            .filter { $0.hasSuffix(ScenesStore.ext) && !$0.hasPrefix(".") }
            .sorted()
            .map { folder.appendingPathComponent($0) }
            .filter { EngineFS.isFile($0) }
    }

    func find(_ stem: String) -> URL? {
        let p = root.appendingPathComponent(stem + ScenesStore.ext)
        return EngineFS.isFile(p) ? p : nil
    }

    func path(_ name: String) throws -> URL {
        let s = try cleanName(name)
        return root.appendingPathComponent(s + ScenesStore.ext)
    }

    func entry(_ url: URL) -> [String: Any] {
        let st = EngineFS.stat(url)
        return [
            "name": stem(url),
            "file": url.lastPathComponent,
            "path": url.path,
            "size": st?.size ?? 0,
            "modified": st?.modified ?? 0,
            "created": st?.created ?? 0,
        ]
    }
}

final class ScenesRoutes: APIRoutes {
    let prefix = "/scenes"
    private let table = RouteTable()
    private let store = ScenesStore.shared

    init() {
        table.add("GET", "/scenes") { [unowned self] c in try self.list(c) }
        table.add("GET", "/scenes/{name}") { [unowned self] c in try self.read(c) }
        table.add("GET", "/scenes/{name}/poster") { [unowned self] c in try self.poster(c) }
        table.add("PUT", "/scenes/{name}") { [unowned self] c in try self.write(c) }
        table.add("POST", "/scenes/{name}/rename") { [unowned self] c in try self.rename(c) }
        table.add("DELETE", "/scenes/{name}") { [unowned self] c in try self.delete(c) }
    }

    func handle(_ request: APIRequest) async -> APIResponse? {
        if !table.handles(request) { return nil }
        return await EngineWork.run { return self.table.dispatch(request) }
    }

    private func list(_ c: RouteContext) throws -> APIResponse {
        var items = store.files().map { store.entry($0) }
        items.sort { (($0["modified"] as? Double) ?? 0) > (($1["modified"] as? Double) ?? 0) }
        return APIResponse.json(["folder": store.root.path, "items": items])
    }

    private func existing(_ c: RouteContext) throws -> URL {
        let path = try store.path(c.param("name"))
        if !EngineFS.isFile(path) { throw EngineError(404, "No scene by that name.") }
        return path
    }

    private func read(_ c: RouteContext) throws -> APIResponse {
        let path = try existing(c)
        guard let data = try? Data(contentsOf: path, options: .mappedIfSafe) else {
            throw EngineError(404, "No scene by that name.")
        }
        return APIResponse.data(data, contentType: "application/octet-stream")
    }

    /// poster.png from inside the file; none is an empty 204, as the library answers.
    private func poster(_ c: RouteContext) throws -> APIResponse {
        let path = try existing(c)
        guard let zip = try? ZipReader(url: path), let e = zip.entry(named: "poster.png"),
              let data = try? zip.read(e, limit: 64 * 1024 * 1024) else {
            return EngineHTTP.noContent(contentType: "image/png")
        }
        var r = APIResponse.data(data, contentType: "image/png")
        let v = c.query("v")
        r.headers["Cache-Control"] = (v != nil && !(v ?? "").isEmpty) ? "private, max-age=300" : "no-store"
        return r
    }

    private func write(_ c: RouteContext) throws -> APIResponse {
        let path = try store.path(c.param("name"))
        let body = try c.limited(EngineConfig.maxCharacterBytes, "The scene is too large to save.")
        if body.count < 4 || Array(body.prefix(4)) != [0x50, 0x4B, 0x03, 0x04] {
            throw EngineError(400, "That is not a FormMorpheus scene.")
        }
        let tmp = EngineFS.tempBeside(path)
        defer { EngineFS.remove(tmp) }
        try EngineFS.writeFile(body, to: tmp)
        store.lock.lock()
        defer { store.lock.unlock() }
        try EngineFS.replace(tmp, path)
        return APIResponse.json(store.entry(path))
    }

    private func rename(_ c: RouteContext) throws -> APIResponse {
        let src = try existing(c)
        let to = try c.json().string("to")
        let stem = try store.cleanName(to)
        let dst = store.root.appendingPathComponent(stem + ScenesStore.ext)
        store.lock.lock()
        defer { store.lock.unlock() }
        if let other = store.find(stem), !(EngineFS.exists(other) && EngineFS.exists(src) && EngineFS.sameFile(other, src)) {
            throw EngineError(409, "A scene with that name already exists.")
        }
        try EngineFS.replace(src, dst)
        return APIResponse.json(store.entry(dst))
    }

    private func delete(_ c: RouteContext) throws -> APIResponse {
        let src = try existing(c)
        let stamp = EngineText.stamp()
        store.lock.lock()
        defer { store.lock.unlock() }
        var dst = EngineConfig.trashDir.appendingPathComponent("\(store.stem(src)) \(stamp)\(ScenesStore.ext)")
        var n = 2
        while EngineFS.exists(dst) {
            dst = EngineConfig.trashDir.appendingPathComponent("\(store.stem(src)) \(stamp) \(n)\(ScenesStore.ext)")
            n += 1
        }
        try EngineFS.safeMove(src, dst)
        TrashStore.shared.record(dst, original: src.lastPathComponent, kind: ScenesStore.kind)
        return APIResponse.json(["deleted": store.stem(src), "kept": dst.path])
    }
}
