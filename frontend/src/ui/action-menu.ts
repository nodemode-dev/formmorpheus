// Keyframe mode menus: the Action menu on the Playhead pill, the parameter cards, and the lane context menu.
import type { Engine } from '../engine/engine';
import { baseValues, easeAt, easeCurve, evalLane, kindSpec, KEY_KINDS, laneFrames, laneOf, shownOf, storedOf, type ChannelSpec } from '../engine/keys';
import { locate } from '../engine/model';
import { fitBase, isScaleChannel } from '../engine/fit-base';
import { setEasePreview, setLaneBase, setLaneShown } from './key-lanes';
import { dropChannels } from '../engine/key-chan-ops';
import * as keyOps from '../engine/key-ops';
import type { KeyClip } from '../engine/key-ops';
import * as ops from '../engine/ops';
import { applyTake, Recorder, roomFor } from '../engine/perform';
import { perform } from './perform-ui';
import { EASES, type Content, type Ease, type KeyKind } from '../engine/types';
import { el, q, setClass, setHidden, setStyleVar, setText } from './dom';
import { icon } from './icons';
import { t as tt } from './i18n';
import { Popover, popRow, popSep, type PopRow } from './popover';
import { WarpCard } from './warp-card';
import { warpMode } from './warp-view';
import { bonesMode } from './bones-view';
import '../engine/fx';
import { eyedropButton } from './fx-stage-tools';
import { ActionGroups, FILTER_GROUPS, MOTION_GROUPS } from './action-groups';
import { FxStack } from './fx-stack';
import { buildCurves, buildSwatch, groupHead, type CurvesExtra, type Swatch } from './fx-params';

export const CLAPPER = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.6 6.4l16.8-3.3.8 3.9-16.8 3.3z"/><path d="M4 11h16v8.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M8.4 4.6l1.6 3.2M13.6 3.6l1.6 3.2"/></svg>';
const SPARKLE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4l1.8 4.6L16.4 10.4 11.8 12.2 10 16.8 8.2 12.2 3.6 10.4 8.2 8.6z"/><path d="M18 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></svg>';

/** State the Keyframe UI shares between the menus and the Timeline. */
export interface KeyState {
  lastEase: Ease;
  clip: KeyClip | null;
}

const shared: KeyState = { lastEase: 'linear', clip: null };

/** The one Keyframe UI state (last ease, key clipboard), shared by the Timeline menus and the Stage. */
export function newKeyState(): KeyState {
  return shared;
}

/** Add the lane for `kind` (collapsed, with a key at `at` and optionally at the start); an existing lane gets a key at `at`. */
export function ensureLane(c: Content, kind: KeyKind, at: number, keyAtStart: boolean, ease: Ease): Content {
  if (laneOf(c, kind)) return keyOps.addLane(c, kind, at, keyAtStart, ease);
  return keyOps.setExpanded(keyOps.addLane(c, kind, at, keyAtStart, ease), kind, false);
}

interface Target { c: Content; local: number }

function targetOf(engine: Engine): Target | null {
  const sel = engine.selected;
  const c = sel.length === 1 ? sel[0] : null;
  if (!c || !engine.isOver(c)) return null;
  return { c, local: engine.frame - c.start };
}

export function curveIcon(ease: Ease): string {
  const f = easeCurve(ease);
  const pts: string[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push(`${(2 + 12 * t).toFixed(1)},${(14 - 12 * f(t)).toFixed(1)}`);
  }
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x=".75" y=".75" width="14.5" height="14.5" rx="3.5" stroke-opacity=".35" stroke-width="1"/><polyline points="${pts.join(' ')}"/></svg>`;
}

interface CardRow { ch: ChannelSpec; wrap: HTMLElement; range: HTMLInputElement; pill: HTMLElement; edit: HTMLInputElement }
interface Card {
  kind: KeyKind;
  root: HTMLElement;
  rows: CardRow[];
  seg: Map<string, HTMLButtonElement>;
  toggles: Map<string, HTMLButtonElement>;
  extra?: WarpCard;
  /** Registry effects: color swatches (by color id) and the curve editor. */
  swatches?: Map<string, Swatch>;
  curves?: CurvesExtra;
}

/** A card slider being recorded in Perform mode. */
interface CardTake { id: string; kind: KeyKind; channel: string; rec: Recorder; start: number; last: number | null; tag: string; /** History depth and Playhead frame when the take began (for Retake). */ before: number; from: number }

const ADVANCED = new Set(['offsetX', 'offsetY', 'travel']);
type View = 'action' | 'motion' | 'filter' | 'card';

function fmt(ch: ChannelSpec, v: number, base = 1): string {
  const n = shownOf(ch, v, isScaleChannel(ch.id) ? base : 1);
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  const s = String(r);
  return ch.unit === '%' ? `${s}%` : ch.unit === 'deg' ? `${s}°` : ch.unit === 'x' ? `${s}x` : ch.unit === 'px' ? `${s} px` : s;
}

export class ActionMenu {
  private readonly pop: Popover;
  private readonly views: Record<'action' | 'motion' | 'filter', HTMLElement>;
  private readonly moveBtn: HTMLButtonElement;
  private readonly filterBtn: HTMLButtonElement;
  private readonly levelBtn: HTMLButtonElement;
  /** Shape, Solid and Adjustment content: opens the Shape panel (ui/shape-panel.ts). */
  private readonly shapeBtn: HTMLButtonElement;
  private readonly moveGrp: HTMLElement;
  private readonly filterGrp: HTMLElement;
  private readonly passHint: HTMLElement;
  private readonly cards = new Map<KeyKind, Card>();
  private readonly cardHost = el('<div class="fm-kc-host"></div>');
  private readonly groups = new ActionGroups();
  private readonly stack: FxStack;
  private view: View = 'action';
  private cardKind: KeyKind | null = null;
  private anchor: HTMLElement | null = null;
  private tag: string | null = null;
  private take: CardTake | null = null;
  private cardTag: string | null = null;

  constructor(private readonly engine: Engine, private readonly state: KeyState) {
    this.pop = new Popover('fm-ka');
    setLaneBase((c) => (engine.movie ? fitBase(engine.movie, c) : 1));
    // lanes show for the chosen blocks only (a lane being dragged or edited always belongs to a chosen block)
    setLaneShown((c) => engine.selection.content.includes(c.id));
    this.stack =new FxStack(engine, (k) => this.choose(k));
    const action = el('<div class="fm-ka-view"><div class="fm-ka-title">Action</div><div class="fm-ka-btns"></div></div>');
    const btns = q(action, '.fm-ka-btns');
    const mk = (label: string, svg: string): HTMLButtonElement => {
      const b = el<HTMLButtonElement>(`<button class="fm-ka-btn" type="button"><span class="fm-ka-bico">${svg}</span><span></span></button>`);
      setText(q(b, 'span:last-child'), label);
      btns.appendChild(b);
      return b;
    };
    this.moveBtn = mk('Move', kindSpec('move').icon);
    this.filterBtn = mk('Filter', SPARKLE);
    this.levelBtn = mk('Level', kindSpec('volume').icon);
    this.moveBtn.addEventListener('click', () => this.show('motion'));
    this.filterBtn.addEventListener('click', () => this.show('filter'));
    this.levelBtn.addEventListener('click', () => this.choose('volume'));
    this.shapeBtn = mk('Shape', kindSpec('shape').icon);
    this.shapeBtn.addEventListener('click', () => { this.pop.hide(); document.dispatchEvent(new CustomEvent('fm:command', { detail: 'shape-options' })); });
    setHidden(this.shapeBtn, true);

    // two steps, as the reference: Action! (Move, Filter) then the list of that choice, with a way back
    const back = (): HTMLButtonElement => el<HTMLButtonElement>(`<button class="fm-ka-back" type="button" aria-label="Back" title="Back">${icon('chevronLeft', 16)}</button>`);
    const motion = el('<div class="fm-ka-view" hidden><div class="fm-ka-title"><span class="fm-ka-tico"></span><span>Move</span></div><div class="fm-ka-list"></div></div>');
    q(motion, '.fm-ka-tico').innerHTML = kindSpec('move').icon;
    const mback = back();
    mback.addEventListener('click', () => this.show('action'));
    q(motion, '.fm-ka-title').prepend(mback);
    const mlist = q(motion, '.fm-ka-list');
    this.groups.fill(mlist, MOTION_GROUPS, ['move', 'warp', 'distort', 'bones', 'time', 'textanim'], (k) => this.kindRow(k));

    const filter = el('<div class="fm-ka-view" hidden><div class="fm-ka-title"><span class="fm-ka-tico"></span><span>Filter</span></div><div class="fm-ka-list"></div></div>');
    q(filter, '.fm-ka-tico').innerHTML = SPARKLE;
    const fback = back();
    fback.addEventListener('click', () => this.show('action'));
    q(filter, '.fm-ka-title').prepend(fback);
    const flist = q(filter, '.fm-ka-list');
    this.groups.fill(flist, FILTER_GROUPS, KEY_KINDS.filter((k) => k.group === 'filter').map((k) => k.kind), (k) => this.kindRow(k));
    flist.appendChild(this.groups.emptyNote);

    this.moveGrp = motion;
    this.filterGrp = filter;
    this.passHint = el('<div class="fm-ka-hint" hidden><span class="fm-ka-hint-text">Filters need a normal blend. A Passthrough group has no picture of its own.</span><button class="fm-ka-hint-fix" type="button">Use Normal</button></div>');
    filter.insertBefore(this.passHint, flist);
    filter.insertBefore(this.stack.root, flist);
    filter.insertBefore(this.groups.search, this.passHint);
    q(this.passHint, '.fm-ka-hint-fix').addEventListener('click', () => {
      const t = targetOf(this.engine);
      if (t) this.engine.run('Blend Mode', (m) => ops.patchContent(m, [t.c.id], { blend: 'normal' }));
      this.paintKeyed();
    });
    this.views = { action, motion, filter };
    this.pop.body.append(action, motion, filter, this.cardHost);
    setHidden(this.cardHost, true);
    // the parameter card stays open while the Stage or the Timeline is worked: only Escape, a press elsewhere or a mode change closes it
    this.pop.keep = (t) => this.view === 'card' && !!t.closest('.fm-stage, .fm-timeline');
    engine.on('mode', () => this.pop.hide());
    engine.on('selection', () => { if (this.pop.isOpen && !targetOf(this.engine)) this.pop.hide(); });
    // typing on the first step goes straight to the search over every filter
    this.pop.el.addEventListener('keydown', (e) => {
      if (this.view !== 'action' || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || (e.target as Element).closest('input')) return;
      const t = targetOf(this.engine);
      if (!t || t.c.kind === 'audio') return;
      this.show('filter');
      const input = q<HTMLInputElement>(this.groups.search, 'input');
      input.value = e.key;
      input.focus();
      input.dispatchEvent(new Event('input'));
      e.preventDefault();
    });
    this.pop.onHide(() => { this.anchor = null; this.cardKind = null; this.endRec(); this.cardTag = null; });
    for (const ev of ['time', 'movie', 'selection'] as const) engine.on(ev, () => { if (this.pop.isOpen && this.view === 'card') this.syncCard(); });
    engine.on('movie', () => { if (this.pop.isOpen) this.paintKeyed(); });
    // a held slider still records: every Playhead step repeats its last value
    engine.on('time', () => { const r = this.take; if (r && r.last !== null && engine.playing) this.recordValue(r, r.last); });
  }

  get isOpen(): boolean { return this.pop.isOpen; }

  hide(): void { this.pop.hide(); }

  /** Open the Action menu on the Playhead pill. */
  open(anchor: HTMLElement): void {
    const t = targetOf(this.engine);
    if (!t) return;
    if (this.pop.isOpen) { this.pop.hide(); return; }
    this.anchor = anchor;
    const audio = t.c.kind === 'audio';
    // a sound has Level only; any other content has Move and Filter
    setHidden(this.moveBtn, audio);
    setHidden(this.filterBtn, audio);
    setHidden(this.levelBtn, !audio);
    setHidden(this.shapeBtn, !(t.c.kind === 'shape' || t.c.kind === 'solid' || t.c.kind === 'adjust'));
    this.show('action');
    this.groups.reset();
    this.paintKeyed();
    this.pop.showFor(anchor, 'above');
    this.reposition();
  }

  /** The red Playhead icon: key `kind` at the Playhead and open its card. */
  openFor(anchor: HTMLElement, kind: KeyKind): void {
    const t = targetOf(this.engine);
    if (!t) return;
    this.anchor = anchor;
    this.show('action');
    this.paintKeyed();
    this.pop.showFor(anchor, 'above');
    this.choose(kind);
  }

  /** Tapping a key on a lane: open that property's card on the key at the Playhead (no new key). */
  editKey(anchor: HTMLElement, kind: KeyKind): void {
    const t = targetOf(this.engine);
    if (!t || kind === 'bones' || !laneOf(t.c, kind)) return;
    if (kind === 'shape') { document.dispatchEvent(new CustomEvent('fm:command', { detail: 'shape-options' })); return; }
    this.anchor = anchor;
    this.cardTag = null;
    this.show('action');
    this.pop.showFor(anchor, 'above');
    this.openCard(kind);
  }

  /** Keep the open menu attached to the pill as the Playhead moves. */
  follow(): void {
    // a card being performed stays put: the slider must not travel under a still pen while the movie plays
    if (this.pop.isOpen && !this.take) this.reposition();
  }

  private kindRow(kind: KeyKind): HTMLElement {
    const spec = kindSpec(kind);
    const r = popRow(null, spec.label);
    r.ico.innerHTML = spec.icon;
    r.el.addEventListener('click', () => this.choose(kind));
    // a property the content already animates reads red, with a Clear button that removes its lane
    const wrap = el(`<div class="fm-ka-krow"></div>`);
    const clear = el<HTMLButtonElement>('<button class="fm-ka-clear" type="button" hidden>Clear</button>');
    clear.addEventListener('click', () => {
      const t = targetOf(this.engine);
      if (!t) return;
      this.engine.run(`Clear ${spec.label}`, (m) => ops.updateContent(m, t.c.id, (cc) => keyOps.deleteLane(cc, kind)));
      this.paintKeyed();
    });
    wrap.append(r.el, clear);
    // swipe left on a red row (touch, pen, or a mouse drag) slides it aside and clears its lane; the Clear button stays for a plain click
    let sw: { id: number; x: number; y: number; dx: number; live: boolean } | null = null;
    r.el.addEventListener('pointerdown', (e) => {
      if (!wrap.classList.contains('is-keyed') || e.button !== 0) return;
      sw = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, live: false };
    });
    r.el.addEventListener('pointermove', (e) => {
      if (!sw || e.pointerId !== sw.id) return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      if (!sw.live) {
        if (dx > -8 || Math.abs(dy) > Math.abs(dx)) { if (Math.abs(dy) > 12) sw = null; return; }
        sw.live = true;
        try { r.el.setPointerCapture(e.pointerId); } catch { /* gone */ }
      }
      sw.dx = Math.min(0, dx);
      r.el.style.transform = `translateX(${sw.dx}px)`;
      r.el.style.opacity = String(Math.max(0.35, 1 + sw.dx / 220));
    });
    const endSwipe = (e: PointerEvent): void => {
      if (!sw || e.pointerId !== sw.id) return;
      const done = sw.live && sw.dx <= -56;
      const live = sw.live;
      sw = null;
      r.el.style.transform = '';
      r.el.style.opacity = '';
      if (live) {
        const eat = (ev: Event): void => ev.stopPropagation();
        r.el.addEventListener('click', eat, { capture: true, once: true });
        window.setTimeout(() => r.el.removeEventListener('click', eat, true), 0);
      }
      if (done) clear.click();
    };
    r.el.addEventListener('pointerup', endSwipe);
    r.el.addEventListener('pointercancel', endSwipe);
    this.keyRows.set(kind, { wrap, clear, row: r });
    return wrap;
  }

  private readonly keyRows = new Map<KeyKind, { wrap: HTMLElement; clear: HTMLButtonElement; row: PopRow }>();

  /** Tints the rows (and the Move, Filter and Level buttons) of properties the target already animates. */
  private paintKeyed(): void {
    const t = targetOf(this.engine);
    setHidden(this.passHint, !(t && t.c.kind === 'group' && t.c.blend === 'passthrough'));
    this.stack.sync(t ? t.c : null);
    for (const [kind, r] of this.keyRows) {
      const on = !!t && laneOf(t.c, kind) !== null;
      setClass(r.wrap, 'is-keyed', on);
      setHidden(r.clear, !on);
      if (kind === 'time') setHidden(r.wrap, !t || !(t.c.kind === 'video' || t.c.kind === 'flipbook' || t.c.kind === 'group'));
      if (kind === 'textanim') setHidden(r.wrap, !t || t.c.kind !== 'text');
      if (kind === 'warp' || kind === 'distort') {
        // an adjustment layer has no picture of its own to bend: the row stays, off, and says why
        const off = !!t && t.c.kind === 'adjust';
        r.row.setDisabled(off);
        r.row.el.title = off ? tt('{kind} needs a picture, and an adjustment layer has none.').replace('{kind}', tt(kindSpec(kind).label)) : '';
      }
    }
    this.groups.refresh();
    const has = (kinds: KeyKind[]): boolean => !!t && kinds.some((k) => laneOf(t.c, k) !== null);
    setClass(this.moveBtn, 'is-keyed', has(['move', 'warp', 'distort', 'bones', 'time']));
    setClass(this.filterBtn, 'is-keyed', has(KEY_KINDS.filter((k) => k.group === 'filter').map((k) => k.kind)));
    setClass(this.levelBtn, 'is-keyed', has(['volume']));
  }

  private show(view: View): void {
    this.view = view;
    for (const k of ['action', 'motion', 'filter'] as const) setHidden(this.views[k], k !== view);
    setHidden(this.cardHost, view !== 'card');
    // a view always opens at its top, so the effect stack is the first thing seen
    for (const k of ['action', 'motion', 'filter'] as const) if (k === view) this.views[k].scrollTop = 0;
    if (this.pop.isOpen) this.reposition();
  }

  private choose(kind: KeyKind): void {
    const t = targetOf(this.engine);
    if (!t) { this.pop.hide(); return; }
    const { c, local } = t;
    const ease = this.state.lastEase;
    // Bones keeps its card on the Stage (it must outlive this menu, which closes on any outside press); the lane appears with the first pose
    if (kind === 'bones') { warpMode.set(null); bonesMode.open(c.id); this.pop.hide(); return; }
    // in Perform the lane and the take that follows are one undo step: they share a merge tag
    this.cardTag = this.engine.mode === 'perform' ? `kc-card-${Date.now()}` : null;
    this.engine.run(`Add ${kindSpec(kind).label} keyframe`, (m) => ops.updateContent(m, c.id, (cc) => ensureLane(cc, kind, local, m.addKeyAtStart, ease)), this.cardTag);
    this.openCard(kind);
  }

  private openCard(kind: KeyKind): void {
    const card = this.card(kind);
    for (const [k, cd] of this.cards) setHidden(cd.root, k !== kind);
    setHidden(card.root, false);
    this.cardKind = kind;
    const target = targetOf(this.engine);
    warpMode.set(kind === 'warp' || kind === 'distort' ? kind : null, target?.c.id ?? null);
    warpMode.tag = this.cardTag;
    bonesMode.open(null);
    this.view = 'card';
    for (const k of ['action', 'motion', 'filter'] as const) setHidden(this.views[k], true);
    setHidden(this.cardHost, false);
    this.syncCard();
    this.reposition();
  }

  private card(kind: KeyKind): Card {
    const have = this.cards.get(kind);
    if (have) return have;
    const spec = kindSpec(kind);
    const root = el(`<div class="fm-kc" data-kind="${kind}" hidden><div class="fm-ka-title"><span class="fm-ka-tico">${spec.icon}</span><span></span></div></div>`);
    setText(q(root, '.fm-ka-title span:last-child'), spec.label);
    const card: Card = { kind, root, rows: [], seg: new Map(), toggles: new Map() };
    if (kind === 'warp' || kind === 'distort') {
      card.extra = new WarpCard(this.engine, kind, () => this.pop.hide());
      root.appendChild(card.extra.root);
      this.cardHost.appendChild(root);
      this.cards.set(kind, card);
      return card;
    }

    for (const opt of spec.options ?? []) {
      if (!opt.choices) continue;
      const seg = el('<div class="fm-kc-seg" role="group"></div>');
      for (const choice of opt.choices) {
        const b = el<HTMLButtonElement>('<button class="fm-kc-segbtn" type="button"></button>');
        setText(b, choice.charAt(0).toUpperCase() + choice.slice(1));
        b.addEventListener('click', () => this.setOption(kind, opt.id, choice));
        card.seg.set(choice, b);
        seg.appendChild(b);
      }
      root.appendChild(seg);
    }

    const main = el('<div class="fm-kc-rows"></div>');
    const adv = el('<div class="fm-kc-rows fm-kc-adv" hidden></div>');
    if (spec.fx) root.dataset.fx = '1';
    const heads = new Map<HTMLElement, string>();
    for (const ch of spec.channels) {
      // keyed on demand by the curve editor, not a slider
      if (ch.demand) continue;
      const box = ADVANCED.has(ch.id) || ch.adv ? adv : main;
      if (ch.group && heads.get(box) !== ch.group) { heads.set(box, ch.group); box.appendChild(groupHead(ch.group)); }
      if (ch.swatch) {
        const sid = ch.swatch;
        const sw = buildSwatch(ch.label.replace(/ red$/, ''), () => { this.tag = `kc-${Date.now()}`; }, (rgb) => this.write(kind, { [sid + 'R']: rgb[0], [sid + 'G']: rgb[1], [sid + 'B']: rgb[2] }), () => { this.engine.endGesture(); this.tag = null; });
        (card.swatches ?? (card.swatches = new Map())).set(sid, sw);
        if (sid === 'key') { sw.root.appendChild(eyedropButton(this.engine, 'Pick color from Stage')); sw.root.dataset.pick = '1'; }
        main.appendChild(sw.root);
      }
      box.appendChild(this.rowFor(card, ch));
    }
    root.appendChild(main);
    if (spec.custom === 'curves') {
      card.curves = buildCurves({
        begin: () => { this.tag = `kc-${Date.now()}`; },
        end: () => { this.engine.endGesture(); this.tag = null; },
        set: (id, value) => this.setOption(kind, id, value),
        key: (vals) => this.write(kind, vals),
        unkey: (prefix) => {
          const t = targetOf(this.engine);
          if (t) this.engine.run('Stop Animating Curve', (m) => ops.updateContent(m, t.c.id, (cc) => dropChannels(cc, kind, (id) => id.startsWith(prefix))), this.tag);
        },
      });
      root.appendChild(card.curves.root);
    }
    if (adv.childElementCount || (spec.options ?? []).some((o) => !o.choices && !o.hidden)) {
      for (const opt of spec.options ?? []) {
        if (opt.choices || opt.hidden) continue;
        const t = el<HTMLButtonElement>('<button class="fm-kc-toggle" type="button" role="switch" aria-checked="false"><span class="fm-kc-tlabel"></span><span class="fm-kc-switch"></span></button>');
        setText(q(t, '.fm-kc-tlabel'), opt.label);
        t.addEventListener('click', () => this.setOption(kind, opt.id, t.getAttribute('aria-checked') !== 'true'));
        card.toggles.set(opt.id, t);
        adv.appendChild(t);
      }
      const head = el<HTMLButtonElement>('<button class="fm-kc-disclose" type="button" aria-expanded="false"><span>Advanced</span><span class="fm-kc-chev"></span></button>');
      q(head, '.fm-kc-chev').innerHTML = icon('chevronDown', 14);
      head.addEventListener('click', () => {
        const open = head.getAttribute('aria-expanded') !== 'true';
        head.setAttribute('aria-expanded', String(open));
        setHidden(adv, !open);
        this.reposition();
      });
      root.append(head, adv);
    }
    this.cardHost.appendChild(root);
    this.cards.set(kind, card);
    return card;
  }

  private rowFor(card: Card, ch: ChannelSpec): HTMLElement {
    const wrap = el(`<div class="fm-kc-row${ch.id === 'hue' ? ' is-hue' : ''}"><span class="fm-kc-label"></span><input class="fm-kc-range" type="range" min="${ch.min}" max="${ch.max}" step="${ch.step}"><span class="fm-kc-val" tabindex="0" title="Double-click to type"></span><input class="fm-kc-edit" type="text" inputmode="decimal" hidden></div>`);
    setText(q(wrap, '.fm-kc-label'), ch.label);
    const range = q<HTMLInputElement>(wrap, '.fm-kc-range');
    range.setAttribute('aria-label', ch.label);
    const pill = q(wrap, '.fm-kc-val');
    const edit = q<HTMLInputElement>(wrap, '.fm-kc-edit');
    const row: CardRow = { ch, wrap, range, pill, edit };
    card.rows.push(row);

    range.addEventListener('pointerdown', () => { this.tag = `kc-${Date.now()}`; this.beginRec(card.kind, ch.id); });
    range.addEventListener('input', () => {
      const v = range.valueAsNumber;
      setStyleVar(range, '--p', this.pct(row, v));
      setText(pill, fmt(ch, v, this.baseNow()));
      if (this.take) this.recordValue(this.take, v);
      else this.write(card.kind, { [ch.id]: v });
    });
    range.addEventListener('change', () => { this.engine.endGesture(); this.tag = null; });

    const begin = (): void => {
      edit.value = String(Math.round(shownOf(ch, range.valueAsNumber, isScaleChannel(ch.id) ? this.baseNow() : 1) * 100) / 100);
      setHidden(pill, true);
      setHidden(edit, false);
      edit.focus();
      edit.select();
    };
    const finish = (commit: boolean): void => {
      if (edit.hidden) return;
      const n = parseFloat(edit.value.replace(/[^0-9eE+.\-]/g, ''));
      setHidden(edit, true);
      setHidden(pill, false);
      if (commit && Number.isFinite(n)) {
        const v = Math.min(ch.max, Math.max(ch.min, storedOf(ch, n, isScaleChannel(ch.id) ? this.baseNow() : 1)));
        this.write(card.kind, { [ch.id]: v });
        this.engine.endGesture();
      }
    };
    pill.addEventListener('dblclick', begin);
    pill.addEventListener('keydown', (e) => { if (e.key === 'Enter') begin(); });
    edit.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    edit.addEventListener('blur', () => finish(true));
    return wrap;
  }

  /** Perform mode: dragging a card slider plays the movie and records the slider as a take. */
  private beginRec(kind: KeyKind, channel: string): void {
    const t = targetOf(this.engine);
    if (this.engine.mode !== 'perform' || !t || this.take) return;
    this.take = { id: t.c.id, kind, channel, rec: new Recorder(kind, [channel]), start: t.c.start, last: null, tag: this.cardTag ?? `kc-rec-${Date.now()}`, before: this.engine.history.past.length, from: this.engine.frame };
    perform.setRecording(true);
    this.engine.play();
    const stop = (): void => { window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); this.endRec(); };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  private recordValue(r: CardTake, v: number): void {
    r.last = v;
    r.rec.add(this.engine.frame - r.start, { [r.channel]: v });
    this.commitTake(r, 0);
  }

  private commitTake(r: CardTake, filtering: number): void {
    const take = r.rec.finish(filtering);
    if (!take) return;
    const ease = this.state.lastEase;
    const at = Math.max(0, Math.round(take.from));
    this.engine.run(`${kindSpec(r.kind).label} performance`, (m) => ops.updateContent(m, r.id, (c) => applyTake(laneOf(c, r.kind) ? c : ensureLane(c, r.kind, at, m.addKeyAtStart, ease), take, 'linear', roomFor(m, r.id))), r.tag);
  }

  private endRec(): void {
    const r = this.take;
    if (!r) return;
    this.take = null;
    if (r.last !== null) r.rec.add(this.engine.frame - r.start, { [r.channel]: r.last });
    this.engine.stop();
    this.commitTake(r, perform.filtering);
    perform.setRecording(false);
    perform.markTake(r.before, this.engine.history.past.length, r.from);
    this.engine.endGesture();
  }

  private pct(row: CardRow, v: number): string {
    const lo = Number(row.range.min), hi = Number(row.range.max);
    return `${hi > lo ? Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)) : 0}%`;
  }

  private write(kind: KeyKind, vals: Record<string, number>): void {
    const t = targetOf(this.engine);
    if (!t) return;
    const { c, local } = t;
    const ease = this.state.lastEase;
    this.engine.run(`${kindSpec(kind).label} keyframe`, (m) => ops.updateContent(m, c.id, (cc) => {
      const base = laneOf(cc, kind) ? cc : ensureLane(cc, kind, local, m.addKeyAtStart, ease);
      return keyOps.setKeys(base, kind, local, vals);
    }), this.tag);
  }

  private setOption(kind: KeyKind, id: string, value: string | number | boolean): void {
    const t = targetOf(this.engine);
    if (!t) return;
    const { c, local } = t;
    const ease = this.state.lastEase;
    this.engine.run(`${kindSpec(kind).label} option`, (m) => ops.updateContent(m, c.id, (cc) => {
      const base = laneOf(cc, kind) ? cc : ensureLane(cc, kind, local, m.addKeyAtStart, ease);
      return keyOps.setLaneOption(base, kind, id, value);
    }), this.tag);
  }

  /** What the selected picture's scale reads as 100 percent (its fit). */
  private baseNow(): number {
    const m = this.engine.movie, t = targetOf(this.engine);
    return m && t ? fitBase(m, t.c) : 1;
  }

  /** Patch the open card to the values at the Playhead. */
  private syncCard(): void {
    const kind = this.cardKind;
    const m = this.engine.movie;
    const t = targetOf(this.engine);
    if (!kind || !m || !t) return;
    const card = this.cards.get(kind);
    if (!card) return;
    const lane = laneOf(t.c, kind);
    card.extra?.sync(t.c, lane);
    const vals = lane ? evalLane(t.c, lane, t.local) : baseValues(t.c, kind);
    for (const row of card.rows) {
      const v = vals[row.ch.id] ?? row.ch.def;
      const wide = row.ch.min <= -1000;
      const lim = row.ch.unit === 'px' ? Math.max(m.width, m.height) : 360;
      const big = !wide && row.ch.unit === '%' && row.ch.max >= 5;
      // a signed scale (a flip) starts its slider at the lowest value shown, not at -2000 percent
      const lo = wide ? Math.min(-lim, v) : row.ch.id.startsWith('scale') ? Math.min(0, v) : row.ch.min, hi = wide ? Math.max(lim, v) : big ? Math.max(4, v) : row.ch.max;
      if (row.range.min !== String(lo)) row.range.min = String(lo);
      if (row.range.max !== String(hi)) row.range.max = String(hi);
      if (document.activeElement !== row.range && row.range.valueAsNumber !== v) row.range.value = String(v);
      setStyleVar(row.range, '--p', this.pct(row, v));
      setText(row.pill, fmt(row.ch, v, fitBase(m, t.c)));
    }
    const spec = kindSpec(kind);
    if (card.swatches) for (const [sid, sw] of card.swatches) sw.set([vals[sid + 'R'] ?? 0, vals[sid + 'G'] ?? 0, vals[sid + 'B'] ?? 0]);
    if (card.curves) {
      const o: Record<string, string | number | boolean> = {};
      for (const opt of spec.options ?? []) o[opt.id] = lane?.options[opt.id] ?? opt.def;
      card.curves.sync(o, vals, (id) => !!lane?.channels[id]?.length);
    }
    for (const opt of spec.options ?? []) {
      if (opt.hidden) continue;
      const cur = lane?.options[opt.id] ?? opt.def;
      if (opt.choices) for (const [choice, b] of card.seg) setClass(b, 'is-active', cur === choice);
      else {
        const b = card.toggles.get(opt.id);
        if (b) { setClass(b, 'is-on', cur === true); b.setAttribute('aria-checked', String(cur === true)); }
      }
    }
  }

  private reposition(): void {
    const anchor = this.anchor;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const box = this.pop.el.getBoundingClientRect();
    const margin = 8;
    const ideal = a.left + a.width / 2 - box.width / 2;
    const x = Math.max(margin, Math.min(ideal, window.innerWidth - box.width - margin));
    const y = Math.max(margin, a.top - box.height - 10);
    this.pop.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    const arrow = Math.max(16, Math.min(box.width - 16, a.left + a.width / 2 - x));
    setStyleVar(this.pop.el, '--fm-arrow-x', `${Math.round(arrow)}px`);
  }
}

export interface LaneCtx {
  id: string;
  kind: KeyKind;
  /** Content-local frame of the click (the key's frame when on a key). */
  at: number;
  onKey: boolean;
  channel: string | null;
  /** Local frame of the last key at or before the click (for Set easing), or null. */
  prev: number | null;
  expanded: boolean;
}

export class LaneMenu {
  private readonly pop: Popover;
  private ctx: LaneCtx | null = null;
  private readonly cut: HTMLButtonElement;
  private readonly copy: HTMLButtonElement;
  private readonly paste: HTMLButtonElement;
  private readonly reverse: PopRow;
  private readonly expand: PopRow;
  private readonly setEase: PopRow;
  private readonly setAll: PopRow;
  private readonly del: PopRow;
  private readonly sepA = popSep();
  private readonly sepB = popSep();

  constructor(private readonly engine: Engine, private readonly state: KeyState) {
    this.pop = new Popover('fm-cm fm-lm', 244);
    const tiles = el('<div class="fm-cm-tiles fm-lm-tiles"></div>');
    const tile = (name: 'cut' | 'copy' | 'paste', label: string, run: () => void): HTMLButtonElement => {
      const b = el<HTMLButtonElement>(`<button class="fm-cm-tile" type="button">${icon(name, 16)}<span></span></button>`);
      setText(q(b, 'span:last-child'), label);
      b.addEventListener('click', () => { run(); this.pop.hide(); });
      tiles.appendChild(b);
      return b;
    };
    this.cut = tile('cut', 'Cut', () => this.doCopy(true));
    this.copy = tile('copy', 'Copy', () => this.doCopy(false));
    this.paste = tile('paste', 'Paste', () => this.doPaste());

    this.reverse = popRow(null, 'Reverse keyframes');
    this.expand = popRow(null, 'Expand');
    this.setEase = popRow(null, 'Set easing', { sub: true });
    this.setAll = popRow(null, 'Set all easings', { sub: true });
    this.del = popRow(null, 'Delete', { danger: true });

    this.pop.onHide(() => setEasePreview(null));
    this.pop.attachSub(this.setEase.el, this.easePanel(false));
    this.pop.attachSub(this.setAll.el, this.easePanel(true));
    this.reverse.el.addEventListener('click', () => this.edit('Reverse Keyframes', (c, k) => keyOps.reverseKeys(c, k)));
    this.expand.el.addEventListener('click', () => { const x = this.ctx; if (x) this.engine.view((m) => ops.updateContent(m, x.id, (c) => keyOps.setExpanded(c, x.kind, !x.expanded))); });
    this.del.el.addEventListener('click', () => {
      const x = this.ctx;
      if (!x) return;
      if (x.onKey) this.edit('Delete Keyframe', (c, k) => keyOps.deleteKey(c, k, x.at, x.channel ?? undefined));
      else this.edit(`Delete ${kindSpec(x.kind).label}`, (c, k) => keyOps.deleteLane(c, k));
    });
    for (const r of [this.reverse, this.expand, this.del]) r.el.addEventListener('click', () => this.pop.hide());

    this.pop.body.append(tiles, this.sepA, this.reverse.el, this.expand.el, this.setEase.el, this.setAll.el, this.sepB, this.del.el);
  }

  private easePanel(all: boolean): HTMLElement {
    const panel = Popover.panel('fm-pop fm-cm-sub fm-lm-ease fm-pop-sub');
    // the four everyone knows first, the extras under "More" (a check marks the stretch's current easing)
    const MAIN = 4;
    EASES.forEach((e, i) => {
      if (i === MAIN) {
        panel.appendChild(popSep());
        const head = el('<div class="fm-lm-more"></div>');
        setText(head, 'More');
        panel.appendChild(head);
      }
      const r = popRow(null, e.label, { check: true });
      if (!all) this.easeRows.set(e.id, r);
      r.ico.innerHTML = curveIcon(e.id);
      r.el.addEventListener('click', () => {
        const x = this.ctx;
        if (!x) return;
        this.state.lastEase = e.id;
        if (all) this.edit('Set All Easings', (c, k) => keyOps.setAllEases(c, k, e.id));
        else if (x.prev !== null) this.edit('Set Easing', (c, k) => keyOps.setEase(c, k, x.prev as number, e.id, x.channel ?? undefined));
        this.pop.hide();
      });
      panel.appendChild(r.el);
    });
    return panel;
  }

  /** The single-stretch panel's rows by easing, to show a check on the current one. */
  private readonly easeRows = new Map<Ease, PopRow>();

  open(px: number, py: number, ctx: LaneCtx): void {
    this.ctx = ctx;
    const label = kindSpec(ctx.kind).label;
    const onKey = ctx.onKey;
    setClass(this.cut, 'is-gone', false); // off a key it cuts the whole lane
    setClass(this.paste, 'is-disabled', !this.state.clip);
    setClass(this.sepA, 'is-gone', false);
    setClass(this.reverse.el, 'is-gone', onKey);
    this.expand.setLabel(`${ctx.expanded ? 'Collapse' : 'Expand'} ${label}`);
    // on a key it eases the stretch that starts at that key
    setClass(this.setEase.el, 'is-gone', false);
    this.setEase.setDisabled(ctx.prev === null);
    this.del.setLabel(onKey ? 'Delete keyframe' : `Delete ${label}`);
    // clear of the lane row (its easing name and ticks stay in view): below the pointer, or above it when the screen ends first
    this.pop.showAt(px, py + 22);
    const box = this.pop.el.getBoundingClientRect();
    if (box.top < py + 14) this.pop.showAt(px, py - 22 - box.height);
    // the stretch between the two keys shows its easing name and tick markers while the menu is open
    const m = this.engine.movie, lane = m ? locate(m, ctx.id)?.content.keys.find((l) => l.kind === ctx.kind) : undefined;
    const frames = lane ? laneFrames(lane, ctx.channel ?? undefined) : [];
    const cur = lane && ctx.prev !== null ? easeAt(lane, ctx.prev, ctx.channel ?? undefined) : null;
    for (const [id, r] of this.easeRows) r.setChecked(id === cur);
    const next = ctx.prev === null ? undefined : frames.find((f) => f > (ctx.prev as number));
    setEasePreview(next === undefined || ctx.prev === null ? null : { id: ctx.id, kind: ctx.kind, channel: ctx.channel, a: ctx.prev, b: next });
  }

  private edit(label: string, fn: (c: Content, kind: KeyKind) => Content): void {
    const x = this.ctx;
    if (!x) return;
    this.engine.run(label, (m) => ops.updateContent(m, x.id, (c) => fn(c, x.kind)));
  }

  private doCopy(cut: boolean): void {
    const x = this.ctx, m = this.engine.movie;
    if (!x || !m) return;
    const c = this.engine.selected.find((it) => it.id === x.id);
    if (!c) return;
    const clip = keyOps.copyKeys(c, x.kind, x.onKey ? x.at : undefined);
    if (clip) this.state.clip = clip;
    if (cut && clip) this.edit(x.onKey ? 'Cut Keyframe' : 'Cut Lane', (cc, k) => (x.onKey ? keyOps.deleteKey(cc, k, x.at) : keyOps.deleteLane(cc, k)));
  }

  private doPaste(): void {
    const x = this.ctx, clip = this.state.clip;
    if (!x || !clip) return;
    this.edit('Paste Keyframes', (c) => keyOps.pasteKeys(c, clip, x.at));
  }
}
