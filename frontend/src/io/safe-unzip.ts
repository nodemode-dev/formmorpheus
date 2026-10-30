// unzipSync with size caps, for archives that come from outside (OpenRaster, Krita, round-trip bundles, brush
// archives). fflate sizes each entry's output buffer from the size the archive declares, so refusing by the declared
// size before inflating bounds the memory; an archive that lies about a size only gets that entry cut short.
import { unzipSync, type Unzipped, type UnzipFileInfo } from 'fflate';

export interface UnzipLimits {
  /** Largest uncompressed size of one entry, bytes. */
  entry?: number;
  /** Largest uncompressed total of the entries read, bytes. */
  total?: number;
  /** Largest number of entries. */
  count?: number;
  /** Which entries to read (the others are skipped and do not count toward the caps). */
  only?: (f: UnzipFileInfo) => boolean;
}

export const UNZIP_ENTRY_MAX = 512 * 1024 * 1024;
export const UNZIP_TOTAL_MAX = 1536 * 1024 * 1024;
const mb = (n: number): string => `${Math.round(n / 1048576)} MB`;

class LimitError extends Error {}

/** safeUnzip, with any failure other than a cap turned into this message (a cap keeps its own, more useful one). */
export function safeUnzipOr(bytes: Uint8Array, unreadable: string, limits: UnzipLimits = {}): Unzipped {
  try { return safeUnzip(bytes, limits); } catch (e) { throw e instanceof LimitError ? e : new Error(unreadable); }
}

export function safeUnzip(bytes: Uint8Array, limits: UnzipLimits = {}): Unzipped {
  const entry = limits.entry ?? UNZIP_ENTRY_MAX;
  const total = limits.total ?? UNZIP_TOTAL_MAX;
  const count = limits.count ?? 20000;
  let sum = 0;
  let n = 0;
  return unzipSync(bytes, {
    filter: (f) => {
      if (limits.only && !limits.only(f)) return false;
      if (++n > count) throw new LimitError('This archive holds too many files.');
      if (f.originalSize > entry) throw new LimitError(`A file inside this archive is too large (over ${mb(entry)} unpacked).`);
      sum += f.originalSize;
      if (sum > total) throw new LimitError(`This archive unpacks to more than ${mb(total)}, so it was not opened.`);
      return true;
    },
  });
}
