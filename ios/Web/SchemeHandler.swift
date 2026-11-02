import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves `fm://localhost/...`. Files come from the bundled interface (Resources/web, a folder
/// reference, so it sits at <bundle>/web). Paths under /api go to EngineRouter.shared.
///
/// Threading: WebKit calls start and stop on the main thread. Work runs off the main thread,
/// but every call back into the task happens on the main thread and only while the task is
/// still in `running`. A task that WebKit stopped is removed there, so nothing is ever sent to it.
final class FMSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "fm"
    static let host = "localhost"

    private let webRoot: URL
    private var running: [ObjectIdentifier: Task<Void, Never>] = [:]

    override init() {
        let base = Bundle.main.resourceURL ?? Bundle.main.bundleURL
        self.webRoot = base.appendingPathComponent("web", isDirectory: true).standardizedFileURL
        super.init()
    }

    // MARK: WKURLSchemeHandler

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let request = urlSchemeTask.request
        guard let url = request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        let path = url.path.isEmpty ? "/" : url.path
        let isAPI = path == "/api" || path.hasPrefix("/api/")

        let work: Task<Void, Never>
        if isAPI {
            work = Task.detached(priority: .userInitiated) { [weak self] in
                let apiRequest = await FMSchemeHandler.makeAPIRequest(from: request, url: url, path: path)
                if Task.isCancelled { return }
                let response = await EngineRouter.shared.handle(apiRequest)
                await self?.deliver(urlSchemeTask, key: key, url: url, response: response)
            }
        } else {
            work = Task.detached(priority: .userInitiated) { [weak self] in
                guard let self = self else { return }
                let response = self.staticResponse(path: path, rangeHeader: request.value(forHTTPHeaderField: "Range"))
                if Task.isCancelled { return }
                await self.deliver(urlSchemeTask, key: key, url: url, response: response)
            }
        }
        running[key] = work
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        if let work = running.removeValue(forKey: key) {
            work.cancel()
        }
    }

    // MARK: Delivery

    private func deliver(_ task: WKURLSchemeTask, key: ObjectIdentifier, url: URL, response: APIResponse) {
        DispatchQueue.main.async { [weak self] in
            // Gone from `running` means WebKit stopped the task: never touch it again.
            guard let self = self, self.running.removeValue(forKey: key) != nil else { return }
            var headers = response.headers
            headers["Content-Length"] = String(response.body.count)
            if headers["Cache-Control"] == nil {
                headers["Cache-Control"] = "no-store"
            }
            guard let http = HTTPURLResponse(
                url: url,
                statusCode: response.status,
                httpVersion: "HTTP/1.1",
                headerFields: headers
            ) else {
                task.didFailWithError(URLError(.cannotParseResponse))
                return
            }
            task.didReceive(http)
            if !response.body.isEmpty {
                task.didReceive(response.body)
            }
            task.didFinish()
        }
    }

    // MARK: API requests

    nonisolated private static func makeAPIRequest(from request: URLRequest, url: URL, path: String) async -> APIRequest {
        var apiPath = String(path.dropFirst(4))   // drop "/api"
        if apiPath.isEmpty { apiPath = "/" }

        var query: [String: String] = [:]
        if let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems {
            for item in items {
                query[item.name] = item.value ?? ""
            }
        }

        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            body = drain(stream)
        }

        return APIRequest(
            method: (request.httpMethod ?? "GET").uppercased(),
            path: apiPath,
            query: query,
            headers: request.allHTTPHeaderFields ?? [:],
            body: body
        )
    }

    nonisolated private static func drain(_ stream: InputStream) -> Data {
        var data = Data()
        stream.open()
        defer { stream.close() }
        let size = 64 * 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let count = stream.read(buffer, maxLength: size)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }

    // MARK: Static files

    nonisolated private func staticResponse(path: String, rangeHeader: String?) -> APIResponse {
        var relative = path
        if relative == "/" { relative = "/index.html" }
        let file = webRoot.appendingPathComponent(String(relative.dropFirst())).standardizedFileURL

        // Stay inside the web root (no ".." escapes).
        let rootPath = webRoot.path.hasSuffix("/") ? webRoot.path : webRoot.path + "/"
        guard file.path.hasPrefix(rootPath) else {
            return APIResponse.error(403, "Forbidden")
        }

        var target = file
        var isDirectory: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: target.path, isDirectory: &isDirectory)
        if !exists || isDirectory.boolValue {
            // Paths without an extension fall back to the app shell; anything else is a 404.
            if file.pathExtension.isEmpty {
                target = webRoot.appendingPathComponent("index.html")
            } else {
                return APIResponse.error(404, "Not Found")
            }
        }

        guard let data = try? Data(contentsOf: target, options: [.mappedIfSafe]) else {
            return APIResponse.error(404, "Not Found")
        }
        let contentType = FMSchemeHandler.mimeType(forExtension: target.pathExtension)
        var headers: [String: String] = [
            "Content-Type": contentType,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache"
        ]

        if let range = FMSchemeHandler.parseRange(rangeHeader, length: data.count) {
            let slice = data.subdata(in: range.lowerBound..<(range.upperBound + 1))
            headers["Content-Range"] = "bytes \(range.lowerBound)-\(range.upperBound)/\(data.count)"
            return APIResponse(status: 206, headers: headers, body: slice)
        }
        return APIResponse(status: 200, headers: headers, body: data)
    }

    /// Parses a single "bytes=a-b" range. Returns inclusive bounds, or nil for none or invalid.
    nonisolated private static func parseRange(_ header: String?, length: Int) -> ClosedRange<Int>? {
        guard let header = header, header.hasPrefix("bytes="), length > 0 else { return nil }
        let spec = header.dropFirst("bytes=".count)
        if spec.contains(",") { return nil }
        let parts = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2 else { return nil }
        if parts[0].isEmpty {
            // Suffix range: the last N bytes.
            guard let suffix = Int(parts[1]), suffix > 0 else { return nil }
            let start = max(0, length - suffix)
            return start...(length - 1)
        }
        guard let start = Int(parts[0]), start >= 0, start < length else { return nil }
        var end = length - 1
        if !parts[1].isEmpty, let requested = Int(parts[1]) {
            end = min(requested, length - 1)
        }
        guard end >= start else { return nil }
        return start...end
    }

    nonisolated private static let mimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8",
        "htm": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "map": "application/json; charset=utf-8",
        "webmanifest": "application/manifest+json; charset=utf-8",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "avif": "image/avif",
        "ico": "image/x-icon",
        "wasm": "application/wasm",
        "woff2": "font/woff2",
        "woff": "font/woff",
        "ttf": "font/ttf",
        "otf": "font/otf",
        "txt": "text/plain; charset=utf-8",
        "md": "text/markdown; charset=utf-8",
        "xml": "application/xml",
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "m4a": "audio/mp4",
        "mp4": "video/mp4",
        "webm": "video/webm"
    ]

    nonisolated static func mimeType(forExtension ext: String) -> String {
        let lower = ext.lowercased()
        if let known = mimeTypes[lower] { return known }
        if let type = UTType(filenameExtension: lower), let mime = type.preferredMIMEType {
            return mime
        }
        return "application/octet-stream"
    }
}
