// ZipStore.swift
// A small zip reader and writer (Foundation and Compression only). A .fmo and a .brush are zips.
//
// Reading: the central directory (zip64 too), stored and deflated entries. COMPRESSION_ZLIB in the Compression
// framework is raw DEFLATE (RFC 1951) with no zlib header, which is what a zip entry holds.
// Writing: entries are either new (stored, no compression) or copied raw from another zip (their compressed bytes,
// checksum and sizes are kept), so a big movie is copied without being inflated or recompressed.
// Output is plain zip (no zip64): a file over 4 GiB or 65535 entries is refused. The movie limit is 4 GiB.

import Foundation
import Compression

enum ZipError: Error {
    case notZip
    case unsupported
    case corrupt
    case tooLarge
}

struct ZipEntry {
    let name: String
    let flags: UInt16
    let method: UInt16
    let dosTime: UInt16
    let dosDate: UInt16
    let crc: UInt32
    let compressedSize: UInt64
    let size: UInt64
    let localOffset: UInt64

    var isDirectory: Bool { return name.hasSuffix("/") }
}

enum CRC32 {
    private static let table: [UInt32] = {
        var t = [UInt32](repeating: 0, count: 256)
        for i in 0..<256 {
            var c = UInt32(i)
            for _ in 0..<8 {
                c = (c & 1) != 0 ? (0xEDB88320 ^ (c >> 1)) : (c >> 1)
            }
            t[i] = c
        }
        return t
    }()

    static func checksum(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFFFFFF
        data.withUnsafeBytes { (p: UnsafeRawBufferPointer) in
            for b in p {
                c = table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8)
            }
        }
        return c ^ 0xFFFFFFFF
    }
}

private func le16(_ d: Data, _ o: Int) -> UInt16 {
    let i = d.startIndex + o
    return UInt16(d[i]) | (UInt16(d[i + 1]) << 8)
}

private func le32(_ d: Data, _ o: Int) -> UInt32 {
    let i = d.startIndex + o
    return UInt32(d[i]) | (UInt32(d[i + 1]) << 8) | (UInt32(d[i + 2]) << 16) | (UInt32(d[i + 3]) << 24)
}

private func le64(_ d: Data, _ o: Int) -> UInt64 {
    return UInt64(le32(d, o)) | (UInt64(le32(d, o + 4)) << 32)
}

private extension Data {
    mutating func putLE16(_ v: UInt16) {
        append(UInt8(v & 0xFF))
        append(UInt8((v >> 8) & 0xFF))
    }

    mutating func putLE32(_ v: UInt32) {
        putLE16(UInt16(v & 0xFFFF))
        putLE16(UInt16((v >> 16) & 0xFFFF))
    }
}

// MARK: - Reader

final class ZipReader {
    private let handle: FileHandle?
    private let memory: Data?
    private let length: UInt64
    let entries: [ZipEntry]

    /// Opens a zip file. The file stays open until the reader is released or `close()` is called.
    convenience init(url: URL) throws {
        let h = try FileHandle(forReadingFrom: url)
        let end: UInt64
        do {
            end = try h.seekToEnd()
        } catch {
            try? h.close()
            throw error
        }
        do {
            try self.init(handle: h, memory: nil, length: end)
        } catch {
            try? h.close()
            throw error
        }
    }

    /// Reads a zip held in memory.
    convenience init(data: Data) throws {
        try self.init(handle: nil, memory: data, length: UInt64(data.count))
    }

    private init(handle: FileHandle?, memory: Data?, length: UInt64) throws {
        self.handle = handle
        self.memory = memory
        self.length = length
        self.entries = try ZipReader.parse(length: length) { (offset: UInt64, count: Int) throws -> Data in
            return try ZipReader.readRange(handle: handle, memory: memory, offset: offset, count: count)
        }
    }

    deinit {
        try? handle?.close()
    }

    func close() {
        try? handle?.close()
    }

    func entry(named name: String) -> ZipEntry? {
        for e in entries where e.name == name { return e }
        return nil
    }

    // MARK: reading bytes

    private static func readRange(handle: FileHandle?, memory: Data?, offset: UInt64, count: Int) throws -> Data {
        if count < 0 { throw ZipError.corrupt }
        if let d = memory {
            guard offset <= UInt64(d.count), UInt64(count) <= UInt64(d.count) - offset else { throw ZipError.corrupt }
            let start = d.startIndex + Int(offset)
            return d.subdata(in: start..<(start + count))
        }
        guard let h = handle else { throw ZipError.corrupt }
        if count == 0 { return Data() }
        try h.seek(toOffset: offset)
        var out = Data()
        while out.count < count {
            guard let chunk = try h.read(upToCount: count - out.count), !chunk.isEmpty else { throw ZipError.corrupt }
            out.append(chunk)
        }
        return out
    }

    private func bytes(_ offset: UInt64, _ count: Int) throws -> Data {
        return try ZipReader.readRange(handle: handle, memory: memory, offset: offset, count: count)
    }

    // MARK: central directory

    private static func parse(length: UInt64, read: (UInt64, Int) throws -> Data) throws -> [ZipEntry] {
        if length < 22 { throw ZipError.notZip }
        let tailSize = Int(min(length, 65557))
        let tailStart = length - UInt64(tailSize)
        let tail = try read(tailStart, tailSize)
        var eocd = -1
        var i = tail.count - 22
        while i >= 0 {
            if le32(tail, i) == 0x06054B50 { eocd = i; break }
            i -= 1
        }
        if eocd < 0 { throw ZipError.notZip }

        var total = UInt64(le16(tail, eocd + 10))
        var cdSize = UInt64(le32(tail, eocd + 12))
        var cdOffset = UInt64(le32(tail, eocd + 16))
        let eocdAt = tailStart + UInt64(eocd)

        if total == 0xFFFF || cdSize == 0xFFFFFFFF || cdOffset == 0xFFFFFFFF {
            guard eocdAt >= 20 else { throw ZipError.corrupt }
            let loc = try read(eocdAt - 20, 20)
            guard le32(loc, 0) == 0x07064B50 else { throw ZipError.corrupt }
            let z64At = le64(loc, 8)
            let z64 = try read(z64At, 56)
            guard le32(z64, 0) == 0x06064B50 else { throw ZipError.corrupt }
            total = le64(z64, 32)
            cdSize = le64(z64, 40)
            cdOffset = le64(z64, 48)
        }
        if cdSize > 256 * 1024 * 1024 || cdOffset > length || cdSize > length - cdOffset { throw ZipError.corrupt }
        if total > 1_000_000 { throw ZipError.tooLarge }
        let cd = try read(cdOffset, Int(cdSize))

        var out: [ZipEntry] = []
        var pos = 0
        for _ in 0..<Int(total) {
            guard pos + 46 <= cd.count, le32(cd, pos) == 0x02014B50 else { throw ZipError.corrupt }
            let flags = le16(cd, pos + 8)
            let method = le16(cd, pos + 10)
            let time = le16(cd, pos + 12)
            let date = le16(cd, pos + 14)
            let crc = le32(cd, pos + 16)
            var csize = UInt64(le32(cd, pos + 20))
            var usize = UInt64(le32(cd, pos + 24))
            let nameLen = Int(le16(cd, pos + 28))
            let extraLen = Int(le16(cd, pos + 30))
            let commentLen = Int(le16(cd, pos + 32))
            var offset = UInt64(le32(cd, pos + 42))
            guard pos + 46 + nameLen + extraLen + commentLen <= cd.count else { throw ZipError.corrupt }
            let nameStart = cd.startIndex + pos + 46
            let nameData = cd.subdata(in: nameStart..<(nameStart + nameLen))
            let name = String(data: nameData, encoding: .utf8) ?? String(data: nameData, encoding: .isoLatin1) ?? ""

            // zip64 extra field: the 64-bit values of the fields that read 0xFFFFFFFF, in this order
            var x = pos + 46 + nameLen
            let xEnd = x + extraLen
            while x + 4 <= xEnd {
                let id = le16(cd, x)
                let size = Int(le16(cd, x + 2))
                var v = x + 4
                if id == 0x0001 && v + size <= xEnd {
                    if usize == 0xFFFFFFFF && v + 8 <= xEnd { usize = le64(cd, v); v += 8 }
                    if csize == 0xFFFFFFFF && v + 8 <= xEnd { csize = le64(cd, v); v += 8 }
                    if offset == 0xFFFFFFFF && v + 8 <= xEnd { offset = le64(cd, v); v += 8 }
                }
                x += 4 + size
            }
            out.append(ZipEntry(name: name, flags: flags, method: method, dosTime: time, dosDate: date, crc: crc,
                                compressedSize: csize, size: usize, localOffset: offset))
            pos += 46 + nameLen + extraLen + commentLen
        }
        return out
    }

    // MARK: entry data

    /// Where the entry's compressed bytes start (after its local header).
    private func dataStart(_ e: ZipEntry) throws -> UInt64 {
        let head = try bytes(e.localOffset, 30)
        guard le32(head, 0) == 0x04034B50 else { throw ZipError.corrupt }
        let n = UInt64(le16(head, 26))
        let m = UInt64(le16(head, 28))
        let start = e.localOffset + 30 + n + m
        guard start <= length, e.compressedSize <= length - start else { throw ZipError.corrupt }
        return start
    }

    /// The entry's bytes, inflated and checked against its checksum. `limit` caps the inflated size.
    func read(_ e: ZipEntry, limit: Int) throws -> Data {
        if (e.flags & 1) != 0 { throw ZipError.unsupported }
        if e.size > UInt64(limit) || e.compressedSize > UInt64(limit) { throw ZipError.tooLarge }
        if e.size == 0 { return Data() }
        let raw = try bytes(try dataStart(e), Int(e.compressedSize))
        var out: Data
        if e.method == 0 {
            guard raw.count == Int(e.size) else { throw ZipError.corrupt }
            out = raw
        } else if e.method == 8 {
            out = try ZipReader.inflate(raw, expected: Int(e.size))
        } else {
            throw ZipError.unsupported
        }
        if CRC32.checksum(out) != e.crc { throw ZipError.corrupt }
        return out
    }

    private static func inflate(_ raw: Data, expected: Int) throws -> Data {
        var out = Data(count: expected)
        let got: Int = out.withUnsafeMutableBytes { (dst: UnsafeMutableRawBufferPointer) -> Int in
            return raw.withUnsafeBytes { (src: UnsafeRawBufferPointer) -> Int in
                guard let d = dst.bindMemory(to: UInt8.self).baseAddress,
                      let s = src.bindMemory(to: UInt8.self).baseAddress else { return 0 }
                return compression_decode_buffer(d, expected, s, raw.count, nil, COMPRESSION_ZLIB)
            }
        }
        if got != expected { throw ZipError.corrupt }
        return out
    }

    /// Feeds the entry's compressed bytes, as stored, to `sink` in pieces (for a raw copy into another zip).
    func copyRaw(_ e: ZipEntry, chunk: Int = 1024 * 1024, to sink: (Data) throws -> Void) throws {
        if (e.flags & 1) != 0 { throw ZipError.unsupported }
        var at = try dataStart(e)
        var left = e.compressedSize
        while left > 0 {
            let n = Int(min(UInt64(chunk), left))
            try sink(try bytes(at, n))
            at += UInt64(n)
            left -= UInt64(n)
        }
    }
}

// MARK: - Writer

final class ZipWriter {
    private let handle: FileHandle
    private var offset: UInt64 = 0
    private var central = Data()
    private var count = 0
    private var finished = false

    /// Creates (or truncates) the file.
    init(url: URL) throws {
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else { throw ZipError.corrupt }
        handle = try FileHandle(forWritingTo: url)
    }

    private func put(_ d: Data) throws {
        try handle.write(contentsOf: d)
        offset += UInt64(d.count)
    }

    private func header(name: String, flags: UInt16, method: UInt16, time: UInt16, date: UInt16,
                        crc: UInt32, csize: UInt64, size: UInt64) throws -> Data {
        let nameData = Data(name.utf8)
        guard csize < 0xFFFFFFFF, size < 0xFFFFFFFF, offset < 0xFFFFFFFF, nameData.count < 0xFFFF, count < 0xFFFF else {
            throw ZipError.tooLarge
        }
        let f = (flags & 0x0800) | 0x0800   // names are written as UTF-8; no data descriptor, no encryption
        var local = Data()
        local.putLE32(0x04034B50)
        local.putLE16(20)
        local.putLE16(f)
        local.putLE16(method)
        local.putLE16(time)
        local.putLE16(date)
        local.putLE32(crc)
        local.putLE32(UInt32(csize))
        local.putLE32(UInt32(size))
        local.putLE16(UInt16(nameData.count))
        local.putLE16(0)
        local.append(nameData)

        var cd = Data()
        cd.putLE32(0x02014B50)
        cd.putLE16(20)
        cd.putLE16(20)
        cd.putLE16(f)
        cd.putLE16(method)
        cd.putLE16(time)
        cd.putLE16(date)
        cd.putLE32(crc)
        cd.putLE32(UInt32(csize))
        cd.putLE32(UInt32(size))
        cd.putLE16(UInt16(nameData.count))
        cd.putLE16(0)
        cd.putLE16(0)
        cd.putLE16(0)
        cd.putLE16(0)
        cd.putLE32(name.hasSuffix("/") ? 0x10 : 0)
        cd.putLE32(UInt32(offset))
        cd.append(nameData)
        central.append(cd)
        count += 1
        return local
    }

    static func dosNow() -> (time: UInt16, date: UInt16) {
        let c = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: Date())
        let year = max(1980, c.year ?? 1980) - 1980
        let date = UInt16(year << 9) | UInt16((c.month ?? 1) << 5) | UInt16(c.day ?? 1)
        let time = UInt16((c.hour ?? 0) << 11) | UInt16((c.minute ?? 0) << 5) | UInt16((c.second ?? 0) / 2)
        return (time, date)
    }

    /// A new entry, stored (not compressed). A name ending in "/" is a folder entry.
    func addStored(name: String, data: Data, dosTime: UInt16? = nil, dosDate: UInt16? = nil) throws {
        let now = ZipWriter.dosNow()
        let local = try header(name: name, flags: 0x0800, method: 0, time: dosTime ?? now.time, date: dosDate ?? now.date,
                               crc: CRC32.checksum(data), csize: UInt64(data.count), size: UInt64(data.count))
        try put(local)
        try put(data)
    }

    /// An entry of another zip, copied as it is (same name, method, checksum, sizes and times; the bytes are not inflated).
    func addRaw(_ e: ZipEntry, from reader: ZipReader) throws {
        let local = try header(name: e.name, flags: e.flags, method: e.method, time: e.dosTime, date: e.dosDate,
                               crc: e.crc, csize: e.compressedSize, size: e.size)
        try put(local)
        try reader.copyRaw(e) { (piece: Data) throws -> Void in
            try self.put(piece)
        }
    }

    /// Writes the directory, flushes to disk and closes. Call once.
    func finish() throws {
        guard !finished else { return }
        finished = true
        let cdAt = offset
        guard cdAt < 0xFFFFFFFF, UInt64(central.count) < 0xFFFFFFFF, count < 0xFFFF else { throw ZipError.tooLarge }
        try put(central)
        var end = Data()
        end.putLE32(0x06054B50)
        end.putLE16(0)
        end.putLE16(0)
        end.putLE16(UInt16(count))
        end.putLE16(UInt16(count))
        end.putLE32(UInt32(central.count))
        end.putLE32(UInt32(cdAt))
        end.putLE16(0)
        try put(end)
        try handle.synchronize()
        try handle.close()
    }

    /// Closes without writing a directory (the caller deletes the file).
    func abort() {
        finished = true
        try? handle.close()
    }
}
