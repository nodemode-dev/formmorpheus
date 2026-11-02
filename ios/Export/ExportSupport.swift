// Shared helpers of the export routes: folders, file names, frame rates, WAV headers.
// Everything here mirrors backend/app/routers/exports.py, jobs.py and core/config.py so the interface cannot tell the two engines apart.
import Foundation

enum ExportLimits {
    static let maxExportBytes = 2 * 1024 * 1024 * 1024
    static let maxJobFrames = 36000
    static let maxJobSide = 8192
    static let maxJobFrameBytes = 256 * 1024 * 1024
    static let maxJobAudioBytes = 1024 * 1024 * 1024
    static let jobMaxAgeSeconds: TimeInterval = 24 * 3600
    static let abandonSeconds: TimeInterval = 600
    static let orphanSeconds: TimeInterval = 1800
    static let sweepEverySeconds: UInt64 = 60
    static let maxKeptRecords = 40
}

enum ExportPaths {
    /// The storage root of the whole engine (visible in the Files app).
    static var documents: URL {
        return EngineConfig.dataDir
    }

    static func ensure(_ url: URL) -> URL {
        _ = try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: nil)
        return url
    }

    /// Documents/Exports, the same folder name the desktop engine uses.
    static var exportsDir: URL {
        return EngineConfig.exportsDir
    }

    /// Documents/Recently Deleted (the engine's TrashStore keeps its index.json).
    static var trashDir: URL {
        return EngineConfig.trashDir
    }

    /// Temporary job folders live in Caches, not Documents: thousands of PNGs would show in Files and go to the device backup.
    static var jobsDir: URL {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return ensure(caches.appendingPathComponent("Jobs", isDirectory: true))
    }

    /// Port of exports.clean_name: nil where the desktop engine answers 400 "That file name cannot be used."
    static func cleanName(_ name: String) -> String? {
        var scalars = String.UnicodeScalarView()
        let banned = "\\/:*?\"<>|".unicodeScalars
        for s in name.unicodeScalars {
            if s.value < 32 || banned.contains(s) {
                scalars.append(Unicode.Scalar(UInt8(ascii: "-")))
            } else {
                scalars.append(s)
            }
        }
        let replaced = String(scalars)
        var safe = replaced.trimmingCharacters(in: .whitespacesAndNewlines)
        safe = safe.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        let original = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if safe.isEmpty || safe.utf8.count > 200 || safe != original || safe.hasPrefix(".") {
            return nil
        }
        return safe
    }

    /// An export never replaces an earlier one: a taken name becomes "name 2", "name 3" and so on.
    static func freePath(_ url: URL) -> URL {
        let fm = FileManager.default
        if !fm.fileExists(atPath: url.path) { return url }
        let stem = url.deletingPathExtension().lastPathComponent
        let ext = url.pathExtension
        let folder = url.deletingLastPathComponent()
        var n = 2
        while true {
            let name = ext.isEmpty ? "\(stem) \(n)" : "\(stem) \(n).\(ext)"
            let candidate = folder.appendingPathComponent(name)
            if !fm.fileExists(atPath: candidate.path) { return candidate }
            n += 1
        }
    }

    /// Moves a finished file into Exports without ever replacing one that is there. Returns the final URL.
    static func keep(_ tmp: URL, as name: String) throws -> URL {
        let fm = FileManager.default
        var target = freePath(exportsDir.appendingPathComponent(name))
        var attempts = 0
        while true {
            do {
                try fm.moveItem(at: tmp, to: target)
                return target
            } catch {
                attempts += 1
                // a name taken in the meantime: pick the next free one; any other error is real
                if fm.fileExists(atPath: target.path) && attempts < 50 {
                    target = freePath(target)
                } else {
                    throw error
                }
            }
        }
    }

    static let kinds: [String: String] = [
        "mp4": "video", "webm": "video", "mov": "video", "gif": "animation",
        "png": "picture", "jpg": "picture", "jpeg": "picture", "webp": "picture",
        "zip": "frames", "fmo": "movie"
    ]
    static let mimes: [String: String] = [
        "mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime", "gif": "image/gif",
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
        "zip": "application/zip"
    ]

    static func entry(_ url: URL) -> [String: Any] {
        let attrs = (try? FileManager.default.attributesOfItem(atPath: url.path)) ?? [:]
        let size = (attrs[.size] as? NSNumber)?.intValue ?? 0
        let modified = (attrs[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
        let ext = url.pathExtension.lowercased()
        let kind = kinds[ext] ?? (ext.isEmpty ? "file" : ext)
        return ["name": url.lastPathComponent, "path": url.path, "size": size, "modified": modified, "kind": kind]
    }
}

/// An exact frame rate. 23.976 is 24000/1001, 29.97 is 30000/1001, 59.94 is 60000/1001 (backend rate_text).
struct Rational {
    let num: Int
    let den: Int

    static func fromFps(_ fps: Double) -> Rational {
        let whole = fps.rounded()
        if abs(fps - whole) < 1e-9 {
            return Rational(num: max(1, Int(whole)), den: 1)
        }
        let ntsc = (fps * 1001.0 / 1000.0).rounded()
        if ntsc > 0 && abs(fps - ntsc * 1000.0 / 1001.0) < 0.01 {
            return Rational(num: Int(ntsc) * 1000, den: 1001)
        }
        return limitDenominator(fps, maxDenominator: 1000)
    }

    /// Continued fractions, as Fraction.limit_denominator does.
    static func limitDenominator(_ value: Double, maxDenominator: Int) -> Rational {
        var p0 = 0, q0 = 1, p1 = 1, q1 = 0
        var x = value
        while true {
            let a = Int(x.rounded(.down))
            let q2 = q0 + a * q1
            if q2 > maxDenominator { break }
            let p2 = p0 + a * p1
            p0 = p1; q0 = q1; p1 = p2; q1 = q2
            let frac = x - Double(a)
            if frac < 1e-12 {
                return Rational(num: max(1, p1), den: max(1, q1))
            }
            x = 1.0 / frac
        }
        if q1 == 0 { return Rational(num: max(1, Int(value.rounded())), den: 1) }
        let k = (maxDenominator - q0) / q1
        let boundNum1 = Double(p0 + k * p1), boundDen1 = Double(q0 + k * q1)
        let boundNum2 = Double(p1), boundDen2 = Double(q1)
        let err1 = abs(boundNum1 / boundDen1 - value)
        let err2 = abs(boundNum2 / boundDen2 - value)
        if err2 <= err1 { return Rational(num: max(1, p1), den: max(1, q1)) }
        return Rational(num: max(1, p0 + k * p1), den: max(1, q0 + k * q1))
    }

    var framesPerSecond: Double { return Double(num) / Double(den) }

    /// A media timescale of at least 600, a whole multiple of the numerator, so every frame time is exact.
    var multiplier: Int { return num >= 600 ? 1 : (600 + num - 1) / num }
    var timescale: Int32 { return Int32(num * multiplier) }
    /// CMTime value of one frame at `timescale`.
    var frameValue: Int64 { return Int64(den * multiplier) }
}

/// What an uploaded WAV file holds (the interface sends 16 bit PCM, 48000 Hz).
struct WavInfo {
    var channels: Int
    var sampleRate: Int
    var bitsPerSample: Int
    var dataBytes: Int

    var seconds: Double {
        let frameBytes = max(1, channels * max(8, bitsPerSample) / 8)
        return Double(dataBytes / frameBytes) / Double(max(1, sampleRate))
    }

    static func hasRiffHeader(_ data: Data) -> Bool {
        if data.count < 12 { return false }
        let riff = [UInt8](data.prefix(4))
        let wave = [UInt8](data.subdata(in: data.startIndex + 8 ..< data.startIndex + 12))
        return riff == [0x52, 0x49, 0x46, 0x46] && wave == [0x57, 0x41, 0x56, 0x45]
    }

    static func parse(url: URL) -> WavInfo? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        guard let head = try? handle.read(upToCount: 65536), head.count >= 12 else { return nil }
        let fileSize = ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.intValue ?? head.count
        let bytes = [UInt8](head)
        func le32(_ o: Int) -> Int {
            return Int(bytes[o]) | (Int(bytes[o + 1]) << 8) | (Int(bytes[o + 2]) << 16) | (Int(bytes[o + 3]) << 24)
        }
        func le16(_ o: Int) -> Int {
            return Int(bytes[o]) | (Int(bytes[o + 1]) << 8)
        }
        func tag(_ o: Int) -> String {
            return String(decoding: bytes[o ..< o + 4], as: UTF8.self)
        }
        guard tag(0) == "RIFF", tag(8) == "WAVE" else { return nil }
        var at = 12
        var channels = 0, rate = 0, bits = 0
        while at + 8 <= bytes.count {
            let id = tag(at)
            let size = le32(at + 4)
            let body = at + 8
            if id == "fmt " && body + 16 <= bytes.count {
                channels = le16(body + 2)
                rate = le32(body + 4)
                bits = le16(body + 14)
            } else if id == "data" {
                var length = size
                // an unfinished or oversized chunk size: take what the file holds
                if length == 0 || length > fileSize - body { length = max(0, fileSize - body) }
                if channels > 0 && rate > 0 && bits > 0 {
                    return WavInfo(channels: channels, sampleRate: rate, bitsPerSample: bits, dataBytes: length)
                }
                return nil
            }
            at = body + size + (size & 1)
        }
        return nil
    }
}

/// Reads a JSON number that FastAPI would have coerced.
func exportNumber(_ value: Any?) -> Double? {
    if let n = value as? NSNumber {
        if CFGetTypeID(n) == CFBooleanGetTypeID() { return nil }
        return n.doubleValue
    }
    if let s = value as? String { return Double(s) }
    return nil
}

func exportInt(_ value: Any?) -> Int? {
    guard let d = exportNumber(value), d.isFinite, abs(d) < 1e15 else { return nil }
    return Int(d.rounded(.towardZero))
}
