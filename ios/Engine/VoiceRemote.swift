// VoiceRemote.swift
// The voices that are not built in, on iPad: a voice app (a speech server on a computer on the same network that
// answers the common speech API) and an online voice with the person's own key. A port of
// backend/app/services/voice_remote.py: the same requests, headers, limits and sentences. Keys live in the Keychain
// (VoiceKeychain.swift), the voice app's address, model and voice in UserDefaults.

import Foundation

struct VoiceReply {
    let status: Int
    let data: Data
    let contentType: String
}

/// The voice app may not send the request anywhere else: a redirect is answered as it stands, never followed.
final class VoiceNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

enum VoiceHTTP {
    static let local: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.connectionProxyDictionary = [:]
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config, delegate: VoiceNoRedirect(), delegateQueue: nil)
    }()

    static let online: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }()

    static func fetch(_ session: URLSession, _ request: URLRequest) async throws -> VoiceReply {
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<VoiceReply, Error>) in
            let task = session.dataTask(with: request) { data, response, error in
                if let error = error {
                    cont.resume(throwing: error)
                    return
                }
                guard let http = response as? HTTPURLResponse else {
                    cont.resume(throwing: URLError(.badServerResponse))
                    return
                }
                let ctype = http.value(forHTTPHeaderField: "Content-Type") ?? ""
                cont.resume(returning: VoiceReply(status: http.statusCode, data: data ?? Data(), contentType: ctype))
            }
            task.resume()
        }
    }
}

/// Which addresses the voice app may have on iPad: the desktop's loopback names, private and link-local IPv4 and
/// IPv6 addresses, and .local names. Never a name or address on the open internet.
enum VoiceAddress {
    static func allowed(_ host: String) -> Bool {
        if host == "localhost" || host == "127.0.0.1" || host == "::1" { return true }
        if let quad = ipv4(host) {
            let a = quad[0], b = quad[1]
            if a == 10 { return true }
            if a == 172 && b >= 16 && b <= 31 { return true }
            if a == 192 && b == 168 { return true }
            if a == 169 && b == 254 { return true }
            return false
        }
        if host.contains(":") {
            if !EngineText.matches("^[0-9a-f:.]+$", host) { return false }
            let first = host.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).first.map { String($0) } ?? ""
            guard !first.isEmpty, first.count <= 4, let v = Int(first, radix: 16) else { return false }
            return (v & 0xffc0) == 0xfe80 || (v & 0xfe00) == 0xfc00
        }
        return EngineText.matches("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+local$", host)
    }

    private static func ipv4(_ host: String) -> [Int]? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false).map { String($0) }
        if parts.count != 4 { return nil }
        var out: [Int] = []
        for p in parts {
            guard !p.isEmpty, p.count <= 3, EngineText.matches("^[0-9]+$", p), let n = Int(p), n <= 255 else { return nil }
            out.append(n)
        }
        return out
    }
}

enum VoiceRemote {
    static let localAccount = "voice-local-key"
    static let onlineAccount = "voice-online-key"
    static let settingsKey = "formmorpheus.voice.local"
    static let onlineBase = "https://api.elevenlabs.io"
    static let defaultOnlineVoice = "21m00Tcm4TlvDq8ikWAM"
    static let defaultOnlineModel = "eleven_multilingual_v2"
    static let maxOnlineText = 2000
    static let maxBytes = 200 * 1024 * 1024
    static let speechTimeout: TimeInterval = 300
    static let probeTimeout: TimeInterval = 5
    static let onlineTimeout: TimeInterval = 120

    static let addressSorry = "Only an address on the same network is allowed, such as http://192.168.1.20:8080 or http://my-computer.local:8080."
    static let noKeyStore = "This iPad could not keep the key in its Keychain, so it was not saved."

    private static let mimes: [String: String] = [
        "audio/wav": "audio/wav", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav",
        "audio/mpeg": "audio/mpeg", "audio/mp3": "audio/mpeg", "audio/ogg": "audio/ogg", "application/ogg": "audio/ogg",
        "audio/flac": "audio/flac", "audio/x-flac": "audio/flac",
    ]
    private static let generic: Set<String> = ["", "application/octet-stream", "binary/octet-stream", "text/plain", "audio/basic"]

    struct Spoken {
        let audio: Data
        let mime: String
        let voice: String
    }

    // MARK: settings

    static func storedLocal() -> (base: String, model: String, voice: String) {
        let raw = UserDefaults.standard.dictionary(forKey: settingsKey) ?? [:]
        return ((raw["base"] as? String) ?? "", (raw["model"] as? String) ?? "", (raw["voice"] as? String) ?? "")
    }

    static func localSettings() -> [String: Any] {
        let s = storedLocal()
        return ["base": s.base, "model": s.model, "voice": s.voice, "hasKey": VoiceKeychain.get(localAccount) != nil]
    }

    static func normalizeBase(_ base: String) throws -> String {
        let sorry = EngineError(422, addressSorry)
        let text = EngineText.strip(base)
        if text.isEmpty { throw sorry }
        guard let parts = URLComponents(string: text) else { throw sorry }
        let scheme = (parts.scheme ?? "").lowercased()
        var host = (parts.host ?? "").lowercased()
        if host.hasPrefix("[") && host.hasSuffix("]") { host = String(host.dropFirst().dropLast()) }
        if scheme != "http" && scheme != "https" { throw sorry }
        if parts.user != nil || parts.password != nil || parts.query != nil || parts.fragment != nil { throw sorry }
        var path = parts.path
        while path.hasSuffix("/") { path.removeLast() }
        if path != "" && path != "/v1" { throw sorry }
        if host.isEmpty || !VoiceAddress.allowed(host) { throw sorry }
        var out = scheme + "://" + (host.contains(":") ? "[\(host)]" : host)
        if let port = parts.port {
            if port < 0 || port > 65535 { throw sorry }
            out += ":\(port)"
        }
        return out
    }

    static func saveLocal(base: String, model: String, voice: String, key: String?) throws -> [String: Any] {
        var clean = ""
        if !EngineText.strip(base).isEmpty { clean = try normalizeBase(base) }
        if let k = key {
            let trimmed = EngineText.strip(k)
            if trimmed.isEmpty {
                VoiceKeychain.delete(localAccount)
            } else if !VoiceKeychain.set(localAccount, trimmed) {
                throw EngineError(503, noKeyStore)
            }
        }
        let stored: [String: String] = ["base": clean, "model": EngineText.strip(model), "voice": EngineText.strip(voice)]
        UserDefaults.standard.set(stored, forKey: settingsKey)
        return localSettings()
    }

    // MARK: replies

    private static func replyText(_ data: Data) -> String {
        let said = EngineText.strip(String(decoding: data.prefix(150), as: UTF8.self))
        return EngineText.prefix(said, 150)
    }

    private static func sniff(_ d: Data) -> String? {
        let b = [UInt8](d.prefix(12))
        func at(_ i: Int, _ s: String) -> Bool {
            let want = [UInt8](s.utf8)
            return b.count >= i + want.count && Array(b[i..<(i + want.count)]) == want
        }
        if at(0, "RIFF") && at(8, "WAVE") { return "audio/wav" }
        if at(0, "ID3") || (b.count > 1 && b[0] == 0xFF && (b[1] & 0xE0) == 0xE0) { return "audio/mpeg" }
        if at(0, "OggS") { return "audio/ogg" }
        if at(0, "fLaC") { return "audio/flac" }
        return nil
    }

    private static func mimeOf(_ contentType: String, _ data: Data) throws -> String {
        let declared = EngineText.strip(contentType.split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false).first.map { String($0) } ?? "").lowercased()
        if let m = mimes[declared] { return m }
        if generic.contains(declared), let found = sniff(data) { return found }
        throw EngineError(502, "The voice app answered with something that is not a sound.")
    }

    private static func isOK(_ status: Int) -> Bool {
        return status >= 200 && status < 300
    }

    // MARK: the voice app

    private static func localGet(_ base: String, _ path: String, _ key: String?) async -> Any? {
        guard let url = URL(string: base + path) else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = probeTimeout
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let k = key { req.setValue("Bearer " + k, forHTTPHeaderField: "Authorization") }
        guard let reply = try? await VoiceHTTP.fetch(VoiceHTTP.local, req), isOK(reply.status), reply.data.count <= maxBytes else {
            return nil
        }
        guard let value = EngineJSON.any(reply.data), !(value is NSNull) else { return nil }
        return value
    }

    private static func truthy(_ v: Any?) -> Bool {
        guard let v = v, !(v is NSNull) else { return false }
        if let s = v as? String { return !s.isEmpty }
        if let n = v as? NSNumber { return n.doubleValue != 0 }
        if let a = v as? [Any] { return !a.isEmpty }
        if let o = v as? [String: Any] { return !o.isEmpty }
        return true
    }

    private static func text(_ v: Any) -> String {
        if let s = v as? String { return s }
        return "\(v)"
    }

    static func probeLocal(_ base: String) async throws -> [String: Any] {
        let clean = try normalizeBase(base)
        let key = VoiceKeychain.get(localAccount)
        let listed = await localGet(clean, "/v1/models", key)
        let voiced = await localGet(clean, "/v1/audio/voices", key)
        if listed == nil && voiced == nil {
            guard let url = URL(string: clean + "/") else { throw EngineError(422, addressSorry) }
            var req = URLRequest(url: url)
            req.timeoutInterval = probeTimeout
            do {
                _ = try await VoiceHTTP.fetch(VoiceHTTP.local, req)
            } catch {
                let r: [String: Any] = ["ok": false, "models": [String](), "voices": [[String: Any]](),
                                        "error": "No voice app answered at that address. Check that it is running and that the address is right."]
                return r
            }
        }
        var models: [String] = []
        let items: Any? = (listed as? [String: Any])?["data"] ?? listed
        for item in (items as? [Any]) ?? [] {
            let name: Any? = (item as? [String: Any])?["id"] ?? item
            if let n = name as? String, !n.isEmpty { models.append(n) }
        }
        var voices: [[String: Any]] = []
        let raw: Any? = (voiced as? [String: Any])?["voices"] ?? voiced
        for item in (raw as? [Any]) ?? [] {
            var vid: Any? = nil
            var name: Any? = nil
            if let s = item as? String {
                vid = s
                name = s
            } else if let o = item as? [String: Any] {
                for k in ["id", "voice_id", "name"] where vid == nil && truthy(o[k]) { vid = o[k] }
                name = truthy(o["name"]) ? o["name"] : vid
            } else {
                continue
            }
            if let v = vid as? String, !v.isEmpty {
                voices.append(["id": v, "name": text(name ?? v)])
            }
        }
        let r: [String: Any] = ["ok": true, "models": models, "voices": voices, "error": ""]
        return r
    }

    static func speakLocal(text: String, voice: String, model: String, speed: Double) async throws -> Spoken {
        let stored = storedLocal()
        if EngineText.strip(stored.base).isEmpty {
            throw EngineError(422, "There is no voice app address yet. Add the address of the speech server in the AI Voice card.")
        }
        let base = try normalizeBase(stored.base)
        let useModel = EngineText.strip(model).isEmpty ? stored.model : EngineText.strip(model)
        let useVoice = EngineText.strip(voice).isEmpty ? stored.voice : EngineText.strip(voice)
        var body: [String: Any] = ["input": text, "speed": speed, "response_format": "wav"]
        if !useModel.isEmpty { body["model"] = useModel }
        if !useVoice.isEmpty { body["voice"] = useVoice }
        guard let url = URL(string: base + "/v1/audio/speech") else { throw EngineError(422, addressSorry) }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = speechTimeout
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let k = VoiceKeychain.get(localAccount) { req.setValue("Bearer " + k, forHTTPHeaderField: "Authorization") }
        req.httpBody = EngineJSON.encode(body)
        let reply: VoiceReply
        do {
            reply = try await VoiceHTTP.fetch(VoiceHTTP.local, req)
        } catch {
            throw EngineError(502, "The voice app did not answer. Check that it is running and that its address is right.")
        }
        if !isOK(reply.status) {
            let said = replyText(reply.data)
            throw EngineError(502, "The voice app refused the request (error \(reply.status))" + (said.isEmpty ? "." : ": \(said)"))
        }
        if reply.data.count > maxBytes {
            throw EngineError(502, "The voice sent back a sound larger than 200 MB, so it was dropped.")
        }
        if reply.data.isEmpty { throw EngineError(502, "The voice app answered with an empty sound.") }
        return Spoken(audio: reply.data, mime: try mimeOf(reply.contentType, reply.data), voice: useVoice)
    }

    // MARK: online

    static func onlineStatus() -> [String: Any] {
        return ["hasKey": VoiceKeychain.get(onlineAccount) != nil, "canStore": true]
    }

    static func setOnlineKey(_ key: String) throws {
        let clean = EngineText.strip(key)
        if clean.isEmpty { throw EngineError(422, "There is no key to save.") }
        if !VoiceKeychain.set(onlineAccount, clean) { throw EngineError(503, noKeyStore) }
    }

    static func clearOnlineKey() {
        VoiceKeychain.delete(onlineAccount)
    }

    private static func needKey() throws -> String {
        guard let key = VoiceKeychain.get(onlineAccount) else {
            throw EngineError(503, "There is no online voice key yet. Add your key in the AI Voice card's Online tab.")
        }
        return key
    }

    private static func onlineCall(_ req: URLRequest) async throws -> VoiceReply {
        let reply: VoiceReply
        do {
            reply = try await VoiceHTTP.fetch(VoiceHTTP.online, req)
        } catch {
            throw EngineError(502, "The online voice service could not be reached. Check the internet connection.")
        }
        if reply.status == 401 {
            throw EngineError(502, "The online voice service did not accept the key (error 401). Check the key in the Online tab.")
        }
        if !isOK(reply.status) {
            let said = replyText(reply.data)
            throw EngineError(502, "The online voice service refused the request (error \(reply.status))" + (said.isEmpty ? "." : ": \(said)"))
        }
        if reply.data.count > maxBytes {
            throw EngineError(502, "The voice sent back a sound larger than 200 MB, so it was dropped.")
        }
        return reply
    }

    static func onlineVoices() async throws -> [[String: Any]] {
        let key = try needKey()
        guard let url = URL(string: onlineBase + "/v1/voices") else { throw EngineError(502, "The online voice service could not be reached. Check the internet connection.") }
        var req = URLRequest(url: url)
        req.timeoutInterval = onlineTimeout
        req.setValue(key, forHTTPHeaderField: "xi-api-key")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let reply = try await onlineCall(req)
        guard let top = EngineJSON.any(reply.data) as? [String: Any] else {
            throw EngineError(502, "The online voice service answered with something unreadable.")
        }
        var out: [[String: Any]] = []
        for item in (top["voices"] as? [Any]) ?? [] {
            guard let o = item as? [String: Any], truthy(o["voice_id"]), let vidRaw = o["voice_id"] else { continue }
            let vid = text(vidRaw)
            let labels = (o["labels"] as? [String: Any]) ?? [:]
            var group = ""
            if truthy(labels["accent"]), let a = labels["accent"] { group = text(a) }
            else if truthy(o["category"]), let c = o["category"] { group = text(c) }
            let name = truthy(o["name"]) ? text(o["name"] ?? vid) : vid
            out.append(["id": vid, "name": name, "group": group])
        }
        return out
    }

    static func speakOnline(text spoken: String, voice: String, model: String) async throws -> Spoken {
        let key = try needKey()
        if EngineText.length(spoken) > maxOnlineText {
            throw EngineError(422, "The online voice takes at most \(maxOnlineText) characters at a time. Shorten the text.")
        }
        let useVoice = EngineText.strip(voice).isEmpty ? defaultOnlineVoice : EngineText.strip(voice)
        if !EngineText.matches("^[A-Za-z0-9]+$", useVoice) {
            throw EngineError(422, "That voice id is not valid. It may hold only letters and digits.")
        }
        let useModel = EngineText.strip(model).isEmpty ? defaultOnlineModel : EngineText.strip(model)
        let body: [String: Any] = ["text": spoken, "model_id": useModel]
        guard let url = URL(string: "\(onlineBase)/v1/text-to-speech/\(useVoice)") else {
            throw EngineError(422, "That voice id is not valid. It may hold only letters and digits.")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = onlineTimeout
        req.setValue(key, forHTTPHeaderField: "xi-api-key")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = EngineJSON.encode(body)
        let reply = try await onlineCall(req)
        if reply.data.isEmpty { throw EngineError(502, "The online voice service answered with an empty sound.") }
        return Spoken(audio: reply.data, mime: "audio/mpeg", voice: useVoice)
    }
}
