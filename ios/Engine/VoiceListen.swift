// VoiceListen.swift
// Listening on iPad: the words of a sound with their times, heard by the iPad's own speech recognition (Speech
// framework, on the device only, never the network). Answers in the shape of backend/app/services/voice_transcribe.py:
// {language, seconds, cues}, the word times grouped into short phrases by the same rules as the desktop's worker.

import Foundation
import Speech

struct VoiceWord {
    var text: String
    var start: Double
    var end: Double
}

struct VoiceListenLook {
    let authorization: String
    let authorized: Bool
    let locale: String
    let onDevice: Bool
    let available: Bool
    let reason: String
}

enum VoiceListenOutcome {
    case heard([VoiceWord])
    case nothing
    case failed(String)
    case timedOut
}

/// One recognition of one file. The delegate hears each final utterance; the task's end resumes the caller once.
final class VoiceListenTask: NSObject, SFSpeechRecognitionTaskDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var words: [VoiceWord] = []
    private var lastEnd = -1.0
    private var cont: CheckedContinuation<VoiceListenOutcome, Never>? = nil
    private var done = false
    private var recognizer: SFSpeechRecognizer? = nil
    private var task: SFSpeechRecognitionTask? = nil

    func run(file: URL, locale: String, timeout: Double) async -> VoiceListenOutcome {
        return await withCheckedContinuation { (c: CheckedContinuation<VoiceListenOutcome, Never>) in
            lock.withLock { cont = c }
            DispatchQueue.main.async {
                guard let r = SFSpeechRecognizer(locale: Locale(identifier: locale)) else {
                    self.finish(.failed(VoiceListen.noLanguage))
                    return
                }
                let request = SFSpeechURLRecognitionRequest(url: file)
                request.requiresOnDeviceRecognition = true
                request.shouldReportPartialResults = false
                request.addsPunctuation = true
                self.recognizer = r
                self.task = r.recognitionTask(with: request, delegate: self)
            }
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout) {
                if self.finish(.timedOut) {
                    DispatchQueue.main.async { self.task?.cancel() }
                }
            }
        }
    }

    @discardableResult
    private func finish(_ outcome: VoiceListenOutcome) -> Bool {
        let c: CheckedContinuation<VoiceListenOutcome, Never>? = lock.withLock {
            if done { return nil }
            done = true
            let pending = cont
            cont = nil
            return pending
        }
        guard let resume = c else { return false }
        resume.resume(returning: outcome)
        return true
    }

    func speechRecognitionTask(_ task: SFSpeechRecognitionTask, didFinishRecognition recognitionResult: SFSpeechRecognitionResult) {
        let segments = recognitionResult.bestTranscription.segments
        lock.withLock {
            for s in segments {
                let text = EngineText.strip(s.substring)
                let start = Double(s.timestamp)
                if text.isEmpty || start < lastEnd - 0.001 { continue }
                let end = start + max(0, Double(s.duration))
                words.append(VoiceWord(text: text, start: start, end: end))
                lastEnd = max(lastEnd, end)
            }
        }
    }

    func speechRecognitionTask(_ task: SFSpeechRecognitionTask, didFinishSuccessfully successfully: Bool) {
        let heard = lock.withLock { words }
        if successfully {
            finish(heard.isEmpty ? .nothing : .heard(heard))
            return
        }
        if !heard.isEmpty {
            finish(.heard(heard))
            return
        }
        let error = task.error.map { $0 as NSError }
        if let e = error, e.code == 1110 {
            finish(.nothing)
            return
        }
        let said = error?.localizedDescription ?? ""
        finish(.failed(EngineText.strip("Listening to this sound failed. \(said)")))
    }

    func speechRecognitionTaskWasCancelled(_ task: SFSpeechRecognitionTask) {
        finish(.failed("Listening to this sound was stopped."))
    }
}

enum VoiceListen {
    static let rate = 16000
    static let maxBytes = 256 * 1024 * 1024
    static let name = "iPad speech recognition"
    static let noLanguage = "This iPad cannot listen in that language on the device. Choose another language."

    private static let lock = NSLock()
    private static var busy = false
    private static var job: [String: Any]? = nil

    // MARK: permission and languages

    static func authorizationName(_ s: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch s {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "denied"
        }
    }

    static let askSentence = "Listening uses this iPad's own speech recognition. Allow it when the iPad asks."
    static let deniedSentence = "Speech recognition is turned off for FormMorpheus. Turn it on in Settings, under Privacy & Security, Speech Recognition."
    static let restrictedSentence = "Speech recognition is not allowed on this iPad."

    private static func dashed(_ id: String) -> String {
        let plain = id.split(separator: "@", maxSplits: 1, omittingEmptySubsequences: false).first.map { String($0) } ?? id
        return plain.replacingOccurrences(of: "_", with: "-")
    }

    private static func languagePart(_ id: String) -> String {
        return dashed(id).lowercased().split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false).first.map { String($0) } ?? ""
    }

    /// The identifier of the recognizer's locale for a code: an exact match ("en-gb"), else the code's language in a
    /// region the person prefers, else the first supported region of that language. "" or "auto" is the iPad's own language.
    static func localeFor(_ asked: String) -> String? {
        let ids = SFSpeechRecognizer.supportedLocales().map { dashed($0.identifier) }.sorted()
        let lowered = ids.map { $0.lowercased() }
        let want = dashed(EngineText.strip(asked)).lowercased()
        if want.isEmpty || want == "auto" {
            for pref in Locale.preferredLanguages {
                let code = languagePart(pref)
                if code.isEmpty || code == "auto" { continue }
                if let found = localeFor(code) { return found }
            }
            return nil
        }
        if let i = lowered.firstIndex(of: want) { return ids[i] }
        let code = languagePart(want)
        if code.isEmpty { return nil }
        var tries: [String] = Locale.preferredLanguages.map { dashed($0).lowercased() }
        tries.append(dashed(Locale.current.identifier).lowercased())
        if let region = Locale.current.region?.identifier { tries.append(code + "-" + region.lowercased()) }
        for t in tries where languagePart(t) == code {
            if let i = lowered.firstIndex(of: t) { return ids[i] }
            let parts = t.split(separator: "-").map { String($0) }
            if let last = parts.last, parts.count > 1, let i = lowered.firstIndex(of: code + "-" + last) { return ids[i] }
        }
        if let i = lowered.firstIndex(where: { $0 == code || $0.hasPrefix(code + "-") }) { return ids[i] }
        return nil
    }

    static func look(_ asked: String) -> VoiceListenLook {
        let auth = SFSpeechRecognizer.authorizationStatus()
        let authName = authorizationName(auth)
        let authorized = auth == .authorized
        guard let id = localeFor(asked), let r = SFSpeechRecognizer(locale: Locale(identifier: id)) else {
            let reason = authorized ? noLanguage : sentence(authName)
            return VoiceListenLook(authorization: authName, authorized: authorized, locale: "", onDevice: false, available: false, reason: reason)
        }
        let onDevice = r.supportsOnDeviceRecognition
        var reason = ""
        if !authorized { reason = sentence(authName) } else if !onDevice { reason = noLanguage }
        return VoiceListenLook(authorization: authName, authorized: authorized, locale: id, onDevice: onDevice, available: r.isAvailable, reason: reason)
    }

    private static func sentence(_ auth: String) -> String {
        switch auth {
        case "denied": return deniedSentence
        case "restricted": return restrictedSentence
        case "authorized": return ""
        default: return askSentence
        }
    }

    static func status(_ asked: String) -> [String: Any] {
        let l = look(asked)
        let r: [String: Any] = [
            "ready": l.authorized && l.onDevice,
            "runtime": l.authorized,
            "model": l.onDevice,
            "name": name,
            "bytes": 0,
            "job": currentJob(),
            "platform": "ipad",
            "authorization": l.authorization,
            "language": l.locale,
            "available": l.available,
            "reason": l.reason,
        ]
        return r
    }

    static func currentJob() -> Any {
        let j: [String: Any]? = lock.withLock { job }
        if let found = j { return found }
        return NSNull()
    }

    private static func setJob(_ state: String, _ error: String) -> [String: Any] {
        let j: [String: Any] = ["state": state, "step": "model", "done": 0, "total": 0, "error": error]
        lock.withLock { job = j }
        return j
    }

    /// Asks the iPad for the permission; the page polls the job, as it does the desktop's model download.
    static func startSetup() throws -> [String: Any] {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            return setJob("done", "")
        case .denied:
            throw EngineError(409, deniedSentence)
        case .restricted:
            throw EngineError(409, restrictedSentence)
        default:
            break
        }
        let previous: [String: Any]? = lock.withLock { job }
        if let running = previous, (running["state"] as? String) == "running" {
            throw EngineError(409, "FormMorpheus is already asking for permission to use speech recognition.")
        }
        let j = setJob("running", "")
        DispatchQueue.main.async {
            SFSpeechRecognizer.requestAuthorization { answer in
                switch answer {
                case .authorized: _ = VoiceListen.setJob("done", "")
                case .restricted: _ = VoiceListen.setJob("failed", VoiceListen.restrictedSentence)
                default: _ = VoiceListen.setJob("failed", VoiceListen.deniedSentence)
                }
            }
        }
        return j
    }

    // MARK: the sound

    private static func ascii(_ d: Data, _ o: Int, _ n: Int) -> String {
        if o + n > d.count { return "" }
        let s = d.startIndex + o
        return String(decoding: d[s..<(s + n)], as: UTF8.self)
    }

    private static func u16(_ d: Data, _ o: Int) -> Int {
        let i = d.startIndex + o
        return Int(d[i]) | (Int(d[i + 1]) << 8)
    }

    private static func u32(_ d: Data, _ o: Int) -> Int {
        return u16(d, o) | (u16(d, o + 2) << 16)
    }

    /// Frames and where they start, for a 16 kHz mono 16-bit PCM WAV; nil for anything else.
    static func wav(_ d: Data) -> (frames: Int, offset: Int)? {
        guard ascii(d, 0, 4) == "RIFF", ascii(d, 8, 4) == "WAVE" else { return nil }
        var at = 12
        var format = false
        while at + 8 <= d.count {
            let id = ascii(d, at, 4)
            let size = u32(d, at + 4)
            let body = at + 8
            if id == "fmt " {
                guard size >= 16, body + 16 <= d.count else { return nil }
                format = u16(d, body) == 1 && u16(d, body + 2) == 1 && u32(d, body + 4) == rate && u16(d, body + 14) == 16
                if !format { return nil }
            } else if id == "data" {
                guard format else { return nil }
                return (max(0, min(size, d.count - body)) / 2, body)
            }
            at = body + size + (size & 1)
        }
        return nil
    }

    static func level(_ d: Data, _ offset: Int, _ frames: Int) -> Double {
        if frames <= 0 { return 0 }
        var sum = 0.0
        d.withUnsafeBytes { (p: UnsafeRawBufferPointer) in
            var i = offset
            let end = offset + frames * 2
            while i + 1 < end {
                let v = Int16(bitPattern: UInt16(p[i]) | (UInt16(p[i + 1]) << 8))
                let x = Double(v) / 32768.0
                sum += x * x
                i += 2
            }
        }
        return (sum / Double(frames)).squareRoot()
    }

    // MARK: phrases (the desktop worker's rules)

    static let maxWords = 7
    static let maxChars = 42
    static let maxPhrase = 3.5
    static let maxGap = 0.7
    private static let ends: Set<Character> = [".", "!", "?", "\u{3002}", "\u{FF01}", "\u{FF1F}"]
    private static let unspaced: Set<String> = ["zh", "ja", "yue", "th"]

    private static func splitLong(_ words: [VoiceWord]) -> [VoiceWord] {
        var out: [VoiceWord] = []
        for w in words {
            let chars = Array(w.text)
            if chars.count <= maxChars {
                out.append(w)
                continue
            }
            let n = (chars.count + maxChars - 1) / maxChars
            let span = (w.end - w.start) / Double(n)
            for k in 0..<n {
                let piece = String(chars[(k * maxChars)..<min(chars.count, (k + 1) * maxChars)])
                out.append(VoiceWord(text: piece, start: w.start + Double(k) * span, end: w.start + Double(k + 1) * span))
            }
        }
        return out
    }

    private static func fits(_ g: [VoiceWord], _ sep: String) -> Bool {
        guard let first = g.first, let last = g.last else { return true }
        let text = g.map { $0.text }.joined(separator: sep)
        return g.count <= maxWords && text.count <= maxChars && (g.count == 1 || last.end - first.start <= maxPhrase)
    }

    private static func balance(_ run: [VoiceWord], _ sep: String) -> [[VoiceWord]] {
        let lengths = run.map { Double($0.text.count + 1) }
        let total = lengths.reduce(0, +)
        if run.isEmpty || total <= 0 { return run.map { [$0] } }
        for n in 1...run.count {
            var groups = [[VoiceWord]](repeating: [], count: n)
            var at = 0.0
            for (word, length) in zip(run, lengths) {
                let index = min(n - 1, Int((at + length / 2) / total * Double(n)))
                groups[index].append(word)
                at += length
            }
            let kept = groups.filter { !$0.isEmpty }
            if kept.allSatisfy({ fits($0, sep) }) { return kept }
        }
        return run.map { [$0] }
    }

    private static func round3(_ x: Double) -> Double {
        return (x * 1000).rounded() / 1000
    }

    static func phrases(_ heard: [VoiceWord], language: String) -> [[String: Any]] {
        let sep = unspaced.contains(language) ? "" : " "
        var runs: [[VoiceWord]] = []
        var run: [VoiceWord] = []
        for raw in splitLong(heard) {
            let word = VoiceWord(text: raw.text, start: raw.start, end: max(raw.end, raw.start + 0.05))
            let ended = run.last?.text.last.map({ ends.contains($0) }) ?? false
            if let prev = run.last, word.start - prev.end > maxGap || ended {
                runs.append(run)
                run = []
            }
            run.append(word)
        }
        if !run.isEmpty { runs.append(run) }
        var out: [[String: Any]] = []
        for r in runs {
            for g in balance(r, sep) {
                guard let first = g.first else { continue }
                let end = g.map { $0.end }.max() ?? first.end
                out.append(["start": round3(first.start), "end": round3(end), "text": g.map { $0.text }.joined(separator: sep)])
            }
        }
        return out
    }

    /// The service's _clean: in order, inside the sound, never overlapping.
    static func clean(_ cues: [[String: Any]], _ seconds: Double) -> [[String: Any]] {
        var kept: [(start: Double, end: Double, text: String)] = []
        for cue in cues {
            guard let s = cue["start"] as? Double, let e = cue["end"] as? Double, let t = cue["text"] as? String else { continue }
            let start = max(0, min(s, seconds))
            let end = max(0, min(e, seconds))
            let text = t.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            if !text.isEmpty && end > start { kept.append((start: start, end: end, text: text)) }
        }
        kept.sort { $0.start != $1.start ? $0.start < $1.start : $0.end < $1.end }
        var out: [[String: Any]] = []
        var lastEnd: Double? = nil
        for index in 0..<kept.count {
            var cue = kept[index]
            if let le = lastEnd, cue.start < le { cue.start = le }
            if index + 1 < kept.count { cue.end = min(cue.end, max(cue.start, kept[index + 1].start)) }
            if cue.end - cue.start < 0.01 { continue }
            out.append(["start": round3(cue.start), "end": round3(cue.end), "text": cue.text])
            lastEnd = cue.end
        }
        return out
    }

    /// Words with no times of their own share the sound by their length, as the desktop's spread does.
    private static func spread(_ heard: [VoiceWord], _ seconds: Double) -> [VoiceWord] {
        let weights = heard.map { Double($0.text.count + 1) }
        let total = weights.reduce(0, +)
        if total <= 0 || seconds <= 0 { return heard }
        var at = 0.0
        var out: [VoiceWord] = []
        for (w, weight) in zip(heard, weights) {
            let span = seconds * weight / total
            out.append(VoiceWord(text: w.text, start: at, end: at + span))
            at += span
        }
        return out
    }

    // MARK: listening

    static func transcribe(_ body: Data, language: String) async throws -> [String: Any] {
        if body.count > maxBytes {
            throw EngineError(413, "That sound is too long to listen to in one go. Split the block and try each part.")
        }
        if body.count < 44 { throw EngineError(422, "There is no sound to listen to.") }
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: break
        case .denied: throw EngineError(409, deniedSentence)
        case .restricted: throw EngineError(409, restrictedSentence)
        default: throw EngineError(409, "Allow FormMorpheus to use speech recognition first.")
        }
        let asked = EngineText.strip(language).lowercased()
        let askedCode = (asked.isEmpty || asked == "auto") ? "" : languagePart(asked)
        guard let locale = localeFor(asked) else {
            if askedCode.isEmpty { throw EngineError(409, noLanguage) }
            let shown = EngineText.prefix(EngineText.replaceBad(asked, with: ""), 12)
            throw EngineError(422, "This iPad cannot listen in the language \(shown). Choose another language.")
        }
        if let r = SFSpeechRecognizer(locale: Locale(identifier: locale)), !r.supportsOnDeviceRecognition {
            throw EngineError(409, noLanguage)
        }
        guard let sound = wav(body) else { throw EngineError(422, "The sound must be a 16 kHz mono 16-bit WAV.") }
        let seconds = Double(sound.frames) / Double(rate)
        if seconds < 0.1 || level(body, sound.offset, sound.frames) < 1e-3 {
            let r: [String: Any] = ["language": askedCode, "seconds": round3(seconds), "cues": [[String: Any]]()]
            return r
        }
        let taken: Bool = lock.withLock {
            if busy { return false }
            busy = true
            return true
        }
        if !taken { throw EngineError(409, "Another sound is being listened to. Wait for it to finish, then try again.") }
        defer { lock.withLock { busy = false } }

        let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Voice", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent(".listen-\(EngineText.hex(12)).wav")
        do {
            try EngineFS.writeFile(body, to: file)
        } catch {
            EngineFS.remove(file)
            throw EngineError(500, "The sound could not be stored for listening.")
        }
        defer { EngineFS.remove(file) }

        let token = await TranscodeBackground.begin()
        let outcome = await VoiceListenTask().run(file: file, locale: locale, timeout: min(7200, max(300, 10 * seconds)))
        await TranscodeBackground.end(token)

        let code = languagePart(locale)
        var heard: [VoiceWord] = []
        switch outcome {
        case .heard(let words): heard = words
        case .nothing: heard = []
        case .timedOut: throw EngineError(502, "Listening to this sound took too long. Try a shorter part.")
        case .failed(let said): throw EngineError(502, said)
        }
        let latest = heard.map({ $0.end }).max() ?? 0
        if !heard.isEmpty && latest <= 0 { heard = spread(heard, seconds) }
        let cues = clean(phrases(heard, language: code), seconds)
        let r: [String: Any] = ["language": cues.isEmpty ? askedCode : code, "seconds": round3(seconds), "cues": cues]
        return r
    }
}
