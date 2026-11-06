// /api/jobs: the engine's export jobs with AVFoundation in place of ffmpeg.
// Same paths, methods and JSON as backend/app/routers/jobs.py. The interface renders every frame to a PNG, uploads them
// (4 at a time) with the sound as a WAV, runs the job, polls it and reads the finished file back from /api/exports.
import Foundation
import AVFoundation
import UIKit

final class JobsRoutes: APIRoutes {
    let prefix = "/jobs"

    static let targets = ["prores", "prores4444", "hevc", "h264"]
    static let crf = ["low", "medium", "high", "very-high"]
    static let pngSignature: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

    init() {
        JobStore.shared.startSweeping()
        ExportCapabilities.shared.start()
        // /api/capabilities (SystemRoutes) merges this: ffmpeg false, the AVFoundation targets listed
        let previous = EngineConfig.capabilityProvider
        EngineConfig.capabilityProvider = {
            var body = previous?() ?? [:]
            for (key, value) in ExportCapabilities.dictionary() { body[key] = value }
            return body
        }
    }

    func handle(_ request: APIRequest) async -> APIResponse? {
        let parts = request.path.split(separator: "/").map { String($0) }
        guard parts.first == "jobs" else { return nil }
        let rest = Array(parts.dropFirst())
        let method = request.method.uppercased()

        if rest.count == 1 && rest[0] == "capabilities" {
            if method != "GET" { return APIResponse.error(405, "Method Not Allowed") }
            await ExportCapabilities.shared.ready()
            return APIResponse.json(ExportCapabilities.shared.jobsBody())
        }
        if rest.count == 1 && rest[0] == "export" {
            if method != "POST" { return APIResponse.error(405, "Method Not Allowed") }
            return await createJob(request)
        }
        if rest.count == 3 && rest[1] == "frames" {
            if method != "PUT" { return APIResponse.error(405, "Method Not Allowed") }
            guard let index = Int(rest[2]) else { return APIResponse.error(422, "The frame index must be a whole number.") }
            return putFrame(id: rest[0], index: index, body: request.body)
        }
        if rest.count == 2 && rest[1] == "audio" {
            if method != "PUT" { return APIResponse.error(405, "Method Not Allowed") }
            return putAudio(id: rest[0], body: request.body)
        }
        if rest.count == 2 && rest[1] == "run" {
            if method != "POST" { return APIResponse.error(405, "Method Not Allowed") }
            return await runJob(id: rest[0])
        }
        if rest.count == 1 {
            if method == "GET" { return getJob(id: rest[0]) }
            if method == "DELETE" { return cancelJob(id: rest[0]) }
            return APIResponse.error(405, "Method Not Allowed")
        }
        return nil
    }

    // MARK: create

    private func createJob(_ request: APIRequest) async -> APIResponse {
        guard let object = (try? JSONSerialization.jsonObject(with: request.body, options: [])) as? [String: Any] else {
            return APIResponse.error(422, "The job description must be a JSON object.")
        }
        guard let target = object["target"] as? String else { return APIResponse.error(422, "target is required.") }
        guard let fps = exportNumber(object["fps"]) else { return APIResponse.error(422, "fps is required.") }
        guard let width = exportInt(object["width"]), let height = exportInt(object["height"]) else {
            return APIResponse.error(422, "width and height are required.")
        }
        guard let frames = exportInt(object["frames"]) else { return APIResponse.error(422, "frames is required.") }
        let hasAudio = (object["has_audio"] as? Bool) ?? false
        let wantAlpha = (object["alpha"] as? Bool) ?? false
        let quality = (object["quality"] as? String) ?? "high"
        let container = (object["container"] as? String) ?? "mp4"
        let rawName = (object["name"] as? String) ?? "movie"
        let audioCodec = (object["audio_codec"] as? String) ?? "aac"
        let profile = (object["profile"] as? String) ?? ""
        let videoKbps = exportInt(object["video_kbps"]) ?? 0
        let targetBytes = exportInt(object["target_bytes"]) ?? 0
        let chapters = (object["chapters"] as? [Any])?.count ?? 0

        if !JobsRoutes.targets.contains(target) { return APIResponse.error(400, "Unknown export target.") }
        if !(fps >= 1 && fps <= 240) { return APIResponse.error(400, "The frame rate must be between 1 and 240.") }
        if !(width >= 2 && width <= ExportLimits.maxJobSide && height >= 2 && height <= ExportLimits.maxJobSide) {
            return APIResponse.error(400, "The size must be between 2 and \(ExportLimits.maxJobSide) pixels a side.")
        }
        if width % 2 != 0 || height % 2 != 0 { return APIResponse.error(400, "The width and height must be even.") }
        if !(frames >= 1 && frames <= ExportLimits.maxJobFrames) {
            return APIResponse.error(400, "A job takes 1 to \(ExportLimits.maxJobFrames) frames.")
        }
        if !JobsRoutes.crf.contains(quality) { return APIResponse.error(400, "Unknown quality.") }
        if container != "mp4" && container != "mov" { return APIResponse.error(400, "The container must be mp4 or mov.") }
        if audioCodec != "aac" && audioCodec != "pcm" { return APIResponse.error(400, "The sound must be aac or pcm.") }
        let isProRes = target == "prores" || target == "prores4444"
        if isProRes && !profile.isEmpty && !ExportCapabilities.proresNames.contains(profile) {
            return APIResponse.error(400, "Unknown ProRes profile.")
        }
        if audioCodec == "pcm" && container == "mp4" && (target == "hevc" || target == "h264") {
            return APIResponse.error(400, "Linear PCM sound needs a .mov file.")
        }

        let caps = ExportCapabilities.shared
        await caps.ready()
        var useProfile = profile
        var note = ""
        if isProRes {
            let wanted = profile.isEmpty ? (target == "prores" ? "hq" : "4444") : profile
            if caps.profileAvailable(wanted) {
                useProfile = wanted
            } else if wanted == "4444xq" && caps.profileAvailable("4444") {
                useProfile = "4444"
                note = "This iPad has no ProRes 4444 XQ encoder, so ProRes 4444 was used."
            } else {
                return APIResponse.error(503, "This iPad has no ProRes encoder for that type. ProRes needs an iPad with an M-series chip.")
            }
        }
        if target == "h264" && !caps.h264Available { return APIResponse.error(503, "This iPad has no H.264 encoder.") }
        if target == "hevc" && !caps.hevcAvailable { return APIResponse.error(503, "This iPad has no HEVC encoder.") }

        guard let cleaned = ExportPaths.cleanName(rawName.isEmpty ? "movie" : rawName) else {
            return APIResponse.error(400, "That file name cannot be used.")
        }
        var base = (cleaned as NSString).deletingPathExtension
        if base.isEmpty { base = "movie" }

        let alpha = wantAlpha && (target == "prores4444" || (target == "prores" && (useProfile == "4444" || useProfile == "4444xq")) || (target == "hevc" && caps.hevcAlphaAvailable))
        // HEVC with an alpha layer is a QuickTime movie
        let finalContainer = (isProRes || (target == "hevc" && alpha)) ? "mov" : container

        let id = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(16))
        let folder = ExportPaths.jobsDir.appendingPathComponent(id, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder.appendingPathComponent("frames", isDirectory: true), withIntermediateDirectories: true, attributes: nil)
        } catch {
            return APIResponse.error(500, "The job folder could not be made.")
        }
        let job = ExportJobRecord(
            id: id, target: target, fps: fps, width: width, height: height, frames: frames, hasAudio: hasAudio, alpha: alpha,
            quality: quality, container: finalContainer, name: base, folder: folder, audioCodec: audioCodec, profile: useProfile,
            videoKbps: max(0, min(videoKbps, 2_000_000)), targetBytes: max(0, min(targetBytes, 1 << 40)), chapterCount: chapters)
        job.note = note
        if wantAlpha && !alpha && target == "hevc" { JobsRoutes.appendNote(job, "This iPad cannot encode HEVC with transparency, so the background is filled.") }
        if chapters > 0 { JobsRoutes.appendNote(job, "Chapter markers are not written to movies made on iPad.") }
        JobStore.shared.add(job)
        return APIResponse.json(job.describe())
    }

    // MARK: uploads

    private func notFound() -> APIResponse { return APIResponse.error(404, "No job by that id.") }

    private func putFrame(id: String, index: Int, body: Data) -> APIResponse {
        guard let job = JobStore.shared.get(id) else { return notFound() }
        job.touch()
        if !job.accepting { return APIResponse.error(409, "The job is \(job.state); it no longer takes files.") }
        if index < 0 || index >= job.frames { return APIResponse.error(400, "Frame index out of range.") }
        if body.count > ExportLimits.maxJobFrameBytes { return APIResponse.error(413, "That upload is too large.") }
        if body.count < 8 || [UInt8](body.prefix(8)) != JobsRoutes.pngSignature {
            return APIResponse.error(400, "A frame must be a PNG picture.")
        }
        let dest = job.folder.appendingPathComponent("frames", isDirectory: true).appendingPathComponent(String(format: "%06d.png", index))
        do {
            try body.write(to: dest, options: [.atomic])
        } catch {
            return APIResponse.error(500, "The frame could not be stored.")
        }
        if !job.accepting {
            _ = try? FileManager.default.removeItem(at: dest)
            return APIResponse.error(409, "The job ended.")
        }
        let count = job.markReceived(index)
        if job.state == "queued" { job.state = "receiving" }   // never over "cancelled" or "encoding" set meanwhile
        return APIResponse.json(["received": count])
    }

    private func putAudio(id: String, body: Data) -> APIResponse {
        guard let job = JobStore.shared.get(id) else { return notFound() }
        job.touch()
        if !job.accepting { return APIResponse.error(409, "The job is \(job.state); it no longer takes files.") }
        if !job.hasAudio { return APIResponse.error(400, "This job was created without sound.") }
        if body.count > ExportLimits.maxJobAudioBytes { return APIResponse.error(413, "That upload is too large.") }
        if !WavInfo.hasRiffHeader(body) { return APIResponse.error(400, "The sound must be a WAV file.") }
        let dest = job.folder.appendingPathComponent("audio.wav")
        do {
            try body.write(to: dest, options: [.atomic])
        } catch {
            return APIResponse.error(500, "The sound could not be stored.")
        }
        guard let info = WavInfo.parse(url: dest), info.channels >= 1, info.channels <= 2 else {
            _ = try? FileManager.default.removeItem(at: dest)
            return APIResponse.error(400, "The sound must be a mono or stereo PCM WAV file.")
        }
        job.audioIn = true
        if job.state == "queued" { job.state = "receiving" }
        return APIResponse.json(["audio": true])
    }

    // MARK: run

    private func runJob(id: String) async -> APIResponse {
        guard let job = JobStore.shared.get(id) else { return notFound() }
        job.touch()
        let state = job.state
        if state != "queued" && state != "receiving" { return APIResponse.error(409, "The job is \(state).") }
        if job.receivedCount != job.frames {
            return APIResponse.error(409, "\(job.frames - job.receivedCount) frames have not been uploaded.")
        }
        if job.hasAudio && !job.audioIn { return APIResponse.error(409, "The sound has not been uploaded.") }
        job.state = "encoding"
        job.running = true
        Task.detached(priority: .userInitiated) {
            await JobsRoutes.encode(job)
        }
        return APIResponse.json(job.describe())
    }

    private func getJob(id: String) -> APIResponse {
        guard let job = JobStore.shared.get(id) else { return notFound() }
        job.touch()
        if job.state == "done" { job.fetched = true }
        return APIResponse.json(job.describe())
    }

    private func cancelJob(id: String) -> APIResponse {
        guard let job = JobStore.shared.get(id) else { return notFound() }
        job.touch()
        let state = job.state
        if state == "done" || state == "failed" || state == "cancelled" { return APIResponse.json(job.describe()) }
        job.state = "cancelled"
        // a running encode sees the flag within one frame and removes the folder itself
        if !job.running { job.removeFiles() }
        return APIResponse.json(job.describe())
    }

    // MARK: encode

    /// The picture's bits per second the person asked for, or what a file size leaves after the sound; 0 means "by quality".
    static func requestedBps(_ job: ExportJobRecord, rate: Rational) -> Int {
        if job.videoKbps > 0 { return job.videoKbps * 1000 }
        if job.targetBytes > 0 {
            let seconds = max(0.1, Double(job.frames) / rate.framesPerSecond)
            var audio = 0
            if job.hasAudio {
                let linear = job.audioCodec == "pcm" || job.target == "prores" || job.target == "prores4444"
                audio = linear ? 1_411_200 : 192_000
            }
            return max(30_000, Int(Double(job.targetBytes) * 8.0 * 0.985 / seconds) - audio)
        }
        return 0
    }

    /// No bitrate or size was asked for: a rate from the quality word, scaled by picture size and rate.
    static func qualityBps(_ job: ExportJobRecord, rate: Rational) -> Int {
        let perPixel: Double
        switch job.quality {
        case "low": perPixel = 0.04
        case "medium": perPixel = 0.07
        case "high": perPixel = 0.11
        default: perPixel = 0.18
        }
        var bps = Double(job.width * job.height) * rate.framesPerSecond * perPixel
        if job.target == "hevc" { bps *= 0.6 }
        return Int(max(200_000, min(240_000_000, bps)))
    }

    /// ProRes has no bitrate switch: the family member nearest below the target is used (backend prores_plan).
    static func proresPick(_ job: ExportJobRecord, bps: Int, fps: Double) -> String {
        let name = job.profile.isEmpty ? (job.target == "prores" ? "hq" : "4444") : job.profile
        if bps <= 0 || ((name == "4444" || name == "4444xq") && job.alpha) { return name }
        if name == "4444" || name == "4444xq" { return name }
        let scale = (Double(job.width) * Double(job.height) * fps) / (1920.0 * 1080.0 * 29.97)
        var pick = "proxy"
        let nominal: [(String, Double)] = [("proxy", 45.0), ("lt", 102.0), ("422", 147.0), ("hq", 220.0)]
        for (pname, mbps) in nominal where mbps * 1e6 * scale <= Double(bps) {
            pick = pname
        }
        return pick
    }

    static func appendNote(_ job: ExportJobRecord, _ text: String) {
        let old = job.note
        job.note = old.isEmpty ? text : old + " " + text
    }

    static func buildPlan(_ job: ExportJobRecord) throws -> VideoPlan {
        let rate = Rational.fromFps(job.fps)
        let isProRes = job.target == "prores" || job.target == "prores4444"
        let requested = requestedBps(job, rate: rate)
        let codec: AVVideoCodecType
        var bps = 0
        if isProRes {
            let pick = proresPick(job, bps: requested, fps: job.fps)
            var chosen = pick
            if !ExportCapabilities.shared.profileAvailable(chosen) {
                if chosen == "4444xq" && ExportCapabilities.shared.profileAvailable("4444") { chosen = "4444" } else {
                    throw ExportFailure("This iPad cannot encode ProRes \(chosen).")
                }
            }
            guard let c = ExportCapabilities.proresCodec(chosen) else { throw ExportFailure("Unknown ProRes profile.") }
            codec = c
            if requested > 0 && chosen != (job.profile.isEmpty ? (job.target == "prores" ? "hq" : "4444") : job.profile) {
                appendNote(job, "ProRes has no bitrate setting, so ProRes \(chosen) was used to follow your target.")
            } else if requested > 0 {
                appendNote(job, "ProRes has no bitrate setting, so your target was not used; the size follows the ProRes type.")
            }
        } else if job.target == "hevc" {
            codec = job.alpha ? AVVideoCodecType.hevcWithAlpha : AVVideoCodecType.hevc
            bps = requested > 0 ? requested : qualityBps(job, rate: rate)
        } else {
            codec = AVVideoCodecType.h264
            bps = requested > 0 ? requested : qualityBps(job, rate: rate)
        }
        let fileType: AVFileType = job.container == "mov" ? AVFileType.mov : AVFileType.mp4

        var audio: AudioPlan?
        if job.hasAudio {
            let url = job.folder.appendingPathComponent("audio.wav")
            guard let info = WavInfo.parse(url: url) else { throw ExportFailure("The sound must be a WAV file.") }
            let aac = !isProRes && job.audioCodec != "pcm"
            // the picture's length and a little over, so a longer sound is cut at the picture's end
            let seconds = (Double(job.frames) + 0.5) / rate.framesPerSecond
            audio = AudioPlan(url: url, info: info, aac: aac, bitrate: 192_000, maxSeconds: seconds)
        }
        return VideoPlan(codec: codec, fileType: fileType, width: job.width, height: job.height, rate: rate, frames: job.frames,
                         bitsPerSecond: bps, alpha: job.alpha, isProRes: isProRes, optimizeForNetwork: !isProRes, audio: audio)
    }

    static func encoderName(_ plan: VideoPlan) -> String {
        if plan.isProRes { return "prores_avfoundation" }
        return plan.codec == AVVideoCodecType.h264 ? "h264_avfoundation" : "hevc_avfoundation"
    }

    static func encode(_ job: ExportJobRecord) async {
        let token = await BackgroundGuard.begin(name: "formmorpheus.export") {
            // iPadOS is taking the extra time back: stop within a frame and report it
            job.expired = true
        }
        do {
            let plan = try buildPlan(job)
            job.encoder = encoderName(plan)
            let ext = job.container == "mov" ? "mov" : "mp4"
            let out = job.folder.appendingPathComponent("out.\(ext)")
            let folder = job.folder.appendingPathComponent("frames", isDirectory: true)
            let width = job.width, height = job.height
            let encoder = VideoEncoder(
                plan: plan, output: out,
                fill: { index, buffer in
                    let file = folder.appendingPathComponent(String(format: "%06d.png", index))
                    try PNGFrameDecoder.draw(file: file, into: buffer, width: width, height: height)
                },
                progress: { done in job.doneFrames = done },
                isCancelled: { job.shouldStop })
            try await encoder.run()
            if job.state == "cancelled" { throw ExportCancelled() }
            let size = ((try? FileManager.default.attributesOfItem(atPath: out.path))?[.size] as? NSNumber)?.intValue ?? 0
            if size <= 0 { throw ExportFailure("The encoder made an empty file.") }
            let kept = try ExportPaths.keep(out, as: "\(job.name).\(ext)")
            job.output = kept.lastPathComponent
            job.state = "done"
        } catch is ExportCancelled {
            if job.expired && job.state != "cancelled" {
                job.error = "formmorpheus was moved to the background and iPadOS stopped the export. Keep the app open while it encodes."
                job.state = "failed"
            } else {
                job.state = "cancelled"
            }
        } catch {
            if job.state != "cancelled" {
                if job.expired {
                    job.error = "formmorpheus was moved to the background and iPadOS stopped the export. Keep the app open while it encodes."
                } else {
                    let text = exportMessage(error)
                    job.error = text.isEmpty ? "The encode failed." : text
                }
                job.state = "failed"
            }
        }
        job.running = false
        job.removeFiles()
        await BackgroundGuard.end(token)
    }
}

/// Extra time when the app goes to the background mid-export, and no screen lock while it encodes.
final class BackgroundToken: @unchecked Sendable {
    var identifier = UIBackgroundTaskIdentifier.invalid
}

enum BackgroundGuard {
    static func begin(name: String, onExpire: @escaping () -> Void) async -> BackgroundToken {
        return await MainActor.run { () -> BackgroundToken in
            let token = BackgroundToken()
            UIApplication.shared.isIdleTimerDisabled = true
            token.identifier = UIApplication.shared.beginBackgroundTask(withName: name) {
                onExpire()
                if token.identifier != UIBackgroundTaskIdentifier.invalid {
                    UIApplication.shared.endBackgroundTask(token.identifier)
                    token.identifier = UIBackgroundTaskIdentifier.invalid
                }
            }
            return token
        }
    }

    static func end(_ token: BackgroundToken) async {
        await MainActor.run {
            UIApplication.shared.isIdleTimerDisabled = false
            if token.identifier != UIBackgroundTaskIdentifier.invalid {
                UIApplication.shared.endBackgroundTask(token.identifier)
                token.identifier = UIBackgroundTaskIdentifier.invalid
            }
        }
    }
}
