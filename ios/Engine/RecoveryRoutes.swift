// RecoveryRoutes.swift
// /api/recovery: snapshots of the open movie, the heartbeat, and the offer of what a dead session left behind.
// A port of backend/app/routers/recovery.py.
//
// The desktop engine learns that a window died from a live WebSocket. A scheme handler cannot serve one, so the
// socket becomes a lease the page renews by polling:
//   POST   /api/recovery/{session}/live   renews the lease (60 s); call it every 20 s with the heartbeat
//   DELETE /api/recovery/{session}/live   the page is closing (pagehide): the session counts as gone after the grace
// A session with no lease at all is gone when its last heartbeat is older than this process (the app was quit or
// killed and started again) or older than 240 s, which is the desktop's own fallback. So a page that only keeps
// calling POST /{session}/alive still works; the lease just makes the answer quicker.

import Foundation

final class RecoveryRoutes: APIRoutes {
    let prefix = "/recovery"
    private let table = RouteTable()

    private let fileLock = NSLock()
    private let stateLock = NSLock()
    private let boot = Date().timeIntervalSince1970
    private var leases: [String: Double] = [:]   // session -> lease end
    private var closed: [String: Double] = [:]   // session -> when it closed

    private let leaseSeconds = 60.0
    private let graceSeconds = 30.0   // a dropped lease is given this long to come back (a suspended app resumes late)
    private let pruneSeconds = 120.0

    init() {
        table.add("GET", "/recovery") { [unowned self] c in try self.list(c) }
        table.add("POST", "/recovery/{session}/live") { [unowned self] c in try self.renewLease(c) }
        table.add("DELETE", "/recovery/{session}/live") { [unowned self] c in try self.closeLease(c) }
        table.add("GET", "/recovery/{session}") { [unowned self] c in try self.read(c) }
        table.add("PUT", "/recovery/{session}") { [unowned self] c in try self.write(c) }
        table.add("POST", "/recovery/{session}/alive") { [unowned self] c in try self.heartbeat(c) }
        table.add("DELETE", "/recovery/{session}") { [unowned self] c in try self.delete(c) }
    }

    func handle(_ request: APIRequest) async -> APIResponse? {
        if !table.handles(request) { return nil }
        return await EngineWork.run { return self.table.dispatch(request) }
    }

    // MARK: helpers

    private func session(_ c: RouteContext) throws -> String {
        let s = c.param("session")
        if !validSession(s) { throw EngineError(400, "That is not a session id.") }
        return s
    }

    private func paths(_ session: String) -> (fmo: URL, side: URL) {
        let folder = EngineConfig.recoveryDir
        return (folder.appendingPathComponent(session + EngineConfig.projectExt), folder.appendingPathComponent(session + ".json"))
    }

    private func validSession(_ s: String) -> Bool {
        let n = s.unicodeScalars.count
        if n < 6 || n > 64 { return false }
        for u in s.unicodeScalars {
            let v = u.value
            let digit = v >= 48 && v <= 57
            let upper = v >= 65 && v <= 90
            let lower = v >= 97 && v <= 122
            let mark = v == 95 || v == 45   // _ and -
            if !(digit || upper || lower || mark) { return false }
        }
        return true
    }

    private func prune() {
        let cut = Date().timeIntervalSince1970 - pruneSeconds
        stateLock.lock()
        defer { stateLock.unlock() }
        for (k, t) in closed where t < cut { closed.removeValue(forKey: k) }
        for (k, t) in leases where t < cut { leases.removeValue(forKey: k) }
    }

    /// (gone, wait): gone is true or false when the leases know, nil when the heartbeat age decides.
    /// wait is the seconds until a session whose lease just ended counts as gone (it may be coming back).
    private func state(_ session: String, alive: Double) -> (gone: Bool?, wait: Double) {
        let now = Date().timeIntervalSince1970
        stateLock.lock()
        defer { stateLock.unlock() }
        var endedAt: Double? = nil
        if let exp = leases[session] {
            if exp > now { return (false, 0) }
            endedAt = exp
        } else if let cl = closed[session] {
            endedAt = cl
        }
        if let ended = endedAt {
            let age = now - ended
            return (age > graceSeconds, max(0, graceSeconds - age))
        }
        if alive < boot { return (true, 0) }
        return (nil, 0)
    }

    private func atomic(_ url: URL, _ data: Data) throws {
        try EngineFS.atomicWrite(data, to: url)
    }

    private func entry(_ session: String, _ fmo: URL, _ side: URL) -> [String: Any] {
        let meta = EngineJSON.readObject(side) ?? [:]
        let st = EngineFS.stat(fmo)
        let taken = EngineJSON.number(meta["time"], fallback: st?.modified ?? 0)
        // the heartbeat of the window that owns this snapshot; older files only have the snapshot time
        let alive = EngineJSON.number(meta["alive"], fallback: taken)
        let now = Date().timeIntervalSince1970
        let idle = max(0.0, now - alive)
        let s = state(session, alive: alive)
        var name = "Untitled"
        if let n = meta["name"] as? String, !n.isEmpty { name = n }
        var library: Any = NSNull()
        if let l = meta["library"] as? String { library = l }
        return [
            "gone": s.gone ?? (idle > 240),
            "wait": s.gone == false ? s.wait : 0.0,
            "session": session,
            "name": name,
            "library": library,
            "time": taken,
            "alive": alive,
            "idle": idle,
            "size": st?.size ?? 0,
        ]
    }

    // MARK: routes

    private func list(_ c: RouteContext) throws -> APIResponse {
        prune()
        var items: [[String: Any]] = []
        let folder = EngineConfig.recoveryDir
        for n in EngineFS.names(folder) where n.hasSuffix(EngineConfig.projectExt) && !n.hasPrefix(".") {
            let stem = String(n.dropLast(EngineConfig.projectExt.count))
            let fmo = folder.appendingPathComponent(n)
            if validSession(stem) && EngineFS.isFile(fmo) {
                items.append(entry(stem, fmo, folder.appendingPathComponent(stem + ".json")))
            }
        }
        items.sort { (($0["time"] as? Double) ?? 0) > (($1["time"] as? Double) ?? 0) }
        return APIResponse.json(["items": items])
    }

    private func renewLease(_ c: RouteContext) throws -> APIResponse {
        let s = try session(c)
        stateLock.lock()
        leases[s] = Date().timeIntervalSince1970 + leaseSeconds
        closed.removeValue(forKey: s)
        stateLock.unlock()
        return APIResponse.json(["ok": true, "lease": leaseSeconds])
    }

    private func closeLease(_ c: RouteContext) throws -> APIResponse {
        let s = try session(c)
        stateLock.lock()
        leases.removeValue(forKey: s)
        closed[s] = Date().timeIntervalSince1970
        stateLock.unlock()
        prune()
        return EngineHTTP.ok()
    }

    private func read(_ c: RouteContext) throws -> APIResponse {
        let p = paths(try session(c))
        if !EngineFS.isFile(p.fmo) { throw EngineError(404, "No recovery snapshot for that session.") }
        guard let data = try? Data(contentsOf: p.fmo, options: .mappedIfSafe) else {
            throw EngineError(404, "No recovery snapshot for that session.")
        }
        return APIResponse.data(data, contentType: "application/octet-stream")
    }

    private func write(_ c: RouteContext) throws -> APIResponse {
        let s = try session(c)
        let p = paths(s)
        let name = c.query("name") ?? "Untitled"
        let library = c.query("library")
        let body = try c.limited(EngineConfig.maxProjectBytes, "The movie is too large to snapshot.")
        if body.count < 4 || Array(body.prefix(4)) != [0x50, 0x4B, 0x03, 0x04] {
            throw EngineError(400, "That is not a formmorpheus project.")
        }
        let now = Date().timeIntervalSince1970
        var meta: [String: Any] = ["name": EngineText.prefix(name, 180), "time": now, "alive": now]
        if let l = library, !l.isEmpty { meta["library"] = EngineText.prefix(l, 180) } else { meta["library"] = NSNull() }
        fileLock.lock()
        defer { fileLock.unlock() }
        try atomic(p.fmo, body)
        try atomic(p.side, EngineJSON.encode(meta))
        return APIResponse.json(entry(s, p.fmo, p.side))
    }

    /// The owning window calls this every 20 s and on every visibility change; a snapshot whose heartbeat is
    /// over 240 s old is offered as a crash.
    private func heartbeat(_ c: RouteContext) throws -> APIResponse {
        let p = paths(try session(c))
        fileLock.lock()
        defer { fileLock.unlock() }
        if !EngineFS.isFile(p.fmo) { throw EngineError(404, "No recovery snapshot for that session.") }
        var meta = EngineJSON.readObject(p.side) ?? [:]
        meta["alive"] = Date().timeIntervalSince1970
        try atomic(p.side, EngineJSON.encode(meta))
        return EngineHTTP.ok()
    }

    private func delete(_ c: RouteContext) throws -> APIResponse {
        let p = paths(try session(c))
        fileLock.lock()
        defer { fileLock.unlock() }
        EngineFS.remove(p.fmo)
        EngineFS.remove(p.side)
        return EngineHTTP.ok()
    }
}
