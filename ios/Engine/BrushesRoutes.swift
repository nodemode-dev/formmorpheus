// BrushesRoutes.swift
// /api/brushes: the person's brush libraries as files they can browse in the Files app:
// Documents/Brushes/<Library>/<Set>/<Brush>.brush. A port of backend/app/routers/brushes.py.
//
// A .brush is the same zip the app exports plus a small formmorpheus/brush.json inside it. Order lives in small
// .order.json files (libraries at the top, sets in a library, brush ids in a set). Starter brushes are built into
// the interface and have no file unless edited, so there is nothing to seed. The old single brushes.json is migrated
// by the interface once (GET /legacy, then POST /migrated), as on the desktop.

import Foundation

final class BrushesRoutes: APIRoutes {
    let prefix = "/brushes"
    private let table = RouteTable()
    private let lock = NSRecursiveLock()

    private let ext = ".brush"
    private let orderName = ".order.json"
    private let sidecar = "formmorpheus/brush.json"
    private let fileLimit = 64 * 1024 * 1024
    private let metaLimit = 256 * 1024
    // The desktop keeps a whole path under 240 characters for Windows. Here the part below the data folder is measured,
    // since the container path in front of it is not the person's to shorten.
    private let relativeLimit = 200

    private let metaLock = NSLock()
    private var metas: [String: (modified: Date, size: Int64, meta: Any?)] = [:]

    init() {
        table.add("GET", "/brushes/tree") { [unowned self] c in try self.tree(c) }
        table.add("GET", "/brushes/legacy") { [unowned self] c in try self.legacy(c) }
        table.add("GET", "/brushes/file") { [unowned self] c in try self.readFile(c) }
        table.add("PUT", "/brushes/file") { [unowned self] c in try self.writeFile(c) }
        table.add("POST", "/brushes/dir") { [unowned self] c in try self.makeDir(c) }
        table.add("POST", "/brushes/move") { [unowned self] c in try self.move(c, rename: false) }
        table.add("POST", "/brushes/rename") { [unowned self] c in try self.move(c, rename: true) }
        table.add("DELETE", "/brushes/item") { [unowned self] c in try self.deleteItem(c) }
        table.add("PUT", "/brushes/order") { [unowned self] c in try self.writeOrder(c) }
        table.add("POST", "/brushes/clear") { [unowned self] c in try self.clear(c) }
        table.add("POST", "/brushes/migrated") { [unowned self] c in try self.migrated(c) }
    }

    func handle(_ request: APIRequest) async -> APIResponse? {
        if !table.handles(request) { return nil }
        return await EngineWork.run { return self.table.dispatch(request) }
    }

    // MARK: names and paths

    private var root: URL { return EngineConfig.brushesDir }
    private var legacyURL: URL { return EngineConfig.dataDir.appendingPathComponent("brushes.json") }

    /// One path segment: no separators, no dot in front or behind, no padding, no device name. What is checked is what is used.
    private func check(_ raw: String, _ what: String = "name") throws -> String {
        let head = (raw.components(separatedBy: ".").first ?? raw).trimmingCharacters(in: .whitespaces)
        let reserved = EngineText.matches("^(con|prn|aux|nul|com[1-9]|lpt[1-9])$", head, caseInsensitive: true)
        if raw.isEmpty || EngineText.length(raw) > 120 || raw != EngineText.strip(raw) || EngineText.hasBad(raw)
            || raw.hasPrefix(".") || raw.hasSuffix(".") || reserved {
            throw EngineError(400, "That \(what) cannot be used.")
        }
        return raw
    }

    private func link(_ p: URL) -> Bool { return EngineFS.isLink(p) }
    private func plainDir(_ p: URL) -> Bool { return EngineFS.isDir(p) && !link(p) }
    private func plainFile(_ p: URL) -> Bool { return EngineFS.isFile(p) && !link(p) }

    private func fit(_ p: URL) throws -> URL {
        let full = p.path
        let base = root.path
        let rel = full.hasPrefix(base) ? String(full.dropFirst(base.count)) : full
        if EngineText.length(rel) > relativeLimit { throw EngineError(400, "That name makes the path too long.") }
        return p
    }

    private func libDir(_ lib: String, must: Bool = true) throws -> URL {
        let p = try fit(root.appendingPathComponent(try check(lib, "library name"), isDirectory: true))
        if must && !plainDir(p) { throw EngineError(404, "No library by that name.") }
        return p
    }

    private func setDir(_ lib: String, _ name: String, must: Bool = true) throws -> URL {
        let p = try fit(try libDir(lib).appendingPathComponent(try check(name, "set name"), isDirectory: true))
        if must && !plainDir(p) { throw EngineError(404, "No set by that name.") }
        return p
    }

    private func filePath(_ lib: String, _ name: String, _ file: String, must: Bool = true) throws -> URL {
        if !file.hasSuffix(ext) { throw EngineError(400, "That brush file name cannot be used.") }
        _ = try check(String(file.dropLast(ext.count)), "brush name")
        let p = try fit(try setDir(lib, name).appendingPathComponent(file))
        if must && !plainFile(p) { throw EngineError(404, "No brush by that name.") }
        return p
    }

    /// Another entry beside `p` whose name differs from it only by case (a folder that is case-sensitive can hold both, a synced one cannot).
    private func caseTwin(_ p: URL, ignore: URL? = nil) -> Bool {
        let key = p.lastPathComponent.lowercased()
        let parent = p.deletingLastPathComponent()
        for n in EngineFS.names(parent) where n != p.lastPathComponent && n.lowercased() == key {
            if let ig = ignore, parent.appendingPathComponent(n).path == ig.path { continue }
            return true
        }
        return false
    }

    private func readOrder(_ d: URL) -> [String: Any] {
        return EngineJSON.readObject(d.appendingPathComponent(orderName)) ?? [:]
    }

    private func writeAtomic(_ path: URL, _ data: Data) throws {
        try EngineFS.atomicWrite(data, to: path)
    }

    private func slug(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        var lastDash = false
        for u in s.lowercased().unicodeScalars {
            let v = u.value
            if (v >= 97 && v <= 122) || (v >= 48 && v <= 57) {
                out.append(u)
                lastDash = false
            } else if !lastDash {
                out.append("-")
                lastDash = true
            }
        }
        var str = String(out)
        while str.hasPrefix("-") { str.removeFirst() }
        while str.hasSuffix("-") { str.removeLast() }
        return str.isEmpty ? "set" : str
    }

    private func dirs(_ d: URL) -> [URL] {
        return EngineFS.names(d)
            .filter { !$0.hasPrefix(".") }
            .map { d.appendingPathComponent($0, isDirectory: true) }
            .filter { plainDir($0) }
            .sorted { $0.lastPathComponent.lowercased() < $1.lastPathComponent.lowercased() }
    }

    /// Folders in the order file's order (with the id it gave), then folders it did not know.
    private func ordered(_ found: [URL], _ entries: Any?) -> [(URL, String?)] {
        var by: [String: URL] = [:]
        for p in found { by[p.lastPathComponent] = p }
        var out: [(URL, String?)] = []
        if let list = entries as? [Any] {
            for e in list {
                if let o = e as? [String: Any], let dir = o["dir"] as? String, let p = by[dir] {
                    by.removeValue(forKey: dir)
                    out.append((p, o["id"] as? String))
                }
            }
        }
        for p in found where by[p.lastPathComponent] != nil { out.append((p, nil)) }
        return out
    }

    // MARK: sidecar

    private func readMeta(_ path: URL) -> Any? {
        guard let zip = try? ZipReader(url: path), let e = zip.entry(named: sidecar),
              let raw = try? zip.read(e, limit: metaLimit) else { return nil }
        return EngineJSON.any(raw)
    }

    /// The sidecar again only when the file changed (size and modified time), so a tree does not reopen every zip.
    private func metaCached(_ path: URL, _ st: EngineFS.Stat) -> Any? {
        let key = path.path
        metaLock.lock()
        let hit = metas[key]
        metaLock.unlock()
        if let h = hit, h.modified == st.modifiedDate, h.size == st.size { return h.meta }
        let meta = readMeta(path)
        metaLock.lock()
        metas[key] = (st.modifiedDate, st.size, meta)
        metaLock.unlock()
        return meta
    }

    // MARK: routes

    /// Every library, set and brush file; "fresh" means no order file yet (nothing was ever saved as files).
    private func tree(_ c: RouteContext) throws -> APIResponse {
        lock.lock()
        defer { lock.unlock() }
        let top = root
        let order = readOrder(top)
        let fresh = !EngineFS.isFile(top.appendingPathComponent(orderName))
        var usedSets = Set<String>()
        var live = Set<String>()
        var libs: [[String: Any]] = []
        for (ld, lidIn) in ordered(dirs(top), order["libs"]) {
            let lid = lidIn ?? slug(ld.lastPathComponent)
            let lorder = readOrder(ld)
            var sets: [[String: Any]] = []
            for (sd, sidIn) in ordered(dirs(ld), lorder["sets"]) {
                var sid = sidIn ?? ""
                if sidIn == nil {
                    let base = (lid == "animation" ? "anim-" : "") + slug(sd.lastPathComponent)
                    sid = base
                    var n = 2
                    while usedSets.contains(sid) {
                        sid = "\(base)-\(n)"
                        n += 1
                    }
                }
                usedSets.insert(sid)
                var files: [[String: Any]] = []
                let names = EngineFS.names(sd)
                    .filter { $0.hasSuffix(ext) && !$0.hasPrefix(".") }
                    .sorted { $0.lowercased() < $1.lowercased() }
                for n in names {
                    let f = sd.appendingPathComponent(n)
                    guard plainFile(f), let st = EngineFS.stat(f) else { continue }
                    live.insert(f.path)
                    files.append(["file": n, "meta": metaCached(f, st) ?? NSNull()])
                }
                var ids: [String] = []
                if let list = readOrder(sd)["ids"] as? [Any] { ids = list.compactMap { $0 as? String } }
                sets.append(["id": sid, "dir": sd.lastPathComponent, "ids": ids, "files": files])
            }
            libs.append(["id": lid, "dir": ld.lastPathComponent, "sets": sets])
        }
        metaLock.lock()
        for k in Array(metas.keys) where !live.contains(k) { metas.removeValue(forKey: k) }
        metaLock.unlock()
        var active: Any = NSNull()
        if let a = order["active"] as? String { active = a }
        var deleted: [String] = []
        if let list = order["deleted"] as? [Any] { deleted = list.compactMap { $0 as? String } }
        let out: [String: Any] = [
            "folder": top.path,
            "fresh": fresh,
            "legacy": EngineFS.isFile(legacyURL),
            "active": active,
            "deleted": deleted,
            "libs": libs,
        ]
        return APIResponse.json(out)
    }

    private func legacy(_ c: RouteContext) throws -> APIResponse {
        guard EngineFS.isFile(legacyURL), let d = try? Data(contentsOf: legacyURL) else {
            return APIResponse.data(Data("{}".utf8), contentType: "application/json")
        }
        return APIResponse.data(d, contentType: "application/json")
    }

    private func readFile(_ c: RouteContext) throws -> APIResponse {
        let p = try filePath(try c.requiredQuery("lib"), try c.requiredQuery("set"), try c.requiredQuery("file"))
        guard let d = try? Data(contentsOf: p, options: .mappedIfSafe) else { throw EngineError(404, "No brush by that name.") }
        return APIResponse.data(d, contentType: "application/zip")
    }

    private func writeFile(_ c: RouteContext) throws -> APIResponse {
        let lib = try c.requiredQuery("lib")
        let set = try c.requiredQuery("set")
        let file = try c.requiredQuery("file")
        let replace = try c.queryBool("replace")
        let body = try c.limited(fileLimit, "That brush file is too large.")
        if (try? ZipReader(data: body)) == nil { throw EngineError(400, "A brush file is a zip.") }
        lock.lock()
        defer { lock.unlock() }
        let path = try filePath(lib, set, file, must: false)
        if (EngineFS.exists(path) && !replace) || caseTwin(path) {
            throw EngineError(409, "A brush with that name is already there.")
        }
        try writeAtomic(path, body)
        return APIResponse.json(["ok": true, "bytes": body.count])
    }

    private func makeDir(_ c: RouteContext) throws -> APIResponse {
        let b = try c.json()
        let lib = try b.string("lib")
        let set = try b.optString("set")
        lock.lock()
        defer { lock.unlock() }
        let p: URL
        if let s = set {
            _ = try libDir(lib)
            p = try setDir(lib, s, must: false)
        } else {
            p = try libDir(lib, must: false)
        }
        if link(p) || (EngineFS.exists(p) && !EngineFS.isDir(p)) || caseTwin(p) {
            throw EngineError(409, "Something with that name is already there.")
        }
        try EngineFS.fm.createDirectory(at: p, withIntermediateDirectories: true)
        return EngineHTTP.ok()
    }

    private func first(_ a: String?, _ b: String?) -> String {
        if let x = a, !x.isEmpty { return x }
        return b ?? ""
    }

    private func move(_ c: RouteContext, rename: Bool) throws -> APIResponse {
        let b = try c.json()
        let kind = try b.string("kind")
        if kind != "lib" && kind != "set" && kind != "brush" { throw EngineError(422, "Input should be 'lib', 'set' or 'brush'.") }
        let lib = try b.string("lib")
        let set = try b.optString("set")
        let file = try b.optString("file")
        var toLib = try b.optString("toLib")
        var toSet = try b.optString("toSet")
        let to = try b.optString("to")
        if rename {
            if (to ?? "").isEmpty { throw EngineError(400, "Give the new name.") }
            toLib = nil
            toSet = nil
        }
        lock.lock()
        defer { lock.unlock() }
        let src: URL
        let dst: URL
        if kind == "lib" {
            src = try libDir(lib)
            dst = try libDir(first(to, lib), must: false)
        } else if kind == "set" {
            src = try setDir(lib, set ?? "")
            dst = try setDir(first(toLib, lib), first(to, set), must: false)
        } else {
            src = try filePath(lib, set ?? "", file ?? "")
            dst = try filePath(first(toLib, lib), first(toSet, set), first(to, file), must: false)
        }
        if EngineFS.exists(dst) && !(EngineFS.sameFile(dst, src) && dst.path != src.path) {
            if dst.path == src.path { return APIResponse.json(["ok": true, "unchanged": true]) }
            throw EngineError(409, "Something with that name is already there.")
        }
        if caseTwin(dst, ignore: src) {
            throw EngineError(409, "Something that differs only by case is already there.")
        }
        if kind == "brush" {
            try EngineFS.safeMove(src, dst)
        } else {
            try EngineFS.replace(src, dst)
        }
        return EngineHTTP.ok()
    }

    private func deleteItem(_ c: RouteContext) throws -> APIResponse {
        let kind = try c.requiredQuery("kind")
        if kind != "lib" && kind != "set" && kind != "brush" { throw EngineError(422, "Input should be 'lib', 'set' or 'brush'.") }
        let lib = try c.requiredQuery("lib")
        let set = c.query("set")
        let file = c.query("file")
        lock.lock()
        defer { lock.unlock() }
        var left = false
        if kind == "lib" {
            left = sweepLib(try libDir(lib))
        } else if kind == "set" {
            left = sweepSet(try setDir(lib, set ?? ""))
        } else {
            try EngineFS.fm.removeItem(at: try filePath(lib, set ?? "", file ?? ""))
        }
        return APIResponse.json(["ok": true, "kept": left])
    }

    /// Removes the brush files and the order file the app manages, then the folder if nothing else is in it. True when something stays.
    private func sweepSet(_ d: URL) -> Bool {
        guard let names = try? EngineFS.fm.contentsOfDirectory(atPath: d.path) else { return true }
        for n in names {
            let x = d.appendingPathComponent(n)
            let part = n.hasPrefix(".") && n.hasSuffix(".part")
            if plainFile(x) && (n == orderName || n.hasSuffix(ext) || part) { EngineFS.remove(x) }
        }
        return !EngineFS.rmdir(d)
    }

    private func sweepLib(_ d: URL) -> Bool {
        guard let names = try? EngineFS.fm.contentsOfDirectory(atPath: d.path) else { return true }
        var kept = false
        for n in names {
            let x = d.appendingPathComponent(n)
            if plainDir(x) && !n.hasPrefix(".") {
                let k = sweepSet(x)
                kept = kept || k
            }
        }
        EngineFS.remove(d.appendingPathComponent(orderName))
        return !EngineFS.rmdir(d)
    }

    private func ids(_ raw: [String]?) -> [String] {
        var out: [String] = []
        for i in raw ?? [] where !i.isEmpty && EngineText.length(i) <= 200 && !out.contains(i) { out.append(i) }
        return out
    }

    private func writeOrder(_ c: RouteContext) throws -> APIResponse {
        let b = try c.json()
        let level = try b.string("level")
        if level != "root" && level != "lib" && level != "set" { throw EngineError(422, "Input should be 'root', 'lib' or 'set'.") }
        let lib = try b.optString("lib")
        let set = try b.optString("set")
        var entries: [(id: String, dir: String)]? = nil
        if let objs = try b.optObjects("items") {
            var list: [(id: String, dir: String)] = []
            for o in objs {
                guard let id = o["id"] as? String, let dir = o["dir"] as? String else { throw EngineError(422, "Field required: id, dir") }
                list.append((id, dir))
            }
            entries = list
        }
        let idList = try b.optStringArray("ids")
        let active = try b.optString("active")
        let deleted = try b.optStringArray("deleted")
        lock.lock()
        defer { lock.unlock() }
        let d: URL
        let data: [String: Any]
        if level == "root" {
            d = root
            var libs: [[String: Any]] = []
            for e in entries ?? [] {
                let dir = try check(e.dir)
                libs.append(["id": e.id, "dir": dir])
            }
            data = ["libs": libs, "active": active ?? "", "deleted": ids(deleted)]
        } else if level == "lib" {
            d = try libDir(lib ?? "")
            var sets: [[String: Any]] = []
            for e in entries ?? [] {
                let dir = try check(e.dir)
                sets.append(["id": e.id, "dir": dir])
            }
            data = ["sets": sets]
        } else {
            d = try setDir(lib ?? "", set ?? "")
            data = ["ids": ids(idList)]
        }
        try writeAtomic(d.appendingPathComponent(orderName), EngineJSON.encode(data))
        return EngineHTTP.ok()
    }

    /// Empties the Brushes folder before a migration is retried; refused once a library has been saved as files.
    private func clear(_ c: RouteContext) throws -> APIResponse {
        lock.lock()
        defer { lock.unlock() }
        let top = root
        if EngineFS.isFile(top.appendingPathComponent(orderName)) {
            throw EngineError(409, "The brush folder already holds a saved library.")
        }
        // Only what a migration writes: libraries and sets of .brush files and order files. Anything else stays.
        for n in EngineFS.names(top) {
            let x = top.appendingPathComponent(n)
            if plainDir(x) && !n.hasPrefix(".") { _ = sweepLib(x) }
        }
        return EngineHTTP.ok()
    }

    /// Keeps the old single-file store beside the new folder under a new name, never over an older copy.
    private func migrated(_ c: RouteContext) throws -> APIResponse {
        lock.lock()
        defer { lock.unlock() }
        if !EngineFS.isFile(root.appendingPathComponent(orderName)) {
            throw EngineError(409, "The brush folder has not been written yet.")
        }
        let src = legacyURL
        if !EngineFS.isFile(src) { return APIResponse.json(["ok": true, "renamed": false]) }
        var dst = src.deletingLastPathComponent().appendingPathComponent("brushes.json.migrated")
        var n = 2
        while EngineFS.exists(dst) {
            dst = src.deletingLastPathComponent().appendingPathComponent("brushes.json.migrated\(n)")
            n += 1
        }
        try EngineFS.replace(src, dst)
        return APIResponse.json(["ok": true, "renamed": true])
    }
}
