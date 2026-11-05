// The AVFoundation encoders: video (AVAssetWriter + pixel buffer adaptor, optional sound) and sound only (AAC in M4A).
import Foundation
import AVFoundation
import AudioToolbox
import CoreMedia
import CoreVideo
import CoreGraphics
import ImageIO

struct ExportCancelled: Error {}

struct ExportFailure: Error, LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { return message }
}

func exportMessage(_ error: Error) -> String {
    if let f = error as? ExportFailure { return f.message }
    return error.localizedDescription
}

/// Sound settings shared by the movie encoder and the sound-only encoder.
enum ExportAudioSettings {
    static func layoutData(channels: Int) -> Data {
        var layout = AudioChannelLayout()
        layout.mChannelLayoutTag = channels == 1 ? kAudioChannelLayoutTag_Mono : kAudioChannelLayoutTag_Stereo
        layout.mChannelBitmap = AudioChannelBitmap(rawValue: 0)
        layout.mNumberChannelDescriptions = 0
        return withUnsafeBytes(of: &layout) { Data($0) }
    }

    /// What the reader hands to the writer: 16 bit little endian interleaved PCM at the file's own rate.
    static func readSettings(_ info: WavInfo) -> [String: Any] {
        return [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
            AVSampleRateKey: info.sampleRate,
            AVNumberOfChannelsKey: info.channels
        ]
    }

    static func aac(_ info: WavInfo, bitrate: Int) -> [String: Any] {
        return [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: info.sampleRate,
            AVNumberOfChannelsKey: info.channels,
            AVEncoderBitRateKey: bitrate,
            AVChannelLayoutKey: layoutData(channels: info.channels)
        ]
    }

    static func pcm(_ info: WavInfo) -> [String: Any] {
        return [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: info.sampleRate,
            AVNumberOfChannelsKey: info.channels,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
            AVChannelLayoutKey: layoutData(channels: info.channels)
        ]
    }

    /// The AAC settings the writer accepts: the asked rate first, then lower standard rates.
    static func acceptedAAC(_ writer: AVAssetWriter, info: WavInfo, bitrate: Int) -> [String: Any]? {
        var tries = [bitrate]
        for b in [320_000, 256_000, 192_000, 160_000, 128_000, 96_000, 64_000] where b < bitrate {
            tries.append(b)
        }
        for b in tries {
            let s = aac(info, bitrate: b)
            if writer.canApply(outputSettings: s, forMediaType: .audio) { return s }
        }
        return nil
    }
}

struct AudioPlan {
    let url: URL
    let info: WavInfo
    /// AAC, or 16 bit linear PCM (a .mov file only).
    let aac: Bool
    let bitrate: Int
    /// The sound is cut at this length (the picture's end plus half a frame, as the desktop engine does).
    let maxSeconds: Double
}

struct VideoPlan {
    var codec: AVVideoCodecType
    var fileType: AVFileType
    var width: Int
    var height: Int
    var rate: Rational
    var frames: Int
    /// 0: leave the encoder's default (ProRes always).
    var bitsPerSecond: Int
    var alpha: Bool
    var isProRes: Bool
    var optimizeForNetwork: Bool
    var audio: AudioPlan?
}

/// Pumps the frames and the sound into one AVAssetWriter. Frames come from `fill`, which draws frame i into a BGRA buffer.
final class VideoEncoder: @unchecked Sendable {
    typealias FrameFill = (_ index: Int, _ buffer: CVPixelBuffer) throws -> Void

    private let plan: VideoPlan
    private let output: URL
    private let fill: FrameFill
    private let progress: (Int) -> Void
    private let isCancelled: () -> Bool

    private let lock = NSLock()
    private var failure: Error?
    private var nextFrame = 0
    private var videoLeft = false
    private var audioLeft = false
    private var writer: AVAssetWriter?

    init(plan: VideoPlan, output: URL, fill: @escaping FrameFill, progress: @escaping (Int) -> Void, isCancelled: @escaping () -> Bool) {
        self.plan = plan
        self.output = output
        self.fill = fill
        self.progress = progress
        self.isCancelled = isCancelled
    }

    private func fail(_ error: Error) {
        lock.lock()
        if failure == nil { failure = error }
        lock.unlock()
    }

    private var failed: Bool {
        lock.lock()
        defer { lock.unlock() }
        return failure != nil
    }

    private var stopRequested: Bool {
        return isCancelled() || failed
    }

    func videoSettings() -> [String: Any] {
        var settings: [String: Any] = [
            AVVideoCodecKey: plan.codec.rawValue,
            AVVideoWidthKey: plan.width,
            AVVideoHeightKey: plan.height,
            AVVideoColorPropertiesKey: [
                AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2
            ]
        ]
        if !plan.isProRes {
            let fps = max(1, Int(plan.rate.framesPerSecond.rounded()))
            var compression: [String: Any] = [
                AVVideoExpectedSourceFrameRateKey: fps,
                AVVideoMaxKeyFrameIntervalKey: fps * 2
            ]
            if plan.bitsPerSecond > 0 { compression[AVVideoAverageBitRateKey] = plan.bitsPerSecond }
            if plan.codec == .h264 { compression[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel }
            settings[AVVideoCompressionPropertiesKey] = compression
        }
        return settings
    }

    private func tag(_ buffer: CVPixelBuffer) {
        CVBufferSetAttachment(buffer, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(buffer, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(buffer, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
    }

    func run() async throws {
        _ = try? FileManager.default.removeItem(at: output)
        let writer = try AVAssetWriter(outputURL: output, fileType: plan.fileType)
        self.writer = writer
        writer.shouldOptimizeForNetworkUse = plan.optimizeForNetwork

        let settings = videoSettings()
        guard writer.canApply(outputSettings: settings, forMediaType: .video) else {
            throw ExportFailure("This iPad cannot encode that video setting (\(plan.codec.rawValue) at \(plan.width) x \(plan.height)).")
        }
        let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        videoInput.expectsMediaDataInRealTime = false
        videoInput.mediaTimeScale = CMTimeScale(plan.rate.timescale)
        let attributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
            kCVPixelBufferWidthKey as String: plan.width,
            kCVPixelBufferHeightKey as String: plan.height,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any]()
        ]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput, sourcePixelBufferAttributes: attributes)
        guard writer.canAdd(videoInput) else { throw ExportFailure("The video track could not be added to the file.") }
        writer.add(videoInput)

        // sound: read the uploaded WAV, write AAC or linear PCM
        var audioInput: AVAssetWriterInput?
        var audioReader: AVAssetReader?
        var audioOutput: AVAssetReaderTrackOutput?
        if let a = plan.audio {
            let writeSettings: [String: Any]
            if a.aac {
                guard let accepted = ExportAudioSettings.acceptedAAC(writer, info: a.info, bitrate: a.bitrate) else {
                    throw ExportFailure("This iPad cannot encode AAC sound for that file.")
                }
                writeSettings = accepted
            } else {
                writeSettings = ExportAudioSettings.pcm(a.info)
                guard writer.canApply(outputSettings: writeSettings, forMediaType: .audio) else {
                    throw ExportFailure("This file type cannot hold linear PCM sound.")
                }
            }
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: writeSettings)
            input.expectsMediaDataInRealTime = false
            guard writer.canAdd(input) else { throw ExportFailure("The sound track could not be added to the file.") }
            writer.add(input)
            audioInput = input

            let asset = AVURLAsset(url: a.url, options: nil)
            let tracks = try await asset.loadTracks(withMediaType: .audio)
            guard let track = tracks.first else { throw ExportFailure("The sound file has no audio track.") }
            let reader = try AVAssetReader(asset: asset)
            let out = AVAssetReaderTrackOutput(track: track, outputSettings: ExportAudioSettings.readSettings(a.info))
            out.alwaysCopiesSampleData = false
            guard reader.canAdd(out) else { throw ExportFailure("The sound file could not be read.") }
            reader.add(out)
            reader.timeRange = CMTimeRange(start: CMTime.zero, duration: CMTime(seconds: a.maxSeconds, preferredTimescale: 48000))
            audioReader = reader
            audioOutput = out
        }

        guard writer.startWriting() else {
            throw ExportFailure(writer.error?.localizedDescription ?? "The file could not be started.")
        }
        writer.startSession(atSourceTime: CMTime.zero)
        if let reader = audioReader {
            guard reader.startReading() else {
                writer.cancelWriting()
                throw ExportFailure(reader.error?.localizedDescription ?? "The sound file could not be read.")
            }
        }

        let group = DispatchGroup()
        let videoQueue = DispatchQueue(label: "formmorpheus.export.video")
        let audioQueue = DispatchQueue(label: "formmorpheus.export.audio")

        group.enter()
        videoInput.requestMediaDataWhenReady(on: videoQueue) { [self] in
            if self.videoLeft { return }
            if self.pumpVideo(input: videoInput, adaptor: adaptor, writer: writer) {
                self.videoLeft = true
                group.leave()
            }
        }
        if let input = audioInput, let out = audioOutput, let reader = audioReader {
            group.enter()
            input.requestMediaDataWhenReady(on: audioQueue) { [self] in
                if self.audioLeft { return }
                if self.pumpAudio(input: input, output: out, reader: reader) {
                    self.audioLeft = true
                    group.leave()
                }
            }
        }

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            group.notify(queue: DispatchQueue.global(qos: .userInitiated)) {
                continuation.resume()
            }
        }

        if isCancelled() || failed {
            audioReader?.cancelReading()
            writer.cancelWriting()
            _ = try? FileManager.default.removeItem(at: output)
            if let error = currentFailure() { throw error }
            throw ExportCancelled()
        }

        writer.endSession(atSourceTime: CMTime(value: Int64(plan.frames) * plan.rate.frameValue, timescale: plan.rate.timescale))
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            writer.finishWriting {
                continuation.resume()
            }
        }
        if writer.status != .completed {
            _ = try? FileManager.default.removeItem(at: output)
            throw ExportFailure(writer.error?.localizedDescription ?? "The encoder could not finish the file.")
        }
    }

    private func currentFailure() -> Error? {
        lock.lock()
        defer { lock.unlock() }
        return failure
    }

    /// Returns true once this input has been finished (every frame appended, or a stop).
    private func pumpVideo(input: AVAssetWriterInput, adaptor: AVAssetWriterInputPixelBufferAdaptor, writer: AVAssetWriter) -> Bool {
        while input.isReadyForMoreMediaData {
            if stopRequested || nextFrame >= plan.frames {
                input.markAsFinished()
                return true
            }
            guard let pool = adaptor.pixelBufferPool else {
                fail(ExportFailure("The encoder has no pixel buffer pool."))
                input.markAsFinished()
                return true
            }
            var made: CVPixelBuffer?
            let status = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &made)
            guard status == kCVReturnSuccess, let buffer = made else {
                fail(ExportFailure("A frame buffer could not be allocated (\(status))."))
                input.markAsFinished()
                return true
            }
            do {
                try autoreleasepool {
                    try fill(nextFrame, buffer)
                }
            } catch {
                fail(error)
                input.markAsFinished()
                return true
            }
            tag(buffer)
            let time = CMTime(value: Int64(nextFrame) * plan.rate.frameValue, timescale: plan.rate.timescale)
            if !adaptor.append(buffer, withPresentationTime: time) {
                fail(ExportFailure(writer.error?.localizedDescription ?? "The encoder stopped accepting frames."))
                input.markAsFinished()
                return true
            }
            nextFrame += 1
            progress(nextFrame)
        }
        return false
    }

    private func pumpAudio(input: AVAssetWriterInput, output: AVAssetReaderTrackOutput, reader: AVAssetReader) -> Bool {
        while input.isReadyForMoreMediaData {
            if stopRequested {
                input.markAsFinished()
                return true
            }
            if let sample = output.copyNextSampleBuffer() {
                if !input.append(sample) {
                    fail(ExportFailure(writer?.error?.localizedDescription ?? "The encoder stopped accepting sound."))
                    input.markAsFinished()
                    return true
                }
            } else {
                if reader.status == .failed {
                    fail(ExportFailure(reader.error?.localizedDescription ?? "The sound file could not be read."))
                }
                input.markAsFinished()
                return true
            }
        }
        return false
    }
}

/// Decodes one uploaded PNG into a BGRA pixel buffer (premultiplied alpha, sRGB values, tagged BT.709 by the encoder).
enum PNGFrameDecoder {
    static func draw(file: URL, into buffer: CVPixelBuffer, width: Int, height: Int) throws {
        let options: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithURL(file as CFURL, options as CFDictionary),
              let image = CGImageSourceCreateImageAtIndex(source, 0, options as CFDictionary) else {
            throw ExportFailure("A frame could not be read back (\(file.lastPathComponent)).")
        }
        CVPixelBufferLockBaseAddress(buffer, CVPixelBufferLockFlags(rawValue: 0))
        defer { CVPixelBufferUnlockBaseAddress(buffer, CVPixelBufferLockFlags(rawValue: 0)) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else {
            throw ExportFailure("A frame buffer has no memory.")
        }
        let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        let info = CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
        guard let context = CGContext(data: base, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: space, bitmapInfo: info) else {
            throw ExportFailure("A frame could not be drawn.")
        }
        // .copy replaces what a recycled buffer held, so no clear is needed
        context.setBlendMode(.copy)
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
}

/// WAV in, AAC in M4A out: the engine's /audio-encode/lossy for aac-m4a.
enum AudioFileEncoder {
    static func encodeAAC(wav: URL, info: WavInfo, kbps: Int, output: URL) async throws {
        _ = try? FileManager.default.removeItem(at: output)
        let writer = try AVAssetWriter(outputURL: output, fileType: .m4a)
        guard let settings = ExportAudioSettings.acceptedAAC(writer, info: info, bitrate: kbps * 1000) else {
            throw ExportFailure("This iPad cannot encode AAC sound at that rate.")
        }
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        guard writer.canAdd(input) else { throw ExportFailure("The sound track could not be added to the file.") }
        writer.add(input)

        let asset = AVURLAsset(url: wav, options: nil)
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        guard let track = tracks.first else { throw ExportFailure("The sound must be a WAV file.") }
        let reader = try AVAssetReader(asset: asset)
        let out = AVAssetReaderTrackOutput(track: track, outputSettings: ExportAudioSettings.readSettings(info))
        out.alwaysCopiesSampleData = false
        guard reader.canAdd(out) else { throw ExportFailure("The sound file could not be read.") }
        reader.add(out)

        guard writer.startWriting() else {
            throw ExportFailure(writer.error?.localizedDescription ?? "The file could not be started.")
        }
        writer.startSession(atSourceTime: CMTime.zero)
        guard reader.startReading() else {
            writer.cancelWriting()
            throw ExportFailure(reader.error?.localizedDescription ?? "The sound file could not be read.")
        }

        let queue = DispatchQueue(label: "formmorpheus.export.aac")
        let box = AudioPumpBox()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            input.requestMediaDataWhenReady(on: queue) {
                if box.done { return }
                while input.isReadyForMoreMediaData {
                    if let sample = out.copyNextSampleBuffer() {
                        if !input.append(sample) {
                            box.failed = true
                            input.markAsFinished()
                            box.done = true
                            continuation.resume()
                            return
                        }
                    } else {
                        if reader.status == .failed { box.failed = true }
                        input.markAsFinished()
                        box.done = true
                        continuation.resume()
                        return
                    }
                }
            }
        }
        if box.failed {
            reader.cancelReading()
            writer.cancelWriting()
            throw ExportFailure(reader.error?.localizedDescription ?? writer.error?.localizedDescription ?? "The sound could not be encoded.")
        }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            writer.finishWriting {
                continuation.resume()
            }
        }
        if writer.status != .completed {
            _ = try? FileManager.default.removeItem(at: output)
            throw ExportFailure(writer.error?.localizedDescription ?? "The encoder could not finish the file.")
        }
    }
}

final class AudioPumpBox: @unchecked Sendable {
    var done = false
    var failed = false
}
