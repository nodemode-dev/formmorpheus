// Level meters: a master meter in the transport bar and thin per-track meters drawn on the Timeline's track rows.
// Peak and RMS come from the AudioEngine's analysers; both are shown on a -60 to 0 dB scale with a latched clip light.
import type { AudioEngine, MeterLevel } from '../media/audio';
import { lufsText } from '../media/loudness';
import '../styles/audio-fx.css';

const FLOOR_DB = -60;
const CLIP_RED = '#e5484d';

/** 0..1 position of a linear level on the dB scale. */
export function meterPos(v: number): number {
  if (!(v > 0.000001)) return 0;
  const db = 20 * Math.log10(v);
  return Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));
}

export function dbText(v: number): string {
  return v > 0.000001 ? `${(20 * Math.log10(v)).toFixed(1)} dB` : '-inf dB';
}

/** One vertical meter in a track row of the Timeline canvas: RMS body, peak tick, clip light on top. */
export function drawTrackMeter(c: CanvasRenderingContext2D, lv: MeterLevel, x: number, y: number, w: number, h: number, body: string): void {
  if (!(lv.peak > 0.000001) && !lv.clip) return;
  const rms = meterPos(lv.rms), peak = meterPos(lv.peak);
  c.save();
  c.globalAlpha = 0.85;
  c.fillStyle = body;
  c.fillRect(x, y + h - h * rms, w, h * rms);
  c.fillStyle = lv.clip || peak > 0.99 ? CLIP_RED : body;
  c.fillRect(x, y + h - h * peak - 1, w, 2);
  if (lv.clip) { c.fillStyle = CLIP_RED; c.fillRect(x, y, w, 3); }
  c.restore();
}

/** The master meter: its own canvas, drawn on animation frames only while there is something to show. */
export class MasterMeter {
  private raf = 0;
  private shown = false;
  private readonly ro: ResizeObserver | null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** The bars take the left 64 px; the loudness numbers the rest. */
  private readonly barW = 64;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly audio: () => AudioEngine | null) {
    canvas.addEventListener('click', () => { this.audio()?.resetClip(); this.audio()?.resetLoudness(); this.shown = true; });
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.size()) : null;
    this.ro?.observe(canvas);
    this.size();
    this.raf = requestAnimationFrame(() => this.tick());
  }

  private size(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.shown = true;
  }

  private tick(): void {
    this.raf = requestAnimationFrame(() => this.tick());
    if (document.hidden) return;
    const a = this.audio();
    const lv = a ? a.meter() : { peak: 0, rms: 0, clip: false };
    const idle = !(lv.peak > 0.000001) && !lv.clip;
    if (idle && !this.shown) return;
    this.shown = !idle;
    this.draw(lv);
  }

  private draw(lv: MeterLevel): void {
    const c = this.canvas.getContext('2d');
    if (!c) return;
    const { w, h } = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const st = getComputedStyle(this.canvas);
    const track = st.getPropertyValue('--fm-meter-track').trim() || 'rgba(128,128,128,.28)';
    const accent = st.getPropertyValue('--accent-color').trim() || '#f97316';
    const bar = Math.max(2, Math.floor((h - 4) / 2));
    const lightW = 7, len = this.barW - lightW - 4;
    c.fillStyle = track;
    c.fillRect(0, 1, len, bar);
    c.fillRect(0, 3 + bar, len, bar);
    c.fillStyle = accent;
    c.fillRect(0, 1, len * meterPos(lv.rms), bar);
    const pk = meterPos(lv.peak);
    c.fillStyle = pk > 0.99 ? CLIP_RED : accent;
    c.fillRect(0, 3 + bar, len * pk, bar);
    c.fillStyle = lv.clip ? CLIP_RED : track;
    c.beginPath();
    c.arc(this.barW - lightW / 2, h / 2, 3, 0, Math.PI * 2);
    c.fill();
    const ld = this.audio()?.loudness() ?? { short: -Infinity, integrated: -Infinity, truePeak: -Infinity };
    const num = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : '--');
    // short-term (3 s), integrated loudness and the highest true peak sit right of the bars
    c.fillStyle = st.getPropertyValue('--text-secondary').trim() || '#999';
    c.font = '9px ui-monospace, monospace';
    c.textBaseline = 'middle';
    c.fillText(`S ${num(ld.short)}  I ${num(ld.integrated)}  TP ${num(ld.truePeak)}`, this.barW + 8, h / 2 + 0.5);
    this.canvas.title = `Peak ${dbText(lv.peak)} · RMS ${dbText(lv.rms)} · ${lufsText(ld.short)} short-term · ${lufsText(ld.integrated)} integrated · ${num(ld.truePeak)} dBTP true peak${lv.clip ? ' · clipped' : ''} (click to reset)`;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
  }
}
