// SaveToRoutes.swift
// /api/save-to/file and /api/save-to/frames: exports written to a folder by path. A port of backend/app/routers/save_to.py.
//
// On iPad the native picker (the bridge's saveFile and share) is how a person saves to a place of their choice.
// These routes keep the contract for folders inside the app's own Documents tree: a folder anywhere else answers
// 400 "That folder belongs to the system. Choose one of your own." exactly as the desktop does for a system folder.
// Nothing here replaces a file: a taken name becomes "name 2", "name 3". A frames folder is cut out of the zip.

import Foundation

final class SaveToRoutes: APIRoutes {
    let prefix = "/save-to"
    private let table = RouteTable()
    private let maxFiles = 200_000
    private let maxUnpacked: UInt64 = 16 * 1024 * 1024 * 1024   // a zip can claim far more than its own size

    init() {
        table.add("POST", "/save-to/file") { [unowned self] c in try self.saveFile(c) }
        table.add("POST", "/save-to/frames") { [unowned self] c in try self.saveFrames(c) }
    }

    func handle(_ request: APIRequest) async -> APIResponse? {
        if !table.handles(request) { return nil }
        return await EngineWork.run { return self.table.dispatch(request) }
    }

    /// A device name (CON, NUL, COM1 ...) or a name ending in a dot or space would not make a file on other systems.
    private func plain(_ name: String) throws -> String {
        let reserved = "^(con|prn|aux|nul|conin\\$|conout\\$|com[0-9\u{B9}\u{B2}\u{B3}]|lpt[0-9\u{B9}\u{B2}\u{B3}])(\\..*)?$"
        let trimmed = EngineText.strip(name)
        var end = Array(name.unicodeScalars)
        while let l = end.last, l == "." || l == " " { end.removeLast() }
        var view = String.UnicodeScalarView()
        view.append(contentsOf: end)
        if EngineText.matches(reserved, trimmed, caseInsensitive: true) || name != String(view) {
            throw EngineError(400, "That file name cannot be used.")
        }
        return name
    }

    private func folder(_ raw: String) throws -> URL {
        let s = EngineText.strip(raw).replacingOccurrences(of: "\\", with: "/")
        if s.hasPrefix("//") { throw EngineError(400, "A network share path cannot be used here.") }
        return try EngineFolders.safe(raw, create: false)   // a typo must not leave new folders behind
    }

    /// The request body in a part file beside the target, so a failed save leaves nothing.
    private func spool(_ c: RouteContext, in folder: URL) throws -> URL {
        let body = try c.limited(EngineConfig.maxExportBytes, "The export is too large to save.")
        let tmp = folder.appendingPathComponent(".\(EngineText.hex(16)).part")
        do {
            try EngineFS.writeFile(body, to: tmp)
        } catch {
            EngineFS.remove(tmp)
            throw EngineError(400, "FormMorpheus could not write there.")
        }
        return tmp
    }

    private func saveFile(_ c: RouteContext) throws -> APIResponse {
        let dir = try folder(try c.requiredQuery("dir"))
        let parts = EngineText.splitName(try plain(try ExportNaming.clean(try c.requiredQuery("name"))))
        let tmp = try spool(c, in: dir)
        defer { EngineFS.remove(tmp) }
        var n = 1
        while true {
            let dst = dir.appendingPathComponent(n == 1 ? parts.stem + parts.ext : "\(parts.stem) \(n)\(parts.ext)")
            do {
                try EngineFS.publish(tmp, dst)
                return APIResponse.json(["path": dst.path, "name": dst.lastPathComponent])
            } catch EngineFSError.exists {
                n += 1
            } catch {
                throw EngineError(400, "FormMorpheus could not write there.")
            }
        }
    }

    private func saveFrames(_ c: RouteContext) throws -> APIResponse {
        let parent = try folder(try c.requiredQuery("dir"))
        let stem = try plain(try ExportNaming.clean(try c.requiredQuery("folder")))
        let tmp = try spool(c, in: parent)
        defer { EngineFS.remove(tmp) }
        guard let zip = try? ZipReader(url: tmp) else { throw EngineError(400, "That is not a set of frames.") }

        // the name only: an entry can never leave the folder
        func baseName(_ e: ZipEntry) -> String {
            return e.name.split(separator: "/", omittingEmptySubsequences: true).last.map { String($0) } ?? ""
        }
        var files: [ZipEntry] = []
        var total: UInt64 = 0
        for e in zip.entries where !e.isDirectory {
            let b = baseName(e)
            if b.isEmpty || EngineText.hasBad(b) || b.hasPrefix(".") { continue }
            if (try? plain(b)) == nil { continue }
            files.append(e)
            total += e.size
        }
        if files.isEmpty || files.count > maxFiles || total > maxUnpacked {
            throw EngineError(400, "There are no frames to save.")
        }
        var n = 1
        var dst = parent.appendingPathComponent(stem)
        while true {
            dst = parent.appendingPathComponent(n == 1 ? stem : "\(stem) \(n)")
            do {
                try EngineFS.fm.createDirectory(at: dst, withIntermediateDirectories: false)
                break
            } catch let e as CocoaError where e.code == .fileWriteFileExists {
                n += 1
            } catch {
                throw EngineError(400, "FormMorpheus could not write there.")
            }
        }
        var made: [URL] = []
        var written = 0
        var unpacked: UInt64 = 0
        do {
            for e in files {
                let target = dst.appendingPathComponent(baseName(e))
                if EngineFS.exists(target) { throw ZipError.corrupt }   // two entries with one name: refuse, like an exclusive create
                made.append(target)
                let data = try zip.read(e, limit: 1024 * 1024 * 1024)
                unpacked += UInt64(data.count)
                if unpacked > maxUnpacked { throw ZipError.tooLarge }   // the header lied about the size
                try EngineFS.writeFile(data, to: target)
                written += 1
            }
        } catch {
            // a half-written folder is worse than none: take back what this call made
            for p in made { EngineFS.remove(p) }
            _ = EngineFS.rmdir(dst)
            throw EngineError(400, "FormMorpheus could not write all the frames there.")
        }
        return APIResponse.json(["path": dst.path, "name": dst.lastPathComponent, "files": written])
    }
}
