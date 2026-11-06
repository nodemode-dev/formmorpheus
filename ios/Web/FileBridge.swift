import Foundation
import UIKit
import UniformTypeIdentifiers

/// Native side of the page's files and sharing messages (shapes match frontend/src/platform/ipad.ts).
///
/// Page to native:
///   pickFiles { id, accept, multiple }  -> replies pickedFiles { id, files: [{ name, type, size, bytes | path }] }
///   saveFile  { id, name, mime, size, index, count, data }  (base64 chunks, in order) or { id, name, path }
///             -> export picker; replies fileSaved { id, ok, name }
///   share     { text, url } or the same chunked / path file fields plus text and url
///             -> share sheet; replies shareDone { id, completed }. Optional rect { x, y, width, height }
///                (page points) anchors the popover; the default is the window centre.
/// Small picked files come back as base64 `bytes`. Files over inlineLimit are kept in Documents/Inbox
/// and come back as an absolute `path` (the engine reads such paths through /api/files/read).
/// The UIDocumentPickerDelegate conformance is in an extension at the end of the file so that the class itself is not
/// main-actor isolated (register() is called from nonisolated code, finishPick runs on a background queue).
final class FileBridge: NSObject {
    static let shared = FileBridge()
    static let inlineLimit = 8 * 1024 * 1024

    private enum Job {
        case pick(id: String)
        case save(id: String, cleanup: URL?)
    }

    private struct Incoming {
        var dir: URL
        var file: URL
        var handle: FileHandle
        var next: Int
    }

    private var jobs: [ObjectIdentifier: Job] = [:]
    private var incoming: [String: Incoming] = [:]
    private var registered = false

    private override init() {
        super.init()
    }

    /// Registers the three message handlers. Safe to call more than once.
    static func register() {
        let me = FileBridge.shared
        if me.registered { return }
        me.registered = true
        Bridge.shared.on("pickFiles") { payload in me.pick(payload) }
        Bridge.shared.on("saveFile") { payload in me.saveFile(payload) }
        Bridge.shared.on("share") { payload in me.share(payload) }
    }

    // MARK: Picking

    private func pick(_ payload: [String: Any]) {
        let id = payload["id"] as? String ?? ""
        let types = FileBridge.contentTypes(accept: payload["accept"] as? String ?? "")
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        picker.allowsMultipleSelection = (payload["multiple"] as? Bool) ?? false
        picker.delegate = self
        guard let top = Diagnostics.topViewController() else {
            Bridge.shared.send("pickedFiles", ["id": id, "files": [[String: Any]]()])
            return
        }
        jobs[ObjectIdentifier(picker)] = .pick(id: id)
        top.present(picker, animated: true)
    }

    /// Turns an HTML accept string (".fmo,image/*,video/mp4") into content types. Empty means any file.
    static func contentTypes(accept: String) -> [UTType] {
        var out: [UTType] = []
        for raw in accept.split(separator: ",") {
            let token = raw.trimmingCharacters(in: .whitespaces).lowercased()
            if token.isEmpty { continue }
            if token.hasPrefix(".") {
                if let type = UTType(filenameExtension: String(token.dropFirst())) { out.append(type) }
            } else if token == "image/*" {
                out.append(.image)
            } else if token == "video/*" {
                out.append(.movie)
            } else if token == "audio/*" {
                out.append(.audio)
            } else if let type = UTType(mimeType: token) {
                out.append(type)
            }
        }
        return out.isEmpty ? [.item] : out
    }

    private func finishPick(id: String, urls: [URL]) {
        DispatchQueue.global(qos: .userInitiated).async {
            var files: [[String: Any]] = []
            for url in urls {
                let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? ""
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
                var entry: [String: Any] = ["name": url.lastPathComponent, "type": type, "size": size]
                if size <= FileBridge.inlineLimit, let data = try? Data(contentsOf: url) {
                    entry["bytes"] = data.base64EncodedString()
                } else if let kept = FileBridge.keepInInbox(url) {
                    entry["path"] = kept.path
                } else {
                    continue
                }
                files.append(entry)
            }
            Bridge.shared.send("pickedFiles", ["id": id, "files": files])
        }
    }

    private static func keepInInbox(_ url: URL) -> URL? {
        guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return nil
        }
        let inbox = documents.appendingPathComponent("Inbox", isDirectory: true)
        let stamp = String(UUID().uuidString.prefix(8))
        let target = inbox.appendingPathComponent(stamp + "-" + url.lastPathComponent)
        do {
            try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
            do {
                try FileManager.default.moveItem(at: url, to: target)
            } catch {
                try FileManager.default.copyItem(at: url, to: target)
            }
            return target
        } catch {
            return nil
        }
    }

    // MARK: Saving

    private func saveFile(_ payload: [String: Any]) {
        guard let got = collect(payload) else { return }
        let picker = UIDocumentPickerViewController(forExporting: [got.file], asCopy: true)
        picker.delegate = self
        guard let top = Diagnostics.topViewController() else {
            try? FileManager.default.removeItem(at: got.cleanup)
            Bridge.shared.send("fileSaved", ["id": got.id, "ok": false])
            return
        }
        jobs[ObjectIdentifier(picker)] = .save(id: got.id, cleanup: got.cleanup)
        top.present(picker, animated: true)
    }

    // MARK: UIDocumentPickerDelegate

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let job = jobs.removeValue(forKey: ObjectIdentifier(controller)) else { return }
        switch job {
        case .pick(let id):
            finishPick(id: id, urls: urls)
        case .save(let id, let cleanup):
            if let cleanup = cleanup { try? FileManager.default.removeItem(at: cleanup) }
            Bridge.shared.send("fileSaved", ["id": id, "ok": true, "name": urls.first?.lastPathComponent ?? ""])
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let job = jobs.removeValue(forKey: ObjectIdentifier(controller)) else { return }
        switch job {
        case .pick(let id):
            Bridge.shared.send("pickedFiles", ["id": id, "files": [[String: Any]]()])
        case .save(let id, let cleanup):
            if let cleanup = cleanup { try? FileManager.default.removeItem(at: cleanup) }
            Bridge.shared.send("fileSaved", ["id": id, "ok": false])
        }
    }

    // MARK: Sharing

    private func share(_ payload: [String: Any]) {
        var items: [Any] = []
        var cleanup: URL?
        let hasFile = payload["data"] != nil || payload["path"] != nil
        var id = payload["id"] as? String ?? ""
        if hasFile {
            // Not the last chunk yet: wait for the rest.
            guard let got = collect(payload) else { return }
            items.append(got.file)
            cleanup = got.cleanup
            id = got.id
        }
        if let text = payload["text"] as? String, !text.isEmpty { items.append(text) }
        if let address = payload["url"] as? String, !address.isEmpty, let url = URL(string: address) { items.append(url) }
        if items.isEmpty { return }

        guard let top = Diagnostics.topViewController() else {
            if let cleanup = cleanup { try? FileManager.default.removeItem(at: cleanup) }
            return
        }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = top.view
            if let rect = payload["rect"] as? [String: Any], let width = FileBridge.number(rect["width"]),
               let height = FileBridge.number(rect["height"]) {
                let x = FileBridge.number(rect["x"]) ?? 0
                let y = FileBridge.number(rect["y"]) ?? 0
                popover.sourceRect = CGRect(x: x, y: y, width: max(1, width), height: max(1, height))
            } else {
                popover.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
        }
        sheet.completionWithItemsHandler = { _, completed, _, _ in
            if let cleanup = cleanup { try? FileManager.default.removeItem(at: cleanup) }
            Bridge.shared.send("shareDone", ["id": id, "completed": completed])
        }
        top.present(sheet, animated: true)
    }

    private static func number(_ value: Any?) -> CGFloat? {
        guard let number = value as? NSNumber else { return nil }
        return CGFloat(number.doubleValue)
    }

    // MARK: Receiving files from the page

    /// Gathers one file from the page into a temporary folder. Returns it when complete, else nil
    /// (more chunks to come, or the transfer failed). `cleanup` is the folder to delete afterwards.
    private func collect(_ payload: [String: Any]) -> (id: String, file: URL, cleanup: URL)? {
        let id = payload["id"] as? String ?? UUID().uuidString
        let name = FileBridge.safeName(payload["name"] as? String)

        if payload["data"] == nil, let path = payload["path"] as? String {
            // A file the engine wrote: only paths inside the app's own container are allowed.
            guard EngineConfig.isInside(URL(fileURLWithPath: path), URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)) else { return nil }
            let dir = FileBridge.newTransferFolder()
            let copy = dir.appendingPathComponent(name)
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try FileManager.default.copyItem(at: URL(fileURLWithPath: path), to: copy)
                return (id, copy, dir)
            } catch {
                return nil
            }
        }

        guard let encoded = payload["data"] as? String, let chunk = Data(base64Encoded: encoded) else {
            abort(id)
            return nil
        }
        let index = (payload["index"] as? NSNumber)?.intValue ?? 0
        let count = max(1, (payload["count"] as? NSNumber)?.intValue ?? 1)

        var state: Incoming
        if index == 0 {
            abort(id)
            let dir = FileBridge.newTransferFolder()
            let file = dir.appendingPathComponent(name)
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            } catch {
                return nil
            }
            FileManager.default.createFile(atPath: file.path, contents: nil)
            guard let handle = try? FileHandle(forWritingTo: file) else { return nil }
            state = Incoming(dir: dir, file: file, handle: handle, next: 0)
        } else if let existing = incoming[id], existing.next == index {
            state = existing
        } else {
            abort(id)
            return nil
        }

        do {
            _ = try state.handle.seekToEnd()
            try state.handle.write(contentsOf: chunk)
        } catch {
            incoming[id] = state
            abort(id)
            return nil
        }
        state.next = index + 1
        if state.next >= count {
            try? state.handle.close()
            incoming[id] = nil
            return (id, state.file, state.dir)
        }
        incoming[id] = state
        return nil
    }

    private func abort(_ id: String) {
        if let state = incoming.removeValue(forKey: id) {
            try? state.handle.close()
            try? FileManager.default.removeItem(at: state.dir)
        }
    }

    private static func newTransferFolder() -> URL {
        return FileManager.default.temporaryDirectory
            .appendingPathComponent("FMTransfer", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    private static func safeName(_ raw: String?) -> String {
        var name = (raw ?? "").replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty || name == "." || name == ".." { name = "file" }
        return name
    }
}

extension FileBridge: UIDocumentPickerDelegate {}
