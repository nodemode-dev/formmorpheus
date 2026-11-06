import Foundation

/// One request from the interface to the engine, already split into parts.
/// The scheme handler builds it from `fm://localhost/api/...`.
struct APIRequest {
    let method: String          // "GET", "POST", ...
    let path: String            // e.g. "/library/list" (after "/api"), no query
    let query: [String: String]
    let headers: [String: String]
    let body: Data

    /// The body parsed as JSON, or nil when it is empty or not JSON.
    var jsonBody: Any? {
        if body.isEmpty { return nil }
        return try? JSONSerialization.jsonObject(with: body, options: [.fragmentsAllowed])
    }

    /// Case-insensitive header lookup (HTTP header names are not case sensitive).
    func header(_ name: String) -> String? {
        let wanted = name.lowercased()
        for (key, value) in headers where key.lowercased() == wanted {
            return value
        }
        return nil
    }
}

/// One response from the engine to the interface.
struct APIResponse {
    var status: Int
    var headers: [String: String]
    var body: Data

    /// JSON response. Dictionaries, arrays, strings, numbers and NSNull are accepted.
    /// Anything JSONSerialization cannot encode becomes `null` instead of crashing.
    static func json(_ object: Any, status: Int = 200) -> APIResponse {
        var data = Data("null".utf8)
        let isFragment = object is String || object is NSNumber || object is NSNull
        if JSONSerialization.isValidJSONObject(object) || isFragment {
            if let encoded = try? JSONSerialization.data(
                withJSONObject: object,
                options: [.fragmentsAllowed, .withoutEscapingSlashes]
            ) {
                data = encoded
            }
        }
        return APIResponse(
            status: status,
            headers: ["Content-Type": "application/json"],
            body: data
        )
    }

    /// Raw bytes with a content type (files, images, exports).
    static func data(_ data: Data, contentType: String, status: Int = 200) -> APIResponse {
        return APIResponse(status: status, headers: ["Content-Type": contentType], body: data)
    }

    /// Error body shaped like FastAPI's: {"detail": "..."}.
    static func error(_ status: Int, _ detail: String) -> APIResponse {
        return json(["detail": detail], status: status)
    }
}

/// A group of routes. The engine router asks each group in turn.
protocol APIRoutes: AnyObject {
    /// Path prefix after "/api", e.g. "/library". "" for root routes (/health, /capabilities, /system/...).
    var prefix: String { get }
    /// Return nil when no route matches so the router tries the next group.
    func handle(_ request: APIRequest) async -> APIResponse?
}
