// CharactersRoutes.swift
// /api/characters: saved characters, one .fmo each in Documents/Characters, so the Files app shows them.
// A port of backend/app/routers/characters.py, which follows /api/library: the same entry shape, the zip check,
// the part file and atomic replace, rename with {to}, and delete to Recently Deleted (restored to Characters).

import Foundation

final class CharacterStore {
    static let shared = CharacterStore()

    let lock = NSRecursiveLock()

    static let ext = EngineConfig.projectExt
    static let kind = "character"

    private init() {}

    var root: URL { return EngineConfig.charactersDir }

    func cleanName(_ name: String) throws -> String {
        var stem = name
        if name.lowercased().hasSuffix(CharacterStore.ext) { stem = String(name.dropLast(CharacterStore.ext.count)) }
        stem = EngineText.stripDots(EngineText.strip(EngineText.replaceBad(stem, with: "-")))
        if stem.isEmpty || EngineText.length(stem) > 180 {
            throw EngineError(400, "That character name cannot be used.")
        }
        return stem
    }

    func stem(_ url: URL) -> String {
        return String(url.lastPathComponent.dropLast(CharacterStore.ext.count))
    }

    func files() -> [URL] {
        return EngineFS.names(root)
            .filter { $0.hasSuffix(CharacterStore.ext) && !$0.hasPrefix(".") }
            .sorted()
            .map { root.appendingPathComponent($0) }
            .filter { EngineFS.isFile($0) }
    }

    func find(_ stem: String) -> URL? {
        let p = root.appendingPathComponent(stem + CharacterStore.ext)
        return EngineFS.isFile(p) ? p : nil
    }

    func path(_ name: String) throws -> URL {
        let s = try cleanName(name)
        return root.appendingPathComponent(s + CharacterStore.ext)
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

final class CharactersRoutes: APIRoutes {
    let prefix = "/characters"
    private let table = RouteTable()
    private let store = CharacterStore.shared

    init() {
        table.add("GET", "/characters") { [unowned self] c in try self.list(c) }
        table.add("GET", "/characters/{name}") { [unowned self] c in try self.read(c) }
        table.add("GET", "/characters/{name}/poster") { [unowned self] c in try self.poster(c) }
        table.add("PUT", "/characters/{name}") { [unowned self] c in try self.write(c) }
        table.add("POST", "/characters/{name}/rename") { [unowned self] c in try self.rename(c) }
        table.add("DELETE", "/characters/{name}") { [unowned self] c in try self.delete(c) }
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
        if !EngineFS.isFile(path) { throw EngineError(404, "No character by that name.") }
        return path
    }

    private func read(_ c: RouteContext) throws -> APIResponse {
        let path = try existing(c)
        guard let data = try? Data(contentsOf: path, options: .mappedIfSafe) else {
            throw EngineError(404, "No character by that name.")
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
        let body = try c.limited(EngineConfig.maxProjectBytes, "The character is too large to save.")
        if body.count < 4 || Array(body.prefix(4)) != [0x50, 0x4B, 0x03, 0x04] {
            throw EngineError(400, "That is not a FormMorpheus character.")
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
        let dst = store.root.appendingPathComponent(stem + CharacterStore.ext)
        // a change of case only is the same file on a case-insensitive volume
        if let other = store.find(stem), !(EngineFS.exists(other) && EngineFS.exists(src) && EngineFS.sameFile(other, src)) {
            throw EngineError(409, "A character with that name already exists.")
        }
        store.lock.lock()
        defer { store.lock.unlock() }
        try EngineFS.replace(src, dst)
        return APIResponse.json(store.entry(dst))
    }

    private func delete(_ c: RouteContext) throws -> APIResponse {
        let src = try existing(c)
        let dst = EngineConfig.trashDir.appendingPathComponent("\(store.stem(src)) \(EngineText.stamp())\(CharacterStore.ext)")
        store.lock.lock()
        defer { store.lock.unlock() }
        try EngineFS.safeMove(src, dst)
        TrashStore.shared.record(dst, original: src.lastPathComponent, kind: CharacterStore.kind)
        return APIResponse.json(["deleted": store.stem(src), "kept": dst.path])
    }
}
