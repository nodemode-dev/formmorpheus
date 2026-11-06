// What this iPad's encoders can do, found by encoding two tiny frames with each codec (nothing is assumed from the model name).
// The engine builder merges `ExportCapabilities.dictionary()` into /api/capabilities; /api/jobs/capabilities is served by JobsRoutes.
import Foundation
import AVFoundation
import CoreVideo

final class ExportCapabilities: @unchecked Sendable {
    static let shared = ExportCapabilities()

    static let proresNames = ["proxy", "lt", "422", "hq", "4444", "4444xq"]

    static func proresCodec(_ name: String) -> AVVideoCodecType? {
        switch name {
        case "proxy": return AVVideoCodecType.proRes422Proxy
        case "lt": return AVVideoCodecType.proRes422LT
        case "422": return AVVideoCodecType.proRes422
        case "hq": return AVVideoCodecType.proRes422HQ
        case "4444": return AVVideoCodecType.proRes4444
        case "4444xq": return AVVideoCodecType.appleProRes4444XQ
        default: return nil
        }
    }

    private let lock = NSLock()
    private var task: Task<Void, Never>?
    private var finished = false
    // Optimistic until the probe has run: every supported iPad has the H.264 and HEVC hardware encoders.
    private var h264 = true
    private var hevc = true
    private var hevcAlpha = false
    private var prores: [String: Bool] = [:]

    var probed: Bool {
        lock.lock()
        defer { lock.unlock() }
        return finished
    }

    /// Starts the probe once; later calls return the same task.
    @discardableResult
    func start() -> Task<Void, Never> {
        lock.lock()
        defer { lock.unlock() }
        if let t = task { return t }
        let t = Task.detached(priority: .utility) {
            await ExportCapabilities.shared.runProbe()
        }
        task = t
        return t
    }

    /// Waits for the probe.
    func ready() async {
        let t = start()
        await t.value
    }

    func profileAvailable(_ name: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return prores[name] ?? false
    }

    var h264Available: Bool {
        lock.lock()
        defer { lock.unlock() }
        return h264
    }

    var hevcAvailable: Bool {
        lock.lock()
        defer { lock.unlock() }
        return hevc
    }

    var hevcAlphaAvailable: Bool {
        lock.lock()
        defer { lock.unlock() }
        return hevcAlpha
    }

    private func runProbe() async {
        let okH264 = await ExportCapabilities.tryEncode(codec: .h264, fileType: .mp4, alpha: false, prores: false)
        let okHevc = await ExportCapabilities.tryEncode(codec: .hevc, fileType: .mp4, alpha: false, prores: false)
        let okAlpha = await ExportCapabilities.tryEncode(codec: .hevcWithAlpha, fileType: .mov, alpha: true, prores: false)
        var pro: [String: Bool] = [:]
        for name in ExportCapabilities.proresNames {
            guard let codec = ExportCapabilities.proresCodec(name) else { continue }
            let alpha = name == "4444" || name == "4444xq"
            pro[name] = await ExportCapabilities.tryEncode(codec: codec, fileType: .mov, alpha: alpha, prores: true)
        }
        lock.lock()
        h264 = okH264
        hevc = okHevc
        hevcAlpha = okAlpha
        prores = pro
        finished = true
        lock.unlock()
    }

    /// Encodes two small frames to a temporary file; true when the file came out whole.
    static func tryEncode(codec: AVVideoCodecType, fileType: AVFileType, alpha: Bool, prores: Bool) async -> Bool {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("fm-probe-\(UUID().uuidString).\(fileType == .mov ? "mov" : "mp4")")
        defer { _ = try? FileManager.default.removeItem(at: tmp) }
        let plan = VideoPlan(codec: codec, fileType: fileType, width: 256, height: 144, rate: Rational(num: 30, den: 1), frames: 2,
                             bitsPerSecond: prores ? 0 : 1_000_000, alpha: alpha, isProRes: prores, optimizeForNetwork: false, audio: nil)
        let encoder = VideoEncoder(plan: plan, output: tmp, fill: { _, buffer in
            CVPixelBufferLockBaseAddress(buffer, CVPixelBufferLockFlags(rawValue: 0))
            defer { CVPixelBufferUnlockBaseAddress(buffer, CVPixelBufferLockFlags(rawValue: 0)) }
            if let base = CVPixelBufferGetBaseAddress(buffer) {
                memset(base, 0x60, CVPixelBufferGetBytesPerRow(buffer) * CVPixelBufferGetHeight(buffer))
            }
        }, progress: { _ in }, isCancelled: { false })
        do {
            try await encoder.run()
            let size = ((try? FileManager.default.attributesOfItem(atPath: tmp.path))?[.size] as? NSNumber)?.intValue ?? 0
            return size > 0
        } catch {
            return false
        }
    }

    // MARK: JSON

    private func target(_ available: Bool, encoder: String, reason: String) -> [String: Any] {
        return ["available": available, "encoder": available ? encoder : "", "reason": available ? "" : reason]
    }

    /// The body of GET /api/jobs/capabilities. The field `ffmpeg` stays true so the interface's existing check passes:
    /// the engine here is AVFoundation, named in `engine`.
    func jobsBody() -> [String: Any] {
        let hevcOk = hevcAvailable
        let alphaOk = hevcAlphaAvailable
        let lowFamily = ["proxy", "lt", "422", "hq"].contains { profileAvailable($0) }
        let highFamily = profileAvailable("4444") || profileAvailable("4444xq")
        let proReason = "This iPad has no ProRes encoder. ProRes needs an iPad with an M-series chip."
        var profiles: [String: Bool] = [:]
        for name in ExportCapabilities.proresNames { profiles[name] = profileAvailable(name) }

        var hevcInfo = target(hevcOk, encoder: "hevc_avfoundation", reason: "This iPad has no HEVC encoder.")
        hevcInfo["encoders"] = hevcOk ? ["hevc_avfoundation"] : [String]()
        hevcInfo["alpha"] = alphaOk
        hevcInfo["alpha_reason"] = alphaOk ? "" : "This iPad cannot encode HEVC with transparency. Use ProRes 4444 or VP9 for transparent video."

        var prores = target(lowFamily, encoder: "prores_avfoundation", reason: proReason)
        prores["profiles"] = profiles
        var prores4444 = target(highFamily, encoder: "prores_avfoundation", reason: proReason)
        prores4444["profiles"] = profiles

        return [
            "ffmpeg": true,
            "engine": "avfoundation",
            "path": "AVFoundation",
            "version": ProcessInfo.processInfo.operatingSystemVersionString,
            "gpl": false,
            "aac": true,
            "mp3": false,
            "opus": false,
            "targets": [
                "h264": target(h264Available, encoder: "h264_avfoundation", reason: "This iPad has no H.264 encoder."),
                "prores": prores,
                "prores4444": prores4444,
                "hevc": hevcInfo
            ] as [String: Any]
        ]
    }

    /// For SystemRoutes: merge into the /api/capabilities body. Safe to call at any time; starts the probe.
    static func dictionary() -> [String: Any] {
        shared.start()
        var body = shared.jobsBody()
        body["ffmpeg"] = false
        return [
            "ffmpeg": false,
            "avfoundation": true,
            "export": body
        ]
    }
}
