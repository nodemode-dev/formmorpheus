// One export job and the registry of them: the Swift counterpart of the Job dataclass and JOBS in backend/app/routers/jobs.py.
import Foundation

final class ExportJobRecord: @unchecked Sendable {
    let id: String
    let target: String
    let fps: Double
    let width: Int
    let height: Int
    let frames: Int
    let hasAudio: Bool
    let alpha: Bool
    let quality: String
    let container: String
    let name: String
    let folder: URL
    let audioCodec: String
    let profile: String
    let videoKbps: Int
    let targetBytes: Int
    let chapterCount: Int
    let created = Date()

    private let lock = NSLock()
    private var _state = "queued"
    private var _received = Set<Int>()
    private var _audioIn = false
    private var _doneFrames = 0
    private var _output = ""
    private var _error = ""
    private var _encoder = ""
    private var _note = ""
    private var _touched = Date()
    private var _fetched = false
    private var _expired = false
    private var _running = false

    init(id: String, target: String, fps: Double, width: Int, height: Int, frames: Int, hasAudio: Bool, alpha: Bool,
         quality: String, container: String, name: String, folder: URL, audioCodec: String, profile: String,
         videoKbps: Int, targetBytes: Int, chapterCount: Int) {
        self.id = id
        self.target = target
        self.fps = fps
        self.width = width
        self.height = height
        self.frames = frames
        self.hasAudio = hasAudio
        self.alpha = alpha
        self.quality = quality
        self.container = container
        self.name = name
        self.folder = folder
        self.audioCodec = audioCodec
        self.profile = profile
        self.videoKbps = videoKbps
        self.targetBytes = targetBytes
        self.chapterCount = chapterCount
    }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    var state: String {
        get { return locked { _state } }
        set { locked { _state = newValue } }
    }
    var audioIn: Bool {
        get { return locked { _audioIn } }
        set { locked { _audioIn = newValue } }
    }
    var doneFrames: Int {
        get { return locked { _doneFrames } }
        set { locked { _doneFrames = newValue } }
    }
    var output: String {
        get { return locked { _output } }
        set { locked { _output = newValue } }
    }
    var error: String {
        get { return locked { _error } }
        set { locked { _error = newValue } }
    }
    var encoder: String {
        get { return locked { _encoder } }
        set { locked { _encoder = newValue } }
    }
    var note: String {
        get { return locked { _note } }
        set { locked { _note = newValue } }
    }
    var touched: Date { return locked { _touched } }
    var fetched: Bool {
        get { return locked { _fetched } }
        set { locked { _fetched = newValue } }
    }
    /// True once iPadOS ended the extra background time.
    var expired: Bool {
        get { return locked { _expired } }
        set { locked { _expired = newValue } }
    }
    /// True while an encode task owns the folder (the backend's `task is not None`).
    var running: Bool {
        get { return locked { _running } }
        set { locked { _running = newValue } }
    }
    var receivedCount: Int { return locked { _received.count } }

    func touch() { locked { _touched = Date() } }

    func markReceived(_ index: Int) -> Int {
        return locked { () -> Int in
            _received.insert(index)
            return _received.count
        }
    }

    /// Cancelled by the person, or stopped because iPadOS took the background time away.
    var shouldStop: Bool {
        return locked { _state == "cancelled" || _expired }
    }

    var accepting: Bool {
        return locked { _state == "queued" || _state == "receiving" }
    }

    func progress() -> Double {
        return locked { () -> Double in
            if _state == "done" { return 1.0 }
            if _state == "encoding" { return min(0.99, Double(_doneFrames) / Double(max(1, frames))) }
            if _state == "receiving" || _state == "queued" { return Double(_received.count) / Double(max(1, frames)) }
            return 0.0
        }
    }

    func describe() -> [String: Any] {
        let p = (progress() * 10000.0).rounded() / 10000.0
        return locked { () -> [String: Any] in
            return [
                "id": id, "target": target, "state": _state, "progress": p,
                "frames": frames, "received": _received.count, "audio": _audioIn,
                "output": _output, "error": _error, "encoder": _encoder, "note": _note,
                "pass": 1, "passes": 1
            ]
        }
    }

    func removeFiles() {
        _ = try? FileManager.default.removeItem(at: folder)
    }
}

final class JobStore: @unchecked Sendable {
    static let shared = JobStore()

    private let lock = NSLock()
    private var jobs: [String: ExportJobRecord] = [:]
    private var sweeping = false

    func add(_ job: ExportJobRecord) {
        lock.lock()
        jobs[job.id] = job
        lock.unlock()
        prune()
    }

    func get(_ id: String) -> ExportJobRecord? {
        lock.lock()
        defer { lock.unlock() }
        return jobs[id]
    }

    private func all() -> [ExportJobRecord] {
        lock.lock()
        defer { lock.unlock() }
        return Array(jobs.values)
    }

    /// Keeps at most MAX_KEPT_RECORDS finished records (a finished export nobody has read the result of is kept until fetched or a day old).
    func prune() {
        let now = Date()
        var finished: [ExportJobRecord] = []
        for j in all() {
            let s = j.state
            if s == "failed" || s == "cancelled" {
                finished.append(j)
            } else if s == "done" && (j.fetched || now.timeIntervalSince(j.created) > ExportLimits.jobMaxAgeSeconds) {
                finished.append(j)
            }
        }
        finished.sort { $0.created < $1.created }
        let extra = finished.count - ExportLimits.maxKeptRecords
        if extra <= 0 { return }
        lock.lock()
        for j in finished.prefix(extra) { jobs.removeValue(forKey: j.id) }
        lock.unlock()
    }

    /// Startup: temp folders left by a crash, older than a day, are removed.
    func sweepStartup() {
        let cutoff = Date().addingTimeInterval(-ExportLimits.jobMaxAgeSeconds)
        let fm = FileManager.default
        let root = ExportPaths.jobsDir
        guard let items = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey], options: []) else { return }
        for url in items {
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .isDirectoryKey])
            if values?.isDirectory == true, let m = values?.contentModificationDate, m < cutoff {
                _ = try? fm.removeItem(at: url)
            }
        }
    }

    /// While running: a job that took no upload and no poll for ABANDON_SECONDS loses its folder; folders nobody owns
    /// and nothing wrote to for ORPHAN_SECONDS go too. Returns how many.
    @discardableResult
    func sweepAbandoned(now: Date = Date()) -> Int {
        var gone = 0
        var owned = Set<String>()
        for job in all() {
            owned.insert(job.folder.lastPathComponent)
            let s = job.state
            if (s == "queued" || s == "receiving") && now.timeIntervalSince(job.touched) > ExportLimits.abandonSeconds {
                job.state = "cancelled"
                job.error = "The window stopped sending this job."
                job.removeFiles()
                gone += 1
            }
        }
        let fm = FileManager.default
        if let items = try? fm.contentsOfDirectory(at: ExportPaths.jobsDir, includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey], options: []) {
            for url in items where !owned.contains(url.lastPathComponent) {
                let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .isDirectoryKey])
                if values?.isDirectory == true, let m = values?.contentModificationDate, now.timeIntervalSince(m) > ExportLimits.orphanSeconds {
                    _ = try? fm.removeItem(at: url)
                    gone += 1
                }
            }
        }
        return gone
    }

    /// Starts the once-a-minute abandon sweep (idempotent) and the startup sweep.
    func startSweeping() {
        lock.lock()
        if sweeping {
            lock.unlock()
            return
        }
        sweeping = true
        lock.unlock()
        DispatchQueue.global(qos: .utility).async {
            JobStore.shared.sweepStartup()
        }
        Task.detached(priority: .utility) {
            while true {
                try? await Task.sleep(nanoseconds: ExportLimits.sweepEverySeconds * 1_000_000_000)
                JobStore.shared.sweepAbandoned()
            }
        }
    }
}
