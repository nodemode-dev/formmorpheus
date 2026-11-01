// Pieces of the Timeline that live beside its canvas code: the end-bar menu, the keyframe-selection menu, the key
// selection itself, lasso geometry and the Free Trim banner. timeline.ts keeps the drawing and the pointer routing.
import type { Engine } from '../engine/engine';
import { contentEnd } from '../engine/model';
import * as ops from '../engine/ops';
import * as selOps from '../engine/key-sel-ops';
import type { KeyClip } from '../engine/key-ops';
import type { KeyKind } from '../engine/types';
import { promptName } from './dialogs';
import { formatHms, parseHms } from './duration-hms';
import { t } from './i18n';
import { Popover, popRow, popSep } from './popover';
import '../styles/timeline-extras.css';

export type Pt = [number, number];

/** True when `p` lies inside the closed polygon `poly` (even-odd). */
export function inPoly(poly: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the trail passes within `r` of the point. */
export function nearTrail(trail: readonly Pt[], x: number, y: number, r: number): boolean {
  for (let i = 0; i < trail.length; i++) {
    const [a, b] = trail[i];
    if (Math.abs(a - x) <= r && Math.abs(b - y) <= r) return true;
    if (i > 0) {
      // sample along the segment so a quick stroke across a small target still counts
      const [pa, pb] = trail[i - 1];
      const n = Math.ceil(Math.hypot(a - pa, b - pb) / r);
      for (let k = 1; k < n; k++) { const t = k / n; if (Math.abs(pa + (a - pa) * t - x) <= r && Math.abs(pb + (b - pb) * t - y) <= r) return true; }
    }
  }
  return false;
}

/** The lasso touches a rectangle: it encloses its centre, or the trail runs through it. */
export function lassoTouches(trail: readonly Pt[], x: number, y: number, w: number, h: number): boolean {
  if (trail.length < 2) return false;
  if (inPoly(trail, x + w / 2, y + h / 2)) return true;
  for (let i = 0; i < trail.length; i++) {
    const [a, b] = trail[i];
    if (a >= x - 2 && a <= x + w + 2 && b >= y - 2 && b <= y + h + 2) return true;
    if (i > 0) {
      const [pa, pb] = trail[i - 1];
      const n = Math.max(1, Math.ceil(Math.hypot(a - pa, b - pb) / 6));
      for (let k = 1; k < n; k++) { const t = k / n, sx = pa + (a - pa) * t, sy = pb + (b - pb) * t; if (sx >= x && sx <= x + w && sy >= y && sy <= y + h) return true; }
    }
  }
  return false;
}

/** The chosen keyframes: per content, by lane kind and content-local frame. Cleared when the content selection moves on. */
export class KeySelection {
  private readonly by = new Map<string, Map<string, selOps.KeyRef>>();
  /** Bumped on every change so the Timeline can cheaply tell. */
  rev = 0;

  get size(): number { let n = 0; for (const m of this.by.values()) n += m.size; return n; }
  ids(): string[] { return [...this.by.keys()]; }
  has(id: string, kind: KeyKind, frame: number): boolean { return !!this.by.get(id)?.has(selOps.refKey({ kind, frame })); }
  refs(id: string): selOps.KeyRef[] { return [...(this.by.get(id)?.values() ?? [])]; }

  clear(): void {
    if (!this.by.size) return;
    this.by.clear();
    this.rev++;
  }

  toggle(id: string, kind: KeyKind, frame: number): void {
    const r = { kind, frame }, k = selOps.refKey(r);
    let m = this.by.get(id);
    if (!m) { m = new Map(); this.by.set(id, m); }
    if (m.has(k)) { m.delete(k); if (!m.size) this.by.delete(id); } else m.set(k, r);
    this.rev++;
  }

  /** Replaces the selection with `next` (id to its refs). */
  set(next: Map<string, selOps.KeyRef[]>): void {
    this.by.clear();
    for (const [id, list] of next) if (list.length) this.by.set(id, new Map(list.map((r) => [selOps.refKey(r), r])));
    this.rev++;
  }

  /** Keeps only contents in `ids`. */
  keepOnly(ids: ReadonlySet<string>): void {
    let changed = false;
    for (const id of [...this.by.keys()]) if (!ids.has(id)) { this.by.delete(id); changed = true; }
    if (changed) this.rev++;
  }
}

/** One clipboard of whole key selections, kept per lane type so a paste lands each key on its own kind of lane. */
export const keyClipboard: { clips: KeyClip[] } = { clips: [] };

const updateEach = (engine: Engine, label: string, sel: KeySelection, fn: (id: string, refs: selOps.KeyRef[], c: Parameters<Parameters<typeof ops.updateContent>[2]>[0]) => ReturnType<Parameters<typeof ops.updateContent>[2]>): void => {
  const ids = sel.ids();
  engine.run(label, (m) => ids.reduce((acc, id) => { try { return ops.updateContent(acc, id, (c) => fn(id, sel.refs(id), c)); } catch { return acc; } }, m));
};

/** Menu of the chosen keyframes: Cut, Copy, Paste, Reverse, Delete. */
export class KeySelMenu {
  private readonly pop = new Popover('fm-cm fm-ksm', 220);
  private readonly rows = {
    cut: popRow('cut', 'Cut'), copy: popRow('copy', 'Copy'), paste: popRow('paste', 'Paste'), reverse: popRow(null, 'Reverse keyframes'),
    none: popRow(null, 'Select none'), del: popRow(null, 'Delete keyframes', { danger: true }),
  };

  constructor(private readonly engine: Engine, private readonly sel: KeySelection, private readonly onChange: () => void) {
    const r = this.rows;
    r.copy.el.addEventListener('click', () => { this.copy(); this.pop.hide(); });
    r.cut.el.addEventListener('click', () => { this.copy(); updateEach(this.engine, 'Cut Keyframes', this.sel, (_id, refs, c) => selOps.deleteRefs(c, refs)); this.sel.clear(); this.onChange(); this.pop.hide(); });
    r.paste.el.addEventListener('click', () => { this.paste(); this.pop.hide(); });
    r.reverse.el.addEventListener('click', () => { updateEach(this.engine, 'Reverse Keyframes', this.sel, (_id, refs, c) => selOps.reverseRefs(c, refs)); this.pop.hide(); });
    r.none.el.addEventListener('click', () => { this.sel.clear(); this.onChange(); this.pop.hide(); });
    r.del.el.addEventListener('click', () => { updateEach(this.engine, 'Delete Keyframes', this.sel, (_id, refs, c) => selOps.deleteRefs(c, refs)); this.sel.clear(); this.onChange(); this.pop.hide(); });
    this.pop.body.append(r.cut.el, r.copy.el, r.paste.el, popSep(), r.reverse.el, r.none.el, popSep(), r.del.el);
  }

  open(x: number, y: number): void {
    this.rows.paste.setDisabled(!keyClipboard.clips.length || this.engine.selected.length !== 1);
    this.pop.showAt(x, y);
  }

  copy(): void {
    const first = this.sel.ids()[0];
    const c = this.engine.selected.find((it) => it.id === first) ?? this.engine.movie?.tracks.flatMap((t) => t.content).find((it) => it.id === first);
    if (!c) return;
    keyClipboard.clips = selOps.copyRefs(c, this.sel.refs(first));
  }

  /** Pastes the copied keys, each on its own lane kind, at the Playhead of the one selected content. */
  paste(): void {
    const c = this.engine.selected.length === 1 ? this.engine.selected[0] : null;
    if (!c || !keyClipboard.clips.length) return;
    const at = Math.max(0, Math.min(c.duration - 1, this.engine.frame - c.start));
    const clips = keyClipboard.clips;
    this.engine.run('Paste Keyframes', (m) => ops.updateContent(m, c.id, (cc) => selOps.pasteClips(cc, clips, at)));
  }
}

/** Menu of the movie's end bar: type a length, fit the length to the content, fit the view. */
export class EndBarMenu {
  private readonly pop = new Popover('fm-cm fm-ebm', 216);
  constructor(private readonly engine: Engine, fitView: () => void) {
    const dur = popRow(null, 'Enter duration');
    const fit = popRow(null, 'Fit to content');
    const view = popRow(null, 'Fit view to movie');
    dur.el.addEventListener('click', () => { this.pop.hide(); void this.enter(); });
    fit.el.addEventListener('click', () => { this.pop.hide(); this.engine.run('Fit Duration to Content', (m) => ops.fitToContent(m)); });
    view.el.addEventListener('click', () => { this.pop.hide(); fitView(); });
    this.pop.body.append(dur.el, fit.el, popSep(), view.el);
    this.fit = fit;
  }
  private readonly fit;

  open(x: number, y: number): void {
    const m = this.engine.movie;
    this.fit.setDisabled(!m || contentEnd(m) <= 0 || contentEnd(m) === m.duration);
    this.pop.showAt(x, y);
  }

  private async enter(): Promise<void> {
    const m = this.engine.movie;
    if (!m) return;
    const v = await promptName(t('Movie duration (hours:minutes:seconds, like 0:00:10 or 1m 30s)'), formatHms(m.duration, m.fps), t('Set'));
    const n = v === null ? NaN : parseHms(v, m.fps) ?? NaN;
    if (Number.isFinite(n) && n >= 1 && n <= 200000) this.engine.run('Movie Duration', (mv) => ops.patchMovie(mv, { duration: n }));
  }
}
