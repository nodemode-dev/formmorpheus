// EngineSupport.swift
// Shared plumbing for the Swift engine: errors, folders, text rules, file helpers, the small route table.
// Foundation only. Every route group in ios/Engine/ is built on these.

import Foundation
import Darwin

// MARK: - Errors

/// Thrown by any route; the route table turns it into {"detail": "..."} with the status, like FastAPI's HTTPException.
struct EngineError: Error {
    let status: Int
    let detail: String
    init(_ status: Int, _ detail: String) {
        self.status = status
        self.detail = detail
    }
}

enum EngineFSError: Error {
    case posix(Int32)
    case exists
}

// MARK: - Folders and constants

/// The engine's storage. The root is the app's Documents folder, so the Files app shows
/// Library, Brushes, Fonts, Ideas, Recently Deleted, Recovery, Exports and Jobs, the names the desktop engine uses.
enum EngineConfig {
    static let appName = "formmorpheus"
    static let projectExt = ".fmo"
    static let maxProjectBytes = 4 * 1024 * 1024 * 1024
    static let maxExportBytes = 2 * 1024 * 1024 * 1024

    /// Tests or tools may point the engine at another folder before the first request.
    static var rootOverride: URL? = nil
    /// Extra folders /api/files/read may read from (the document scene builder adds the inbox of opened files).
    static var extraReadableRoots: [URL] = []
    /// Extra folders /api/save-to may write into.
    static var extraWritableRoots: [URL] = []
    /// The export builder may set this to add fields to /api/capabilities.
    static var capabilityProvider: (() -> [String: Any])? = nil

    static var version: String {
        if let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String, !v.isEmpty {
            return v
        }
        return "0.22.0"
    }

    static var dataDir: URL {
        if let o = rootOverride { return o }
        if let u = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first { return u }
        return URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Documents", isDirectory: true)
    }

    /// A named folder of the data folder, created when missing.
    static func folder(_ name: String) -> URL {
        let u = dataDir.appendingPathComponent(name, isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    static var libraryDir: URL { return CloudLibrary.activeFolder() ?? folder("Library") }
    static var localLibraryDir: URL { return folder("Library") }
    static var brushesDir: URL { return folder("Brushes") }
    static var fontsDir: URL { return folder("Fonts") }
    static var ideasDir: URL { return folder("Ideas") }
    static var trashDir: URL { return folder("Recently Deleted") }
    static var recoveryDir: URL { return folder("Recovery") }
    static var exportsDir: URL { return folder("Exports") }
    static var jobsDir: URL { return folder("Jobs") }

    /// Creates every top-level folder once, so the Files app shows the whole tree from the first launch.
    /// Jobs is left out: the export builder keeps its temporary job folders in Caches (thousands of frames
    /// do not belong in Files or in the device backup), so Documents/Jobs would stay empty.
    static func ensureTree() {
        _ = localLibraryDir; _ = brushesDir; _ = fontsDir; _ = ideasDir
        _ = trashDir; _ = recoveryDir; _ = exportsDir
    }

    /// A path inside `root` (after resolving links and "..")?
    static func isInside(_ path: URL, _ root: URL) -> Bool {
        let p = path.standardizedFileURL.resolvingSymlinksInPath().path
        let r = root.standardizedFileURL.resolvingSymlinksInPath().path
        return p == r || p.hasPrefix(r.hasSuffix("/") ? r : r + "/")
    }

    /// A container path saved by an earlier install or run ("/.../Application/<old id>/Documents/Library/a.fmo")
    /// is mapped onto the current Documents folder. Other paths come back unchanged.
    static func remapStale(_ raw: String) -> String {
        if FileManager.default.fileExists(atPath: raw) { return raw }
        let marker = "/Documents/"
        guard let r = raw.range(of: marker) else { return raw }
        let rest = String(raw[r.upperBound...])
        return dataDir.appendingPathComponent(rest).path
    }
}

// MARK: - Text rules (the backend's _BAD, strip and slicing, by code point)

enum EngineText {
    private static let bad: Set<UInt32> = [92, 47, 58, 42, 63, 34, 60, 62, 124]   // \ / : * ? " < > |

    static func isBad(_ u: Unicode.Scalar) -> Bool {
        return u.value < 0x20 || bad.contains(u.value)
    }

    static func hasBad(_ s: String) -> Bool {
        return s.unicodeScalars.contains(where: { isBad($0) })
    }

    static func replaceBad(_ s: String, with r: String) -> String {
        var out = String.UnicodeScalarView()
        for u in s.unicodeScalars {
            if isBad(u) { out.append(contentsOf: r.unicodeScalars) } else { out.append(u) }
        }
        return String(out)
    }

    static func strip(_ s: String) -> String {
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Python's strip(".").
    static func stripDots(_ s: String) -> String {
        var a = Array(s.unicodeScalars)
        while let f = a.first, f == "." { a.removeFirst() }
        while let l = a.last, l == "." { a.removeLast() }
        var v = String.UnicodeScalarView()
        v.append(contentsOf: a)
        return String(v)
    }

    /// Python's s[:n] (code points).
    static func prefix(_ s: String, _ n: Int) -> String {
        var v = String.UnicodeScalarView()
        v.append(contentsOf: s.unicodeScalars.prefix(n))
        return String(v)
    }

    static func length(_ s: String) -> Int {
        return s.unicodeScalars.count
    }

    /// pathlib's stem and suffix of a file name ("a.b.fmo" gives "a.b" and ".fmo"; ".hidden" has no suffix).
    static func splitName(_ name: String) -> (stem: String, ext: String) {
        let scalars = Array(name.unicodeScalars)
        if let i = scalars.lastIndex(of: "."), i > 0, i < scalars.count - 1 {
            var a = String.UnicodeScalarView()
            a.append(contentsOf: scalars[0..<i])
            var b = String.UnicodeScalarView()
            b.append(contentsOf: scalars[i...])
            return (String(a), String(b))
        }
        return (name, "")
    }

    static func hex(_ n: Int) -> String {
        let h = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        return String(h.prefix(n))
    }

    static func stamp(_ date: Date = Date(), _ format: String = "yyyyMMdd-HHmmss") -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        f.dateFormat = format
        return f.string(from: date)
    }

    static func matches(_ pattern: String, _ s: String, caseInsensitive: Bool = false) -> Bool {
        guard let re = try? NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : []) else { return false }
        let range = NSRange(s.startIndex..<s.endIndex, in: s)
        return re.firstMatch(in: s, options: [], range: range) != nil
    }
}

/// Names for export files (the backend's exports.clean_name), used by Save To and the export routes.
enum ExportNaming {
    static func clean(_ name: String) throws -> String {
        let safe = EngineText.stripDots(EngineText.strip(EngineText.replaceBad(name, with: "-")))
        if safe.isEmpty || safe.utf8.count > 200 || safe != EngineText.strip(name) || safe.hasPrefix(".") {
            throw EngineError(400, "That file name cannot be used.")
        }
        return safe
    }
}

// MARK: - Files

enum EngineFS {
    static let fm = FileManager.default

    static func exists(_ u: URL) -> Bool {
        return fm.fileExists(atPath: u.path)
    }

    static func isDir(_ u: URL) -> Bool {
        var d: ObjCBool = false
        return fm.fileExists(atPath: u.path, isDirectory: &d) && d.boolValue
    }

    static func isFile(_ u: URL) -> Bool {
        var d: ObjCBool = false
        return fm.fileExists(atPath: u.path, isDirectory: &d) && !d.boolValue
    }

    /// A symbolic link (never followed by the brush and font routes).
    static func isLink(_ u: URL) -> Bool {
        guard let a = try? fm.attributesOfItem(atPath: u.path) else { return false }
        return (a[.type] as? FileAttributeType) == FileAttributeType.typeSymbolicLink
    }

    struct Stat {
        let size: Int64
        let modified: Double
        let modifiedDate: Date
        let created: Double
    }

    static func stat(_ u: URL) -> Stat? {
        guard let a = try? fm.attributesOfItem(atPath: u.path) else { return nil }
        let size = (a[.size] as? NSNumber)?.int64Value ?? 0
        let m = (a[.modificationDate] as? Date) ?? Date(timeIntervalSince1970: 0)
        let c = (a[.creationDate] as? Date) ?? m
        return Stat(size: size, modified: m.timeIntervalSince1970, modifiedDate: m, created: c.timeIntervalSince1970)
    }

    static func names(_ dir: URL) -> [String] {
        return (try? fm.contentsOfDirectory(atPath: dir.path)) ?? []
    }

    static func sameFile(_ a: URL, _ b: URL) -> Bool {
        guard let x = try? fm.attributesOfItem(atPath: a.path), let y = try? fm.attributesOfItem(atPath: b.path) else { return false }
        guard let ix = (x[.systemFileNumber] as? NSNumber)?.uint64Value, let iy = (y[.systemFileNumber] as? NSNumber)?.uint64Value else { return false }
        let dx = (x[.systemNumber] as? NSNumber)?.int64Value
        let dy = (y[.systemNumber] as? NSNumber)?.int64Value
        return ix == iy && dx == dy
    }

    static func setModified(_ u: URL, _ date: Date) {
        try? fm.setAttributes([.modificationDate: date], ofItemAtPath: u.path)
    }

    static func remove(_ u: URL) {
        try? fm.removeItem(at: u)
    }

    /// rmdir: removes a folder only when it is empty.
    static func rmdir(_ u: URL) -> Bool {
        return Darwin.rmdir(u.path) == 0
    }

    /// os.replace: an atomic rename that replaces the target.
    static func replace(_ src: URL, _ dst: URL) throws {
        if Darwin.rename(src.path, dst.path) != 0 {
            throw EngineFSError.posix(errno)
        }
    }

    /// A hidden part file beside `dst`; the part sweep deletes leftovers older than an hour.
    static func tempBeside(_ dst: URL) -> URL {
        return dst.deletingLastPathComponent().appendingPathComponent(".\(EngineText.hex(12)).part")
    }

    /// Writes the bytes to `tmp` and flushes them to disk.
    static func writeFile(_ data: Data, to tmp: URL) throws {
        guard fm.createFile(atPath: tmp.path, contents: nil) else { throw EngineFSError.posix(EIO) }
        let h = try FileHandle(forWritingTo: tmp)
        do {
            try h.write(contentsOf: data)
            try h.synchronize()
            try h.close()
        } catch {
            try? h.close()
            throw error
        }
    }

    /// Temp file in the same folder, flushed, then renamed over the target: a kill leaves the old file or the whole new one.
    static func atomicWrite(_ data: Data, to dst: URL) throws {
        let tmp = tempBeside(dst)
        defer { remove(tmp) }
        try writeFile(data, to: tmp)
        try replace(tmp, dst)
    }

    /// Moves a file; across volumes it copies beside the target first, as the backend's safe_move does.
    static func safeMove(_ src: URL, _ dst: URL) throws {
        do {
            try replace(src, dst)
            return
        } catch EngineFSError.posix(let code) where code == EXDEV {
            // fall through to the copy
        }
        let tmp = tempBeside(dst)
        defer { remove(tmp) }
        try fm.copyItem(at: src, to: tmp)
        try replace(tmp, dst)
        try fm.removeItem(at: src)
    }

    /// Puts a finished temp file at `dst` only if `dst` does not exist (a hard link is atomic and exclusive;
    /// a copy where links are not supported). The temp file stays; the caller removes it.
    static func publish(_ tmp: URL, _ dst: URL) throws {
        if Darwin.link(tmp.path, dst.path) == 0 { return }
        if errno == EEXIST { throw EngineFSError.exists }
        if fm.fileExists(atPath: dst.path) { throw EngineFSError.exists }
        do {
            try fm.copyItem(at: tmp, to: dst)
        } catch let e as CocoaError where e.code == .fileWriteFileExists {
            throw EngineFSError.exists
        }
    }

    /// "name.ext", "name 2.ext", "name 3.ext" ... the first that is free in `folder`.
    static func freePath(_ folder: URL, stem: String, ext: String) -> URL {
        var cand = folder.appendingPathComponent(stem + ext)
        var n = 2
        while exists(cand) {
            cand = folder.appendingPathComponent("\(stem) \(n)\(ext)")
            n += 1
        }
        return cand
    }
}

// MARK: - JSON

enum EngineJSON {
    static func object(_ data: Data) -> [String: Any]? {
        guard let v = try? JSONSerialization.jsonObject(with: data, options: []) else { return nil }
        return v as? [String: Any]
    }

    static func any(_ data: Data) -> Any? {
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    static func encode(_ value: Any) -> Data {
        if JSONSerialization.isValidJSONObject(value),
           let d = try? JSONSerialization.data(withJSONObject: value, options: [.withoutEscapingSlashes]) {
            return d
        }
        return Data("{}".utf8)
    }

    static func readObject(_ url: URL) -> [String: Any]? {
        guard let d = try? Data(contentsOf: url) else { return nil }
        return object(d)
    }

    /// A finite number from a JSON value (numbers, or numeric text), else the fallback.
    static func number(_ v: Any?, fallback: Double) -> Double {
        var x: Double? = nil
        if let n = v as? NSNumber { x = n.doubleValue }
        else if let s = v as? String { x = Double(s) }
        if let d = x, d == d, abs(d) < 1e12, d != 0 { return d }
        return fallback
    }
}

/// A request body that must be a JSON object; missing or wrongly typed fields answer 422 like pydantic.
struct JSONBody {
    let dict: [String: Any]

    private func missing(_ k: String) -> EngineError {
        return EngineError(422, "Field required: \(k)")
    }

    func string(_ k: String) throws -> String {
        guard let v = dict[k] as? String else { throw missing(k) }
        return v
    }

    func optString(_ k: String) throws -> String? {
        guard let raw = dict[k], !(raw is NSNull) else { return nil }
        guard let v = raw as? String else { throw EngineError(422, "Input should be a valid string: \(k)") }
        return v
    }

    func optBool(_ k: String, default d: Bool) -> Bool {
        if let n = dict[k] as? NSNumber { return n.boolValue }
        return d
    }

    func stringArray(_ k: String) throws -> [String] {
        guard let raw = dict[k] else { throw missing(k) }
        return try toStrings(raw, k)
    }

    func optStringArray(_ k: String) throws -> [String]? {
        guard let raw = dict[k], !(raw is NSNull) else { return nil }
        return try toStrings(raw, k)
    }

    func optObjects(_ k: String) throws -> [[String: Any]]? {
        guard let raw = dict[k], !(raw is NSNull) else { return nil }
        guard let arr = raw as? [Any] else { throw EngineError(422, "Input should be a valid list: \(k)") }
        var out: [[String: Any]] = []
        for e in arr {
            guard let o = e as? [String: Any] else { throw EngineError(422, "Input should be a valid object: \(k)") }
            out.append(o)
        }
        return out
    }

    private func toStrings(_ raw: Any, _ k: String) throws -> [String] {
        guard let arr = raw as? [Any] else { throw EngineError(422, "Input should be a valid list: \(k)") }
        var out: [String] = []
        for e in arr {
            guard let s = e as? String else { throw EngineError(422, "Input should be a valid string: \(k)") }
            out.append(s)
        }
        return out
    }
}

// MARK: - Routes

struct RouteContext {
    let request: APIRequest
    let params: [String: String]

    var body: Data { return request.body }

    func param(_ key: String) -> String {
        return params[key] ?? ""
    }

    func query(_ key: String) -> String? {
        return request.query[key]
    }

    func requiredQuery(_ key: String) throws -> String {
        guard let v = request.query[key] else { throw EngineError(422, "Field required: \(key)") }
        return v
    }

    /// FastAPI's bool query parsing; absent means false.
    func queryBool(_ key: String) throws -> Bool {
        guard let raw = request.query[key] else { return false }
        switch raw.lowercased() {
        case "1", "true", "t", "yes", "y", "on": return true
        case "0", "false", "f", "no", "n", "off", "": return false
        default: throw EngineError(422, "Input should be a valid boolean: \(key)")
        }
    }

    func json() throws -> JSONBody {
        guard let o = EngineJSON.object(request.body) else {
            throw EngineError(422, "Input should be a valid JSON object.")
        }
        return JSONBody(dict: o)
    }

    func header(_ name: String) -> String? {
        let want = name.lowercased()
        for (k, v) in request.headers where k.lowercased() == want { return v }
        return nil
    }

    /// 413 when the body is over the limit (the engine already holds it whole; the check keeps the backend's limits).
    func limited(_ limit: Int, _ message: String) throws -> Data {
        if request.body.count > limit { throw EngineError(413, message) }
        return request.body
    }
}

enum EngineHTTP {
    static func split(_ path: String) -> [String] {
        return path.split(separator: "/", omittingEmptySubsequences: true).map { String($0) }
    }

    /// Path segments, percent-decoded when the shell passes them raw (EngineRouter.decodesPath).
    static func segments(_ path: String) -> [String] {
        let raw = split(path)
        if !EngineRouter.decodesPath { return raw }
        return raw.map { $0.removingPercentEncoding ?? $0 }
    }

    static func ok() -> APIResponse {
        return APIResponse.json(["ok": true])
    }

    /// An empty 204 (a movie saved without a picture), as the backend answers.
    static func noContent(contentType: String) -> APIResponse {
        return APIResponse.data(Data(), contentType: contentType, status: 204)
    }
}

/// A route table for one group: first registered route that matches wins, like FastAPI.
/// A path that matches only with another method answers 405.
final class RouteTable {
    typealias Handler = (RouteContext) throws -> APIResponse

    private struct Route {
        let method: String
        let parts: [String]
        let handler: Handler
    }

    private var routes: [Route] = []

    func add(_ method: String, _ pattern: String, _ handler: @escaping Handler) {
        routes.append(Route(method: method, parts: EngineHTTP.split(pattern), handler: handler))
    }

    private func match(_ route: Route, _ segs: [String]) -> [String: String]? {
        guard route.parts.count == segs.count else { return nil }
        var params: [String: String] = [:]
        for i in 0..<segs.count {
            let p = route.parts[i]
            if p.hasPrefix("{") && p.hasSuffix("}") {
                params[String(p.dropFirst().dropLast())] = segs[i]
            } else if p != segs[i] {
                return nil
            }
        }
        return params
    }

    /// Does any route of this group have this path (any method)?
    func handles(_ request: APIRequest) -> Bool {
        let segs = EngineHTTP.segments(request.path)
        for r in routes where match(r, segs) != nil { return true }
        return false
    }

    func dispatch(_ request: APIRequest) -> APIResponse? {
        let segs = EngineHTTP.segments(request.path)
        let method = request.method.uppercased()
        var pathMatched = false
        for route in routes {
            guard let params = match(route, segs) else { continue }
            pathMatched = true
            if route.method != method { continue }
            do {
                return try route.handler(RouteContext(request: request, params: params))
            } catch let e as EngineError {
                return APIResponse.error(e.status, e.detail)
            } catch {
                return APIResponse.error(500, "Internal Server Error")
            }
        }
        return pathMatched ? APIResponse.error(405, "Method Not Allowed") : nil
    }
}

/// Runs blocking file work off the caller's thread. The queue is concurrent; each group guards its own state with a lock.
enum EngineWork {
    static let queue = DispatchQueue(label: "formmorpheus.engine.work", qos: .userInitiated, attributes: .concurrent)

    static func run(_ work: @escaping () -> APIResponse?) async -> APIResponse? {
        return await withCheckedContinuation { (cont: CheckedContinuation<APIResponse?, Never>) in
            queue.async {
                cont.resume(returning: work())
            }
        }
    }
}

// MARK: - Folders the person may name (Save To, copy-to)

enum EngineFolders {
    /// The backend's _safe_folder for iPad: a folder must lie inside the app's own folders (Documents and anything
    /// the document scene registered). Anything else answers as a system folder does on the desktop, because the
    /// native picker, not a typed path, saves to other places on iPad.
    static func safe(_ rawIn: String, create: Bool = true) throws -> URL {
        let raw = EngineText.strip(rawIn)
        if raw.isEmpty || EngineText.length(raw) > 1000 || raw.contains("\u{0}") {
            throw EngineError(400, "That folder cannot be used.")
        }
        if !raw.hasPrefix("/") {
            throw EngineError(400, "Give the full path of the folder.")
        }
        let url = URL(fileURLWithPath: EngineConfig.remapStale(raw)).standardizedFileURL.resolvingSymlinksInPath()
        var allowed = false
        for root in [EngineConfig.dataDir] + EngineConfig.extraWritableRoots + CloudLibrary.writableRoots where EngineConfig.isInside(url, root) {
            allowed = true
        }
        if !allowed || url.pathComponents.count < 2 {
            throw EngineError(400, "That folder belongs to the system. Choose one of your own.")
        }
        for sub in ["Exports", "Jobs", "Recently Deleted", "Recovery"] {
            if EngineConfig.isInside(url, EngineConfig.dataDir.appendingPathComponent(sub, isDirectory: true)) {
                throw EngineError(400, "That folder is used for something else.")
            }
        }
        if EngineFS.exists(url) && !EngineFS.isDir(url) {
            throw EngineError(400, "That path is a file, not a folder.")
        }
        if !create && !EngineFS.isDir(url) {
            throw EngineError(400, "That folder does not exist.")
        }
        do {
            try EngineFS.fm.createDirectory(at: url, withIntermediateDirectories: true)
            let probe = url.appendingPathComponent(".fm-write-test-\(EngineText.hex(8))")
            try Data().write(to: probe)
            EngineFS.remove(probe)
        } catch {
            throw EngineError(400, "formmorpheus cannot write to that folder.")
        }
        return url
    }
}
