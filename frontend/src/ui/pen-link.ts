import '../styles/pen-link.css';
import { Dialog } from './dialogs';
import { el, q, setClass, setHidden, setText } from './dom';
import { t } from './i18n';
import { drawQr } from './qr';
import { socketUrl } from '../io/window-key';

/** What Pen Link needs of Draw & Paint. */
export interface PenLinkPaint {
  penLinkState(): { open: boolean; erase: boolean; size: number; opacity: number };
  penLinkApply(p: { erase?: boolean; size?: number; opacity?: number; history?: 'undo' | 'redo' }): void;
  /** The drawing's own area inside the view, in the view's CSS pixels and clipped to it; null when it cannot say (the whole view is used). */
  penLinkFrame?(): { x: number; y: number; w: number; h: number } | null;
}

interface Status { on: boolean; port: number; urls: string[]; code: string; codeSeconds: number; locked: boolean; paired: boolean; connected: boolean; device: string }

const API = '/api/penlink';
const POINTER = 7731;            // one fixed id: a tablet pen is one pointer
const F_DOWN = 1, F_UP = 2, F_HOVER = 4, F_ERASER = 8, F_BARREL = 16, F_ENTER = 32, F_LEAVE = 64;

/** Pen Link: a tablet with a pen and a browser (on a tablet) as a pressure-sensitive drawing tablet over the
 *  local network. The engine runs the LAN listener; this side holds the localhost socket, turns the tablet's sample
 *  batches into the pointer events a real pen would send to the paint canvas, and mirrors that canvas back. */
export class PenLink extends Dialog {
  private readonly toggle: HTMLButtonElement;
  private readonly codeEl: HTMLElement;
  private readonly codeNote: HTMLElement;
  private readonly urlEl: HTMLElement;
  private readonly qrEl: HTMLCanvasElement;
  private qrFor = '';
  private qrOk = false;
  private readonly statusEl: HTMLElement;
  private readonly newCode: HTMLButtonElement;
  private readonly forget: HTMLButtonElement;
  private readonly offBox: HTMLElement;
  private readonly onBox: HTMLElement;
  private st: Status = { on: false, port: 0, urls: [], code: '', codeSeconds: 0, locked: false, paired: false, connected: false, device: '' };
  private codeUntil = 0;
  private latency = 0;
  private tick = 0;
  private sock: WebSocket | null = null;
  private error = '';

  // receiver
  private hovering = false;
  private down = false;
  private lastKey = '';
  private lastX = 0;
  private lastY = 0;
  // mirror
  private mirrorTimer = 0;
  private view = { w: 0, h: 0 };
  private ackAt = 0;
  private sentAt = 0;
  private pending = false;
  private ackMs = 60;
  private fseq = 0;
  private lastSig = '';
  private lastSend = 0;
  private activeAt = 0;
  private sig = new OffscreenCanvas(24, 24);
  private out: OffscreenCanvas | null = null;

  constructor(private readonly paint: PenLinkPaint) {
    super('Pen Link', 460);
    const root = el(`<div class="fm-pl">
      <p class="fm-pl-intro"></p>
      <div class="fm-pl-off"><button class="cv-btn cv-btn-primary fm-pl-on" type="button"></button></div>
      <div class="fm-pl-on-box" hidden>
        <div class="fm-pl-code" aria-live="polite"></div>
        <div class="fm-pl-note"></div>
        <canvas class="fm-pl-qr" width="168" height="168" role="img"></canvas>
        <div class="fm-pl-url"></div>
        <div class="fm-pl-status"></div>
        <div class="fm-pl-row"><button class="cv-btn fm-pl-new" type="button"></button><button class="cv-btn fm-pl-forget" type="button"></button></div>
      </div>
      <p class="fm-pl-hint"></p>
      <p class="fm-pl-err" hidden></p>
    </div>`);
    this.body.appendChild(root);
    setText(q(root, '.fm-pl-intro'), t('Use a tablet with a pen as a drawing tablet. On the tablet, open the address below in its browser, then type the code. Both must be on the same network.'));
    setText(q(root, '.fm-pl-hint'), t('Turn off handwriting-to-text on the tablet for Pen Link, and keep the page in the foreground while you draw.'));
    this.toggle = q<HTMLButtonElement>(root, '.fm-pl-on');
    this.offBox = q(root, '.fm-pl-off');
    this.onBox = q(root, '.fm-pl-on-box');
    this.codeEl = q(root, '.fm-pl-code');
    this.codeNote = q(root, '.fm-pl-note');
    this.urlEl = q(root, '.fm-pl-url');
    this.qrEl = q<HTMLCanvasElement>(root, '.fm-pl-qr');
    this.qrEl.setAttribute('aria-label', t('QR code of the address'));
    this.statusEl = q(root, '.fm-pl-status');
    this.newCode = q<HTMLButtonElement>(root, '.fm-pl-new');
    this.forget = q<HTMLButtonElement>(root, '.fm-pl-forget');
    setText(this.toggle, t('Turn on Pen Link'));
    setText(this.newCode, t('New code'));
    setText(this.forget, t('Disconnect'));
    this.toggle.addEventListener('click', () => { void this.setOn(!this.st.on); });
    this.newCode.addEventListener('click', () => { void this.call('code'); });
    this.forget.addEventListener('click', () => { void this.call('code'); });
    this.button('Turn off', 'ghost', () => { void this.setOn(false); });
    this.button('Close', 'primary', () => this.close());
    this.paint2dom();
    void this.refresh();   // a page reload while Pen Link is on picks the session up again
    window.addEventListener('beforeunload', () => { try { this.sock?.close(); } catch { /* gone */ } });
  }

  show(): void {
    this.open();
    void this.refresh();
    this.tick = window.setInterval(() => this.paint2dom(), 500);
    const prev = this.onClose;
    this.onClose = () => { clearInterval(this.tick); this.onClose = prev; prev?.(); };
  }

  /** True while a tablet is paired and connected. */
  get active(): boolean { return this.st.on && this.st.connected; }

  private async call(path: string, body?: unknown): Promise<Status | null> {
    try {
      const r = await fetch(`${API}/${path}`, { method: path === 'status' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) { const j = await r.json().catch(() => ({})) as { detail?: string }; this.error = j.detail || t('Pen Link could not start.'); this.paint2dom(); return null; }
      this.error = '';
      this.take(await r.json() as Status);
      return this.st;
    } catch { this.error = t('The engine is not answering.'); this.paint2dom(); return null; }
  }

  private async refresh(): Promise<void> { const s = await this.call('status'); if (s?.on) this.attach(); }

  private async setOn(on: boolean): Promise<void> {
    if (on) { if (await this.call('start')) this.attach(); }
    else { this.detach(); await this.call('stop'); }
  }

  private take(s: Status): void {
    const was = this.st.connected;
    this.st = s;
    this.codeUntil = Date.now() + s.codeSeconds * 1000;
    if (was && !s.connected) this.release();
    if (s.connected && !was) { this.lastKey = ''; this.pushState(true); }
    this.paint2dom();
  }

  // ---------------------------------------------------------------- panel
  private paint2dom(): void {
    const s = this.st;
    setHidden(this.offBox, s.on);
    setHidden(this.onBox, !s.on);
    setText(this.toggle, t('Turn on Pen Link'));
    const left = Math.max(0, Math.round((this.codeUntil - Date.now()) / 1000));
    const code = s.paired ? '' : s.code && left > 0 ? s.code : '';
    setText(this.codeEl, s.paired ? '------' : code ? `${code.slice(0, 3)} ${code.slice(3)}` : '--- ---');
    setClass(this.codeEl, 'fm-pl-dim', !code);
    setText(this.codeNote, s.paired ? t('Paired. The code is used up.') : code ? t('Code expires in {n} s').replace('{n}', String(left)) : s.locked ? t('Too many wrong tries. Ask for a new code.') : t('The code expired. Ask for a new one.'));
    setText(this.urlEl, s.urls.join('\n'));
    // the first address as a code to scan; redrawn only when the address changes
    const first = s.on && !s.paired ? s.urls[0] ?? '' : '';
    if (first && first !== this.qrFor) { this.qrFor = first; this.qrOk = drawQr(this.qrEl, first, 168); }
    // invisible, not removed: the dialog keeps its height, so Close does not move when the tablet pairs
    setClass(this.qrEl, 'fm-pl-qr-off', !first || !this.qrOk);
    setText(this.statusEl, !s.on ? '' : s.connected ? `${t('Paired')}: ${s.device || t('Tablet')} · ${this.latency ? `${this.latency} ms` : '...'}` : s.paired ? t('Paired tablet is reconnecting') : t('Waiting for the tablet'));
    setClass(this.statusEl, 'fm-pl-live', s.connected);
    setText(this.newCode, s.paired ? t('Pair another tablet') : t('New code'));
    setHidden(this.forget, !s.paired);
    const err = q(this.scrim, '.fm-pl-err');
    setText(err, this.error);
    setHidden(err, !this.error);
  }

  // ---------------------------------------------------------------- socket
  private attach(): void {
    if (this.sock && this.sock.readyState <= 1) return;
    void socketUrl(`${API}/desk`).then((url) => {
      if (this.sock && this.sock.readyState <= 1) return;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.sock = ws;
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') this.onText(JSON.parse(ev.data) as Record<string, unknown>);
        else this.onSamples(ev.data as ArrayBuffer);
      };
      ws.onclose = () => { if (this.sock === ws) { this.sock = null; this.release(); window.clearInterval(this.mirrorTimer); this.mirrorTimer = 0; } };
      ws.onopen = () => { window.clearInterval(this.mirrorTimer); this.mirrorTimer = window.setInterval(() => this.mirror(), 70); };
    });
  }

  private detach(): void {
    window.clearInterval(this.mirrorTimer);
    this.mirrorTimer = 0;
    this.release();
    const ws = this.sock;
    this.sock = null;
    try { ws?.close(); } catch { /* gone */ }
  }

  private send(o: object | ArrayBuffer | Blob): void {
    const ws = this.sock;
    if (ws && ws.readyState === 1) ws.send(o instanceof ArrayBuffer || o instanceof Blob ? o : JSON.stringify(o));
  }

  private onText(m: Record<string, unknown>): void {
    switch (m.t) {
      case 'status': this.take(m as unknown as Status); break;
      case 'lat': this.latency = Number(m.ms) || 0; this.paint2dom(); break;
      case 'view': this.view = { w: Number(m.w) || 0, h: Number(m.h) || 0 }; this.lastSig = ''; break;
      case 'ack': this.ackMs = Math.round(this.ackMs * 0.7 + (performance.now() - this.sentAt) * 0.3); this.pending = false; break;
      case 'undo': this.paint.penLinkApply({ history: 'undo' }); break;
      case 'redo': this.paint.penLinkApply({ history: 'redo' }); break;
      case 'tool': this.paint.penLinkApply({ erase: typeof m.erase === 'boolean' ? m.erase : undefined, size: typeof m.size === 'number' ? m.size : undefined, opacity: typeof m.opacity === 'number' ? m.opacity : undefined }); this.pushState(true); break;
    }
  }

  // ---------------------------------------------------------------- the receiver
  private canvas(): HTMLCanvasElement | null {
    const c = document.querySelector<HTMLCanvasElement>('.fm-paint-canvas');
    if (!c || c.offsetParent === null || !this.paint.penLinkState().open) return null;
    this.guardCapture(c);
    return c;
  }

  /** The browser refuses pointer capture for a pointer it does not know (this one is synthetic); the canvas gets the
   *  events directly, so capture for our id is a no-op instead of an exception inside the paint input. */
  private guardCapture(c: HTMLCanvasElement): void {
    if (this.guarded.has(c)) return;
    this.guarded.add(c);
    const set = c.setPointerCapture.bind(c), rel = c.releasePointerCapture.bind(c);
    c.setPointerCapture = (id: number): void => { if (id !== POINTER) set(id); };
    c.releasePointerCapture = (id: number): void => { if (id !== POINTER) rel(id); };
  }
  private readonly guarded = new WeakSet<HTMLCanvasElement>();

  /** The part of the paint view the tablet shows: the drawing itself, not the grey around it. `css` is relative to the
   *  view; the rest is the same rectangle on the page. */
  private frame(c: HTMLCanvasElement): { left: number; top: number; width: number; height: number; css: { x: number; y: number; w: number; h: number } } {
    const r = c.getBoundingClientRect();
    const f = this.paint.penLinkFrame?.() ?? null;
    const css = f && f.w >= 8 && f.h >= 8 ? f : { x: 0, y: 0, w: r.width, h: r.height };
    return { left: r.left + css.x, top: r.top + css.y, width: css.w, height: css.h, css };
  }

  private fire(c: HTMLCanvasElement, type: string, x: number, y: number, o: { pressure: number; tiltX: number; tiltY: number; twist: number; buttons: number; button: number; alt: number; az: number }): void {
    const init: PointerEventInit & Record<string, unknown> = {
      pointerId: POINTER, pointerType: 'pen', isPrimary: true, width: 1, height: 1, clientX: x, clientY: y, screenX: x, screenY: y,
      pressure: o.pressure, tiltX: o.tiltX, tiltY: o.tiltY, twist: o.twist, buttons: o.buttons, button: o.button,
      altitudeAngle: o.alt, azimuthAngle: o.az,
      bubbles: !/enter|leave/.test(type), cancelable: !/enter|leave/.test(type), composed: true, view: window,
    };
    c.dispatchEvent(new PointerEvent(type, init));
  }

  private onSamples(buf: ArrayBuffer): void {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint8(0) !== 1) return;
    const c = this.canvas();
    if (!c) return;
    this.activeAt = performance.now();
    const n = Math.min(v.getUint8(1), Math.floor((v.byteLength - 4) / 20));
    const r = this.frame(c);
    for (let i = 0; i < n; i++) {
      const o = 4 + i * 20;
      const x = r.left + v.getFloat32(o + 2, true) * r.width, y = r.top + v.getFloat32(o + 6, true) * r.height;
      const pr = v.getUint16(o + 10, true) / 65535;
      const f = v.getUint8(o + 16);
      const base = { tiltX: v.getInt8(o + 12), tiltY: v.getInt8(o + 13), twist: Math.round(v.getUint16(o + 14, true) / 10), alt: v.getUint8(o + 18) / 255 * Math.PI / 2, az: v.getUint8(o + 19) / 255 * 2 * Math.PI };
      this.lastX = x; this.lastY = y;
      const erase = (f & F_ERASER) !== 0;
      const barrel = (f & F_BARREL) !== 0 ? 2 : 0;
      const contact = erase ? 32 : 1;
      if (f & F_LEAVE && !(f & F_UP)) {
        if (this.hovering) { this.fire(c, 'pointerout', x, y, { ...base, pressure: 0, buttons: 0, button: -1 }); this.fire(c, 'pointerleave', x, y, { ...base, pressure: 0, buttons: 0, button: -1 }); this.hovering = false; }
        continue;
      }
      if (!this.hovering) { this.hovering = true; this.fire(c, 'pointerover', x, y, { ...base, pressure: 0, buttons: 0, button: -1 }); this.fire(c, 'pointerenter', x, y, { ...base, pressure: 0, buttons: 0, button: -1 }); }
      if (f & F_DOWN) {
        this.down = true;
        this.fire(c, 'pointerdown', x, y, { ...base, pressure: pr, buttons: contact | barrel, button: erase ? 5 : 0 });
      } else if (f & F_UP) {
        if (this.down) { this.down = false; this.fire(c, f & F_LEAVE ? 'pointercancel' : 'pointerup', x, y, { ...base, pressure: 0, buttons: 0, button: erase ? 5 : 0 }); }
      } else if (this.down) {
        this.fire(c, 'pointermove', x, y, { ...base, pressure: pr, buttons: contact | barrel, button: -1 });
      } else {
        this.fire(c, 'pointermove', x, y, { ...base, pressure: 0, buttons: 0, button: -1 });
      }
    }
  }

  /** The tablet went away or was turned off: an open stroke ends, a hover leaves. */
  private release(): void {
    const c = document.querySelector<HTMLCanvasElement>('.fm-paint-canvas');
    // a lift at the last place seen, not a discard: a half stroke from a dropped socket stays as drawn
    if (c && this.down) this.fire(c, 'pointerup', this.lastX, this.lastY, { tiltX: 0, tiltY: 0, twist: 0, alt: 0, az: 0, pressure: 0, buttons: 0, button: 0 });
    if (c && this.hovering) { this.fire(c, 'pointerout', 0, 0, { tiltX: 0, tiltY: 0, twist: 0, alt: 0, az: 0, pressure: 0, buttons: 0, button: -1 }); this.fire(c, 'pointerleave', 0, 0, { tiltX: 0, tiltY: 0, twist: 0, alt: 0, az: 0, pressure: 0, buttons: 0, button: -1 }); }
    this.down = this.hovering = false;
  }

  // ---------------------------------------------------------------- the mirror and the tablet's toolbar
  private pushState(force = false): void {
    const c = this.canvas();
    if (!c) {
      // Draw & Paint is not open: the tablet shows its own message instead of a blank pad
      if (this.lastKey !== 'closed' || force) { this.lastKey = 'closed'; this.send({ t: 'state', open: false }); }
      return;
    }
    const r = this.frame(c);
    const s = this.paint.penLinkState();
    const key = `${Math.round(r.width)}x${Math.round(r.height)}:${s.erase}:${s.size.toFixed(3)}:${s.opacity.toFixed(3)}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.send({ t: 'state', open: true, w: Math.round(r.width), h: Math.round(r.height), erase: s.erase, size: s.size, opacity: s.opacity });
  }

  private mirror(): void {
    if (!this.st.connected) return;
    this.pushState();
    const c = this.canvas();
    if (!c || !this.view.w || !c.width || !c.height) return;
    const now = performance.now();
    if (this.pending && now - this.sentAt < 1500) return;   // ack backpressure: one frame in flight
    const gap = Math.min(200, Math.max(70, this.ackMs * 1.5));
    if (now - this.lastSend < gap) return;
    // only the drawing's area of the view, fitted to the tablet's pixels and never above the canvas's own
    const fr = this.frame(c).css, bx = c.width / Math.max(1, c.getBoundingClientRect().width);
    const cx = Math.max(0, Math.round(fr.x * bx)), cy = Math.max(0, Math.round(fr.y * bx));
    const sw = Math.max(1, Math.min(c.width - cx, Math.round(fr.w * bx))), sh = Math.max(1, Math.min(c.height - cy, Math.round(fr.h * bx)));
    const k = Math.min(1, this.view.w / sw, this.view.h / sh);
    const w = Math.max(16, Math.round(sw * k)), h = Math.max(16, Math.round(sh * k));
    if (!this.out) this.out = new OffscreenCanvas(w, h);
    if (this.out.width !== w || this.out.height !== h) { this.out.width = w; this.out.height = h; this.lastSig = ''; }
    const x = this.out.getContext('2d') as OffscreenCanvasRenderingContext2D;
    x.drawImage(c, cx, cy, sw, sh, 0, 0, w, h);
    // a cheap look at the picture: unchanged for a while means nothing to send, but a frame a second keeps it fresh
    const sx = this.sig.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    sx.drawImage(this.out, 0, 0, 24, 24);
    const d = sx.getImageData(0, 0, 24, 24).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
    const sig = String(sum);
    const busy = now - this.activeAt < 800;
    if (sig === this.lastSig && !busy && now - this.lastSend < 1000) return;
    this.lastSig = sig; this.lastSend = now; this.pending = true; this.sentAt = now;
    const quality = this.ackMs > 250 ? 0.5 : this.ackMs > 120 ? 0.62 : 0.72;
    const seq = this.fseq = (this.fseq + 1) & 0xffff;
    void this.out.convertToBlob({ type: 'image/webp', quality }).then((blob) => {
      const hdr = new Uint8Array(4);
      hdr[0] = 2; hdr[1] = 0; hdr[2] = seq & 255; hdr[3] = seq >> 8;
      this.send(new Blob([hdr, blob]));
    }).catch(() => { this.pending = false; });
  }
}
