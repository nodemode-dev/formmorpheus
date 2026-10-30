import { el, setClass, setHidden, setText } from './dom';
import type { TheaterTools, Target, DropZone } from './home-theater';

/** Pick up and carry movies in the Theater. Press and hold a card (or drag it with the mouse) and it rises as a
 *  small pile of cards that follows the pointer; with several movies selected, the whole selection rides along, and a
 *  second press (another finger, or a right click) on a movie adds it. Drop onto a movie to stack, onto a stack to
 *  add, between cards or on the grid to place; hovering a stack enters it, hovering the back control leaves it; Esc
 *  puts everything back. One ghost element is built once and moved with a transform. */
export interface CarryHost {
  /** What a card key stands for (undefined for cards that cannot be carried). */
  target(key: string): Target | undefined;
  list(): boolean;
  /** A touch or pen hold that is released without moving shows the card's menu. */
  menu(target: Target, x: number, y: number): void;
}

const HOLD = 380;
const MOVE = 6;
const DWELL = 650;
const EDGE = 0.25;

export class TheaterCarry {
  private readonly ghost = el(`<div class="cv-th-ghost" hidden aria-hidden="true">
    <div class="cv-th-gc"><img alt="" draggable="false"></div><div class="cv-th-gc"><img alt="" draggable="false"></div><div class="cv-th-gc"><img alt="" draggable="false"></div>
    <span class="cv-th-gn"></span>
  </div>`);
  private readonly cards = Array.from(this.ghost.querySelectorAll<HTMLElement>('.cv-th-gc'));
  private keys: string[] = [];
  private srcs: string[] = [];
  private down: { id: number; key: string; type: string; sx: number; sy: number } | null = null;
  private active = false;
  private moved = false;
  private x = 0;
  private y = 0;
  private holdTimer = 0;
  private scrollTimer = 0;
  private dwellTimer = 0;
  private dwellOn = '';
  private mark: HTMLElement | null = null;
  private markZone: DropZone | null = null;
  private overBack = false;
  private overGrid = false;

  constructor(private readonly items: HTMLElement, private readonly th: TheaterTools, private readonly host: CarryHost) {
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.ghost);
    items.addEventListener('pointerdown', (e) => this.onDown(e));
    items.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); }, true);
    items.addEventListener('dragstart', (e) => e.preventDefault());
  }

  private readonly onMoveFn = (e: PointerEvent): void => this.onMove(e);
  private readonly onUpFn = (e: PointerEvent): void => this.onUp(e);
  private readonly onCancelFn = (e: PointerEvent): void => { if (this.down && e.pointerId === this.down.id) this.cancel(); };
  private readonly onKeyFn = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.active) return;
    e.preventDefault();
    e.stopPropagation();
    this.cancel();
  };
  private readonly onTouchFn = (e: TouchEvent): void => { if (this.active && e.cancelable) e.preventDefault(); };

  private rowOf(t: EventTarget | null): HTMLElement | null {
    const row = (t as HTMLElement | null)?.closest<HTMLElement>('.cv-hf-item') ?? null;
    return row && this.host.target(row.dataset.key ?? '') ? row : null;
  }

  private onDown(e: PointerEvent): void {
    const row = this.rowOf(e.target);
    if (!row || (e.target as HTMLElement).closest('.cv-hf-remove')) return;
    if (this.active) { this.addCard(row.dataset.key ?? ''); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.down) return;
    this.down = { id: e.pointerId, key: row.dataset.key ?? '', type: e.pointerType, sx: e.clientX, sy: e.clientY };
    this.x = e.clientX;
    this.y = e.clientY;
    this.moved = false;
    document.addEventListener('pointermove', this.onMoveFn);
    document.addEventListener('pointerup', this.onUpFn);
    document.addEventListener('pointercancel', this.onCancelFn);
    document.addEventListener('keydown', this.onKeyFn, true);
    document.addEventListener('touchmove', this.onTouchFn, { passive: false });
    this.holdTimer = window.setTimeout(() => this.start(), HOLD);
  }

  private start(): void {
    const d = this.down;
    if (!d) return;
    const th = this.th;
    const sel = th.selecting && th.selected.has(d.key) ? [...th.selected] : [d.key];
    this.keys = sel;
    this.srcs = [];
    this.active = true;
    th.suppressClick = true;
    this.refreshGhost();
    setHidden(this.ghost, false);
    document.body.classList.add('cv-th-carrying');
    this.markCarried();
    this.moveGhost();
    this.scrollTimer = window.setInterval(() => this.autoScroll(), 30);
    this.hit();
  }

  private addCard(key: string): void {
    if (!key || this.keys.includes(key) || !this.host.target(key)) return;
    this.keys.push(key);
    this.refreshGhost();
    this.markCarried();
  }

  /** Top three thumbnails, a count when there are more than one. */
  private refreshGhost(): void {
    for (const k of this.keys) {
      if (this.srcs.length >= 3) break;
      const img = this.items.querySelector<HTMLElement>(`.cv-hf-item[data-key="${CSS.escape(k)}"] .cv-hf-img`) as HTMLImageElement | null;
      this.srcs.push(img && !img.hidden ? img.src : '');
    }
    const shown = Math.min(3, this.keys.length);
    this.cards.forEach((c, i) => {
      setHidden(c, i >= shown);
      const im = c.firstElementChild as HTMLImageElement;
      const s = this.srcs[i] ?? '';
      if (im.getAttribute('src') !== (s || null)) { if (s) im.src = s; else im.removeAttribute('src'); }
      setHidden(im, !s);
    });
    const n = this.keys.length;
    setText(this.ghost.lastElementChild as HTMLElement, String(n));
    setHidden(this.ghost.lastElementChild as HTMLElement, n < 2);
  }

  private markCarried(): void {
    for (const row of Array.from(this.items.querySelectorAll<HTMLElement>('.cv-hf-item'))) setClass(row, 'is-dragging', this.keys.includes(row.dataset.key ?? ''));
  }

  private moveGhost(): void {
    this.ghost.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)`;
  }

  private onMove(e: PointerEvent): void {
    const d = this.down;
    if (!d || e.pointerId !== d.id) return;
    this.x = e.clientX;
    this.y = e.clientY;
    if (!this.active) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) <= MOVE) return;
      if (d.type === 'mouse') { window.clearTimeout(this.holdTimer); this.start(); } else { this.end(); }   // a finger that moves first is scrolling
      return;
    }
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > MOVE) this.moved = true;
    this.moveGhost();
    this.hit();
  }

  /** What is under the pointer: a card (before, after or into), the back control, the grid, or nothing. */
  private hit(): void {
    this.ghost.style.pointerEvents = 'none';
    const under = document.elementFromPoint(this.x, this.y);
    const th = this.th;
    const back = under?.closest<HTMLElement>('.cv-th-back') ?? null;
    const backOn = !!back && !back.hidden && th.current !== null;
    let row = backOn ? null : this.rowOf(under);
    if (row && this.keys.includes(row.dataset.key ?? '')) row = null;
    let zone: DropZone | null = null;
    if (row) {
      const key = row.dataset.key ?? '', tgt = this.host.target(key), r = row.getBoundingClientRect();
      const f = this.host.list() ? (this.y - r.top) / Math.max(1, r.height) : (this.x - r.left) / Math.max(1, r.width);
      const movies = this.keys.some((k) => k.startsWith('lib:'));
      const nest = th.current === null && movies && !!tgt && (!!tgt.stack || !this.keys.some((k) => k.startsWith('stk:')));
      zone = nest && f >= EDGE && f <= 1 - EDGE ? 'into' : f < 0.5 ? 'before' : 'after';
    }
    this.overBack = backOn;
    const own = !row && !backOn && !!this.rowOf(under);   // over a card in the pile: dropping here changes nothing
    this.overGrid = !row && !backOn && !own && !!under && !!under.closest('.cv-hf, .cv-home-main') && !under.closest('.cv-hf-bar');
    this.setMark(row, zone);
    this.setDwell(backOn ? 'back' : row && zone === 'into' && this.host.target(row.dataset.key ?? '')?.stack ? row.dataset.key ?? '' : '', backOn ? back : row);
    setClass(this.items, 'is-drop-end', this.overGrid);
  }

  private setMark(row: HTMLElement | null, zone: DropZone | null): void {
    if (row === this.mark && zone === this.markZone) return;
    if (this.mark) this.mark.classList.remove('is-drop', 'is-before', 'is-after');
    this.mark = row;
    this.markZone = zone;
    if (row) { setClass(row, 'is-drop', zone === 'into'); setClass(row, 'is-before', zone === 'before'); setClass(row, 'is-after', zone === 'after'); }
  }

  /** Staying over a stack (or the back control) a moment enters (or leaves) it, with the pile still in hand. */
  private setDwell(what: string, node: HTMLElement | null): void {
    if (what === this.dwellOn) return;
    window.clearTimeout(this.dwellTimer);
    for (const n of Array.from(document.querySelectorAll('.is-entering'))) n.classList.remove('is-entering');
    this.dwellOn = what;
    if (!what || !node) return;
    node.classList.add('is-entering');
    this.dwellTimer = window.setTimeout(() => {
      this.dwellOn = '';
      this.setMark(null, null);
      node.classList.remove('is-entering');
      if (what === 'back') this.th.enter(null, true); else this.th.enter(this.host.target(what)?.stack ?? null, true);
      this.markCarried();
      this.hit();
    }, DWELL);
  }

  private autoScroll(): void {
    let n: HTMLElement | null = this.items;
    while (n && n.scrollHeight <= n.clientHeight + 1) n = n.parentElement;
    if (!n) return;
    const r = n.getBoundingClientRect(), edge = 48;
    if (this.y < r.top + edge) n.scrollTop -= Math.ceil((r.top + edge - this.y) / 4);
    else if (this.y > r.bottom - edge) n.scrollTop += Math.ceil((this.y - (r.bottom - edge)) / 4);
  }

  private onUp(e: PointerEvent): void {
    const d = this.down;
    if (!d || e.pointerId !== d.id) return;
    window.clearTimeout(this.holdTimer);
    if (!this.active) { this.end(); return; }
    if (e.clientX || e.clientY) { this.x = e.clientX; this.y = e.clientY; }   // the last move stands when a lift reports no point
    this.hit();
    const keys = this.keys.slice(), row = this.mark, zone = this.markZone, back = this.overBack, grid = this.overGrid, type = d.type, key = d.key;
    const target = this.host.target(key);
    this.end();
    if (!this.moved) {
      if (type !== 'mouse' && target) this.host.menu(target, e.clientX, e.clientY);
      return;
    }
    if (back) void this.th.carryOut(keys);
    else if (row && zone) void this.th.carryDrop(keys, { key: row.dataset.key ?? '', zone });
    else if (grid) void this.th.carryDrop(keys, null);
  }

  private cancel(): void {
    this.end();
  }

  /** Puts the view back: ghost hidden, marks off, listeners off. */
  private end(): void {
    window.clearTimeout(this.holdTimer);
    window.clearTimeout(this.dwellTimer);
    window.clearInterval(this.scrollTimer);
    this.dwellOn = '';
    this.setMark(null, null);
    for (const n of Array.from(document.querySelectorAll('.is-entering'))) n.classList.remove('is-entering');
    for (const n of Array.from(this.items.querySelectorAll('.is-dragging'))) n.classList.remove('is-dragging');
    setClass(this.items, 'is-drop-end', false);
    setHidden(this.ghost, true);
    document.body.classList.remove('cv-th-carrying');
    document.removeEventListener('pointermove', this.onMoveFn);
    document.removeEventListener('pointerup', this.onUpFn);
    document.removeEventListener('pointercancel', this.onCancelFn);
    document.removeEventListener('keydown', this.onKeyFn, true);
    document.removeEventListener('touchmove', this.onTouchFn);
    const was = this.active;
    this.active = false;
    this.down = null;
    this.keys = [];
    this.srcs = [];
    if (was) window.setTimeout(() => { this.th.suppressClick = false; }, 0);
  }
}
