// TrashRoutes.swift
// /api/trash: Documents/Recently Deleted, kept 30 days, with an index.json that remembers the original name.
// A port of backend/app/routers/trash.py.

import Foundation

final class TrashStore {
    static let shared = TrashStore()

    static let keepDays = 30
    static let indexName = "index.json"

    let lock = NSRecursiveLock()

    private init() {}

    var folder: URL { return EngineConfig.trashDir }
    private var indexURL: URL { return folder.appendingPathComponent(TrashStore.indexName) }

    func readIndex() -> [String: Any] {
        return EngineJSON.readObject(indexURL) ?? [:]
    }

    func writeIndex(_ data: [String: Any]) {
        try? EngineFS.atomicWrite(EngineJSON.encode(data), to: indexURL)
    }

    /// Called by the routes that move a file here; keeps its original name and deletion time.
    func record(_ trashed: URL, original: String, kind: String) {
        lock.lock()
        defer { lock.unlock() }
        var data = readIndex()
        let rec: [String: Any] = ["original": original, "kind": kind, "deleted": Date().timeIntervalSince1970]
        data[trashed.lastPathComponent] = rec
        writeIndex(data)
    }

    func files() -> [URL] {
        return EngineFS.names(folder)
            .filter { !$0.hasPrefix(".") && $0 != TrashStore.indexName }
            .map { folder.appendingPathComponent($0) }
            .filter { EngineFS.isFile($0) }
    }

    func safeFile(_ id: String) throws -> URL {
        if id.isEmpty || id.contains("/") || id.hasPrefix(".") || id == TrashStore.indexName || id.contains("\u{0}") {
            throw EngineError(400, "That is not a deleted item.")
        }
        let p = folder.appendingPathComponent(id)
        if !EngineFS.isFile(p) { throw EngineError(404, "That item is no longer in Recently Deleted.") }
        return p
    }

    struct Meta {
        let id: String
        let name: String
        let original: String
        let kind: String
        let deleted: Double
        let size: Int64
        let daysLeft: Int

        var json: [String: Any] {
            return ["id": id, "name": name, "original": original, "kind": kind, "deleted": deleted, "size": size, "daysLeft": daysLeft]
        }
    }

    func meta(_ path: URL, _ data: [String: Any]) -> Meta {
        let st = EngineFS.stat(path)
        let id = path.lastPathComponent
        var original = id
        var kind = id.hasSuffix(EngineConfig.projectExt) ? "movie" : "export"
        var deleted = st?.modified ?? Date().timeIntervalSince1970
        if let rec = data[id] as? [String: Any], let o = rec["original"] as? String, let k = rec["kind"] as? String {
            original = o
            kind = k
            deleted = EngineJSON.number(rec["deleted"], fallback: deleted)
        }
        var name = original
        if (kind == "movie" || kind == CharacterStore.kind || kind == ScenesStore.kind) && original.lowercased().hasSuffix(EngineConfig.projectExt) {
            name = String(original.dropLast(EngineConfig.projectExt.count))
        }
        let age = Date().timeIntervalSince1970 - deleted
        let left = max(0, Int(Double(TrashStore.keepDays) - (age / 86400).rounded(.down)))
        return Meta(id: id, name: name, original: original, kind: kind, deleted: deleted, size: st?.size ?? 0, daysLeft: left)
    }

    /// Deletes items trashed more than keepDays ago; returns how many went.
    @discardableResult
    func sweep(now: Date = Date()) -> Int {
        let cutoff = now.timeIntervalSince1970 - Double(TrashStore.keepDays) * 86400
        var gone = 0
        lock.lock()
        defer { lock.unlock() }
        var data = readIndex()
        var stamped = false
        for p in files() {
            let id = p.lastPathComponent
            if data[id] == nil {
                // No record: the 30 days start now, since a moved file keeps its old modified time.
                let m = meta(p, data)
                let rec: [String: Any] = ["original": m.original, "kind": m.kind, "deleted": now.timeIntervalSince1970]
                data[id] = rec
                stamped = true
                continue
            }
            if meta(p, data).deleted < cutoff {
                EngineFS.remove(p)
                data.removeValue(forKey: id)
                gone += 1
            }
        }
        let live = Set(files().map { $0.lastPathComponent })
        var pruned: [String: Any] = [:]
        for (k, v) in data where live.contains(k) { pruned[k] = v }
        if gone > 0 || stamped || pruned.count != data.count {
            writeIndex(pruned)
        }
        return gone
    }
}

final class TrashRoutes: APIRoutes {
    let prefix = "/trash"
    private let table = RouteTable()
    private let store = TrashStore.shared

    init() {
        table.add("GET", "/trash") { [unowned self] c in try self.list(c) }
        table.add("POST", "/trash/{item_id}/restore") { [unowned self] c in try self.restore(c) }
        table.add("DELETE", "/trash/{item_id}") { [unowned self] c in try self.purge(c) }
        table.add("DELETE", "/trash") { [unowned self] c in try self.empty(c) }
    }

    func handle(_ request: APIRequest) async -> APIResponse? {
        if !table.handles(request) { return nil }
        return await EngineWork.run { return self.table.dispatch(request) }
    }

    private func list(_ c: RouteContext) throws -> APIResponse {
        store.lock.lock()
        defer { store.lock.unlock() }
        let data = store.readIndex()
        var items = store.files().map { store.meta($0, data) }
        items.sort { $0.deleted > $1.deleted }
        return APIResponse.json(["folder": store.folder.path, "keepDays": TrashStore.keepDays, "items": items.map { $0.json }])
    }

    private func restore(_ c: RouteContext) throws -> APIResponse {
        store.lock.lock()
        defer { store.lock.unlock() }
        let path = try store.safeFile(c.param("item_id"))
        var data = store.readIndex()
        let meta = store.meta(path, data)
        let parts = EngineText.splitName(meta.original)
        let dst: URL
        if meta.kind == "movie" {
            let stem = parts.ext.lowercased() == EngineConfig.projectExt ? parts.stem : meta.original
            // names are unique across the whole library, stack folders included
            var n = 2
            var name = stem
            while LibraryStore.shared.findMovie(name) != nil {
                name = "\(stem) \(n)"
                n += 1
            }
            dst = EngineConfig.libraryDir.appendingPathComponent(name + EngineConfig.projectExt)
        } else if meta.kind == CharacterStore.kind {
            let stem = parts.ext.lowercased() == EngineConfig.projectExt ? parts.stem : meta.original
            dst = EngineFS.freePath(EngineConfig.charactersDir, stem: stem, ext: EngineConfig.projectExt)
        } else if meta.kind == ScenesStore.kind {
            let stem = parts.ext.lowercased() == EngineConfig.projectExt ? parts.stem : meta.original
            dst = EngineFS.freePath(ScenesStore.shared.root, stem: stem, ext: EngineConfig.projectExt)
        } else {
            dst = EngineFS.freePath(EngineConfig.exportsDir, stem: parts.stem, ext: parts.ext)
        }
        try EngineFS.safeMove(path, dst)
        data.removeValue(forKey: path.lastPathComponent)
        store.writeIndex(data)
        return APIResponse.json(["restored": dst.lastPathComponent, "kind": meta.kind])
    }

    private func purge(_ c: RouteContext) throws -> APIResponse {
        let id = c.param("item_id")
        store.lock.lock()
        defer { store.lock.unlock() }
        let path = try store.safeFile(id)
        var data = store.readIndex()
        EngineFS.remove(path)
        data.removeValue(forKey: path.lastPathComponent)
        store.writeIndex(data)
        return APIResponse.json(["deleted": id])
    }

    private func empty(_ c: RouteContext) throws -> APIResponse {
        store.lock.lock()
        defer { store.lock.unlock() }
        var data = store.readIndex()
        let files = store.files()
        for p in files {
            EngineFS.remove(p)
            data.removeValue(forKey: p.lastPathComponent)
        }
        store.writeIndex(data)
        return APIResponse.json(["deleted": files.count])
    }
}
