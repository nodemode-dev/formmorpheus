// FontsRoutes.swift
// /api/fonts: the app-wide Fonts library in Documents/Fonts, with a .fonts.json index of family names.
// A port of backend/app/routers/fonts.py, including the check that the first bytes are those of a font.

import Foundation

final class FontsRoutes: APIRoutes {
    let prefix = "/fonts"
    private let table = RouteTable()
    private let lock = NSRecursiveLock()

    private let types: [String: String] = [".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2"]
    private let fileLimit = 64 * 1024 * 1024
    private let indexName = ".fonts.json"

    init() {
        table.add("GET", "/fonts") { [unowned self] c in try self.list(c) }
        table.add("GET", "/fonts/{name}") { [unowned self] c in try self.read(c) }
        table.add("PUT", "/fonts/{name}") { [unowned self] c in try self.write(c) }
        table.add("DELETE", "/fonts/{name}") { [unowned self] c in try self.delete(c) }
    }

    func handle(_ request: APIRequest) async -> APIResponse? {
        if !table.handles(request) { return nil }
        return await EngineWork.run { return self.table.dispatch(request) }
    }

    private var root: URL { return EngineConfig.fontsDir }

    private func check(_ name: String) throws -> String {
        if name.isEmpty || name.utf8.count > 160 || name != EngineText.strip(name) || EngineText.hasBad(name)
            || name.hasPrefix(".") || name.hasSuffix(".") {
            throw EngineError(400, "That font file name cannot be used.")
        }
        if types[EngineText.splitName(name).ext.lowercased()] == nil {
            throw EngineError(400, "Fonts are .ttf, .otf, .woff or .woff2 files.")
        }
        return name
    }

    private func readIndex() -> [String: Any] {
        return EngineJSON.readObject(root.appendingPathComponent(indexName)) ?? [:]
    }

    private func writeIndex(_ data: [String: Any]) throws {
        try EngineFS.atomicWrite(EngineJSON.encode(data), to: root.appendingPathComponent(indexName))
    }

    private func entry(_ url: URL, _ family: String) -> [String: Any] {
        let st = EngineFS.stat(url)
        return ["file": url.lastPathComponent, "family": family, "size": st?.size ?? 0, "modified": st?.modified ?? 0]
    }

    private func list(_ c: RouteContext) throws -> APIResponse {
        lock.lock()
        defer { lock.unlock() }
        let index = readIndex()
        var items: [[String: Any]] = []
        let names = EngineFS.names(root).sorted { $0.lowercased() < $1.lowercased() }
        for n in names where !n.hasPrefix(".") && types[EngineText.splitName(n).ext.lowercased()] != nil {
            let u = root.appendingPathComponent(n)
            if EngineFS.isFile(u) && !EngineFS.isLink(u) {
                var family = EngineText.splitName(n).stem
                if let f = index[n] as? String, !f.isEmpty { family = f }
                items.append(entry(u, family))
            }
        }
        return APIResponse.json(["folder": root.path, "items": items])
    }

    private func read(_ c: RouteContext) throws -> APIResponse {
        let name = try check(c.param("name"))
        let p = root.appendingPathComponent(name)
        if !EngineFS.isFile(p) || EngineFS.isLink(p) { throw EngineError(404, "No font by that name.") }
        guard let data = try? Data(contentsOf: p, options: .mappedIfSafe) else { throw EngineError(404, "No font by that name.") }
        var r = APIResponse.data(data, contentType: types[EngineText.splitName(name).ext.lowercased()] ?? "application/octet-stream")
        r.headers["Cache-Control"] = "no-store"
        return r
    }

    private func write(_ c: RouteContext) throws -> APIResponse {
        let name = try check(c.param("name"))
        let family = EngineText.prefix(EngineText.strip(c.query("family") ?? ""), 120)
        if family.isEmpty || family.contains("\"") || family.contains("\\") || family.unicodeScalars.contains(where: { $0.value < 0x20 }) {
            throw EngineError(400, "The font needs a family name.")
        }
        var dest = root.appendingPathComponent(name)
        lock.lock()
        // the same file name with the same family is the same font: it is replaced; another family gets its own name
        if EngineFS.exists(dest), (readIndex()[name] as? String) != family {
            let parts = EngineText.splitName(name)
            var n = 2
            while EngineFS.exists(root.appendingPathComponent("\(parts.stem) \(n)\(parts.ext)")) { n += 1 }
            dest = root.appendingPathComponent("\(parts.stem) \(n)\(parts.ext)")
        }
        lock.unlock()
        let body = try c.limited(fileLimit, "That font file is too large.")
        if body.count < 12 { throw EngineError(400, "That is not a font file.") }
        // the first bytes must be those of a font, not just the right extension (a page or a script renamed .ttf)
        let magic = Array(body.prefix(4))
        let known: [[UInt8]] = [
            [0x00, 0x01, 0x00, 0x00], Array("OTTO".utf8), Array("true".utf8), Array("ttcf".utf8), Array("wOFF".utf8), Array("wOF2".utf8),
        ]
        if !known.contains(magic) { throw EngineError(400, "That is not a font file.") }
        let tmp = EngineFS.tempBeside(dest)
        defer { EngineFS.remove(tmp) }
        try EngineFS.writeFile(body, to: tmp)
        lock.lock()
        defer { lock.unlock() }
        try EngineFS.replace(tmp, dest)
        var index = readIndex()
        index[dest.lastPathComponent] = family
        try writeIndex(index)
        return APIResponse.json(entry(dest, family))
    }

    private func delete(_ c: RouteContext) throws -> APIResponse {
        let name = try check(c.param("name"))
        let p = root.appendingPathComponent(name)
        lock.lock()
        defer { lock.unlock() }
        if !EngineFS.isFile(p) || EngineFS.isLink(p) { throw EngineError(404, "No font by that name.") }
        try EngineFS.fm.removeItem(at: p)
        var index = readIndex()
        if index.removeValue(forKey: name) != nil { try writeIndex(index) }
        return APIResponse.json(["deleted": name])
    }
}
