// LibraryRoutes.swift
// /api/library: the movies in Documents/Library, stacks as real folders, tags, posters, the atomic write.
// A port of backend/app/routers/library.py with the same paths, methods, query parameters, status codes and JSON.

import Foundation

/// The library on disk. Shared by the library and trash routes (restore needs findMovie).
final class LibraryStore {
    static let shared = LibraryStore()

    /// One lock for every library change. Reads of single files do not take it.
    let lock = NSRecursiveLock()

    static let legacyName = ".stacks.json"
    static let orderName = ".order.json"
    static let tagsName = ".tags.json"
    static let ext = EngineConfig.projectExt

    private init() {}

    var root: URL { return EngineConfig.libraryDir }

    // MARK: names

    /// The movie name from a request: no separators or control characters, no dots at the ends.
    func cleanName(_ name: String) throws -> String {
        var stem = name
        if name.lowercased().hasSuffix(LibraryStore.ext) { stem = String(name.dropLast(LibraryStore.ext.count)) }
        stem = EngineText.stripDots(EngineText.strip(EngineText.replaceBad(stem, with: "-")))
        if stem.isEmpty || EngineText.length(stem) > 180 {
            throw EngineError(400, "That project name cannot be used.")
        }
        return stem
    }

    func stackName(_ raw: String) -> String {
        let a = EngineText.stripDots(EngineText.strip(EngineText.replaceBad(raw, with: "-")))
        let b = EngineText.prefix(a, 80)
        return EngineText.stripDots(EngineText.strip(b))
    }

    // MARK: finding

    func stackDirs() -> [URL] {
        let dirs = EngineFS.names(root)
            .filter { !$0.hasPrefix(".") }
            .map { root.appendingPathComponent($0, isDirectory: true) }
            .filter { EngineFS.isDir($0) }
        return dirs.sorted { $0.lastPathComponent.lowercased() < $1.lastPathComponent.lowercased() }
    }

    /// The .fmo files directly inside a folder, by name.
    func movies(in dir: URL) -> [URL] {
        return EngineFS.names(dir)
            .filter { $0.hasSuffix(LibraryStore.ext) && !$0.hasPrefix(".") }
            .sorted()
            .map { dir.appendingPathComponent($0) }
            .filter { EngineFS.isFile($0) }
    }

    func stem(_ url: URL) -> String {
        return String(url.lastPathComponent.dropLast(LibraryStore.ext.count))
    }

    func findMovie(_ stem: String) -> URL? {
        let top = root.appendingPathComponent(stem + LibraryStore.ext)
        if EngineFS.isFile(top) { return top }
        for d in stackDirs() {
            let p = d.appendingPathComponent(stem + LibraryStore.ext)
            if EngineFS.isFile(p) { return p }
        }
        return nil
    }

    func projectPath(_ name: String) throws -> URL {
        let s = try cleanName(name)
        return findMovie(s) ?? root.appendingPathComponent(s + LibraryStore.ext)
    }

    func isTop(_ dir: URL) -> Bool {
        return dir.standardizedFileURL.path == root.standardizedFileURL.path
    }

    func entry(_ url: URL) -> [String: Any] {
        let st = EngineFS.stat(url)
        var out: [String: Any] = [
            "name": stem(url),
            "file": url.lastPathComponent,
            "path": url.path,
            "size": st?.size ?? 0,
            "modified": st?.modified ?? 0,
            "created": st?.created ?? 0,
        ]
        let parent = url.deletingLastPathComponent()
        if !isTop(parent) { out["stack"] = parent.lastPathComponent }
        return out
    }

    func uniquePath(_ stem: String, in folder: URL) -> URL {
        var candidate = folder.appendingPathComponent(stem + LibraryStore.ext)
        var n = 2
        while findMovie(self.stem(candidate)) != nil {
            candidate = folder.appendingPathComponent("\(stem) \(n)\(LibraryStore.ext)")
            n += 1
        }
        return candidate
    }

    // MARK: order files (.order.json in the library and in each stack)

    func orderRead(_ dir: URL?) -> [String] {
        let url = (dir ?? root).appendingPathComponent(LibraryStore.orderName)
        guard let o = EngineJSON.readObject(url), let list = o["order"] as? [Any] else { return [] }
        return list.compactMap { $0 as? String }
    }

    func orderWrite(_ dir: URL?, _ keys: [String]) throws {
        var clean: [String] = []
        for k in keys where !k.isEmpty && EngineText.length(k) <= 200 && !clean.contains(k) {
            clean.append(k)
        }
        let path = (dir ?? root).appendingPathComponent(LibraryStore.orderName)
        if clean.isEmpty {
            EngineFS.remove(path)
            return
        }
        try EngineFS.atomicWrite(EngineJSON.encode(["order": Array(clean.prefix(5000))]), to: path)
    }

    func orderSwap(_ dir: URL?, _ old: String, _ new: String?) {
        let keys = orderRead(dir)
        if !keys.contains(old) { return }
        var next: [String] = []
        for k in keys {
            if k == old {
                if let n = new, !n.isEmpty { next.append(n) }
            } else {
                next.append(k)
            }
        }
        try? orderWrite(dir, next)
    }

    // MARK: stacks

    func stackDir(_ sid: String) throws -> URL {
        let name = stackName(sid)
        if name.isEmpty || name != sid { throw EngineError(400, "That stack name cannot be used.") }
        let d = root.appendingPathComponent(name, isDirectory: true)
        if !EngineFS.isDir(d) { throw EngineError(404, "No stack by that name.") }
        return d
    }

    func freeStackName(_ baseIn: String, keep: URL? = nil) -> String {
        var base = stackName(baseIn)
        if base.isEmpty { base = "Stack" }
        var taken = Set<String>()
        for n in EngineFS.names(root) {
            if let k = keep, k.lastPathComponent == n { continue }
            taken.insert(n.lowercased())
        }
        var name = base
        var n = 2
        while taken.contains(name.lowercased()) {
            name = "\(base) \(n)"
            n += 1
        }
        return name
    }

    /// A stack emptied of movies goes away; its hidden order file goes with it.
    func leave(_ d: URL) {
        if isTop(d) || !EngineFS.isDir(d) || !movies(in: d).isEmpty { return }
        EngineFS.remove(d.appendingPathComponent(LibraryStore.orderName))
        if !EngineFS.rmdir(d) { return }   // only an empty folder goes; files the person put there stay
        orderSwap(nil, "stk:\(d.lastPathComponent)", nil)
    }

    /// Moves a movie into another folder of the library; the name must be free there.
    @discardableResult
    func moveMovie(_ path: URL, to dest: URL) throws -> URL {
        let dst = dest.appendingPathComponent(path.lastPathComponent)
        if dst.path == path.path { return path }
        if EngineFS.exists(dst) {
            throw EngineError(409, "\"\(stem(path))\" already exists in that folder, so it was not moved.")
        }
        try EngineFS.safeMove(path, dst)
        let parent = path.deletingLastPathComponent()
        orderSwap(isTop(parent) ? nil : parent, "lib:\(stem(path))", nil)
        leave(parent)
        return dst
    }

    /// Old builds kept stacks as a list in .stacks.json; make each one a real folder, once.
    func migrate() {
        let legacy = root.appendingPathComponent(LibraryStore.legacyName)
        if !EngineFS.isFile(legacy) { return }
        lock.lock()
        defer { lock.unlock() }
        if !EngineFS.isFile(legacy) { return }
        var stacks: [Any] = []
        if let o = EngineJSON.readObject(legacy), let s = o["stacks"] as? [Any] { stacks = s }
        for case let s as [String: Any] in stacks {
            guard let items = s["items"] as? [Any] else { continue }
            var found: [URL] = []
            for i in items {
                guard let str = i as? String else { continue }
                let p = root.appendingPathComponent(stackName(str) + LibraryStore.ext)
                if EngineFS.isFile(p) { found.append(p) }
            }
            if found.isEmpty { continue }
            let d = root.appendingPathComponent(freeStackName((s["name"] as? String) ?? "Stack"), isDirectory: true)
            do {
                try EngineFS.fm.createDirectory(at: d, withIntermediateDirectories: false)
                for p in found { try moveMovie(p, to: d) }
            } catch {
                continue
            }
        }
        try? EngineFS.replace(legacy, root.appendingPathComponent(LibraryStore.legacyName + ".migrated"))
    }

    // MARK: tags

    func tagsRead() -> [String: [String]] {
        guard let o = EngineJSON.readObject(root.appendingPathComponent(LibraryStore.tagsName)) else { return [:] }
        var out: [String: [String]] = [:]
        for (k, v) in o {
            if let list = v as? [Any] { out[k] = list.compactMap { $0 as? String } }
        }
        return out
    }

    func tagsWrite(_ tags: [String: [String]]) throws {
        let path = root.appendingPathComponent(LibraryStore.tagsName)
        let tmp = root.appendingPathComponent(LibraryStore.tagsName + ".part")
        try EngineFS.writeFile(EngineJSON.encode(tags), to: tmp)
        try EngineFS.replace(tmp, path)
    }

    /// Every movie name in the library, stacks included.
    func allStems() -> Set<String> {
        var s = Set<String>()
        if let e = EngineFS.fm.enumerator(atPath: root.path) {
            while let rel = e.nextObject() as? String {
                if rel.hasSuffix(LibraryStore.ext) {
                    let last = rel.split(separator: "/").last.map(String.init) ?? rel
                    s.insert(String(last.dropLast(LibraryStore.ext.count)))
                }
            }
        }
        return s
    }
}

final class LibraryRoutes: APIRoutes {
    let prefix = "/library"
    private let table = RouteTable()
    private let store = LibraryStore.shared
    private let jsonLimit = 64 * 1024 * 1024

    init() {
        // Order matters, as in the backend: the fixed names come before /{name}.
        table.add("GET", "/library") { [unowned self] c in try self.list(c) }
        table.add("GET", "/library/_tags") { [unowned self] c in try self.listTags(c) }
        table.add("POST", "/library/_tags/{name}") { [unowned self] c in try self.setTags(c) }
        table.add("GET", "/library/_stacks") { [unowned self] c in try self.listStacks(c) }
        table.add("POST", "/library/_stacks") { [unowned self] c in try self.createStack(c) }
        table.add("POST", "/library/_stacks/{sid}") { [unowned self] c in try self.updateStack(c) }
        table.add("PUT", "/library/_stacks") { [unowned self] c in try self.saveOrder(c) }
        table.add("DELETE", "/library/_stacks/{sid}") { [unowned self] c in try self.ungroupStack(c) }
        table.add("GET", "/library/{name}") { [unowned self] c in try self.read(c) }
        table.add("GET", "/library/{name}/poster") { [unowned self] c in try self.picture(c, member: "poster.png") }
        table.add("PUT", "/library/{name}/poster") { [unowned self] c in try self.writePoster(c) }
        table.add("GET", "/library/{name}/preview") { [unowned self] c in try self.picture(c, member: "preview.png") }
        table.add("PUT", "/library/{name}") { [unowned self] c in try self.write(c) }
        table.add("POST", "/library/{name}/rename") { [unowned self] c in try self.rename(c) }
        table.add("POST", "/library/{name}/duplicate") { [unowned self] c in try self.duplicate(c) }
        table.add("POST", "/library/{name}/copy-to") { [unowned self] c in try self.copyTo(c) }
        table.add("DELETE", "/library/{name}") { [unowned self] c in try self.delete(c) }
    }

    func handle(_ request: APIRequest) async -> APIResponse? {
        if !table.handles(request) { return nil }
        return await EngineWork.run { return self.table.dispatch(request) }
    }

    // MARK: list

    private func list(_ c: RouteContext) throws -> APIResponse {
        store.migrate()
        let folder = store.root
        var paths = store.movies(in: folder)
        let stacks = store.stackDirs()
        for d in stacks { paths += store.movies(in: d) }
        CloudLibrary.fetchMissing([folder] + stacks)
        var items = paths.map { store.entry($0) }
        items.sort { (($0["modified"] as? Double) ?? 0) > (($1["modified"] as? Double) ?? 0) }
        return APIResponse.json(["folder": folder.path, "items": items])
    }

    // MARK: tags

    private func listTags(_ c: RouteContext) throws -> APIResponse {
        return APIResponse.json(["tags": store.tagsRead()])
    }

    private func setTags(_ c: RouteContext) throws -> APIResponse {
        let name = c.param("name")
        let raw = try c.json().stringArray("tags")
        var clean: [String] = []
        for t in raw {
            let one = EngineText.prefix(
                EngineText.replaceBad(t, with: " ").components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " "), 32)
            if !one.isEmpty && !clean.contains(where: { $0.lowercased() == one.lowercased() }) { clean.append(one) }
        }
        clean = Array(clean.prefix(12))
        store.lock.lock()
        defer { store.lock.unlock() }
        var all = store.tagsRead()
        if clean.isEmpty { all.removeValue(forKey: name) } else { all[name] = clean }
        let live = store.allStems()
        all = all.filter { live.contains($0.key) }
        try store.tagsWrite(all)
        return APIResponse.json(["tags": clean])
    }

    // MARK: stacks

    private func knownMovies(_ names: [String]) throws -> [URL] {
        var seen: [URL] = []
        for n in names {
            if let p = store.findMovie(try store.cleanName(n)), !seen.contains(p) { seen.append(p) }
        }
        return seen
    }

    private func listStacks(_ c: RouteContext) throws -> APIResponse {
        store.migrate()
        var stacks: [[String: Any]] = []
        var order: [String: [String]] = ["": store.orderRead(nil)]
        for d in store.stackDirs() {
            let items = store.movies(in: d).map { store.stem($0) }.sorted()
            if !items.isEmpty {
                stacks.append(["id": d.lastPathComponent, "name": d.lastPathComponent, "items": items])
                order[d.lastPathComponent] = store.orderRead(d)
            }
        }
        return APIResponse.json(["stacks": stacks, "order": order])
    }

    private func createStack(_ c: RouteContext) throws -> APIResponse {
        let body = try c.json()
        let name = try body.optString("name")
        let items = try body.optStringArray("items") ?? []
        store.migrate()
        store.lock.lock()
        defer { store.lock.unlock() }
        let paths = try knownMovies(items)
        if paths.count < 1 { throw EngineError(400, "A stack needs at least one movie.") }
        let nameIn = (name?.isEmpty ?? true) ? "Stack" : (name ?? "Stack")
        let d = store.root.appendingPathComponent(store.freeStackName(nameIn), isDirectory: true)
        try EngineFS.fm.createDirectory(at: d, withIntermediateDirectories: false)
        defer { store.leave(d) }
        for p in paths { try store.moveMovie(p, to: d) }
        let names = store.movies(in: d).map { store.stem($0) }.sorted()
        return APIResponse.json(["id": d.lastPathComponent, "name": d.lastPathComponent, "items": names])
    }

    private func updateStack(_ c: RouteContext) throws -> APIResponse {
        let body = try c.json()
        let newName = try body.optString("name")
        let items = try body.optStringArray("items")
        store.lock.lock()
        defer { store.lock.unlock() }
        var d = try store.stackDir(c.param("sid"))
        if let items = items {
            let want = try knownMovies(items)
            let keep = Set(want.map { store.stem($0) })
            for p in want { try store.moveMovie(p, to: d) }
            for p in store.movies(in: d) where !keep.contains(store.stem(p)) {
                try store.moveMovie(p, to: store.root)
            }
        }
        if let nn = newName, !store.stackName(nn).isEmpty, store.stackName(nn) != d.lastPathComponent, EngineFS.isDir(d) {
            let new = store.stackName(nn)
            let dst = store.root.appendingPathComponent(new, isDirectory: true)
            if EngineFS.exists(dst) && dst.lastPathComponent.lowercased() != d.lastPathComponent.lowercased() {
                throw EngineError(409, "A folder or stack with that name already exists.")
            }
            try EngineFS.replace(d, dst)
            store.orderSwap(nil, "stk:\(d.lastPathComponent)", "stk:\(new)")
            d = dst
        } else if items != nil && !EngineFS.isDir(d) {
            return APIResponse.json(["ok": true, "id": NSNull()])
        }
        return APIResponse.json(["ok": true, "id": d.lastPathComponent])
    }

    private func saveOrder(_ c: RouteContext) throws -> APIResponse {
        let body = try c.json()
        let stack = try body.optString("stack")
        let order = try body.stringArray("order")
        store.lock.lock()
        defer { store.lock.unlock() }
        var d: URL? = nil
        if let s = stack, !s.isEmpty { d = try store.stackDir(s) }
        try store.orderWrite(d, order)
        return EngineHTTP.ok()
    }

    private func ungroupStack(_ c: RouteContext) throws -> APIResponse {
        let sid = c.param("sid")
        store.lock.lock()
        defer { store.lock.unlock() }
        let d = try store.stackDir(sid)
        for p in store.movies(in: d) { try store.moveMovie(p, to: store.root) }
        EngineFS.remove(d.appendingPathComponent(LibraryStore.orderName))
        _ = EngineFS.rmdir(d)   // other files the person put there stay, and so does the folder
        store.orderSwap(nil, "stk:\(sid)", nil)
        return EngineHTTP.ok()
    }

    // MARK: one movie

    private func existing(_ c: RouteContext) throws -> URL {
        let path = try store.projectPath(c.param("name"))
        if !EngineFS.isFile(path) { throw EngineError(404, "No project by that name.") }
        CloudLibrary.makeLocal(path)
        return path
    }

    private func read(_ c: RouteContext) throws -> APIResponse {
        let path = try existing(c)
        guard let data = try? Data(contentsOf: path, options: .mappedIfSafe) else {
            throw EngineError(404, "No project by that name.")
        }
        return APIResponse.data(data, contentType: "application/octet-stream")
    }

    /// poster.png or preview.png from inside the movie. With ?v=<modified time> the browser may keep it a while.
    /// No picture is an empty 204, not a 404, so the console stays quiet for movies saved without one.
    private func picture(_ c: RouteContext, member: String) throws -> APIResponse {
        let path = try existing(c)
        guard let zip = try? ZipReader(url: path), let e = zip.entry(named: member),
              let data = try? zip.read(e, limit: 64 * 1024 * 1024) else {
            return EngineHTTP.noContent(contentType: "image/png")
        }
        var r = APIResponse.data(data, contentType: "image/png")
        let v = c.query("v")
        r.headers["Cache-Control"] = (v != nil && !(v ?? "").isEmpty) ? "private, max-age=300" : "no-store"
        return r
    }

    /// Sets the poster of a movie that has none without touching anything else in it: every other entry is copied
    /// raw into a new file, which replaces the movie atomically. A movie that already has a poster is left alone.
    private func writePoster(_ c: RouteContext) throws -> APIResponse {
        let path = try existing(c)
        let body = try c.limited(8 * 1024 * 1024, "That picture is too large.")
        let magic: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        if body.count < 8 || Array(body.prefix(8)) != magic { throw EngineError(400, "That is not a picture.") }
        let tmp = EngineFS.tempBeside(path)
        defer { EngineFS.remove(tmp) }
        do {
            guard let st0 = EngineFS.stat(path) else { throw EngineError(404, "No project by that name.") }
            let zin = try ZipReader(url: path)
            if zin.entry(named: "poster.png") != nil {
                return APIResponse.json(["ok": true, "written": false])
            }
            let zout = try ZipWriter(url: tmp)
            do {
                for e in zin.entries { try zout.addRaw(e, from: zin) }
                try zout.addStored(name: "poster.png", data: body)
                try zout.finish()
            } catch {
                zout.abort()
                throw error
            }
            store.lock.lock()
            defer { store.lock.unlock() }
            guard let st = EngineFS.stat(path), st.modifiedDate == st0.modifiedDate, st.size == st0.size else {
                return APIResponse.json(["ok": true, "written": false])   // a save landed meanwhile and is newer
            }
            // a poster is not an edit: the movie keeps the "modified" time the Theater sorts by
            EngineFS.setModified(tmp, st.modifiedDate)
            try EngineFS.replace(tmp, path)
            return APIResponse.json(["ok": true, "written": true])
        } catch let e as EngineError {
            throw e
        } catch {
            throw EngineError(400, "The movie could not be updated.")
        }
    }

    private func write(_ c: RouteContext) throws -> APIResponse {
        let path = try store.projectPath(c.param("name"))
        let body = try c.limited(EngineConfig.maxProjectBytes, "The project is too large to save.")
        if body.count < 4 || Array(body.prefix(4)) != [0x50, 0x4B, 0x03, 0x04] {
            throw EngineError(400, "That is not a FormMorpheus project.")
        }
        // a part file per request, flushed to disk before the rename: a kill or a power cut leaves the old movie or the whole new one
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
        let dst = src.deletingLastPathComponent().appendingPathComponent(stem + LibraryStore.ext)
        if let other = store.findMovie(stem), !(EngineFS.exists(other) && EngineFS.exists(src) && EngineFS.sameFile(other, src)) {
            throw EngineError(409, "A project with that name already exists.")
        }
        store.lock.lock()
        defer { store.lock.unlock() }
        try EngineFS.replace(src, dst)
        if dst.path != src.path {
            let parent = src.deletingLastPathComponent()
            store.orderSwap(store.isTop(parent) ? nil : parent, "lib:\(store.stem(src))", "lib:\(store.stem(dst))")
            var moved = store.tagsRead()
            if let t = moved[store.stem(src)] {
                moved.removeValue(forKey: store.stem(src))
                moved[store.stem(dst)] = t   // a rename keeps the movie's tags
                try store.tagsWrite(moved)
            }
        }
        return APIResponse.json(store.entry(dst))
    }

    private func duplicate(_ c: RouteContext) throws -> APIResponse {
        let src = try existing(c)
        for _ in 0..<100 {
            let dst = store.uniquePath("\(store.stem(src)) copy", in: src.deletingLastPathComponent())
            let tmp = EngineFS.tempBeside(dst)
            defer { EngineFS.remove(tmp) }
            do {
                if !copyWithNewId(src, dst, tmp) {
                    EngineFS.remove(tmp)
                    try EngineFS.fm.copyItem(at: src, to: tmp)
                }
                EngineFS.setModified(tmp, Date())
                try EngineFS.publish(tmp, dst)
                return APIResponse.json(store.entry(dst))
            } catch EngineFSError.exists {
                continue   // the name was taken a moment ago: take the next one
            } catch {
                throw EngineError(400, "FormMorpheus could not duplicate the movie.")
            }
        }
        throw EngineError(409, "No free name for the copy.")
    }

    /// A duplicate is a different movie: a fresh id (and its own name) in movie.json, every other entry copied as it is.
    private func copyWithNewId(_ src: URL, _ dst: URL, _ tmp: URL) -> Bool {
        guard let zin = try? ZipReader(url: src), let mj = zin.entry(named: "movie.json"),
              let raw = try? zin.read(mj, limit: jsonLimit),
              var data = EngineJSON.object(raw), data["id"] is String else { return false }
        data["id"] = "m" + EngineText.hex(16)
        if data["name"] is String { data["name"] = store.stem(dst) }
        guard let writer = try? ZipWriter(url: tmp) else { return false }
        do {
            for e in zin.entries {
                if e.name == "movie.json" {
                    try writer.addStored(name: e.name, data: EngineJSON.encode(data), dosTime: e.dosTime, dosDate: e.dosDate)
                } else {
                    try writer.addRaw(e, from: zin)
                }
            }
            try writer.finish()
            return true
        } catch {
            writer.abort()
            EngineFS.remove(tmp)
            return false
        }
    }

    private func copyTo(_ c: RouteContext) throws -> APIResponse {
        let src = try existing(c)
        let dir = try c.json().string("dir")
        let folder = try EngineFolders.safe(dir, create: false)   // a typo must not leave new folders behind
        if folder.path == src.deletingLastPathComponent().standardizedFileURL.resolvingSymlinksInPath().path {
            throw EngineError(400, "That is the folder the movie is already in.")
        }
        let tmp = folder.appendingPathComponent(".\(src.lastPathComponent).\(EngineText.hex(8)).part")
        defer { EngineFS.remove(tmp) }
        do {
            try EngineFS.fm.copyItem(at: src, to: tmp)
            var n = 1
            while true {
                let name = n == 1 ? src.lastPathComponent : "\(store.stem(src)) \(n)\(LibraryStore.ext)"
                let dst = folder.appendingPathComponent(name)
                do {
                    try EngineFS.publish(tmp, dst)   // exclusive: never replaces a file that appeared meanwhile
                    return APIResponse.json(["path": dst.path, "name": store.stem(dst)])
                } catch EngineFSError.exists {
                    n += 1
                }
            }
        } catch {
            throw EngineError(400, "FormMorpheus could not copy the movie there.")
        }
    }

    private func delete(_ c: RouteContext) throws -> APIResponse {
        let src = try existing(c)
        let dst = EngineConfig.trashDir.appendingPathComponent("\(store.stem(src)) \(EngineText.stamp())\(LibraryStore.ext)")
        store.lock.lock()
        defer { store.lock.unlock() }
        try EngineFS.safeMove(src, dst)
        TrashStore.shared.record(dst, original: src.lastPathComponent, kind: "movie")
        let parent = src.deletingLastPathComponent()
        store.orderSwap(store.isTop(parent) ? nil : parent, "lib:\(store.stem(src))", nil)
        store.leave(parent)
        return APIResponse.json(["deleted": store.stem(src), "kept": dst.path])
    }
}
