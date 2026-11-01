// The files of a drop, with any dropped folder walked into its files (a folder of numbered pictures arrives as them).
// The entries must be taken from the event before the first await; the event's data is gone after that.

interface FsEntry { isFile: boolean; isDirectory: boolean; name: string; file?: (ok: (f: File) => void, no: (e: unknown) => void) => void; createReader?: () => { readEntries(ok: (a: FsEntry[]) => void, no: (e: unknown) => void): void } }

const MAX_FILES = 2000;

async function walk(e: FsEntry, out: File[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  if (e.isFile && e.file) { try { out.push(await new Promise<File>((ok, no) => e.file!(ok, no))); } catch { /* unreadable: skipped */ } return; }
  if (!e.isDirectory || !e.createReader) return;
  const rd = e.createReader();
  for (;;) {
    const batch = await new Promise<FsEntry[]>((ok, no) => rd.readEntries(ok, no)).catch(() => [] as FsEntry[]);
    if (!batch.length) return;
    for (const c of batch) await walk(c, out);
    if (out.length >= MAX_FILES) return;
  }
}

export async function filesOfDrop(dt: DataTransfer | null): Promise<File[]> {
  if (!dt) return [];
  const plain = Array.from(dt.files);
  const entries = Array.from(dt.items ?? []).map((i) => (i.kind === 'file' ? (i as unknown as { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.() ?? null : null));
  if (!entries.some((e) => e?.isDirectory)) return plain;
  const out: File[] = [];
  for (const e of entries) if (e) await walk(e, out);
  return out.length ? out.filter((f) => !f.name.startsWith('.')) : plain;
}
