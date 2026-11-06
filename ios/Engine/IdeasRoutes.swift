// IdeasRoutes.swift
// /api/ideas: Help Center > Send an idea. Each idea is a small text file in Documents/Ideas.
// A port of backend/app/routers/ideas.py.

import Foundation

final class IdeasRoutes: APIRoutes {
    let prefix = "/ideas"
    private let table = RouteTable()
    private let lock = NSLock()
    private let maxBytes = 24 * 1024
    private let namePattern = "^idea-\\d{8}-\\d{6}(-\\d{1,3})?\\.txt$"

    init() {
        table.add("GET", "/ideas") { [unowned self] c in try self.list(c) }
        table.add("POST", "/ideas") { [unowned self] c in try self.add(c) }
        table.add("GET", "/ideas/{name}") { [unowned self] c in try self.read(c) }
        table.add("DELETE", "/ideas/{name}") { [unowned self] c in try self.delete(c) }
    }

    func handle(_ request: APIRequest) async -> APIResponse? {
        if !table.handles(request) { return nil }
        return await EngineWork.run { return self.table.dispatch(request) }
    }

    private func item(_ url: URL) -> [String: Any] {
        let st = EngineFS.stat(url)
        let raw = (try? Data(contentsOf: url)) ?? Data()
        let text = EngineText.prefix(String(decoding: raw, as: UTF8.self), maxBytes)
        return ["name": url.lastPathComponent, "path": url.path, "modified": st?.modified ?? 0, "size": st?.size ?? 0, "text": text]
    }

    private func file(_ name: String) throws -> URL {
        if !EngineText.matches(namePattern, name) { throw EngineError(400, "That is not an idea file.") }
        let url = EngineConfig.ideasDir.appendingPathComponent(name)
        if !EngineFS.isFile(url) { throw EngineError(404, "That idea is not here.") }
        return url
    }

    private func list(_ c: RouteContext) throws -> APIResponse {
        let folder = EngineConfig.ideasDir
        var files: [(URL, Double)] = []
        for n in EngineFS.names(folder) where EngineText.matches(namePattern, n) {
            let u = folder.appendingPathComponent(n)
            if EngineFS.isFile(u) { files.append((u, EngineFS.stat(u)?.modified ?? 0)) }
        }
        files.sort { $0.1 > $1.1 }
        let items = files.prefix(200).map { item($0.0) }
        return APIResponse.json(["folder": folder.path, "items": items])
    }

    private func add(_ c: RouteContext) throws -> APIResponse {
        let raw = try c.limited(maxBytes * 2, "That note is too long.")
        guard let body = EngineJSON.object(raw) else { throw EngineError(400, "The note could not be read.") }
        let text = EngineText.strip(stringValue(body["text"], ""))
        if text.isEmpty { throw EngineError(400, "Write something first.") }
        var kind = EngineText.prefix(EngineText.strip(stringValue(body["kind"], "Idea")), 40)
        if kind.isEmpty { kind = "Idea" }
        let context = EngineText.prefix(EngineText.strip(stringValue(body["context"], "")), 200)
        let now = Date()
        let stamp = EngineText.stamp(now)
        var head = "\(kind)\n\(EngineText.stamp(now, "yyyy-MM-dd HH:mm")) · \(EngineConfig.appName) \(EngineConfig.version)"
        if !context.isEmpty { head += " · \(context)" }
        let content = "\(head)\n\n\(EngineText.prefix(text, maxBytes))\n"
        lock.lock()
        defer { lock.unlock() }
        let folder = EngineConfig.ideasDir
        var path = folder.appendingPathComponent("idea-\(stamp).txt")
        var n = 1
        while EngineFS.exists(path) {
            n += 1
            path = folder.appendingPathComponent("idea-\(stamp)-\(n).txt")
        }
        try Data(content.utf8).write(to: path, options: [.atomic])
        return APIResponse.json(item(path))
    }

    private func stringValue(_ v: Any?, _ fallback: String) -> String {
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return fallback
    }

    private func read(_ c: RouteContext) throws -> APIResponse {
        return APIResponse.json(item(try file(c.param("name"))))
    }

    private func delete(_ c: RouteContext) throws -> APIResponse {
        lock.lock()
        defer { lock.unlock() }
        let url = try file(c.param("name"))
        try EngineFS.fm.removeItem(at: url)
        return EngineHTTP.ok()
    }
}
