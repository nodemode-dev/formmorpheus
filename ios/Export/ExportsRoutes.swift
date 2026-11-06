// /api/exports: the files in Documents/Exports (list, read, write, delete into Recently Deleted).
// Same paths, methods and JSON as backend/app/routers/exports.py.
import Foundation

final class ExportsRoutes: APIRoutes {
    let prefix = "/exports"

    init() {}

    func handle(_ request: APIRequest) async -> APIResponse? {
        let parts = request.path.split(separator: "/").map { String($0) }
        guard parts.first == "exports" else { return nil }
        let method = request.method.uppercased()

        if parts.count == 1 {
            if method == "GET" { return list() }
            return APIResponse.error(405, "Method Not Allowed")
        }
        if parts.count == 2 {
            let raw = parts[1]
            switch method {
            case "GET": return read(raw)
            case "PUT": return write(raw, body: request.body)
            case "DELETE": return delete(raw)
            default: return APIResponse.error(405, "Method Not Allowed")
            }
        }
        return nil
    }

    /// The scheme handler passes URL.path, which is already percent-decoded.
    private func resolve(_ raw: String) -> String {
        return raw
    }

    private func list() -> APIResponse {
        let folder = ExportPaths.exportsDir
        let urls = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isRegularFileKey], options: [])) ?? []
        var items: [[String: Any]] = []
        for url in urls {
            if url.lastPathComponent.hasPrefix(".") { continue }
            let values = try? url.resourceValues(forKeys: [.isRegularFileKey])
            if values?.isRegularFile != true { continue }
            items.append(ExportPaths.entry(url))
        }
        items.sort { (($0["modified"] as? Double) ?? 0) > (($1["modified"] as? Double) ?? 0) }
        let body: [String: Any] = ["folder": folder.path, "items": items]
        return APIResponse.json(body)
    }

    private func read(_ raw: String) -> APIResponse {
        guard let name = ExportPaths.cleanName(resolve(raw)) else { return APIResponse.error(400, "That file name cannot be used.") }
        let url = ExportPaths.exportsDir.appendingPathComponent(name)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue else {
            return APIResponse.error(404, "No export by that name.")
        }
        // mapped, so a large movie is paged in by the scheme handler instead of sitting in memory
        guard let data = try? Data(contentsOf: url, options: [.alwaysMapped]) else {
            return APIResponse.error(500, "The export could not be read.")
        }
        let mime = ExportPaths.mimes[url.pathExtension.lowercased()] ?? "application/octet-stream"
        var response = APIResponse.data(data, contentType: mime)
        response.headers["Cache-Control"] = "no-store"
        return response
    }

    private func write(_ raw: String, body: Data) -> APIResponse {
        guard let name = ExportPaths.cleanName(resolve(raw)) else { return APIResponse.error(400, "That file name cannot be used.") }
        if body.count > ExportLimits.maxExportBytes { return APIResponse.error(413, "The export is too large to keep.") }
        let folder = ExportPaths.exportsDir
        let url = ExportPaths.freePath(folder.appendingPathComponent(name))
        let tmp = folder.appendingPathComponent(".\(UUID().uuidString.lowercased()).part")
        do {
            try body.write(to: tmp, options: [])
            try FileManager.default.moveItem(at: tmp, to: url)
        } catch {
            _ = try? FileManager.default.removeItem(at: tmp)
            return APIResponse.error(500, "The export could not be stored.")
        }
        return APIResponse.json(ExportPaths.entry(url))
    }

    private func delete(_ raw: String) -> APIResponse {
        guard let name = ExportPaths.cleanName(resolve(raw)) else { return APIResponse.error(400, "That file name cannot be used.") }
        let src = ExportPaths.exportsDir.appendingPathComponent(name)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: src.path, isDirectory: &isDir), !isDir.boolValue else {
            return APIResponse.error(404, "No export by that name.")
        }
        let stem = src.deletingPathExtension().lastPathComponent
        let ext = src.pathExtension
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let now = Date()
        let nanos = Int((now.timeIntervalSince1970 * 1_000_000_000).truncatingRemainder(dividingBy: 1_000_000_000))
        let trashName = "\(stem) \(formatter.string(from: now))-\(String(format: "%09d", nanos))" + (ext.isEmpty ? "" : ".\(ext)")
        let dst = ExportPaths.trashDir.appendingPathComponent(trashName)
        do {
            try FileManager.default.moveItem(at: src, to: dst)
        } catch {
            return APIResponse.error(500, "The export could not be moved to Recently Deleted.")
        }
        // the engine's trash keeps the original name and the deletion time in its index.json
        TrashStore.shared.record(dst, original: src.lastPathComponent, kind: "export")
        return APIResponse.json(["deleted": src.lastPathComponent, "kept": dst.path])
    }
}
