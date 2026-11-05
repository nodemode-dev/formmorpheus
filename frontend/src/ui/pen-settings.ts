// Preferences > Pen and Tablet: a live test pad that draws through the same pipeline as the canvas, the pressure
// curve with its range and smoothing, what the eraser end and the barrel buttons do, palm rejection, a saved
// profile per device, and a plain-words check when the pen reaches us as a mouse.

import { PenInput } from '../paint/input';
import { penRuntime } from '../paint/pen-device';
import { CURVE_PRESETS, altAzToTilt, cleanCurve, type CurvePoint } from '../paint/pen-sample';
import type { BarrelAction } from '../paint/pen-arbiter';
import { loadPaintPrefs } from './paint-settings';
import { attachPenStorage } from './paint-feel';
import { el, q, setClass, setHidden, setText } from './dom';
import { onLanguage, t } from './i18n';
import { tf } from './i18n-fill';
import { checkRow, selectRow, sliderRow } from './panels/controls';
import { pencilRows } from '../platform/ipad-pencil-settings';

const CURVE = 168, PAD = 10, MAX_POINTS = 8, MIN_GAP = 0.03;

const ACTIONS: ReadonlyArray<readonly [string, string]> = [
  ['none', 'Nothing'], ['eyedropper', 'Eyedropper'], ['menu', 'Right-click menu'], ['undo', 'Undo'], ['pan', 'Pan'], ['cycle', 'Cycle tool'],
];

function osAdvice(kind: 'flat' | 'zero' | 'mouse'): string {
  const ua = navigator.userAgent;
  const mouse = kind === 'mouse';
  // whole sentences, one per case, so a language can order them as it needs
  if (/Windows/i.test(ua)) return mouse
    ? t('Your tablet is arriving as a mouse. In your tablet driver, turn on Windows Ink, restart the driver, then reopen formmorpheus.')
    : t('This pen reports no pressure. In your tablet driver, turn on Windows Ink, restart the driver, then reopen formmorpheus.');
  if (/Mac/i.test(ua)) return mouse
    ? t('Your tablet is arriving as a mouse. Install your tablet\'s own driver (the system\'s generic one gives no pressure), then reopen formmorpheus.')
    : t('This pen reports no pressure. Install your tablet\'s own driver (the system\'s generic one gives no pressure), then reopen formmorpheus.');
  return mouse
    ? t('Your tablet is arriving as a mouse. On Linux the web view may not pass pressure through; an X11 session with your tablet\'s driver gives the best chance.')
    : t('This pen reports no pressure. On Linux the web view may not pass pressure through; an X11 session with your tablet\'s driver gives the best chance.');
}

const onLinux = (): boolean => /Linux|X11/i.test(`${navigator.platform} ${navigator.userAgent}`) && !/Android/i.test(navigator.userAgent);

const same = (a: CurvePoint[], b: CurvePoint[]): boolean => a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) < 2e-3 && Math.abs(p[1] - b[i][1]) < 2e-3);

export class PenSettingsPage {
  readonly groups: HTMLElement[];
  private readonly pad: HTMLCanvasElement;
  private readonly pctx: CanvasRenderingContext2D | null;
  private readonly curveCv: HTMLCanvasElement;
  private readonly cctx: CanvasRenderingContext2D | null;
  private readonly out = new Map<string, HTMLElement>();
  private readonly bar: HTMLElement;
  private readonly barRaw: HTMLElement;
  private readonly diag: HTMLElement;
  private readonly diag2: HTMLElement;
  private readonly diag3: HTMLElement;
  private readonly mouseRow = checkRow('Use pressure from the mouse', (v) => { penRuntime.update({ mousePressure: v }); this.refreshDiag(); });
  private readonly devName: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly forgetBtn: HTMLButtonElement;
  private readonly presetBtns: HTMLButtonElement[];
  private readonly minRow = sliderRow('Minimum pressure (%)', 0, 40, 1, (v) => { penRuntime.edit({ min: v / 100 }); this.draw(); }, { def: 0 });
  private readonly maxRow = sliderRow('Maximum pressure (%)', 60, 100, 1, (v) => { penRuntime.edit({ max: v / 100 }); this.draw(); }, { def: 100 });
  private readonly smoothRow = sliderRow('Pressure smoothing (%)', 0, 100, 1, (v) => { penRuntime.edit({ smoothing: v / 100 }); }, { def: 20 });
  private readonly tiltRow = checkRow('Tilt shapes the brush', (v) => penRuntime.update({ tiltAngle: v }));
  private readonly palmRow = checkRow('Palm rejection: fingers only pan and zoom while the pen is near', (v) => { penRuntime.update({ palm: v }); });
  private readonly eraserRow = selectRow('Eraser end', [['erase', 'Erases'], ['off', 'Does nothing']], (v) => penRuntime.update({ eraserEnd: v as 'erase' | 'off' }));
  private readonly b1Row = selectRow('Barrel button 1', ACTIONS, (v) => penRuntime.update({ barrel1: v as BarrelAction }));
  private readonly b2Row = selectRow('Barrel button 2', ACTIONS, (v) => penRuntime.update({ barrel2: v as BarrelAction }));
  /** The Apple Pencil rows; null on the desktop. */
  private readonly pencil = pencilRows();
  private pts: CurvePoint[] = [[0, 0], [1, 1]];
  private dragIdx = -1;
  private readonly input: PenInput;
  private rect: DOMRect | null = null;
  private strokeId = -1;
  private prev: { x: number; y: number; r: number } | null = null;
  private live: PointerEvent | null = null;
  private touchSays = '';
  private touchSize = '';
  private mouseForce = '';
  private raf = 0;
  private lastRaw = 0;
  private lastShaped = 0;
  private dirty = false;

  constructor() {
    attachPenStorage();
    this.input = new PenInput({ toCanvas: (x, y) => ({ x: x - (this.rect?.left ?? 0), y: y - (this.rect?.top ?? 0) }), smoothing: 0, fingerPaints: true });

    const padBox = el(`<div class="fm-pen-padbox"><canvas class="fm-pen-pad" aria-label="Pen test pad"></canvas><span class="fm-pen-padhint">Draw here with your pen, a finger or a mouse</span></div>`);
    this.pad = q<HTMLCanvasElement>(padBox, 'canvas');
    this.pctx = this.pad.getContext('2d');
    const read = el(`<dl class="fm-pen-read">${
      [['dev', 'Device'], ['type', 'Pointer'], ['p', 'Pressure'], ['tilt', 'Tilt'], ['alt', 'Altitude and azimuth'], ['twist', 'Twist'], ['btn', 'Buttons'], ['hz', 'Rate'], ['touch', 'Touch'], ['tsz', t('Touch size')], ['force', t('Mouse force')]]
        .map(([k, l]) => `<dt>${l}</dt><dd data-k="${k}">-</dd>`).join('')
    }</dl>`);
    for (const dd of Array.from(read.querySelectorAll<HTMLElement>('dd'))) this.out.set(dd.dataset.k ?? '', dd);
    const meter = el('<div class="fm-pen-meter" aria-hidden="true"><span class="fm-pen-meter-raw"></span><span class="fm-pen-meter-fill"></span></div>');
    this.bar = q(meter, '.fm-pen-meter-fill');
    this.barRaw = q(meter, '.fm-pen-meter-raw');
    this.out.get('p')?.after(meter);
    this.diag = el('<p class="fm-pen-diag" role="status"></p>');
    this.diag2 = el('<p class="fm-pen-diag" role="status" hidden></p>');
    this.diag3 = el('<p class="fm-pen-diag" role="status" hidden></p>');
    const clear = el<HTMLButtonElement>('<button class="cv-btn" type="button">Clear pad</button>');
    clear.addEventListener('click', () => this.clearPad());
    const resetSeen = el<HTMLButtonElement>('<button class="cv-btn" type="button">Forget readings</button>');
    resetSeen.addEventListener('click', () => { penRuntime.tracker.reset(); this.refreshDiag(); this.paintReadouts(); });
    const padBtns = el('<div class="fm-pen-btns"></div>');
    padBtns.append(clear, resetSeen);
    const test = el('<div class="fm-pen-test"></div>');
    const side = el('<div class="fm-pen-side"></div>');
    side.append(read);
    test.append(padBox, side);

    // curve editor
    const curveBox = el(`<div class="fm-pen-curvebox"><canvas class="fm-pen-curve" width="${CURVE}" height="${CURVE}" aria-label="Pressure curve"></canvas><div class="fm-pen-curveside"><div class="fm-pen-presets" role="group" aria-label="Curve presets"></div><p class="cv-note">Drag a point. Double-click adds one. Drag one off the graph to remove it. The line is where your pen lands: along the bottom is how hard you press, up the side is how strong the mark is.</p></div></div>`);
    this.curveCv = q<HTMLCanvasElement>(curveBox, 'canvas');
    this.cctx = this.curveCv.getContext('2d');
    const presets = q(curveBox, '.fm-pen-presets');
    this.presetBtns = CURVE_PRESETS.map((p) => {
      const b = el<HTMLButtonElement>(`<button class="cv-btn" type="button" data-p="${p.id}">${t(p.label)}</button>`);
      b.addEventListener('click', () => { this.pts = p.points.map((x) => [...x] as CurvePoint); this.commit(); });
      presets.appendChild(b);
      return b;
    });
    this.devName = el('<span class="fm-pen-devname"></span>');
    this.saveBtn = el<HTMLButtonElement>('<button class="cv-btn" type="button">Save for this pen</button>');
    this.forgetBtn = el<HTMLButtonElement>('<button class="cv-btn" type="button">Forget saved pen</button>');
    this.saveBtn.addEventListener('click', () => { penRuntime.saveProfile(penRuntime.tracker.key('pen'), this.deviceLabel()); this.sync(); });
    this.forgetBtn.addEventListener('click', () => { penRuntime.forgetProfile(penRuntime.tracker.key('pen')); this.sync(); });
    const dev = el('<div class="fm-pen-dev"></div>');
    dev.append(this.devName, this.saveBtn, this.forgetBtn);

    const grp = (label: string, ...content: HTMLElement[]): HTMLElement => {
      const g = el('<section class="cv-prefs-group"><h3 class="cv-prefs-label"></h3></section>');
      const h = q<HTMLElement>(g, '.cv-prefs-label');
      setText(h, t(label));
      onLanguage(() => setText(h, t(label)));
      g.append(...content);
      return g;
    };
    const nt = (text: string): HTMLElement => el(`<p class="cv-note">${text}</p>`);
    this.groups = [
      grp('Test pad', test, this.diag, this.diag2, this.diag3, padBtns, nt('The pad draws through the same pressure curve and smoothing as the canvas.')),
      grp('Pressure', curveBox, this.minRow.el, this.maxRow.el, this.smoothRow.el, this.mouseRow.el, dev, nt('Minimum ignores the faintest touch; maximum is the pressure that already counts as full. A pen saved here keeps its own curve; others use the shared one.')),
      grp('Pen buttons', this.eraserRow.el, this.b1Row.el, this.b2Row.el, this.tiltRow.el, this.palmRow.el, nt('The eraser end erases for that stroke only, then the tool you had comes back. Which button is 1 and which is 2 depends on your tablet driver.')),
    ];
    if (this.pencil) this.groups.push(grp('Apple Pencil', ...this.pencil.rows, nt('Follow system setting uses the choice made in the iPad Settings app under Apple Pencil. With Draw with Pencil only on, fingers pan, zoom and use gestures but never paint.')));

    this.wirePad();
    this.wireCurve();
    new ResizeObserver(() => this.sizePad()).observe(this.pad);
    this.sync();
  }

  /** Called each time Preferences opens. */
  show(): void {
    this.sync();
    this.sizePad();
    this.refreshDiag();
  }

  private deviceLabel(): string {
    const s = penRuntime.tracker.stats('pen');
    return s?.tilt ? 'Pen with tilt' : 'Pen';
  }

  private sync(): void {
    const rt = penRuntime, c = rt.effective(), s = rt.settings, legacy = loadPaintPrefs();
    this.pts = c.points.map((p) => [...p] as CurvePoint);
    this.minRow.set(Math.round(c.min * 100));
    this.maxRow.set(Math.round(c.max * 100));
    this.smoothRow.set(Math.round(rt.smoothing * 100));
    this.tiltRow.set(s.tiltAngle);
    this.palmRow.set(s.palm);
    this.mouseRow.set(s.mousePressure);
    this.eraserRow.set(s.eraserEnd ?? (legacy.eraserEnd ? 'erase' : 'off'));
    this.b1Row.set(s.barrel1 ?? (legacy.penButton === 'off' ? 'none' : legacy.penButton));
    this.b2Row.set(s.barrel2 ?? 'none');
    this.pencil?.sync();
    this.syncDevice();
    this.draw();
  }

  private syncDevice(): void {
    const rt = penRuntime, key = rt.tracker.key('pen'), known = !key.endsWith(':?');
    const saved = !!rt.profiles[key];
    setText(this.devName, known ? tf(saved ? 'Saved pen: {pen}' : 'Pen: {pen}', { pen: key }) : t('No pen seen yet'));
    this.saveBtn.disabled = !known;
    setHidden(this.forgetBtn, !saved);
  }

  private commit(): void {
    this.pts = cleanCurve(this.pts);
    penRuntime.edit({ curve: this.pts });
    penRuntime.effective();
    this.draw();
  }

  // ---------------------------------------------------------------- test pad

  private sizePad(): void {
    const w = this.pad.clientWidth, h = this.pad.clientHeight;
    if (!w || !h) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    if (this.pad.width === Math.round(w * dpr) && this.pad.height === Math.round(h * dpr)) return;
    this.pad.width = Math.round(w * dpr);
    this.pad.height = Math.round(h * dpr);
    this.pctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private clearPad(): void {
    this.pctx?.save();
    this.pctx?.setTransform(1, 0, 0, 1, 0, 0);
    this.pctx?.clearRect(0, 0, this.pad.width, this.pad.height);
    this.pctx?.restore();
    setHidden(q(this.pad.parentElement as HTMLElement, '.fm-pen-padhint'), false);
  }

  private wirePad(): void {
    const pad = this.pad;
    pad.addEventListener('contextmenu', (e) => e.preventDefault());
    pad.addEventListener('pointerdown', (e) => {
      this.rect = pad.getBoundingClientRect();
      this.input.watch(e, 'down');
      this.note(e);
      if (e.pointerType === 'touch') {
        const pol = this.input.runtime.arbiter.admit(e);
        this.touchSays = pol === 'paint' ? 'paints' : pol === 'navigate' ? 'pans and zooms only (a pen is near)' : 'ignored (palm)';
        if (pol !== 'paint') { this.queue(); return; }
      }
      if (e.button === 2 || (e.pointerType === 'pen' && (e.buttons & 6) && !(e.buttons & 32))) { this.queue(); return; }
      pad.setPointerCapture(e.pointerId);
      this.strokeId = e.pointerId;
      this.prev = null;
      setHidden(q(pad.parentElement as HTMLElement, '.fm-pen-padhint'), true);
      this.stamp(this.input.down(e), e.buttons & 32 ? true : false);
      this.queue();
    });
    pad.addEventListener('pointermove', (e) => {
      this.input.watch(e, 'move');
      this.note(e);
      if (e.pointerId === this.strokeId) this.stamp(this.input.move(e), (e.buttons & 32) !== 0);
      this.queue();
    });
    const up = (e: PointerEvent): void => {
      this.input.watch(e, 'up');
      if (e.pointerType === 'touch') this.input.runtime.arbiter.release(e.pointerId);
      if (e.pointerId !== this.strokeId) return;
      this.stamp(this.input.up(e), false);
      this.strokeId = -1;
      this.prev = null;
      this.queue();
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    pad.addEventListener('pointerleave', (e) => { this.input.runtime.arbiter.leave(e); });
  }

  private stamp(list: { x: number; y: number; pressure: number; predicted?: boolean; eraser?: boolean }[], eraser: boolean): void {
    const g = this.pctx;
    if (!g) return;
    const cs = getComputedStyle(this.pad);
    g.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    g.fillStyle = cs.getPropertyValue('--accent-color').trim() || '#f97316';
    for (const s of list) {
      if (s.predicted) continue;
      const r = 0.8 + Math.max(0, s.pressure) * 10 * (eraser ? 1.6 : 1);
      const p = this.prev;
      if (p) {
        const d = Math.hypot(s.x - p.x, s.y - p.y), n = Math.max(1, Math.ceil(d / Math.max(0.8, Math.min(r, p.r) * 0.3)));
        for (let i = 1; i <= n; i++) {
          const k = i / n;
          g.beginPath();
          g.arc(p.x + (s.x - p.x) * k, p.y + (s.y - p.y) * k, p.r + (r - p.r) * k, 0, Math.PI * 2);
          g.fill();
        }
      } else { g.beginPath(); g.arc(s.x, s.y, r, 0, Math.PI * 2); g.fill(); }
      this.prev = { x: s.x, y: s.y, r };
      this.lastShaped = s.pressure;
    }
    g.globalCompositeOperation = 'source-over';
  }

  private note(e: PointerEvent): void {
    this.live = e;
    this.lastRaw = e.buttons === 0 && e.pointerType === 'pen' ? 0 : e.pressure;
    if (e.pointerType === 'pen') penRuntime.noteDevice();
    if (e.pointerType === 'touch') this.touchSize = `${Math.round(e.width)} x ${Math.round(e.height)} px`;
    const wf = (e as { webkitForce?: number }).webkitForce;
    if (typeof wf === 'number') this.mouseForce = wf.toFixed(3);
    if (e.buttons === 0) this.lastShaped = 0;
  }

  private queue(): void {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.dirty) { this.dirty = false; this.paintReadouts(); this.refreshDiag(); this.draw(); } });
  }

  private paintReadouts(): void {
    const e = this.live, o = this.out, rt = penRuntime, tk = rt.tracker;
    const set = (k: string, v: string): void => { const n = o.get(k); if (n) setText(n, v); };
    const st = tk.stats();
    set('dev', st ? tk.key() : '-');
    set('hz', tk.rateHz() ? `${Math.round(tk.rateHz())} Hz` : '-');
    set('touch', this.touchSays || '-');
    set('tsz', this.touchSize || '-');
    set('force', this.mouseForce || '-');
    if (!e) { return; }
    const pen = e.pointerType === 'pen';
    set('type', pen ? (e.isTrusted ? 'pen' : 'pen (linked)') : e.pointerType);
    set('p', `${this.lastRaw.toFixed(3)}  to  ${this.lastShaped.toFixed(3)}`);
    this.barRaw.style.width = `${Math.round(Math.min(1, this.lastRaw) * 100)}%`;
    this.bar.style.width = `${Math.round(Math.min(1, Math.max(0, this.lastShaped)) * 100)}%`;
    const altOnly = pen && !e.tiltX && !e.tiltY && typeof e.altitudeAngle === 'number' && e.altitudeAngle < Math.PI / 2 - 1e-3;
    const tl = altOnly ? altAzToTilt(e.altitudeAngle, e.azimuthAngle ?? 0) : { tiltX: e.tiltX, tiltY: e.tiltY };
    set('tilt', pen ? `${Math.round(tl.tiltX)} , ${Math.round(tl.tiltY)} deg` : '-');
    const aa = pen ? { alt: (e.altitudeAngle ?? Math.PI / 2), az: e.azimuthAngle ?? 0 } : null;
    set('alt', aa ? `${Math.round((aa.alt * 180) / Math.PI)} , ${Math.round((aa.az * 180) / Math.PI)} deg` : '-');
    set('twist', pen ? `${Math.round(e.twist)} deg` : '-');
    const bits: string[] = [];
    if (e.buttons & 1) bits.push('tip');
    if (e.buttons & 2) bits.push('barrel 1');
    if (e.buttons & 4) bits.push('barrel 2');
    if (e.buttons & 32) bits.push('eraser end');
    set('btn', bits.length ? bits.join(', ') : e.buttons === 0 && pen ? 'hovering' : 'none');
  }

  private refreshDiag(): void {
    const tk = penRuntime.tracker, kind = tk.looksLikeMouse(true);
    let msg: string, bad = false;
    if (kind) { msg = osAdvice(kind); bad = true; }
    else if (tk.stats('pen')) {
      const s = tk.stats('pen');
      const v = { min: s ? s.pMin.toFixed(2) : '', max: s ? s.pMax.toFixed(2) : '' };
      msg = s && s.contact > 4
        ? s.tilt && s.twist ? tf('Pen detected: pressure {min} to {max}, tilt, twist.', v) : s.tilt ? tf('Pen detected: pressure {min} to {max}, tilt.', v) : s.twist ? tf('Pen detected: pressure {min} to {max}, twist.', v) : tf('Pen detected: pressure {min} to {max}.', v)
        : t('Pen detected. Press and draw to check its pressure.');
    } else if (tk.stats('touch') || tk.stats('mouse')) msg = t('Only mouse or touch input seen so far. Draw with your pen to test it.');
    else msg = t('Draw on the pad with your pen to test it.');
    setText(this.diag, msg);
    setClass(this.diag, 'is-bad', bad);
    // a second line: a tablet that sends pressure as a mouse, and on Linux the way round it
    const more = tk.mouseVaries() && !penRuntime.settings.mousePressure ? t('Your tablet sends pressure through mouse events. Turn on Use pressure from the mouse.') : '';
    setText(this.diag2, more);
    setHidden(this.diag2, !more);
    const link = kind && onLinux() ? t('On Linux the web view sends your pen as a mouse. Link a tablet or another browser as a pen with Pen Link instead.') : '';
    setText(this.diag3, link);
    setHidden(this.diag3, !link);
    this.syncDevice();
  }

  // ---------------------------------------------------------------- curve editor

  private toPx(p: CurvePoint): [number, number] {
    const s = CURVE - PAD * 2;
    return [PAD + p[0] * s, PAD + (1 - p[1]) * s];
  }

  private fromEvent(e: PointerEvent): [number, number, boolean] {
    const r = this.curveCv.getBoundingClientRect(), s = CURVE - PAD * 2;
    const x = ((e.clientX - r.left) * (CURVE / r.width) - PAD) / s, y = 1 - ((e.clientY - r.top) * (CURVE / r.height) - PAD) / s;
    return [x, y, x < -0.08 || x > 1.08 || y < -0.08 || y > 1.08];
  }

  private wireCurve(): void {
    const c = this.curveCv;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    if (dpr > 1) { c.width = CURVE * dpr; c.height = CURVE * dpr; this.cctx?.setTransform(dpr, 0, 0, dpr, 0, 0); }
    c.style.width = `${CURVE}px`;
    c.style.height = `${CURVE}px`;
    c.addEventListener('pointerdown', (e) => {
      const r = c.getBoundingClientRect();
      let best = -1, bd = 15 * 15;
      this.pts.forEach((p, i) => {
        const [qx, qy] = this.toPx(p), dx = qx - (e.clientX - r.left) * (CURVE / r.width), dy = qy - (e.clientY - r.top) * (CURVE / r.height), d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      });
      if (best < 0) return;
      this.dragIdx = best;
      c.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      if (this.dragIdx < 0) return;
      const i = this.dragIdx, last = this.pts.length - 1, [x, y, off] = this.fromEvent(e), ny = Math.min(1, Math.max(0, y));
      if (i === 0 || i === last) this.pts[i] = [i === 0 ? 0 : 1, ny];
      else this.pts[i] = [Math.min(this.pts[i + 1][0] - MIN_GAP, Math.max(this.pts[i - 1][0] + MIN_GAP, x)), ny];
      setClass(c, 'is-removing', off && i !== 0 && i !== last);
      penRuntime.edit({ curve: this.pts });
      penRuntime.effective();
      this.draw();
    });
    const end = (e: PointerEvent): void => {
      if (this.dragIdx < 0) return;
      const i = this.dragIdx, last = this.pts.length - 1, [, , off] = this.fromEvent(e);
      this.dragIdx = -1;
      setClass(c, 'is-removing', false);
      if (off && i !== 0 && i !== last) { this.pts.splice(i, 1); this.commit(); }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', (e) => {
      if (this.pts.length >= MAX_POINTS) return;
      const [x] = this.fromEvent(e as PointerEvent);
      if (x <= MIN_GAP || x >= 1 - MIN_GAP || this.pts.some((p) => Math.abs(p[0] - x) < MIN_GAP * 2)) return;
      const at = this.pts.findIndex((p) => p[0] > x);
      this.pts.splice(at, 0, [x, penRuntime.effective().at(x)]);
      this.commit();
    });
  }

  private draw(): void {
    const g = this.cctx;
    if (!g) return;
    const cs = getComputedStyle(this.curveCv), s = CURVE - PAD * 2, cur = penRuntime.effective();
    const accent = cs.getPropertyValue('--accent-color').trim() || '#f97316';
    const line = cs.getPropertyValue('--border-light').trim() || '#555';
    const muted = cs.getPropertyValue('--text-muted').trim() || '#888';
    const fill = cs.getPropertyValue('--text-primary').trim() || '#fff';
    g.clearRect(0, 0, CURVE, CURVE);
    g.lineWidth = 1;
    g.strokeStyle = line;
    g.beginPath();
    for (let i = 0; i <= 4; i++) {
      const v = PAD + (s * i) / 4 + 0.5;
      g.moveTo(v, PAD); g.lineTo(v, PAD + s);
      g.moveTo(PAD, v); g.lineTo(PAD + s, v);
    }
    g.stroke();
    // the range: pressure under min or over max is flat
    g.fillStyle = 'rgba(128,128,128,0.14)';
    g.fillRect(PAD, PAD, cur.min * s, s);
    g.fillRect(PAD + cur.max * s, PAD, (1 - cur.max) * s, s);
    g.setLineDash([3, 4]);
    g.strokeStyle = muted;
    g.beginPath();
    g.moveTo(PAD, PAD + s); g.lineTo(PAD + s, PAD);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = accent;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 64; i++) {
      const x = i / 64, [px, py] = this.toPx([x, cur.apply(x)]);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
    this.pts.forEach((p, i) => {
      const [px, py] = this.toPx(p), endPt = i === 0 || i === this.pts.length - 1;
      g.beginPath();
      g.arc(px, py, endPt ? 5 : 4.5, 0, Math.PI * 2);
      g.fillStyle = endPt ? accent : fill;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = accent;
      g.stroke();
    });
    // where the pen is now
    if (this.lastRaw > 0) {
      const [px, py] = this.toPx([this.lastRaw, cur.apply(this.lastRaw)]);
      g.beginPath();
      g.arc(px, py, 3.5, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
    }
    for (const b of this.presetBtns) {
      const p = CURVE_PRESETS.find((x) => x.id === b.dataset.p);
      setClass(b, 'is-on', !!p && same(cleanCurve(p.points), this.pts));
    }
  }
}
