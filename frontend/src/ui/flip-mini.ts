// Mini Flipbook: the frame strip undocked into a small floating card over the canvas. It shows the frames around the
// open one for the open row, can be thrown to an edge (left and right edges lay it out vertically, the top edge
// horizontally, the bottom edge docks it), and carries Play, Previous / Next Drawing, a notched scrub wheel and Scrub Lock.
// The wheel only captures its own pointer, so a pen can keep painting while a finger holds and turns it.
import type { FlipbookFrame } from '../engine/types';
import { el, patchList, q, setClass, setHidden, setStyleVar, setText } from './dom';
import type { FlipStrip, StripHost } from './flip-strip';
import { t } from './i18n';
import { loadPrefs } from './prefs';
import { toast } from './toast';

const WINDOW = 4;      // frames shown on each side of the open one
const TW = 44;
const TH = 34;
const EDGE = 64;       // snap distance in px
const NOTCH = { precise: 28, medium: 18, fast: 10 } as const;
const HOLD_JUMP = 450;

const svg = (body: string, fill = false): string =>
  `<svg viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;
const ICO = {
  play: svg('<path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5z"/>', true),
  pause: svg('<rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/>', true),
  prev: svg('<path d="M15 6l-6 6 6 6"/>'),
  next: svg('<path d="M9 6l6 6-6 6"/>'),
};
const glyph = (s: string, n: number): string => `<span class="icon" style="width:${n}px;height:${n}px" aria-hidden="true">${s}</span>`;

type Edge = 'left' | 'right' | 'top';
interface FrameItem { f: FlipbookFrame; i: number; row: number }

export class FlipMini {
  readonly root: HTMLElement;
  private readonly frames: HTMLElement;
  private readonly wheel: HTMLElement;
  private readonly mid: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly playIco: HTMLElement;
  private readonly shots = new WeakMap<HTMLElement, HTMLCanvasElement>();
  private floating = false;
  private orient: 'h' | 'v' = 'h';
  private edge: Edge | null = null;
  private mx = 0;
  private my = 0;
  private lock: { row: number; index: number } | null = null;
  private flyTimer = 0;
  private holdTimer = 0;
  private held = false;

  constructor(private readonly strip: FlipStrip, private readonly host: StripHost, private readonly parent: HTMLElement) {
    this.root = el<HTMLElement>(
      `<div class="fm-fm" data-o="h" hidden role="group" aria-label="Mini Flipbook">` +
        `<div class="fm-fm-handle" title="Drag to move, double-click to dock"><span class="fm-fm-grip"></span></div>` +
        `<div class="fm-fm-frames"></div>` +
        `<div class="fm-fm-ctl">` +
          `<button class="fm-fm-btn" data-act="prev" type="button" title="Previous drawing (hold for the first)" aria-label="Previous drawing">${glyph(ICO.prev, 16)}</button>` +
          `<button class="fm-fm-btn fm-fm-play" data-act="play" type="button" title="Play" aria-label="Play"><span class="fm-fm-playico"></span></button>` +
          `<button class="fm-fm-btn" data-act="next" type="button" title="Next drawing (hold for the last)" aria-label="Next drawing">${glyph(ICO.next, 16)}</button>` +
          `<div class="fm-fm-wheel" title="Drag to scrub"><button class="fm-fm-mid" type="button" title="Scrub Lock" aria-label="Scrub Lock"></button></div>` +
        `</div></div>`);
    parent.appendChild(this.root);
    this.frames = q(this.root, '.fm-fm-frames');
    this.wheel = q(this.root, '.fm-fm-wheel');
    this.mid = q(this.root, '.fm-fm-mid');
    this.playBtn = q(this.root, '.fm-fm-play');
    this.playIco = q(this.root, '.fm-fm-playico');
    this.wire();
    this.setNotch();
    strip.onMini = () => this.toggle();
    strip.onPaint = (invalid) => this.sync(invalid);
  }

  get isFloating(): boolean { return this.floating; }

  dispose(): void {
    window.clearTimeout(this.flyTimer);
    window.clearTimeout(this.holdTimer);
    this.root.remove();
  }

  /** Back to the docked strip (also on every re-entry to the Flipbook). */
  dock(): void {
    this.floating = false;
    this.edge = null;
    this.lock = null;
    setHidden(this.root, true);
    setClass(this.strip.root, 'is-undocked', false);
    setClass(this.parent, 'mini-float', false);
    this.sideClass();
    this.strip.refresh();
  }

  undock(): void {
    if (this.floating) return;
    this.floating = true;
    setClass(this.strip.root, 'is-undocked', true);
    setClass(this.parent, 'mini-float', true);
    setHidden(this.root, false);
    this.sync(true);
    const p = this.parent.getBoundingClientRect(), r = this.root.getBoundingClientRect();
    this.mx = Math.round((p.width - r.width) / 2);
    this.my = Math.round(p.height - r.height - 28);
    this.place();
    this.sideClass();
  }

  toggle(): void { if (this.floating) this.dock(); else this.undock(); }

  // ---- placing ----

  private place(): void {
    setStyleVar(this.root, '--mx', `${Math.round(this.mx)}px`);
    setStyleVar(this.root, '--my', `${Math.round(this.my)}px`);
  }

  private setOrient(o: 'h' | 'v'): void {
    this.orient = o;
    if (this.root.dataset.o !== o) this.root.dataset.o = o;
    this.setNotch();
  }

  /** Position of an edge for the card's current size. */
  private edgeAt(e: Edge): { x: number; y: number } {
    const p = this.parent.getBoundingClientRect(), r = this.root.getBoundingClientRect();
    const top = 64;
    if (e === 'left') return { x: 10, y: Math.round((p.height - r.height) / 2) };
    if (e === 'right') return { x: Math.round(p.width - r.width - 10), y: Math.round((p.height - r.height) / 2) };
    return { x: Math.round((p.width - r.width) / 2), y: top };
  }

  private snapTo(e: Edge, fly: boolean): void {
    this.edge = e;
    this.setOrient(e === 'top' ? 'h' : 'v');
    const at = this.edgeAt(e);
    if (fly) {
      setClass(this.root, 'is-fly', true);
      window.clearTimeout(this.flyTimer);
      this.flyTimer = window.setTimeout(() => setClass(this.root, 'is-fly', false), 340);
    }
    this.mx = at.x;
    this.my = at.y;
    this.place();
    this.sideClass();
  }

  /** The Size and Opacity sidebar goes to the other side when the card sits on the side it is on. */
  private sideClass(): void {
    setClass(this.parent, 'mini-left', this.floating && this.edge === 'left');
    setClass(this.parent, 'mini-right', this.floating && this.edge === 'right');
  }

  // ---- content ----

  private setNotch(): void {
    const s = NOTCH[loadPrefs().scrubSpeed] ?? NOTCH.medium;
    setStyleVar(this.wheel, '--notch', `${s}px`);
  }

  private notch(): number { return NOTCH[loadPrefs().scrubSpeed] ?? NOTCH.medium; }

  sync(invalid = false): void {
    if (!this.floating) return;
    const c = this.host.content();
    if (!c) { setHidden(this.root, true); return; }
    setHidden(this.root, false);
    const row = this.host.row();
    const t = c.flip[row];
    const idx = this.host.index();
    const playing = this.host.playing();
    if (this.playIco.dataset.on !== (playing ? '1' : '0')) {
      this.playIco.dataset.on = playing ? '1' : '0';
      this.playIco.replaceChildren(el(glyph(playing ? ICO.pause : ICO.play, 16)));
      this.playBtn.title = playing ? 'Pause' : 'Play';
    }
    setClass(this.mid, 'is-locked', !!this.lock);
    if (!t) return;
    const lo = Math.max(0, idx - WINDOW), hi = Math.min(t.frames.length - 1, idx + WINDOW);
    const items: FrameItem[] = [];
    for (let i = lo; i <= hi; i++) items.push({ f: t.frames[i], i, row });
    const a = this.lock && this.lock.row === row ? Math.min(this.lock.index, idx) : -1;
    const b = this.lock && this.lock.row === row ? Math.max(this.lock.index, idx) : -1;
    patchList(this.frames, items, {
      key: (it) => it.f.id,
      create: (it) => {
        const n = el<HTMLElement>(`<button class="fm-fm-cell" type="button"><span class="fm-fm-num"></span></button>`);
        n.addEventListener('click', () => { const i = Number(n.dataset.i); if (Number.isFinite(i)) this.host.select(this.host.row(), i); });
        this.upd(n, it, idx, a, b, invalid);
        return n;
      },
      update: (n, it) => this.upd(n, it, idx, a, b, invalid),
    });
  }

  private upd(n: HTMLElement, it: FrameItem, idx: number, a: number, b: number, invalid: boolean): void {
    n.dataset.i = String(it.i);
    setClass(n, 'is-cur', it.i === idx);
    setClass(n, 'is-lock', !!this.lock && it.i === this.lock.index);
    setClass(n, 'in-range', a >= 0 && it.i >= a && it.i <= b);
    setText(q(n, '.fm-fm-num'), String(it.i + 1));
    this.shot(n, it, invalid);
  }

  private shot(n: HTMLElement, it: FrameItem, invalid: boolean): void {
    const sig = it.f.layers.map((l) => `${l.id}:${l.pixels ?? ''}:${l.visible ? 1 : 0}:${l.opacity}`).join('|');
    if (!invalid && n.dataset.sig === sig) return;
    let cv = this.shots.get(n);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = TW;
      cv.height = TH;
      cv.className = 'fm-fm-shot';
      n.insertBefore(cv, n.firstChild);
      this.shots.set(n, cv);
    }
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, TW, TH);
    if (it.f.layers.some((l) => l.pixels !== null) || it.i === this.host.index()) {
      const src = this.host.thumb(it.row, it.i, TW, TH);
      if (src) {
        const s = src as unknown as { width: number; height: number };
        const k = Math.min(TW / (s.width || TW), TH / (s.height || TH));
        const w = (s.width || TW) * k, h = (s.height || TH) * k;
        g.drawImage(src, (TW - w) / 2, (TH - h) / 2, w, h);
      }
    }
    n.dataset.sig = sig;
  }

  // ---- input ----

  private go(d: number): void {
    const t = this.host.content()?.flip[this.host.row()];
    if (!t) return;
    const i = Math.max(0, Math.min(t.frames.length - 1, this.host.index() + d));
    if (i !== this.host.index()) this.host.select(this.host.row(), i);
  }

  private jump(end: boolean): void {
    const t = this.host.content()?.flip[this.host.row()];
    if (t) this.host.select(this.host.row(), end ? t.frames.length - 1 : 0);
  }

  private wire(): void {
    // Previous / Next Drawing: a press steps, a long press jumps to the first or last drawing
    for (const act of ['prev', 'next'] as const) {
      const b = q<HTMLButtonElement>(this.root, `[data-act="${act}"]`);
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        this.held = false;
        window.clearTimeout(this.holdTimer);
        this.holdTimer = window.setTimeout(() => { this.held = true; this.jump(act === 'next'); }, HOLD_JUMP);
      });
      const stop = (): void => window.clearTimeout(this.holdTimer);
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointerleave', stop);
      b.addEventListener('click', () => { if (this.held) { this.held = false; return; } this.go(act === 'next' ? 1 : -1); });
    }
    this.playBtn.addEventListener('click', () => this.host.togglePlay());

    // Scrub Lock: tap the middle notch
    this.mid.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.mid.addEventListener('click', () => {
      if (this.lock) { this.lock = null; toast('Scrub Lock off'); }
      else { this.lock = { row: this.host.row(), index: this.host.index() }; toast(t('Scrub Lock on at frame {n}').replace('{n}', String(this.host.index() + 1))); }
      this.sync();
    });

    // the wheel: drag left (or up when vertical) for forward
    this.wheel.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target === this.mid) return;
      e.stopPropagation();
      this.wheel.setPointerCapture(e.pointerId);
      const vertical = this.orient === 'v';
      const s = this.notch();
      const p0 = vertical ? e.clientY : e.clientX;
      const base = this.host.index();
      const row = this.host.row();
      let last = base;
      setClass(this.root, 'is-scrub', true);
      const move = (m: PointerEvent): void => {
        if (m.pointerId !== e.pointerId) return;
        const d = (vertical ? m.clientY : m.clientX) - p0;
        setStyleVar(this.wheel, '--wo', `${Math.round(d) % s}px`);
        const t = this.host.content()?.flip[row];
        if (!t) return;
        const to = Math.max(0, Math.min(t.frames.length - 1, base + Math.round(-d / s)));
        if (to !== last) { last = to; this.host.select(row, to); }
      };
      const up = (m: PointerEvent): void => {
        if (m.pointerId !== e.pointerId) return;
        this.wheel.removeEventListener('pointermove', move);
        this.wheel.removeEventListener('pointerup', up);
        this.wheel.removeEventListener('pointercancel', up);
        setClass(this.root, 'is-scrub', false);
        setStyleVar(this.wheel, '--wo', '0px');
        // with Scrub Lock on, letting go goes back to the locked frame
        if (this.lock && this.lock.row === row) this.host.select(row, this.lock.index);
      };
      this.wheel.addEventListener('pointermove', move);
      this.wheel.addEventListener('pointerup', up);
      this.wheel.addEventListener('pointercancel', up);
    });

    // the handle: drag to move and throw, double-click to dock
    const handle = q(this.root, '.fm-fm-handle');
    handle.addEventListener('dblclick', () => this.dock());
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      handle.setPointerCapture(e.pointerId);
      window.clearTimeout(this.flyTimer);
      setClass(this.root, 'is-fly', false);
      const x0 = e.clientX, y0 = e.clientY, mx0 = this.mx, my0 = this.my;
      const trail: Array<{ t: number; x: number; y: number }> = [{ t: performance.now(), x: e.clientX, y: e.clientY }];
      setClass(this.root, 'is-moving', true);
      const move = (m: PointerEvent): void => {
        this.mx = mx0 + m.clientX - x0;
        this.my = my0 + m.clientY - y0;
        this.place();
        trail.push({ t: performance.now(), x: m.clientX, y: m.clientY });
        while (trail.length > 2 && trail[0].t < performance.now() - 110) trail.shift();
      };
      const up = (): void => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        setClass(this.root, 'is-moving', false);
        const a = trail[0], b = trail[trail.length - 1];
        const dt = Math.max(1, b.t - a.t);
        const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
        const p = this.parent.getBoundingClientRect(), r = this.root.getBoundingClientRect();
        if (Math.hypot(vx, vy) > 0.6 && trail.length > 1) {
          // thrown: it flies on to the edge the throw points at
          if (Math.abs(vx) > Math.abs(vy)) this.snapTo(vx < 0 ? 'left' : 'right', true);
          else if (vy < 0) this.snapTo('top', true);
          else this.dock();
          return;
        }
        // set down near an edge: it soft-locks there; at the bottom it docks
        if (r.bottom > p.bottom - EDGE / 2) { this.dock(); return; }
        if (r.left - p.left < EDGE) this.snapTo('left', true);
        else if (p.right - r.right < EDGE) this.snapTo('right', true);
        else if (r.top - p.top < EDGE + 40) this.snapTo('top', true);
        else this.edge = null;
        this.sideClass();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }
}
