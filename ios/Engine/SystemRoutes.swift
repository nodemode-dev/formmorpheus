// SystemRoutes.swift
// /api/health, /api/capabilities, /api/system/library. A port of backend/app/routers/system.py.
//
// On iPad the library is Documents/Library and cannot be moved: GET /system/library reports source "override",
// which locks the Library Folder dialog the way FORMMORPHEUS_LIBRARY_DIR does on the desktop, and POST answers 409.
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
        let dir = EngineConfig.libraryDir.path
        let r: [String: Any] = ["dir": dir, "default": dir, "source": "override", "icloud": NSNull()]
        return APIResponse.json(r)
    }

    private func setLibrary(_ c: RouteContext) throws -> APIResponse {
        throw EngineError(409, "The library folder on iPad is always Documents/Library, so it cannot be changed here.")
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
