// The Sound card of a sound block: level, pan, fades, keys, normalize, scrubbing, and its track's mute and solo.
// Built once and patched in place; every edit is one undo step (sliders merge while dragged).
import type { Engine } from '../engine/engine';
import { evalLane, laneOf } from '../engine/keys';
import * as keyOps from '../engine/key-ops';
import { locate } from '../engine/model';
import * as ops from '../engine/ops';
import type { Content } from '../engine/types';
import type { AudioEngine } from '../media/audio';
import { MAX_LEVEL, normalize, normalizeLoudness, setFade, setMute, setSolo } from '../media/audio-edit';
import { LUFS_PRESETS } from '../media/loudness';
import { el, q, setClass, setDisabled, setHidden, setText } from './dom';
import { t } from './i18n';
import { soundFxCard } from './sound-fx-card';
import '../styles/voice.css';

const X = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const SCRUB_KEY = 'formmorpheus.audioScrub';

interface RowRef { input: HTMLInputElement; val: HTMLElement }

export function loadScrubPref(): boolean {
  try { return localStorage.getItem(SCRUB_KEY) !== '0'; } catch { return true; }
}

export class SoundCard {
  private readonly root: HTMLElement;
  private readonly level: RowRef;
  private readonly pan: RowRef;
  private readonly fin: RowRef;
  private readonly fout: RowRef;
  private readonly keyLevel: HTMLButtonElement;
  private readonly keyPan: HTMLButtonElement;
  private readonly norm: HTMLButtonElement;
  private readonly loud: HTMLSelectElement;
  private readonly scrub: HTMLButtonElement;
  private readonly mute: HTMLButtonElement;
  private readonly solo: HTMLButtonElement;
  private readonly title: HTMLElement;
  private id: string | null = null;
  private open = false;

  constructor(private readonly engine: Engine, private readonly audio: () => AudioEngine) {
    this.root = el<HTMLElement>('<section class="fm-snd" role="dialog" hidden><div class="fm-snd-head"><span class="fm-snd-title"></span><button class="fm-snd-x" type="button"></button></div><div class="fm-snd-body"></div></section>');
    this.root.setAttribute('aria-label', t('Sound'));
    this.title = q(this.root, '.fm-snd-title');
    const x = q<HTMLButtonElement>(this.root, '.fm-snd-x');
    x.innerHTML = X;
    x.setAttribute('aria-label', t('Close'));
    x.addEventListener('click', () => this.close());
    const body = q(this.root, '.fm-snd-body');
    const slider = (label: string, min: number, max: number, step: number): RowRef & { row: HTMLElement } => {
      const row = el<HTMLElement>('<div class="fm-snd-row"><span class="fm-snd-lab"></span><input type="range"><span class="fm-snd-val"></span></div>');
      setText(q(row, '.fm-snd-lab'), t(label));
      const input = q<HTMLInputElement>(row, 'input');
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.setAttribute('aria-label', t(label));
      return { row, input, val: q(row, '.fm-snd-val') };
    };
    const lv = slider('Level', 0, MAX_LEVEL * 100, 1);
    const pn = slider('Pan', -100, 100, 1);
    const fi = slider('Fade in', 0, 100, 1);
    const fo = slider('Fade out', 0, 100, 1);
    this.level = lv;
    this.pan = pn;
    this.fin = fi;
    this.fout = fo;
    const btn = (label: string): HTMLButtonElement => {
      const b = el<HTMLButtonElement>('<button class="cv-btn" type="button"></button>');
      setText(b, t(label));
      return b;
    };
    this.keyLevel = btn('Key level');
    this.keyPan = btn('Key pan');
    this.norm = btn('Normalize');
    this.scrub = btn('Audio scrubbing');
    this.mute = btn('Mute track');
    this.solo = btn('Solo track');
    const keys = el<HTMLElement>('<div class="fm-snd-btns"></div>');
    this.loud = el<HTMLSelectElement>('<select class="cv-input" aria-label="Normalize to loudness"></select>');
    this.loud.append(new Option(t('Normalize to loudness...'), ''), ...LUFS_PRESETS.map((v) => new Option(`${v} LUFS`, String(v))));
    this.loud.addEventListener('change', () => { const v = Number(this.loud.value); this.loud.value = ''; if (v) void this.normalizeLoud(v); });
    keys.append(this.keyLevel, this.keyPan, this.norm, this.loud);
    const tracks = el<HTMLElement>('<div class="fm-snd-btns"></div>');
    tracks.append(this.mute, this.solo, this.scrub);
    const fxRow = el<HTMLElement>('<div class="fm-snd-btns"></div>');
    const fxBlock = btn('Block effects...'), fxTrack = btn('Track effects...');
    fxRow.append(fxBlock, fxTrack);
    fxBlock.addEventListener('click', () => { if (this.id) soundFxCard(this.engine).show({ kind: 'block', id: this.id }); });
    fxTrack.addEventListener('click', () => { const tr = this.track(); if (tr) soundFxCard(this.engine).show({ kind: 'track', id: tr.id }); });
    body.append(lv.row, pn.row, fi.row, fo.row, keys, tracks, fxRow);
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);

    const tag = (k: string): string => `sound-${k}-${this.id}`;
    lv.input.addEventListener('input', () => this.edit('Level', tag('level'), (c, v) => this.keyedValue(c, 'level', v) ?? setLevelBase(c, v), Number(lv.input.value) / 100));
    pn.input.addEventListener('input', () => this.edit('Pan', tag('pan'), (c, v) => this.keyedValue(c, 'pan', v) ?? setPanBase(c, v), Number(pn.input.value) / 100));
    fi.input.addEventListener('input', () => this.run('Fade In', tag('fin'), (id) => (m) => setFade(m, id, 'in', Number(fi.input.value))));
    fo.input.addEventListener('input', () => this.run('Fade Out', tag('fout'), (id) => (m) => setFade(m, id, 'out', Number(fo.input.value))));
    for (const r of [lv, pn, fi, fo]) {
      r.input.addEventListener('change', () => this.engine.endGesture());
      r.input.addEventListener('dblclick', () => { r.input.value = r.input === lv.input ? '100' : '0'; r.input.dispatchEvent(new Event('input')); this.engine.endGesture(); });
    }
    this.keyLevel.addEventListener('click', () => this.keyNow('level'));
    this.keyPan.addEventListener('click', () => this.keyNow('pan'));
    this.norm.addEventListener('click', () => { void this.normalizeNow(); });
    this.scrub.addEventListener('click', () => {
      const on = !this.audio().scrubbing;
      this.audio().setScrub(on);
      try { localStorage.setItem(SCRUB_KEY, on ? '1' : '0'); } catch { /* this session only */ }
      this.patch();
    });
    this.mute.addEventListener('click', () => { const tr = this.track(); if (tr) this.engine.run(tr.mute ? 'Unmute Track' : 'Mute Track', (m) => setMute(m, tr.id, !tr.mute)); });
    this.solo.addEventListener('click', () => { const tr = this.track(); if (tr) this.engine.run(tr.solo ? 'Unsolo Track' : 'Solo Track', (m) => setSolo(m, tr.id, !tr.solo)); });
    for (const ev of ['movie', 'selection', 'history'] as const) this.engine.on(ev, () => { if (this.open) this.follow(); });
    this.engine.on('time', () => { if (this.open) this.patch(); });
  }

  show(id?: string): void {
    const m = this.engine.movie;
    const pick = id ?? this.engine.selected.find((c) => c.kind === 'audio')?.id ?? null;
    if (!m || !pick) return;
    this.id = pick;
    this.open = true;
    setHidden(this.root, false);
    this.patch();
  }

  close(): void {
    this.open = false;
    setHidden(this.root, true);
  }

  private follow(): void {
    const sel = this.engine.selected.find((c) => c.kind === 'audio');
    if (sel) this.id = sel.id;
    this.patch();
  }

  private block(): Content | null {
    const m = this.engine.movie;
    return m && this.id ? locate(m, this.id)?.content ?? null : null;
  }

  private track() {
    const m = this.engine.movie;
    return m && this.id ? locate(m, this.id)?.track ?? null : null;
  }

  /** While the Level or Pan lane has keys the slider writes a key at the Playhead, else the block's base value. */
  private keyedValue(c: Content, channel: 'level' | 'pan', v: number): Content | null {
    const lane = laneOf(c, 'volume');
    if (!lane?.channels[channel]?.length) return null;
    const local = Math.max(0, Math.min(c.duration - 1, this.engine.frame - c.start));
    return keyOps.setKeys(c, 'volume', local, { [channel]: v });
  }

  private edit(label: string, merge: string, fn: (c: Content, v: number) => Content, v: number): void {
    const id = this.id;
    if (!id) return;
    this.engine.run(label, (m) => ops.updateContent(m, id, (c) => fn(c, v)), merge);
  }

  private run(label: string, merge: string, make: (id: string) => (m: NonNullable<Engine['movie']>) => NonNullable<Engine['movie']>): void {
    const id = this.id;
    if (!id) return;
    this.engine.run(label, make(id), merge);
  }

  private keyNow(channel: 'level' | 'pan'): void {
    const c = this.block();
    if (!c) return;
    const local = Math.max(0, Math.min(c.duration - 1, this.engine.frame - c.start));
    const slider = channel === 'level' ? Number(this.level.input.value) / 100 : Number(this.pan.input.value) / 100;
    this.engine.run(channel === 'level' ? 'Key Level' : 'Key Pan', (m) => ops.updateContent(m, c.id, (x) => {
      const withLane = laneOf(x, 'volume') ? x : keyOps.addLane(x, 'volume', local, true, 'linear');
      return keyOps.setKeys(withLane, 'volume', local, { [channel]: slider });
    }));
  }

  /** Brings the block to a target integrated loudness: one undo step. */
  private async normalizeLoud(target: number): Promise<void> {
    const c = this.block();
    const m = this.engine.movie;
    if (!c || !m || !c.asset) return;
    const a = this.audio();
    await a.decode(c.asset);
    const f = m.fps;
    const measured = a.lufsIn(c.asset, c.offset / f, (c.offset + c.duration) / f);
    this.engine.run('Normalize Loudness', (mv) => normalizeLoudness(mv, c.id, measured, target));
  }

  private async normalizeNow(): Promise<void> {
    const c = this.block();
    const m = this.engine.movie;
    if (!c || !m || !c.asset) return;
    const a = this.audio();
    await a.decode(c.asset);
    const f = m.fps;
    const peak = a.peakIn(c.asset, c.offset / f, (c.offset + c.duration) / f);
    this.engine.run('Normalize', (mv) => normalize(mv, c.id, peak));
  }

  patch(): void {
    const c = this.block();
    const m = this.engine.movie;
    if (!c || !m) { this.close(); return; }
    setText(this.title, `${t('Sound')} · ${c.name}`);
    const lane = laneOf(c, 'volume');
    const local = Math.max(0, Math.min(c.duration - 1, this.engine.frame - c.start));
    const set = (r: RowRef, value: number, shown: string): void => {
      if (document.activeElement !== r.input) r.input.value = String(value);
      setText(r.val, shown);
    };
    const lvNow = lane?.channels.level?.length ? this.audioLevelAt(c, local) : c.volume;
    const panNow = lane?.channels.pan?.length ? this.audioPanAt(c, local) : c.pan ?? 0;
    set(this.level, Math.round(lvNow * 100), `${Math.round(lvNow * 100)}%`);
    set(this.pan, Math.round(panNow * 100), panNow === 0 ? t('Centre') : `${panNow < 0 ? 'L' : 'R'} ${Math.abs(Math.round(panNow * 100))}`);
    this.fin.input.max = this.fout.input.max = String(c.duration);
    set(this.fin, c.fadeIn ?? 0, `${((c.fadeIn ?? 0) / m.fps).toFixed(2)} s`);
    set(this.fout, c.fadeOut ?? 0, `${((c.fadeOut ?? 0) / m.fps).toFixed(2)} s`);
    setClass(this.keyLevel, 'is-on', !!lane?.channels.level?.length);
    setClass(this.keyPan, 'is-on', !!lane?.channels.pan?.length);
    const tr = this.track();
    setClass(this.mute, 'is-on', !!tr?.mute);
    setClass(this.solo, 'is-on', !!tr?.solo);
    setClass(this.scrub, 'is-on', this.audio().scrubbing);
    setDisabled(this.norm, !c.asset);
    setDisabled(this.loud, !c.asset);
  }

  private audioLevelAt(c: Content, local: number): number {
    return evalLane(c, laneOf(c, 'volume') as NonNullable<ReturnType<typeof laneOf>>, local).level ?? c.volume;
  }

  private audioPanAt(c: Content, local: number): number {
    return evalLane(c, laneOf(c, 'volume') as NonNullable<ReturnType<typeof laneOf>>, local).pan ?? c.pan ?? 0;
  }
}

function setLevelBase(c: Content, v: number): Content {
  return { ...c, volume: Math.max(0, Math.min(MAX_LEVEL, v)) };
}

function setPanBase(c: Content, v: number): Content {
  const next: Content = { ...c };
  const p = Math.max(-1, Math.min(1, Math.round(v * 100) / 100));
  if (p !== 0) next.pan = p; else delete next.pan;
  return next;
}
