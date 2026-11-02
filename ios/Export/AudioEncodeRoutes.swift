// /api/audio-encode: sound-only encodes. The interface sends a WAV mixdown and gets the encoded file back.
// Same paths, methods and answers as backend/app/routers/audio_encode.py. AAC in M4A is encoded here with AVAssetWriter.
// MP3 and Opus have no encoder in AVFoundation, so those answer 503 exactly as the desktop engine does without ffmpeg,
// and /api/jobs/capabilities reports mp3 false and opus false so the interface uses its own encoder or hides them.
import Foundation

final class AudioEncodeRoutes: APIRoutes {
    let prefix = "/audio-encode"

    static let kbpsChoices = [96, 128, 160, 192, 256, 320]

    init() {}

    func handle(_ request: APIRequest) async -> APIResponse? {
        let parts = request.path.split(separator: "/").map { String($0) }
        guard parts.first == "audio-encode", parts.count == 2 else { return nil }
        let method = request.method.uppercased()
        if parts[1] == "mp3" {
            if method != "POST" { return APIResponse.error(405, "Method Not Allowed") }
            let kbps = Int(request.query["kbps"] ?? "") ?? 192
            if !AudioEncodeRoutes.kbpsChoices.contains(kbps) {
                return APIResponse.error(400, "The MP3 rate must be 96, 128, 160, 192, 256 or 320 kbps.")
            }
            return APIResponse.error(503, "This iPad has no MP3 encoder, so MP3 is not available.")
        }
        if parts[1] == "lossy" {
            if method != "POST" { return APIResponse.error(405, "Method Not Allowed") }
            return await lossy(request)
        }
        return nil
    }

    private func lossy(_ request: APIRequest) async -> APIResponse {
        guard let kind = request.query["kind"] else { return APIResponse.error(422, "The query value kind is required.") }
        let kbps = Int(request.query["kbps"] ?? "") ?? 192
        if kind != "opus-webm" && kind != "opus-ogg" && kind != "aac-m4a" {
            return APIResponse.error(400, "The sound format must be opus-webm, opus-ogg or aac-m4a.")
        }
        if kbps < 32 || kbps > 512 { return APIResponse.error(400, "The rate must be between 32 and 512 kbps.") }
        if kind != "aac-m4a" {
            return APIResponse.error(503, "This iPad has no Opus encoder, so Opus is not available.")
        }
        if !WavInfo.hasRiffHeader(request.body) { return APIResponse.error(400, "The sound must be a WAV file.") }
        if request.body.count > ExportLimits.maxJobAudioBytes { return APIResponse.error(413, "That upload is too large.") }

        let folder = ExportPaths.jobsDir.appendingPathComponent("lossy-" + String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(12)), isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: nil)
        } catch {
            return APIResponse.error(500, "The working folder could not be made.")
        }
        defer { _ = try? FileManager.default.removeItem(at: folder) }
        let src = folder.appendingPathComponent("in.wav")
        let dst = folder.appendingPathComponent("out.m4a")
        do {
            try request.body.write(to: src, options: [.atomic])
        } catch {
            return APIResponse.error(500, "The sound could not be stored.")
        }
        guard let info = WavInfo.parse(url: src), info.channels >= 1, info.channels <= 2 else {
            return APIResponse.error(400, "The sound must be a mono or stereo PCM WAV file.")
        }
        do {
            try await AudioFileEncoder.encodeAAC(wav: src, info: info, kbps: kbps, output: dst)
        } catch {
            let text = exportMessage(error)
            return APIResponse.error(500, text.isEmpty ? "The encoder could not encode the sound." : text)
        }
        guard let data = try? Data(contentsOf: dst), !data.isEmpty else {
            return APIResponse.error(500, "The encoder could not encode the sound.")
        }
        return APIResponse.data(data, contentType: "audio/mp4")
    }
}
