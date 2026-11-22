// SystemRoutes.swift
// /api/health, /api/capabilities, /api/system/library. A port of backend/app/routers/system.py.
//
// On iPad the library is Documents/Library (source "default") or Library in the app's iCloud Drive folder
// (source "custom", see CloudLibrary.swift). POST moves it between those two places only; nothing is copied.
// There is no ffmpeg here, so capabilities carries "ffmpeg": false. The export targets (VideoToolbox encoders) are
// reported by the export builder's GET /api/jobs/capabilities, which is where the interface reads them.

import Foundation

final class SystemRoutes: APIRoutes {
    let prefix = ""
    private let table = RouteTable()

    init() {
        table.add("GET", "/system/library") { [unowned self] c in try self.libraryInfo(c) }
        table.add("POST", "/system/library") { [unowned self] c in try self.setLibrary(c) }
        table.add("GET", "/health") { [unowned self] c in try self.health(c) }
        table.add("GET", "/capabilities") { [unowned self] c in try self.capabilities(c) }
    }

    func handle(_ request: APIRequest) async -> APIResponse? {
        if !table.handles(request) { return nil }
        return await EngineWork.run { return self.table.dispatch(request) }
    }

    private func libraryInfo(_ c: RouteContext) throws -> APIResponse {
        let cloud = CloudLibrary.current()
        let local = EngineConfig.localLibraryDir.path
        let dir = EngineConfig.libraryDir.path
        var icloud: Any = NSNull()
        if let f = cloud.folder { icloud = f.path }
        let r: [String: Any] = [
            "dir": dir,
            "default": local,
            "source": dir == local ? "default" : "custom",
            "icloud": icloud,
            "icloudState": cloud.state.rawValue,
        ]
        return APIResponse.json(r)
    }

    private func setLibrary(_ c: RouteContext) throws -> APIResponse {
        let body = try c.json()
        let raw = EngineText.strip(try body.optString("dir") ?? "")
        if raw.isEmpty {
            CloudLibrary.choose(false)
            let r: [String: Any] = ["dir": EngineConfig.libraryDir.path, "copied": 0, "source": "default"]
            return APIResponse.json(r)
        }
        let cloud = CloudLibrary.current()
        guard let folder = cloud.folder else {
            throw EngineError(409, CloudLibrary.message(cloud.state))
        }
        let asked = URL(fileURLWithPath: raw).standardizedFileURL.resolvingSymlinksInPath().path
        if asked != folder.standardizedFileURL.resolvingSymlinksInPath().path {
            throw EngineError(409, "On iPad the library lives on this iPad or in iCloud Drive, so no other folder can be chosen.")
        }
        CloudLibrary.choose(true)
        let r: [String: Any] = ["dir": EngineConfig.libraryDir.path, "copied": 0, "source": "custom"]
        return APIResponse.json(r)
    }

    private func health(_ c: RouteContext) throws -> APIResponse {
        let r: [String: Any] = ["ok": true, "app": EngineConfig.appName, "version": EngineConfig.version]
        return APIResponse.json(r)
    }

    private func capabilities(_ c: RouteContext) throws -> APIResponse {
        var r: [String: Any] = [
            "app": EngineConfig.appName,
            "version": EngineConfig.version,
            "platform": "ios",
            "desktop": false,
            "dataDir": EngineConfig.dataDir.path,
            "dataDirSource": "override",
            "libraryDir": EngineConfig.libraryDir.path,
            "projectExt": EngineConfig.projectExt,
            "ffmpeg": false,
        ]
        if let extra = EngineConfig.capabilityProvider?() {
            for (k, v) in extra { r[k] = v }
        }
        return APIResponse.json(r)
    }
}
