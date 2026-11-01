// Read-only look inside a project file from another animation app whose format is not documented. It reports the
// container (zip, binary plist or unknown) and, for a zip, lists the entry names and lifts out only the entries that
// are plain media files, told by their first bytes. It never interprets a timeline, a document plist or a drawing.
import { safeUnzip } from './safe-unzip';

export type ProjectContainer = 'zip' | 'bplist' | 'unknown';
export type FoundKind = 'picture' | 'video' | 'sound';

export interface FoundMedia {
  /** The entry's path inside the container. */
  entry: string;
  kind: FoundKind;
  file: File;
}

export interface ProjectSniff {
  container: ProjectContainer;
  /** Every entry name of a zip (folders included), in archive order; empty for the other containers. */
  entries: string[];
  media: FoundMedia[];
  /** Plain media entries left out because there were more than the cap. */
  extra: number;
}

/** A project file larger than this is not read into memory at all. */
export const SNIFF_FILE_MAX = 1536 * 1024 * 1024;
/** Per entry and in all, bytes unpacked; tighter than the general archive caps because only media is wanted. */
const ENTRY_MAX = 256 * 1024 * 1024;
const TOTAL_MAX = 1024 * 1024 * 1024;
const MEDIA_MAX = 200;
/** Entry names kept for the report; a zip with millions of entries must not grow the list without end. */
const ENTRY_NAMES_MAX = 20000;

const ascii = (b: Uint8Array, at: number, s: string): boolean => {
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
};

/** What a run of bytes is when it is a plain media file, by signature alone; null for anything else. */
export function mediaKind(b: Uint8Array): { kind: FoundKind; ext: string; mime: string } | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && ascii(b, 1, 'PNG')) return { kind: 'picture', ext: 'png', mime: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'picture', ext: 'jpg', mime: 'image/jpeg' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return { kind: 'sound', ext: 'wav', mime: 'audio/wav' };
  if (ascii(b, 4, 'ftyp')) {
    if (ascii(b, 8, 'M4A ') || ascii(b, 8, 'M4B ')) return { kind: 'sound', ext: 'm4a', mime: 'audio/mp4' };
    if (['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'].some((x) => ascii(b, 8, x))) return { kind: 'picture', ext: 'heic', mime: 'image/heic' };
    if (ascii(b, 8, 'qt  ')) return { kind: 'video', ext: 'mov', mime: 'video/quicktime' };
    return { kind: 'video', ext: 'mp4', mime: 'video/mp4' };
  }
  if (ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return { kind: 'sound', ext: 'mp3', mime: 'audio/mpeg' };
  return null;
}

const leaf = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

export async function sniffProject(file: File): Promise<ProjectSniff> {
  const none: ProjectSniff = { container: 'unknown', entries: [], media: [], extra: 0 };
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (ascii(head, 0, 'bplist00')) return { ...none, container: 'bplist' };
  if (!(head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5 || head[2] === 7))) return none;
  if (file.size > SNIFF_FILE_MAX) throw new Error(`${file.name} is too large to look inside.`);
  const entries: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    // names are collected as the archive is walked; folders and empty or oversized entries are not unpacked
    files = safeUnzip(new Uint8Array(await file.arrayBuffer()), {
      entry: ENTRY_MAX, total: TOTAL_MAX,
      only: (f) => { if (entries.length < ENTRY_NAMES_MAX) entries.push(f.name); return !f.name.endsWith('/') && f.originalSize >= 12 && f.originalSize <= ENTRY_MAX; },
    });
  } catch (e) {
    if (e instanceof Error && /too large|too many|unpacks to more/.test(e.message)) throw e;
    return none;
  }
  const media: FoundMedia[] = [];
  let extra = 0;
  const seen = new Set<string>();
  for (const [entry, bytes] of Object.entries(files)) {
    const k = mediaKind(bytes);
    if (!k) continue;
    if (media.length >= MEDIA_MAX) { extra++; continue; }
    // the leaf name is all that is kept; a path inside the archive never reaches the movie
    let name = leaf(entry).replace(/[\\/:*?"<>|]/g, '_') || `item.${k.ext}`;
    if (!/\.[A-Za-z0-9]{2,5}$/.test(name)) name += `.${k.ext}`;
    while (seen.has(name.toLowerCase())) name = name.replace(/(\.[^.]+)?$/, (x) => `-2${x}`);
    seen.add(name.toLowerCase());
    media.push({ entry, kind: k.kind, file: new File([bytes as Uint8Array<ArrayBuffer>], name, { type: k.mime }) });
  }
  return { container: 'zip', entries, media, extra };
}
