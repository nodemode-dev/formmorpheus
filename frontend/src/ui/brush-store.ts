// The person's brush library: which sets exist and their order, renamed and edited starter brushes,
// duplicates, imported brushes. It is kept in the engine's data folder (GET and PUT /api/brushes) because
// imported tips run to megabytes, the file follows the person across browsers and the desktop app, and a
// cleared browser profile cannot lose it. IndexedDB holds a copy so the library still loads when the engine
// is not answering. paint/brushes.ts keeps the live lookup that strokes read.

import { BRUSHES, BRUSH_SETS, brushById, registerBrush, starterBrush, unregisterBrush } from '../paint/brushes';
import type { Brush } from '../paint/types';

export interface BrushSet { id: string; name: string; ids: string[] }

interface SavedBrush extends Omit<Brush, 'tipImage' | 'grainImage'> {
  tipImage?: { w: number; h: number; key: string; data: string };
  grainImage?: string;
}

interface Saved {
  v: 1;
  sets: BrushSet[];
  custom: Record<string, SavedBrush>;
  names: Record<string, string>;
  tweaks: Record<string, Partial<Brush>>;
  deleted: string[];
}

export const IMPORTED_ID = 'imported';
const IDB_NAME = 'formmorpheus-brushes', IDB_STORE = 'library', IDB_KEY = 'main';

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'set';
const uid = (p: string): string => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

function toB64(d: Uint8Array): string {
  let s = '';
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const b = atob(s), out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function pack(b: Brush): SavedBrush {
  const { tipImage, grainImage, ...rest } = b;
  const out: SavedBrush = { ...rest };
  if (tipImage) out.tipImage = { w: tipImage.w, h: tipImage.h, key: tipImage.key, data: toB64(tipImage.data) };
  if (grainImage) out.grainImage = toB64(grainImage);
  return out;
}

function unpack(s: SavedBrush): Brush | null {
  try {
    const { tipImage, grainImage, ...rest } = s;
    const b: Brush = { ...(rest as Brush) };
    if (tipImage) {
      const data = fromB64(tipImage.data);
      if (data.length !== tipImage.w * tipImage.h) return null;
      b.tipImage = { w: tipImage.w, h: tipImage.h, key: tipImage.key, data };
    }
    if (grainImage) { const g = fromB64(grainImage); if (g.length === 65536) b.grainImage = g; }
    return b;
  } catch { return null; }
}

function defaults(): Saved {
  const sets: BrushSet[] = BRUSH_SETS.map((n) => ({ id: slug(n), name: n, ids: BRUSHES.filter((b) => b.set === n).map((b) => b.id) }));
  sets.push({ id: IMPORTED_ID, name: 'Imported', ids: [] });
  return { v: 1, sets, custom: {}, names: {}, tweaks: {}, deleted: [] };
}

function idbOpen(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function idbGet(): Promise<unknown> {
  const d = await idbOpen();
  if (!d) return null;
  return new Promise((resolve) => {
    try { const r = d.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); } catch { resolve(null); }
  });
}
async function idbPut(text: string): Promise<void> {
  const d = await idbOpen();
  if (!d) return;
  await new Promise<void>((resolve) => {
    try { const t = d.transaction(IDB_STORE, 'readwrite'); t.objectStore(IDB_STORE).put(text, IDB_KEY); t.oncomplete = () => resolve(); t.onerror = () => resolve(); } catch { resolve(); }
  });
}

class BrushStore {
  private st: Saved = defaults();
  private readonly custom = new Map<string, Brush>();
  private readonly revs = new Map<string, number>();
  private readonly subs = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private timer = 0;
  loaded = false;
  /** False once a save failed in both places. */
  kept = true;

  constructor() { this.rebuildAll(); }

  /** Loads the saved library once; safe to call again. */
  load(): Promise<void> { return (this.loading ??= this.doLoad()); }

  subscribe(fn: () => void): () => void { this.subs.add(fn); return () => { this.subs.delete(fn); }; }

  sets(): readonly BrushSet[] { return this.st.sets; }
  set(id: string): BrushSet | undefined { return this.st.sets.find((s) => s.id === id); }
  setOf(brushId: string): BrushSet | undefined { return this.st.sets.find((s) => s.ids.includes(brushId)); }
  rev(id: string): number { return this.revs.get(id) ?? 0; }
  brush(id: string): Brush | undefined { return brushById(id); }
  brushesOf(setId: string): Brush[] {
    const s = this.set(setId);
    const out: Brush[] = [];
    if (s) for (const id of s.ids) { const b = brushById(id); if (b) out.push(b); }
    return out;
  }
  all(): Brush[] {
    const out: Brush[] = [];
    for (const s of this.st.sets) for (const id of s.ids) { const b = brushById(id); if (b) out.push(b); }
    return out;
  }

  // ---- brush edits -------------------------------------------------------------

  rename(id: string, name: string): boolean {
    const n = name.trim().slice(0, 60);
    if (!n || !brushById(id)) return false;
    if (this.custom.has(id)) this.custom.set(id, { ...this.custom.get(id)!, name: n });
    else this.st.names[id] = n;
    this.refresh(id);
    return true;
  }

  /** Changes brush fields (the Pressure & Smoothing card, sliders); a starter brush keeps the change as an edit. */
  edit(id: string, patch: Partial<Brush>): void {
    if (!brushById(id)) return;
    if (this.custom.has(id)) this.custom.set(id, { ...this.custom.get(id)!, ...patch });
    else this.st.tweaks[id] = { ...(this.st.tweaks[id] ?? {}), ...patch };
    this.refresh(id);
  }

  duplicate(id: string): string | null {
    const src = brushById(id);
    const s = this.setOf(id);
    if (!src || !s) return null;
    const nid = uid('dup');
    const copy: Brush = { ...src, id: nid, name: this.uniqueName(`${src.name} copy`), pressureSize: [...src.pressureSize] as [number, number], pressureFlow: [...src.pressureFlow] as [number, number], presets: src.presets.map((p) => ({ ...p })), custom: true };
    this.custom.set(nid, copy);
    s.ids.splice(s.ids.indexOf(id) + 1, 0, nid);
    this.refresh(nid);
    return nid;
  }

  remove(id: string): void {
    const s = this.setOf(id);
    if (!s) return;
    s.ids.splice(s.ids.indexOf(id), 1);
    this.drop(id);
    this.refresh(id);
  }

  /** Moves a brush into a set, before another brush or last. */
  move(id: string, toSet: string, before: string | null = null): void {
    const from = this.setOf(id), to = this.set(toSet);
    if (!from || !to || id === before) return;
    from.ids.splice(from.ids.indexOf(id), 1);
    const at = before ? to.ids.indexOf(before) : -1;
    if (at < 0) to.ids.push(id); else to.ids.splice(at, 0, id);
    this.refresh(id);
  }

  /** One place up or down inside its set. */
  step(id: string, by: -1 | 1): void {
    const s = this.setOf(id);
    if (!s) return;
    const i = s.ids.indexOf(id), j = i + by;
    if (j < 0 || j >= s.ids.length) return;
    [s.ids[i], s.ids[j]] = [s.ids[j], s.ids[i]];
    this.refresh(id);
  }

  // ---- set edits ---------------------------------------------------------------

  addSet(name: string): string {
    const id = uid('set');
    const imp = this.st.sets.findIndex((s) => s.id === IMPORTED_ID);
    const rec: BrushSet = { id, name: this.uniqueSetName(name.trim().slice(0, 40) || 'New set'), ids: [] };
    if (imp >= 0) this.st.sets.splice(imp, 0, rec); else this.st.sets.push(rec);
    this.refresh();
    return id;
  }

  renameSet(id: string, name: string): boolean {
    const s = this.set(id), n = name.trim().slice(0, 40);
    if (!s || !n) return false;
    s.name = n;
    this.refresh(...s.ids);
    return true;
  }

  duplicateSet(id: string): string | null {
    const s = this.set(id);
    if (!s) return null;
    const nid = uid('set');
    const rec: BrushSet = { id: nid, name: this.uniqueSetName(`${s.name} copy`), ids: [] };
    this.st.sets.splice(this.st.sets.indexOf(s) + 1, 0, rec);
    for (const bid of s.ids) {
      const src = brushById(bid);
      if (!src) continue;
      const cid = uid('dup');
      this.custom.set(cid, { ...src, id: cid, set: rec.name, pressureSize: [...src.pressureSize] as [number, number], pressureFlow: [...src.pressureFlow] as [number, number], presets: src.presets.map((p) => ({ ...p })), custom: true });
      rec.ids.push(cid);
    }
    this.refresh(...rec.ids);
    return nid;
  }

  removeSet(id: string): void {
    const s = this.set(id);
    if (!s || id === IMPORTED_ID) return;
    for (const bid of s.ids) this.drop(bid);
    this.st.sets.splice(this.st.sets.indexOf(s), 1);
    this.refresh(...s.ids);
  }

  moveSet(id: string, before: string | null): void {
    const s = this.set(id);
    if (!s || id === before) return;
    this.st.sets.splice(this.st.sets.indexOf(s), 1);
    const at = before ? this.st.sets.findIndex((x) => x.id === before) : -1;
    if (at < 0) this.st.sets.push(s); else this.st.sets.splice(at, 0, s);
    this.refresh();
  }

  stepSet(id: string, by: -1 | 1): void {
    const i = this.st.sets.findIndex((s) => s.id === id), j = i + by;
    if (i < 0 || j < 0 || j >= this.st.sets.length) return;
    [this.st.sets[i], this.st.sets[j]] = [this.st.sets[j], this.st.sets[i]];
    this.refresh();
  }

  /** Puts imported brushes into the Imported set. */
  addImported(list: Brush[]): void {
    const s = this.set(IMPORTED_ID);
    if (!s) return;
    for (const b of list) { this.custom.set(b.id, { ...b, set: s.name, custom: true }); s.ids.push(b.id); }
    this.refresh(...list.map((b) => b.id));
  }

  /** Back to the starter library; imported and duplicated brushes are removed. */
  resetAll(): void {
    for (const id of this.custom.keys()) unregisterBrush(id);
    this.custom.clear();
    this.st = defaults();
    this.rebuildAll();
    this.refresh();
  }

  uniqueName(base: string): string {
    const names = new Set(this.all().map((b) => b.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }
  private uniqueSetName(base: string): string {
    const names = new Set(this.st.sets.map((s) => s.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  // ---- resolving ---------------------------------------------------------------

  private drop(id: string): void {
    if (this.custom.has(id)) { this.custom.delete(id); unregisterBrush(id); } else {
      if (!this.st.deleted.includes(id)) this.st.deleted.push(id);
      delete this.st.names[id];
      delete this.st.tweaks[id];
      unregisterBrush(id);
    }
  }

  private resolve(id: string): Brush | null {
    const set = this.setOf(id);
    if (!set) return null;
    const c = this.custom.get(id);
    if (c) return { ...c, set: set.name };
    const base = starterBrush(id);
    if (!base) return null;
    return { ...base, ...(this.st.tweaks[id] ?? {}), name: this.st.names[id] ?? base.name, set: set.name };
  }

  private rebuildAll(): void {
    for (const s of this.st.sets) for (const id of s.ids) this.touch(id);
  }

  private touch(id: string): void {
    const b = this.resolve(id);
    if (b) registerBrush(b); else if (!starterBrush(id) || this.st.deleted.includes(id)) unregisterBrush(id);
    this.revs.set(id, (this.revs.get(id) ?? 0) + 1);
  }

  /** Rebuilds the named brushes, tells listeners and schedules the save. */
  private refresh(...ids: string[]): void {
    for (const id of ids) this.touch(id);
    for (const fn of Array.from(this.subs)) fn();
    this.schedule();
  }

  // ---- persistence -------------------------------------------------------------

  private snapshot(): string {
    const custom: Record<string, SavedBrush> = {};
    for (const [id, b] of this.custom) custom[id] = pack(b);
    return JSON.stringify({ ...this.st, custom });
  }

  private schedule(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = 0; void this.save(); }, 300);
  }

  async save(): Promise<void> {
    const text = this.snapshot();
    let ok = false;
    try { const r = await fetch('/api/brushes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text }); ok = r.ok; } catch { ok = false; }
    try { await idbPut(text); ok = true; } catch { /* the engine copy may still hold */ }
    this.kept = ok;
  }

  private async doLoad(): Promise<void> {
    let raw: unknown = null;
    try {
      const r = await fetch('/api/brushes');
      if (r.ok) { const j = await r.json(); if (j && (j as Saved).v === 1) raw = j; }
    } catch { raw = null; }
    if (!raw) {
      const t = await idbGet();
      if (typeof t === 'string') { try { const j = JSON.parse(t); if (j && j.v === 1) raw = j; } catch { raw = null; } }
    }
    if (raw) this.adopt(raw as Saved);
    this.loaded = true;
    for (const fn of Array.from(this.subs)) fn();
  }

  private adopt(s: Saved): void {
    const st = defaults();
    st.names = s.names && typeof s.names === 'object' ? s.names : {};
    st.tweaks = s.tweaks && typeof s.tweaks === 'object' ? s.tweaks : {};
    st.deleted = Array.isArray(s.deleted) ? s.deleted.filter((x) => typeof x === 'string') : [];
    this.custom.clear();
    for (const [id, sb] of Object.entries(s.custom ?? {})) { const b = unpack(sb); if (b) this.custom.set(id, { ...b, id }); }
    const sets: BrushSet[] = [];
    const placed = new Set<string>();
    for (const rec of Array.isArray(s.sets) ? s.sets : []) {
      if (!rec || typeof rec.id !== 'string' || typeof rec.name !== 'string' || !Array.isArray(rec.ids)) continue;
      const ids = rec.ids.filter((id) => typeof id === 'string' && !placed.has(id) && (this.custom.has(id) || (starterBrush(id) && !st.deleted.includes(id))));
      ids.forEach((id) => placed.add(id));
      sets.push({ id: rec.id, name: rec.name, ids });
    }
    // Starter brushes the saved library does not know yet (added by an update) join their own set.
    for (const b of BRUSHES) {
      if (placed.has(b.id) || st.deleted.includes(b.id)) continue;
      let home = sets.find((x) => x.id === slug(b.set));
      if (!home) { home = { id: slug(b.set), name: b.set, ids: [] }; sets.splice(Math.max(0, sets.findIndex((x) => x.id === IMPORTED_ID)), 0, home); }
      home.ids.push(b.id);
    }
    if (!sets.some((x) => x.id === IMPORTED_ID)) sets.push({ id: IMPORTED_ID, name: 'Imported', ids: [] });
    st.sets = sets;
    this.st = st;
    for (const id of st.deleted) unregisterBrush(id);
    this.rebuildAll();
  }
}

export const brushStore = new BrushStore();
