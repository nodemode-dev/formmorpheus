// VoiceRoutes.swift
// /api/voice on iPad: the paths, JSON shapes and status codes of backend/app/routers/voice.py, so the interface's
// io/voice-api.ts works unchanged. The built-in voice (a Python runtime) cannot exist here and says so; the voice
// app is a speech server on the same network and the online voice uses the Keychain (VoiceRemote.swift); listening
// is the iPad's own on-device speech recognition (VoiceListen.swift). A spoken sound waits in Caches/Voice/out until
// the page fetches it, swept after an hour, as the desktop keeps it in its data folder.

import Foundation

final class VoiceRoutes: APIRoutes, @unchecked Sendable {
    let prefix = "/voice"
    private let table = RouteTable()

    typealias AsyncHandler = (RouteContext) async throws -> APIResponse

    private struct AsyncRoute {
        let method: String
        let parts: [String]
        let handler: AsyncHandler
    }

    private var asyncRoutes: [AsyncRoute] = []

    static let engines: Set<String> = ["builtin", "local", "online"]
    static let maxText = 10000
    static let keepSeconds: TimeInterval = 3600
    static let ext: [String: String] = ["audio/wav": ".wav", "audio/mpeg": ".mp3", "audio/ogg": ".ogg", "audio/flac": ".flac", "audio/aac": ".aac"]
    static let noBuiltin = "The built-in voice is not available on iPad."
    static let noSound = "There is no spoken sound with that id."

    init() {
        table.add("GET", "/voice/status") { [unowned self] c in try self.status(c) }
        table.add("POST", "/voice/builtin/setup") { _ in throw EngineError(409, VoiceRoutes.noBuiltin) }
        table.add("GET", "/voice/builtin/job") { _ in APIResponse.json(["job": NSNull()]) }
        table.add("DELETE", "/voice/builtin/job") { _ in APIResponse.json(["cancelled": false]) }
        table.add("DELETE", "/voice/builtin") { _ in APIResponse.json(["removed": false]) }
        table.add("GET", "/voice/builtin/voices") { _ in throw EngineError(409, VoiceRoutes.noBuiltin) }
        table.add("PUT", "/voice/local") { [unowned self] c in try self.localSave(c) }
        table.add("PUT", "/voice/online/key") { [unowned self] c in try self.onlineKey(c) }
        table.add("DELETE", "/voice/online/key") { _ in
            VoiceRemote.clearOnlineKey()
            return APIResponse.json(VoiceRemote.onlineStatus())
        }
        table.add("GET", "/voice/audio/{sid}") { [unowned self] c in try self.audio(c) }
        table.add("DELETE", "/voice/audio/{sid}") { [unowned self] c in try self.audioDrop(c) }
        table.add("GET", "/voice/transcribe/status") { c in APIResponse.json(VoiceListen.status(c.query("language") ?? "auto")) }
        table.add("POST", "/voice/transcribe/setup") { _ in APIResponse.json(try VoiceListen.startSetup(), status: 202) }
        table.add("GET", "/voice/transcribe/job") { _ in APIResponse.json(["job": VoiceListen.currentJob()]) }
        table.add("DELETE", "/voice/transcribe/job") { _ in APIResponse.json(["cancelled": false]) }
        table.add("DELETE", "/voice/transcribe") { _ in APIResponse.json(["removed": false]) }

        addAsync("POST", "/voice/local/probe") { [unowned self] c in try await self.localProbe(c) }
        addAsync("GET", "/voice/online/voices") { _ in
            let voices = try await VoiceRemote.onlineVoices()
            return APIResponse.json(["voices": voices])
        }
        addAsync("POST", "/voice/speak") { [unowned self] c in try await self.speak(c) }
        addAsync("POST", "/voice/transcribe") { c in
            let language = EngineText.prefix(c.query("language") ?? "auto", 12)
            return APIResponse.json(try await VoiceListen.transcribe(c.body, language: language))
        }
    }

    private func addAsync(_ method: String, _ pattern: String, _ handler: @escaping AsyncHandler) {
        asyncRoutes.append(AsyncRoute(method: method, parts: EngineHTTP.split(pattern), handler: handler))
    }

    func handle(_ request: APIRequest) async -> APIResponse? {
        let segs = EngineHTTP.segments(request.path)
        let method = request.method.uppercased()
        var asyncPath = false
        for route in asyncRoutes where route.parts == segs {
            asyncPath = true
            if route.method != method { continue }
            do {
                return try await route.handler(RouteContext(request: request, params: [:]))
            } catch let e as EngineError {
                return APIResponse.error(e.status, e.detail)
            } catch {
                return APIResponse.error(500, "Internal Server Error")
            }
        }
        if table.handles(request) {
            return await EngineWork.run { return self.table.dispatch(request) }
        }
        return asyncPath ? APIResponse.error(405, "Method Not Allowed") : nil
    }

    // MARK: status

    private func status(_ c: RouteContext) throws -> APIResponse {
        let builtin: [String: Any] = ["ready": false, "runtime": false, "model": false, "python": NSNull(), "folder": "", "bytes": 0,
                                      "job": NSNull(), "available": false, "reason": VoiceRoutes.noBuiltin]
        let r: [String: Any] = ["builtin": builtin, "local": VoiceRemote.localSettings(), "online": VoiceRemote.onlineStatus(), "platform": "ipad"]
        return APIResponse.json(r)
    }

    // MARK: the voice app and the online key

    private func limitedString(_ b: JSONBody, _ key: String, max: Int, required: Bool = false) throws -> String? {
        guard let v = try b.optString(key) else {
            if required { throw EngineError(422, "Field required: \(key)") }
            return nil
        }
        if EngineText.length(v) > max { throw EngineError(422, "String should have at most \(max) characters: \(key)") }
        if required && v.isEmpty { throw EngineError(422, "String should have at least 1 character: \(key)") }
        return v
    }

    private func localSave(_ c: RouteContext) throws -> APIResponse {
        let b = try c.json()
        let base = try limitedString(b, "base", max: 200) ?? ""
        let model = try limitedString(b, "model", max: 120) ?? ""
        let voice = try limitedString(b, "voice", max: 120) ?? ""
        let key = try limitedString(b, "key", max: 400)
        return APIResponse.json(try VoiceRemote.saveLocal(base: base, model: model, voice: voice, key: key))
    }

    private func localProbe(_ c: RouteContext) async throws -> APIResponse {
        let b = try c.json()
        let base = try limitedString(b, "base", max: 200, required: true) ?? ""
        return APIResponse.json(try await VoiceRemote.probeLocal(base))
    }

    private func onlineKey(_ c: RouteContext) throws -> APIResponse {
        let b = try c.json()
        let key = try limitedString(b, "key", max: 400, required: true) ?? ""
        try VoiceRemote.setOnlineKey(key)
        return APIResponse.json(VoiceRemote.onlineStatus())
    }

    // MARK: speaking

    static var outDir: URL {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let u = caches.appendingPathComponent("Voice", isDirectory: true).appendingPathComponent("out", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    @discardableResult
    static func sweep(now: Date = Date()) -> Int {
        let limit = now.timeIntervalSince1970 - keepSeconds
        let dir = outDir
        var gone = 0
        for n in EngineFS.names(dir) {
            let u = dir.appendingPathComponent(n)
            if EngineFS.isFile(u), let st = EngineFS.stat(u), st.modified < limit {
                EngineFS.remove(u)
                gone += 1
            }
        }
        return gone
    }

    private func speak(_ c: RouteContext) async throws -> APIResponse {
        let b = try c.json()
        let engine = try b.optString("engine") ?? "builtin"
        guard let raw = try b.optString("text") else { throw EngineError(422, "Field required: text") }
        if raw.isEmpty { throw EngineError(422, "String should have at least 1 character: text") }
        if EngineText.length(raw) > VoiceRoutes.maxText {
            throw EngineError(422, "String should have at most \(VoiceRoutes.maxText) characters: text")
        }
        let voice = try b.optString("voice") ?? ""
        let model = try b.optString("model") ?? ""
        var speed = 1.0
        if let s = b.dict["speed"], !(s is NSNull) {
            guard let n = s as? NSNumber else { throw EngineError(422, "Input should be a valid number: speed") }
            speed = n.doubleValue
        }
        if !(speed >= 0.5 && speed <= 2.0) { throw EngineError(422, "Input should be between 0.5 and 2.0: speed") }
        if !VoiceRoutes.engines.contains(engine) { throw EngineError(422, "There is no voice engine named \(engine).") }
        let text = EngineText.strip(raw)
        if text.isEmpty { throw EngineError(422, "There is no text to speak.") }
        VoiceRoutes.sweep()
        let spoken: VoiceRemote.Spoken
        switch engine {
        case "local": spoken = try await VoiceRemote.speakLocal(text: text, voice: voice, model: model, speed: speed)
        case "online": spoken = try await VoiceRemote.speakOnline(text: text, voice: voice, model: model)
        default: throw EngineError(409, VoiceRoutes.noBuiltin)
        }
        guard let suffix = VoiceRoutes.ext[spoken.mime], !spoken.audio.isEmpty else {
            throw EngineError(502, "The voice answered with something that is not a sound.")
        }
        let sid = EngineText.hex(32)
        let dir = VoiceRoutes.outDir
        let info: [String: Any] = [
            "id": sid, "mime": spoken.mime, "engine": engine, "voice": spoken.voice.isEmpty ? voice : spoken.voice,
            "seconds": NSNull(), "cues": [[String: Any]](), "text": text, "bytes": spoken.audio.count,
        ]
        do {
            try EngineFS.atomicWrite(spoken.audio, to: dir.appendingPathComponent(sid + suffix))
            try EngineFS.atomicWrite(EngineJSON.encode(info), to: dir.appendingPathComponent(sid + ".json"))
        } catch {
            throw EngineError(500, "The spoken sound could not be kept for the window.")
        }
        return APIResponse.json(info, status: 201)
    }

    private func sound(_ sid: String) throws -> (URL, String) {
        if !EngineText.matches("^[0-9a-f]{32}$", sid) { throw EngineError(404, VoiceRoutes.noSound) }
        let dir = VoiceRoutes.outDir
        guard let info = EngineJSON.readObject(dir.appendingPathComponent(sid + ".json")),
              let mime = info["mime"] as? String, let suffix = VoiceRoutes.ext[mime] else {
            throw EngineError(404, VoiceRoutes.noSound)
        }
        let path = dir.appendingPathComponent(sid + suffix)
        if !EngineFS.isFile(path) { throw EngineError(404, VoiceRoutes.noSound) }
        return (path, mime)
    }

    private func audio(_ c: RouteContext) throws -> APIResponse {
        let (path, mime) = try sound(c.param("sid"))
        guard let data = try? Data(contentsOf: path, options: .mappedIfSafe) else { throw EngineError(404, VoiceRoutes.noSound) }
        return APIResponse.data(data, contentType: mime)
    }

    private func audioDrop(_ c: RouteContext) throws -> APIResponse {
        let sid = c.param("sid")
        let (path, _) = try sound(sid)
        EngineFS.remove(path)
        EngineFS.remove(VoiceRoutes.outDir.appendingPathComponent(sid + ".json"))
        return APIResponse.json(["removed": true])
    }
}
