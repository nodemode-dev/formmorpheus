// The brush libraries as files in the engine's data folder: Brushes/<Library>/<Set>/<Brush>.brush (see
// backend/app/routers/brushes.py). A file is the app's own .brush export plus a `formmorpheus/` folder inside
// the zip that keeps what the format cannot (the exact settings, the tip and grain pixels). This module keeps a
// picture of what is on disk and, given what the store wants, makes the smallest set of calls to match it:
// create, rename, move, write and delete, then the small order files. Starter brushes have no file until edited.

import { unzipSync, zipSync } from 'fflate';
import { exportBrush } from '../io/brush-export';
import { brushById } from '../paint/brushes';
import { brushThumb } from './brush-thumb';
import { t } from './i18n';
import { toast } from './toast';

/** What a file's `formmorpheus/brush.json` holds; `kind` says whether the brush is built in (an edited starter). */
export interface BrushMeta {
  v: 1;
  id: string;
  kind: 'custom' | 'starter';
  name?: string;
  /** custom: every field of the brush except its pixels. */
  brush?: Record<string, unknown>;
  tipImage?: { w: number; h: number; key: string };
  grain?: boolean;
  /** starter: the edits over the built-in brush. */
  tweaks?: Record<string, unknown>;
}

export interface TreeFile { file: string; meta: BrushMeta | null }
export interface TreeSet { id: string; dir: string; ids: string[]; files: TreeFile[] }
export interface TreeLib { id: string; dir: string; sets: TreeSet[] }
export interface Tree { folder: string; fresh: boolean; legacy: boolean; active: string | null; deleted: string[]; libs: TreeLib[] }

/** What the store wants on disk. `brushes` holds only the brushes that need a file. */
export interface Want {
  libs: { id: string; name: string }[];
  sets: { id: string; name: string; lib: string; ids: string[] }[];
  active: string;
  deleted: string[];
  brushes: Map<string, { name: string; meta: BrushMeta }>;
}

const EXT = '.brush';
const BAD = /[\\/:*?"<>|\x00-\x1f]/g;
/** Device names Windows reserves, on the part before the first dot. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const enc = new TextEncoder();
const dec = new TextDecoder();
/** Longest segment: the engine refuses a path over 240 characters, so three segments share what the data folder leaves. */
let segMax = 100;

/** One safe path segment from a name (the engine checks the same rules). */
export function cleanSegment(name: string, fallback: string): string {
  const strip = (x: string): string => x.trim().replace(/^[.\s]+|[.\s]+$/g, '');
  let s = strip(name.replace(BAD, '-'));
  const stem = s.split('.')[0].trimEnd();
  if (RESERVED.test(stem)) s = `${stem} brush${s.slice(stem.length)}`;
  s = strip(s.slice(0, segMax));
  return s || fallback;
}

class ApiError extends Error {}

async function call(method: string, path: string, body?: unknown, raw?: Uint8Array): Promise<Response> {
  const init: RequestInit = { method };
  if (raw) { init.body = raw as unknown as BodyInit; init.headers = { 'Content-Type': 'application/zip' }; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
  const r = await fetch(`/api/brushes${path}`, init);
  if (!r.ok) {
    let detail = r.statusText;
    try { detail = ((await r.json()) as { detail?: string }).detail ?? detail; } catch { /* keep the status text */ }
    throw new ApiError(`${method} ${path}: ${detail}`);
  }
  return r;
}

const q = (o: Record<string, string>): string => `?${new URLSearchParams(o).toString()}`;

interface Snap {
  libs: Map<string, string>;
  sets: Map<string, { lib: string; dir: string }>;
  files: Map<string, { set: string; file: string; sig: string }>;
  orders: Map<string, string>;
}

const emptySnap = (): Snap => ({ libs: new Map(), sets: new Map(), files: new Map(), orders: new Map() });

/** A name for each key: its current one when still right, else the wanted one numbered until free. */
function assign(items: { key: string; want: string; cur?: string }[], ext = '', reserved: Iterable<string> = []): Map<string, string> {
  // `reserved`: names already in the folder that are not ours (made elsewhere), so no wanted name lands on one
  const out = new Map<string, string>(), taken = new Set<string>(Array.from(reserved, (n) => (ext && n.endsWith(ext) ? n.slice(0, -ext.length) : n).toLowerCase()));
  const stem = (n: string): string => (ext && n.endsWith(ext) ? n.slice(0, -ext.length) : n);
  const rest: typeof items = [];
  for (const it of items) {
    const cur = it.cur ? stem(it.cur) : '';
    const ok = cur && (cur === it.want || (cur.startsWith(`${it.want} `) && /^\d+$/.test(cur.slice(it.want.length + 1))));
    if (ok && !taken.has(cur.toLowerCase())) { out.set(it.key, it.cur!); taken.add(cur.toLowerCase()); } else rest.push(it);
  }
  for (const it of rest) {
    let n = it.want, i = 2;
    while (taken.has(n.toLowerCase())) n = `${it.want} ${i++}`;
    taken.add(n.toLowerCase());
    out.set(it.key, n + ext);
  }
  return out;
}

interface Move { fromKey: string; toKey: string; run(): Promise<void>; park(): Promise<string> }

/** Runs moves whose target is free; when only a cycle is left (two names swapping) one goes aside first. */
async function settle(moves: Move[], occ: Set<string>): Promise<void> {
  let list = moves;
  let parks = 0;
  while (list.length) {
    const ready = list.filter((m) => !occ.has(m.toKey));
    if (!ready.length) {
      // a target held by something that is not moving never frees: stop instead of setting names aside forever
      if (++parks > moves.length + 2) throw new ApiError('A name could not be freed.');
      const m = list[0];
      occ.delete(m.fromKey);
      m.fromKey = await m.park();
      occ.add(m.fromKey);
      continue;
    }
    for (const m of ready) { await m.run(); occ.delete(m.fromKey); occ.add(m.toKey); }
    list = list.filter((m) => !ready.includes(m));
  }
}

const tmpName = (): string => `moving-${Math.random().toString(36).slice(2, 10)}`;

type Foreign = (setId: string, file: string) => string | undefined;

export class BrushDisk {
  folder = '';
  private snap: Snap | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private getter: (() => Want) | null = null;
  /** Everything this window has seen on disk or made: only these are ever deleted, so another window's files are safe. */
  private readonly known = { libs: new Set<string>(), sets: new Set<string>(), files: new Set<string>() };
  private foreignOf: Foreign = () => undefined;
  /** Another window changed the folder: read it again before the next pass. */
  private stale = false;
  private fails = 0;
  private retryTimer = 0;
  private toasted = false;
  private readonly chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fm-brush-disk') : null;

  constructor() {
    if (this.chan) this.chan.onmessage = () => { this.stale = true; };
  }

  async tree(): Promise<Tree> {
    const t = (await (await call('GET', '/tree')).json()) as Tree;
    this.folder = t.folder;
    // three segments, three separators and the extension share what the engine's 240-character path limit leaves
    segMax = Math.max(20, Math.min(100, Math.floor((224 - t.folder.length) / 3)));
    return t;
  }

  async legacy(): Promise<unknown> { return (await call('GET', '/legacy')).json(); }

  /** A picture of the folder. A file with no id of its own and no import gets a stand-in id so its name still counts as taken. */
  private build(t: Tree, foreign: Foreign): Snap {
    const s = emptySnap();
    for (const l of t.libs) {
      s.libs.set(l.id, l.dir);
      for (const st of l.sets) {
        s.sets.set(st.id, { lib: l.id, dir: st.dir });
        for (const f of st.files) {
          const id = f.meta?.id ?? foreign(st.id, f.file) ?? `\0${st.id}/${f.file}`;
          s.files.set(id, { set: st.id, file: f.file, sig: f.meta ? JSON.stringify(f.meta) : '' });
        }
      }
    }
    return s;
  }

  /** Takes the tree as what is on disk now; `foreign` gives the id of a file made elsewhere once it was imported. */
  attach(t: Tree, foreign: Foreign): void {
    this.foreignOf = foreign;
    const s = this.build(t, foreign);
    this.snap = s;
    this.stale = false;
    for (const k of s.libs.keys()) this.known.libs.add(k);
    for (const k of s.sets.keys()) this.known.sets.add(k);
    for (const k of s.files.keys()) this.known.files.add(k);
  }

  /** The file of a brush: its settings and, when asked for, the pixels. Null when it has no file. */
  async read(id: string): Promise<{ meta: BrushMeta | null; tip?: Uint8Array; grain?: Uint8Array } | null> {
    const s = this.snap, f = s?.files.get(id);
    if (!s || !f) return null;
    const bytes = await this.fetchFile(f.set, f.file);
    if (!bytes) return null;
    const parts = unzipSync(bytes, { filter: (x) => x.name.startsWith('formmorpheus/') });
    const j = parts['formmorpheus/brush.json'];
    return { meta: j ? (JSON.parse(dec.decode(j)) as BrushMeta) : null, tip: parts['formmorpheus/tip.bin'], grain: parts['formmorpheus/grain.bin'] };
  }

  async fetchFile(setId: string, file: string): Promise<Uint8Array | null> {
    const s = this.snap, st = s?.sets.get(setId), lib = st && s?.libs.get(st.lib);
    if (!st || !lib) return null;
    return this.fetchAt(lib, st.dir, file);
  }

  /** A file by its folder names (a file made elsewhere has no id yet). */
  async fetchAt(lib: string, set: string, file: string): Promise<Uint8Array | null> {
    try { return new Uint8Array(await (await call('GET', `/file${q({ lib, set, file })}`)).arrayBuffer()); } catch { return null; }
  }

  /** The old single-file store is kept under a new name once its content lives in the folder. */
  async markMigrated(): Promise<void> { await call('POST', '/migrated'); }

  /** Writes everything for the first time from an old store, then renames the old file. */
  async migrate(get: () => Want): Promise<void> {
    await this.running?.catch(() => undefined);
    await call('POST', '/clear');
    this.snap = emptySnap();
    await this.sync(get);
    await call('POST', '/migrated');
  }

  /**
   * Makes the disk match what the store wants; calls that arrive meanwhile are folded into one more pass.
   * Passes of every window of the app take turns (a Web Lock), and a failed pass backs off, says so once, and gives up after a few tries.
   */
  sync(get: () => Want): Promise<void> {
    this.getter = get;
    if (this.running) { this.again = true; return this.running; }
    window.clearTimeout(this.retryTimer);
    const work = async (): Promise<void> => { do { this.again = false; await this.run(this.getter!()); } while (this.again); };
    this.running = (async () => {
      try {
        const locks = (navigator as unknown as { locks?: { request(name: string, cb: () => Promise<void>): Promise<void> } }).locks;
        await (locks ? locks.request('fm-brush-disk', work) : work());
        this.fails = 0;
        this.toasted = false;
        this.chan?.postMessage(1);
      } catch (e) {
        this.snap = null;   // rebuilt from the folder next time
        this.fails++;
        if (!this.toasted) { this.toasted = true; toast(t('The brush library could not be saved to its folder. Trying again.'), 'error'); }
        if (this.fails <= 6) this.retryTimer = window.setTimeout(() => { this.sync(this.getter!).catch(() => undefined); }, Math.min(60_000, 2000 * 2 ** (this.fails - 1)));
        throw e;
      } finally { this.running = null; }
    })();
    return this.running;
  }

  private async run(want: Want): Promise<void> {
    if (!this.snap || this.stale) {
      const t = await this.tree();
      this.snap = this.build(t, this.foreignOf);
      this.stale = false;
    }
    const snap = this.snap!;
    const wantLib = new Map(want.libs.map((l) => [l.id, l]));
    const wantSet = new Map(want.sets.map((s) => [s.id, s]));
    // what the store wants and the folder already has is this window's now
    for (const l of want.libs) if (snap.libs.has(l.id)) this.known.libs.add(l.id);
    for (const s of want.sets) if (snap.sets.has(s.id)) this.known.sets.add(s.id);
    for (const id of want.brushes.keys()) if (snap.files.has(id)) this.known.files.add(id);

    // 0. What this window knew and the store dropped goes (never what another window made); a folder that still holds a wanted brush or set is set aside until it is empty.
    const parked: { kind: 'lib' | 'set'; id: string }[] = [];
    for (const [id, f] of Array.from(snap.files)) {
      if (want.brushes.has(id) || id.startsWith('\0') || !this.known.files.has(id)) continue;
      const st = snap.sets.get(f.set), lib = st && snap.libs.get(st.lib);
      if (st && lib) await call('DELETE', `/item${q({ kind: 'brush', lib, set: st.dir, file: f.file })}`);
      snap.files.delete(id);
      this.known.files.delete(id);
    }
    const holdsWanted = (setId: string): boolean => Array.from(snap.files).some(([id, f]) => f.set === setId && want.brushes.has(id));
    const holdsAny = (setId: string): boolean => Array.from(snap.files.values()).some((f) => f.set === setId);
    for (const [sid, st] of Array.from(snap.sets)) {
      if (wantSet.has(sid) && wantLib.has(wantSet.get(sid)!.lib) === true) continue;
      if (wantSet.has(sid) || holdsWanted(sid)) continue;   // moves out below; its old folder is dealt with after
      if (!this.known.sets.has(sid) || holdsAny(sid)) continue;   // another window's, or still holding its brushes
      const lib = snap.libs.get(st.lib);
      if (lib) await call('DELETE', `/item${q({ kind: 'set', lib, set: st.dir })}`);
      snap.sets.delete(sid);
      this.known.sets.delete(sid);
    }
    for (const [lid, dir] of Array.from(snap.libs)) {
      if (wantLib.has(lid) || !this.known.libs.has(lid)) continue;
      const inside = Array.from(snap.sets).filter(([, s]) => s.lib === lid);
      if (inside.some(([sid]) => wantSet.has(sid) || holdsWanted(sid))) {
        const tmp = tmpName();
        await call('POST', '/rename', { kind: 'lib', lib: dir, to: tmp });
        snap.libs.set(lid, tmp);
        parked.push({ kind: 'lib', id: lid });
        continue;
      }
      if (inside.length) continue;   // sets made elsewhere stay, and so does their library
      await call('DELETE', `/item${q({ kind: 'lib', lib: dir })}`);
      snap.libs.delete(lid);
      this.known.libs.delete(lid);
    }
    // A removed set whose lib stays but which holds a wanted brush or set: set it aside under a plain name.
    for (const [sid, st] of Array.from(snap.sets)) {
      if (wantSet.has(sid) || !holdsWanted(sid)) continue;
      const lib = snap.libs.get(st.lib);
      if (!lib) continue;
      const tmp = tmpName();
      await call('POST', '/rename', { kind: 'set', lib, set: st.dir, to: tmp });
      st.dir = tmp;
      parked.push({ kind: 'set', id: sid });
    }

    // 1. Library folders: rename, then create the new ones.
    const libDir = assign(want.libs.map((l) => ({ key: l.id, want: cleanSegment(l.name, 'Library'), cur: snap.libs.get(l.id) })), '',
      Array.from(snap.libs).filter(([id]) => !wantLib.has(id)).map(([, d]) => d));
    const occL = new Set(Array.from(snap.libs.values(), (d) => d.toLowerCase()));
    const libMoves: Move[] = [];
    for (const l of want.libs) {
      const cur = snap.libs.get(l.id), to = libDir.get(l.id)!;
      if (!cur || cur === to) continue;
      let from = cur;
      libMoves.push({
        fromKey: cur.toLowerCase(), toKey: to.toLowerCase(),
        run: async () => { await call('POST', '/rename', { kind: 'lib', lib: from, to }); snap.libs.set(l.id, to); },
        park: async () => { const t = tmpName(); await call('POST', '/rename', { kind: 'lib', lib: from, to: t }); from = t; snap.libs.set(l.id, t); return t.toLowerCase(); },
      });
    }
    await settle(libMoves, occL);
    for (const l of want.libs) {
      if (snap.libs.has(l.id)) continue;
      const dir = libDir.get(l.id)!;
      await call('POST', '/dir', { lib: dir });
      snap.libs.set(l.id, dir);
      this.known.libs.add(l.id);
    }

    // 2. Set folders: per library numbering, then move or rename, then create.
    const setDir = new Map<string, string>();
    for (const l of want.libs) {
      const mine = want.sets.filter((s) => s.lib === l.id);
      const names = assign(mine.map((s) => ({ key: s.id, want: cleanSegment(s.name, 'Set'), cur: snap.sets.get(s.id)?.lib === l.id ? snap.sets.get(s.id)!.dir : undefined })), '',
        Array.from(snap.sets).filter(([id, s]) => s.lib === l.id && !wantSet.has(id)).map(([, s]) => s.dir));
      for (const [k, v] of names) setDir.set(k, v);
    }
    const occS = new Set(Array.from(snap.sets.values(), (s) => `${snap.libs.get(s.lib)}|${s.dir}`.toLowerCase()));
    const setMoves: Move[] = [];
    for (const st of want.sets) {
      const cur = snap.sets.get(st.id);
      if (!cur) continue;
      const toDir = setDir.get(st.id)!, toLib = libDir.get(st.lib)!;
      if (cur.lib === st.lib && cur.dir === toDir) continue;
      setMoves.push({
        fromKey: `${snap.libs.get(cur.lib)}|${cur.dir}`.toLowerCase(), toKey: `${toLib}|${toDir}`.toLowerCase(),
        run: async () => {
          await call('POST', '/move', { kind: 'set', lib: snap.libs.get(cur.lib), set: cur.dir, toLib, to: toDir });
          cur.lib = st.lib; cur.dir = toDir;
        },
        park: async () => {
          const t = tmpName();
          await call('POST', '/rename', { kind: 'set', lib: snap.libs.get(cur.lib), set: cur.dir, to: t });
          cur.dir = t;
          return `${snap.libs.get(cur.lib)}|${t}`.toLowerCase();
        },
      });
    }
    await settle(setMoves, occS);
    for (const st of want.sets) {
      if (snap.sets.has(st.id)) continue;
      const dir = setDir.get(st.id)!;
      await call('POST', '/dir', { lib: libDir.get(st.lib), set: dir });
      snap.sets.set(st.id, { lib: st.lib, dir });
      this.known.sets.add(st.id);
    }

    // 3. Brush files: numbering per set, then move or rename, then write what changed.
    const setOfBrush = new Map<string, string>();
    for (const s of want.sets) for (const id of s.ids) if (want.brushes.has(id)) setOfBrush.set(id, s.id);
    const fileName = new Map<string, string>();
    for (const s of want.sets) {
      const mine = s.ids.filter((id) => want.brushes.has(id));
      const names = assign(mine.map((id) => ({ key: id, want: cleanSegment(want.brushes.get(id)!.name, 'Brush'), cur: snap.files.get(id)?.set === s.id ? snap.files.get(id)!.file : undefined })), EXT,
        Array.from(snap.files).filter(([id, f]) => f.set === s.id && !want.brushes.has(id)).map(([, f]) => f.file));
      for (const [k, v] of names) fileName.set(k, v);
    }
    const dirOf = (setId: string): { lib: string; set: string } => { const st = snap.sets.get(setId)!; return { lib: snap.libs.get(st.lib)!, set: st.dir }; };
    const occF = new Set(Array.from(snap.files.values(), (f) => { const d = dirOf(f.set); return `${d.lib}|${d.set}|${f.file}`.toLowerCase(); }));
    const fileMoves: Move[] = [];
    for (const [id, f] of snap.files) {
      const toSet = setOfBrush.get(id), toFile = fileName.get(id);
      if (!toSet || !toFile || (f.set === toSet && f.file === toFile)) continue;
      const key = (set: string, file: string): string => { const d = dirOf(set); return `${d.lib}|${d.set}|${file}`.toLowerCase(); };
      fileMoves.push({
        fromKey: key(f.set, f.file), toKey: key(toSet, toFile),
        run: async () => {
          const a = dirOf(f.set), b = dirOf(toSet);
          await call('POST', '/move', { kind: 'brush', lib: a.lib, set: a.set, file: f.file, toLib: b.lib, toSet: b.set, to: toFile });
          f.set = toSet; f.file = toFile;
        },
        park: async () => {
          const a = dirOf(f.set), t = `${tmpName()}${EXT}`;
          await call('POST', '/rename', { kind: 'brush', lib: a.lib, set: a.set, file: f.file, to: t });
          f.file = t;
          return key(f.set, t);
        },
      });
    }
    await settle(fileMoves, occF);
    for (const [id, w] of want.brushes) {
      const setId = setOfBrush.get(id), name = fileName.get(id);
      if (!setId || !name) continue;
      const sig = JSON.stringify(w.meta), have = snap.files.get(id);
      if (have && have.sig === sig) continue;
      const bytes = await packBrush(id, w.meta);
      if (!bytes) continue;
      const d = dirOf(setId);
      await call('PUT', `/file${q({ lib: d.lib, set: d.set, file: name, ...(have ? { replace: '1' } : {}) })}`, undefined, bytes);
      snap.files.set(id, { set: setId, file: name, sig });
      this.known.files.add(id);
    }

    // 4. Set-aside folders are empty of anything wanted now (sets first, then their libraries); one that still holds something made elsewhere stays.
    for (const p of parked.slice().sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'set' ? -1 : 1))) {
      if (p.kind === 'set') {
        const st = snap.sets.get(p.id);
        if (st && !wantSet.has(p.id) && !holdsAny(p.id)) { await call('DELETE', `/item${q({ kind: 'set', lib: snap.libs.get(st.lib)!, set: st.dir })}`); snap.sets.delete(p.id); this.known.sets.delete(p.id); }
      } else if (!wantLib.has(p.id)) {
        const dir = snap.libs.get(p.id);
        if (Array.from(snap.sets.values()).some((s) => s.lib === p.id)) continue;
        if (dir) await call('DELETE', `/item${q({ kind: 'lib', lib: dir })}`);
        snap.libs.delete(p.id);
        this.known.libs.delete(p.id);
      }
    }

    // 5. Order files: sets inside a library, brush ids inside a set, then the libraries.
    const put = async (key: string, payload: Record<string, unknown>): Promise<void> => {
      const text = JSON.stringify(payload);
      if (snap.orders.get(key) === text) return;
      await call('PUT', '/order', payload);
      snap.orders.set(key, text);
    };
    // Each order file is written whole, so what another window put on disk is kept in it after our own entries.
    for (const s of want.sets) {
      const others = Array.from(snap.files).filter(([id, f]) => f.set === s.id && !s.ids.includes(id) && !id.startsWith('\0')).map(([id]) => id);
      await put(`set:${s.id}`, { level: 'set', lib: libDir.get(s.lib), set: setDir.get(s.id), ids: [...s.ids, ...others] });
    }
    for (const l of want.libs) {
      const others = Array.from(snap.sets).filter(([id, st]) => st.lib === l.id && !wantSet.has(id)).map(([id, st]) => ({ id, dir: st.dir }));
      await put(`lib:${l.id}`, { level: 'lib', lib: libDir.get(l.id), items: [...want.sets.filter((s) => s.lib === l.id).map((s) => ({ id: s.id, dir: setDir.get(s.id)! })), ...others] });
    }
    const otherLibs = Array.from(snap.libs).filter(([id]) => !wantLib.has(id)).map(([id, dir]) => ({ id, dir }));
    await put('root', { level: 'root', items: [...want.libs.map((l) => ({ id: l.id, dir: libDir.get(l.id)! })), ...otherLibs], active: want.active, deleted: want.deleted });
  }
}

/** The file for one brush: the app's .brush export with the exact settings and pixels added inside. */
async function packBrush(id: string, meta: BrushMeta): Promise<Uint8Array | null> {
  const b = brushById(id);
  if (!b) return null;
  let files: Record<string, Uint8Array> = {};
  try { files = unzipSync(exportBrush(b, await brushThumb(b).catch(() => null))); } catch { files = {}; }
  files['formmorpheus/brush.json'] = enc.encode(JSON.stringify(meta));
  if (b.tipImage && meta.tipImage) files['formmorpheus/tip.bin'] = b.tipImage.data;
  if (b.grainImage && meta.grain) files['formmorpheus/grain.bin'] = b.grainImage;
  return zipSync(files, { level: 0 });
}
