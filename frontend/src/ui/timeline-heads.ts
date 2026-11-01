// The optional track header column: name, visibility, lock, mute and solo per track, and a drag handle to reorder.
// Built once; patch() only moves the rows and toggles classes and text, so nothing flashes.
import type { Engine } from '../engine/engine';
import * as ops from '../engine/ops';
import { setTrackLocked } from '../engine/lock-ops';
import type { Movie, Track } from '../engine/types';
import { setMute, setSolo } from '../media/audio-edit';
import { el, q, setClass, setHidden, setText, setTitle } from './dom';
import '../styles/timeline-heads.css';

export type HeadsMode = 'off' | 'full' | 'slim';
const KEY = 'fm.tl.heads';
const WIDTHS: Record<HeadsMode, number> = { off: 0, full: 158, slim: 26 };

const SVG = (body: string): string => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const EYE = SVG('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
const EYE_OFF = SVG('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>');
const LOCK = SVG('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>');
const UNLOCK = SVG('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>');
const SPEAKER = SVG('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9a4 4 0 0 1 0 6"/>');
const SPEAKER_OFF = SVG('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 8l5 8"/>');
const GRIP = SVG('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>');

export interface HeadsGeo {
  /** Top of a track row in the lanes area, and the block height. */
  laneTop(i: number): number;
  blockH(): number;
  /** The track index under a y inside the lanes area. */
  laneAt(y: number): number;
  /** Called when the column's width changes, so the Timeline can move its frame zero. */
  layout(): void;
  /** Right-click on a header: the track's menu. */
  menu?(x: number, y: number, id: string): void;
}

interface Row {
  el: HTMLElement;
  name: HTMLElement;
  input: HTMLInputElement;
  eye: HTMLButtonElement;
  lock: HTMLButtonElement;
  mute: HTMLButtonElement;
  solo: HTMLButtonElement;
  key: string;
}

const hasSound = (m: Movie, t: Track): boolean => t.content.some((c) => c.kind === 'audio' || (c.kind === 'video' && !!c.asset && !!m.assets[c.asset]?.hasAudio));

export class TrackHeads {
  readonly el = el<HTMLElement>('<div class="fm-th" aria-label="Track headers" hidden></div>');
  mode: HeadsMode = 'off';
  private readonly rows = new Map<string, Row>();
  private drag: { id: string; tag: string } | null = null;
  private lastStyle = '';

  constructor(host: HTMLElement, private readonly engine: Engine, private readonly geo: HeadsGeo) {
    host.appendChild(this.el);
    try { const v = localStorage.getItem(KEY); if (v === 'full' || v === 'slim') this.mode = v; } catch { /* storage blocked: off */ }
    this.sync();
  }

  /** Pixels the column takes at the left of the lanes (0 when off). */
  get width(): number { return WIDTHS[this.mode]; }

  set(mode: HeadsMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    try { localStorage.setItem(KEY, mode); } catch { /* not kept */ }
    this.sync();
    this.geo.layout();
  }

  /** Off, then full, then slim, then off. */
  cycle(): void { this.set(this.mode === 'off' ? 'full' : this.mode === 'full' ? 'slim' : 'off'); }

  private sync(): void {
    setHidden(this.el, this.mode === 'off');
    setClass(this.el, 'is-slim', this.mode === 'slim');
    const w = `${this.width}px`;
    if (this.el.style.width !== w) this.el.style.width = w;
  }

  private make(m: Movie, t: Track): Row {
    const node = el<HTMLElement>(`<div class="fm-th-row"><span class="fm-th-grip" title="Drag to reorder">${GRIP}</span><span class="fm-th-name"></span><input class="fm-th-input" type="text" maxlength="80" spellcheck="false" aria-label="Track name" hidden>` +
      `<button class="fm-th-b fm-th-eye" type="button" aria-label="Hide or show">${EYE}</button><button class="fm-th-b fm-th-lock" type="button" aria-label="Lock or unlock">${UNLOCK}</button>` +
      `<button class="fm-th-b fm-th-mute" type="button" aria-label="Mute">${SPEAKER}</button><button class="fm-th-b fm-th-solo" type="button" aria-label="Solo">S</button></div>`);
    const row: Row = { el: node, name: q(node, '.fm-th-name'), input: q<HTMLInputElement>(node, '.fm-th-input'), eye: q(node, '.fm-th-eye'), lock: q(node, '.fm-th-lock'), mute: q(node, '.fm-th-mute'), solo: q(node, '.fm-th-solo'), key: '' };
    const id = t.id;
    const track = (): Track | undefined => this.engine.movie?.tracks.find((x) => x.id === id);
    row.eye.addEventListener('click', () => { const x = track(); if (x) this.engine.run(x.hidden ? 'Show Track' : 'Hide Track', (mv) => ops.setTrackHidden(mv, id, !x.hidden)); });
    row.lock.addEventListener('click', () => { const x = track(); if (x) this.engine.run(x.locked ? 'Unlock Track' : 'Lock Track', (mv) => setTrackLocked(mv, id, !x.locked)); });
    row.mute.addEventListener('click', () => { const x = track(); if (x) this.engine.run(x.mute ? 'Unmute Track' : 'Mute Track', (mv) => setMute(mv, id, !x.mute)); });
    row.solo.addEventListener('click', () => { const x = track(); if (x) this.engine.run(x.solo ? 'Unsolo Track' : 'Solo Track', (mv) => setSolo(mv, id, !x.solo)); });
    row.name.addEventListener('click', () => this.engine.select([], id));
    node.addEventListener('contextmenu', (e) => { e.preventDefault(); this.geo.menu?.(e.clientX, e.clientY, id); });
    row.name.addEventListener('dblclick', () => this.rename(row, id));
    const commit = (): void => {
      if (row.input.hidden) return;
      const v = row.input.value.trim(), x = track();
      setHidden(row.input, true);
      setHidden(row.name, false);
      if (v && x && v !== x.name) this.engine.run('Rename Track', (mv) => ops.renameTrack(mv, id, v));
    };
    row.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') { row.input.value = track()?.name ?? ''; commit(); }
    });
    row.input.addEventListener('blur', commit);
    this.bindGrip(q(node, '.fm-th-grip'), id);
    this.el.appendChild(node);
    void m;
    return row;
  }

  private rename(row: Row, id: string): void {
    const t = this.engine.movie?.tracks.find((x) => x.id === id);
    if (!t) return;
    row.input.value = t.name;
    setHidden(row.name, true);
    setHidden(row.input, false);
    row.input.focus();
    row.input.select();
  }

  private bindGrip(grip: HTMLElement, id: string): void {
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      this.drag = { id, tag: `thmove-${Date.now()}` };
      setClass(this.rows.get(id)?.el ?? null, 'is-dragging', true);
    });
    grip.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== id) return;
      const r = this.el.getBoundingClientRect();
      const to = Math.max(0, Math.min((this.engine.movie?.tracks.length ?? 1) - 1, this.geo.laneAt(e.clientY - r.top)));
      const from = this.engine.movie?.tracks.findIndex((x) => x.id === id) ?? -1;
      if (from >= 0 && to !== from) this.engine.run('Move Track', (mv) => ops.moveTrack(mv, id, to), d.tag);
    });
    const done = (): void => {
      if (!this.drag) return;
      setClass(this.rows.get(this.drag.id)?.el ?? null, 'is-dragging', false);
      this.drag = null;
      this.engine.endGesture();
    };
    grip.addEventListener('pointerup', done);
    grip.addEventListener('pointercancel', done);
  }

  /** Moves and relabels the rows for the current movie and scroll. */
  patch(m: Movie): void {
    if (this.mode === 'off') return;
    const live = new Set<string>();
    const anySolo = m.tracks.some((t) => t.solo);
    m.tracks.forEach((t, i) => {
      live.add(t.id);
      let row = this.rows.get(t.id);
      if (!row) { row = this.make(m, t); this.rows.set(t.id, row); }
      const top = Math.round(this.geo.laneTop(i)), h = this.geo.blockH();
      const sound = hasSound(m, t), sel = this.engine.selection.track === t.id;
      const key = `${top}|${h}|${t.name}|${t.hidden ? 1 : 0}|${t.locked ? 1 : 0}|${t.mute ? 1 : 0}|${t.solo ? 1 : 0}|${sound ? 1 : 0}|${sel ? 1 : 0}|${anySolo && !t.solo ? 1 : 0}`;
      if (key === row.key) return;
      row.key = key;
      row.el.style.transform = `translateY(${top}px)`;
      row.el.style.height = `${h}px`;
      setText(row.name, t.name);
      setTitle(row.name, t.name);
      setClass(row.el, 'is-hidden', t.hidden);
      setClass(row.el, 'is-locked', !!t.locked);
      setClass(row.el, 'is-selected', sel);
      setClass(row.eye, 'is-on', t.hidden);
      row.eye.innerHTML === (t.hidden ? EYE_OFF : EYE) || (row.eye.innerHTML = t.hidden ? EYE_OFF : EYE);
      setTitle(row.eye, t.hidden ? 'Show track' : 'Hide track');
      setClass(row.lock, 'is-on', !!t.locked);
      row.lock.innerHTML === (t.locked ? LOCK : UNLOCK) || (row.lock.innerHTML = t.locked ? LOCK : UNLOCK);
      setTitle(row.lock, t.locked ? 'Unlock track' : 'Lock track');
      // a track with a mute or solo set always shows it, so the state is never invisible
      setHidden(row.mute, !sound && !t.mute);
      setHidden(row.solo, !sound && !t.solo);
      setClass(row.el, 'is-muted', !!t.mute);
      setClass(row.el, 'is-solo', !!t.solo);
      setClass(row.el, 'is-quiet', anySolo && !t.solo && sound);
      setClass(row.mute, 'is-on', !!t.mute);
      row.mute.innerHTML === (t.mute ? SPEAKER_OFF : SPEAKER) || (row.mute.innerHTML = t.mute ? SPEAKER_OFF : SPEAKER);
      setTitle(row.mute, t.mute ? 'Unmute track' : 'Mute track');
      setClass(row.solo, 'is-on', !!t.solo);
      setTitle(row.solo, t.solo ? 'Unsolo track' : 'Solo track');
    });
    for (const [id, row] of this.rows) if (!live.has(id)) { row.el.remove(); this.rows.delete(id); }
    const st = `${this.width}`;
    if (st !== this.lastStyle) { this.lastStyle = st; for (const r of this.rows.values()) r.key = ''; }
  }
}
