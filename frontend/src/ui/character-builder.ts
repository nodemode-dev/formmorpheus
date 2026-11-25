// Character Builder: the character studio's editor as a large dialog. Presets on the left, the recipe drawn live on a
// canvas in the middle, Look, Hair and Outfit on the right. Built once from a template and patched in place; the preview
// and the tiles are canvases redrawn on the next frame after the recipe changes, so a slider never touches the DOM.
import '../styles/character-builder.css';
import {
  build, castToCharacterGroup, mergeRebuild, mkSpec, prepareRebuild, solveRest,
  EYECOL, HAIRCOL, HAIRS, OUTFITS, SKINS, SPECIES, STUDIO_PRESETS,
  type CastInput, type CastPrepared, type CastPrim, type CastRig, type CastSpec, type Mat,
} from '../engine/cast';
import { hex2rgb, rgb2hex } from '../engine/cast/prims';
import type { Engine } from '../engine/engine';
import { floorOf } from '../engine/guides';
import { newMovie } from '../engine/model';
import type { Renderer } from '../engine/render';
import type { Movie } from '../engine/types';
import { placeCharacter, type CharacterSource, type CharactersPanel } from './characters-panel';
import { Dialog } from './dialogs';
import { el, q, setClass, setDisabled, setHidden, setText, setTitle, setValue } from './dom';
import { t } from './i18n';
import { tf } from './i18n-fill';
import { toast } from './toast';

type Tab = 'look' | 'hair' | 'outfit';
type Group = CastSpec['group'];
type Beard = CastSpec['face']['beard'];
type BodyKey = keyof CastSpec['body'];
type FaceFlag = 'lashes' | 'blush' | 'freckles' | 'earrings' | 'glasses';

export interface BuilderDeps {
  renderer: Renderer;
  characters: CharactersPanel;
}

const GROUPS: ReadonlyArray<readonly [Group, string]> = [['F', 'Women'], ['M', 'Men'], ['S', 'Specials']];
const SPECIES_LABEL: Record<string, string> = { human: 'Human', robot: 'Robot', alien: 'Alien', monster: 'Monster' };
const BODY: ReadonlyArray<readonly [BodyKey, string, number, number]> = [['h', 'Height', 0.82, 1.18], ['build', 'Build', 0.75, 1.5], ['shoulders', 'Shoulders', 0.8, 1.25], ['head', 'Head size', 0.85, 1.25]];
const FLAGS: ReadonlyArray<readonly [FaceFlag, string, boolean]> = [['lashes', 'Lashes', true], ['blush', 'Blush', true], ['freckles', 'Freckles', true], ['earrings', 'Earrings', true], ['glasses', 'Glasses', false]];
const BEARDS: ReadonlyArray<readonly [Beard, string]> = [['none', 'None'], ['stubble', 'Stubble'], ['mustache', 'Mustache'], ['goatee', 'Goatee'], ['full', 'Full']];
const LIPS: readonly string[] = ['#b5485a', '#8a4a3c', '#8a2f45', '#c46a6a', '#6b3a3a'];

/** The studio's stage: a 600 by 640 view, the character's feet at 300, 588 at 1.08. */
const VIEW_W = 600, VIEW_H = 640, ROOT: Mat = [1.08, 0, 0, 1.08, 300, 588];
const HEAD_PX = 96, TALL_W = 84, TALL_H = 140;

const RANDOM = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none"/></svg>';
const RESET = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4.5v4h4"/></svg>';

const clone = (s: CastSpec): CastSpec => structuredClone(s);
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

interface Drawn { path: Path2D; fill: string | null; stroke?: string; sw?: number; cap?: string; op: number }
interface DrawnSlot { m: Mat; prims: Drawn[] }

function drawnOf(p: CastPrim): Drawn {
  let path: Path2D;
  if (p.t === 'p') path = new Path2D(p.d);
  else if (p.t === 'e') { path = new Path2D(); path.ellipse(p.cx, p.cy, Math.max(0, p.rx), Math.max(0, p.ry), ((p.rot ?? 0) * Math.PI) / 180, 0, Math.PI * 2); }
  else { path = new Path2D(); path.roundRect(p.x, p.y, Math.max(0, p.w), Math.max(0, p.h), Math.max(0, Math.min(p.r, p.w / 2, p.h / 2))); }
  return { path, fill: p.fill, stroke: p.stroke, sw: p.sw, cap: p.t === 'p' ? p.cap : undefined, op: p.op ?? 1 };
}

/** A rig's rest pose as ready-made paths, one entry per slot in draw order. */
function compile(rig: CastRig): DrawnSlot[] {
  const W = solveRest(rig);
  return rig.slots.map((s) => {
    const b = W[s.bone];
    const m: Mat = s.oy ? [b[0], b[1], b[2], b[3], b[0] * s.ox + b[2] * s.oy + b[4], b[1] * s.ox + b[3] * s.oy + b[5]] : b;
    return { m, prims: s.prims.map(drawnOf) };
  });
}

/** Paints compiled slots with `base` (device pixels per rig unit, the rig origin placed) already worked out. */
function paint(ctx: CanvasRenderingContext2D, slots: DrawnSlot[], base: Mat): void {
  ctx.lineJoin = 'round';
  for (const s of slots) {
    const m = s.m;
    ctx.setTransform(base[0] * m[0] + base[2] * m[1], base[1] * m[0] + base[3] * m[1], base[0] * m[2] + base[2] * m[3], base[1] * m[2] + base[3] * m[3], base[0] * m[4] + base[2] * m[5] + base[4], base[1] * m[4] + base[3] * m[5] + base[5]);
    for (const p of s.prims) {
      ctx.globalAlpha = p.op;
      if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(p.path); }
      if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.sw ?? 1; ctx.lineCap = (p.cap as CanvasLineCap | undefined) ?? 'round'; ctx.stroke(p.path); }
    }
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** The rest pose fitted into a canvas: the head close-up or the full figure, as the studio's thumbnails frame them. */
function drawThumb(cv: HTMLCanvasElement, spec: CastSpec, mode: 'head' | 'full'): void {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const rig = build(spec);
  let vb: [number, number, number, number];
  if (mode === 'head') { const cy = -(rig.height - rig.M.headH * 0.5), s = rig.M.headH * 2.05; vb = [-s / 2, cy - s * 0.56, s, s]; }
  else vb = [-125, -rig.height - 48, 250, rig.height + 62];
  const k = Math.min(cv.width / vb[2], cv.height / vb[3]);
  const ox = (cv.width - vb[2] * k) / 2 - vb[0] * k, oy = (cv.height - vb[3] * k) / 2 - vb[1] * k;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  paint(ctx, compile(rig), [k, 0, 0, k, ox, oy]);
}

interface Swatches { root: HTMLElement; buttons: HTMLButtonElement[]; custom: HTMLInputElement }
interface Tile { btn: HTMLButtonElement; cv: HTMLCanvasElement; label: HTMLElement }

export class CharacterBuilder {
  private readonly dlg = new Dialog('Character Builder', 1120);
  private readonly labels: Array<[HTMLElement, string]> = [];
  private presets: CastInput[] = [];
  private presetSpecs: CastSpec[] = [];
  private presetAt = -1;
  /** The recipe Reset goes back to: the preset picked, or the character's build when one is edited. */
  private base: CastSpec;
  private spec: CastSpec;
  private editing: string | null = null;
  private tab: Tab = 'look';
  private drawn: DrawnSlot[] = [];
  private previewDirty = true;
  private raf = 0;
  private thumbTimer = 0;
  private readonly thumbsFor = new Map<HTMLCanvasElement, string>();
  private busy = false;
  private floor = '';

  private readonly rosterBox: HTMLElement;
  private readonly rosterGrids = new Map<Group, HTMLElement>();
  private readonly rosterTiles = new Map<string, Tile>();
  private readonly stageName: HTMLElement;
  private readonly wrap: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly panes = new Map<Tab, HTMLElement>();
  private readonly nameIn: HTMLInputElement;
  private readonly tagOut: HTMLElement;
  private readonly species = new Map<string, HTMLButtonElement>();
  private readonly frames = new Map<'f' | 'm', HTMLButtonElement>();
  private readonly sliders = new Map<string, { input: HTMLInputElement; out: HTMLElement }>();
  private readonly flags = new Map<FaceFlag, HTMLButtonElement>();
  private readonly beards = new Map<Beard, HTMLButtonElement>();
  private readonly skin: Swatches;
  private readonly eye: Swatches;
  private readonly lip: Swatches;
  private readonly hairCol: Swatches;
  private readonly hairTiles: Tile[] = [];
  private readonly outfitTiles: Tile[] = [];
  private readonly colHead: HTMLElement;
  private readonly cols: Array<{ input: HTMLInputElement; label: HTMLElement }> = [];
  private readonly resetBtn: HTMLButtonElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly applyBtn: HTMLButtonElement;
  private readonly humanOnly: Array<HTMLButtonElement | HTMLInputElement> = [];

  constructor(private readonly engine: Engine, private readonly deps: BuilderDeps, presets: readonly CastInput[] = STUDIO_PRESETS) {
    q<HTMLElement>(this.dlg.scrim, '.cv-dialog').classList.add('fm-cb-dlg');
    this.dlg.scrim.addEventListener('keydown', (e) => {
      if ((e.key !== 'z' && e.key !== 'Z') || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const a = document.activeElement;
      if (!(a instanceof HTMLInputElement && a.type === 'text')) e.preventDefault();
      e.stopPropagation();
    }, true);
    const root = el<HTMLElement>(`<div class="fm-cb">
      <nav class="fm-cb-roster"></nav>
      <div class="fm-cb-stage"><div class="fm-cb-stagename" aria-live="polite"></div><div class="fm-cb-canvaswrap"><canvas class="fm-cb-canvas" role="img"></canvas></div></div>
      <section class="fm-cb-panel"><div class="fm-cb-tabs" role="tablist"></div><div class="fm-cb-panes"></div></section>
    </div>`);
    this.dlg.body.appendChild(root);
    this.rosterBox = q(root, '.fm-cb-roster');
    this.stageName = q(root, '.fm-cb-stagename');
    this.wrap = q(root, '.fm-cb-canvaswrap');
    this.canvas = q<HTMLCanvasElement>(root, '.fm-cb-canvas');
    this.lab(this.rosterBox, 'Presets', 'aria-label');
    this.lab(this.canvas, 'Character preview', 'aria-label');

    for (const [g, name] of GROUPS) {
      const h = el<HTMLElement>('<h3 class="fm-cb-h"></h3>');
      this.lab(h, name);
      const grid = el<HTMLElement>('<div class="fm-cb-rgrid"></div>');
      this.rosterGrids.set(g, grid);
      this.rosterBox.append(h, grid);
    }

    const tablist = q(root, '.fm-cb-tabs'), panes = q(root, '.fm-cb-panes');
    this.lab(tablist, 'Character options', 'aria-label');
    tablist.addEventListener('keydown', (e) => {
      const order: Tab[] = ['look', 'hair', 'outfit'], at = order.indexOf(this.tab);
      const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -9;
      if (to === -9) return;
      e.preventDefault();
      const next = order[(to + 3) % 3];
      this.setTab(next);
      this.tabs.get(next)?.focus();
    });
    for (const [id, name] of [['look', 'Look'], ['hair', 'Hair'], ['outfit', 'Outfit']] as const) {
      const b = el<HTMLButtonElement>(`<button type="button" role="tab" class="fm-cb-tab" id="fm-cb-tab-${id}" aria-controls="fm-cb-pane-${id}"></button>`);
      this.lab(b, name);
      b.addEventListener('click', () => this.setTab(id));
      tablist.appendChild(b);
      this.tabs.set(id, b);
      const p = el<HTMLElement>(`<div class="fm-cb-pane" role="tabpanel" id="fm-cb-pane-${id}" aria-labelledby="fm-cb-tab-${id}" hidden></div>`);
      panes.appendChild(p);
      this.panes.set(id, p);
    }

    const look = this.panes.get('look') as HTMLElement;
    const who = el<HTMLElement>('<div class="fm-cb-who"><input class="fm-cb-name" type="text" maxlength="14" spellcheck="false"><small class="fm-cb-tag"></small></div>');
    this.nameIn = q<HTMLInputElement>(who, 'input');
    this.tagOut = q(who, 'small');
    this.lab(this.nameIn, 'Name', 'aria-label');
    this.nameIn.addEventListener('input', () => { this.spec.name = this.nameIn.value.trim() || t('Unnamed'); this.syncName(); });
    look.appendChild(who);
    look.appendChild(this.head('Species'));
    const sp = el<HTMLElement>('<div class="fm-cb-seg" role="group"></div>');
    this.lab(sp, 'Species', 'aria-label');
    for (const s of SPECIES) {
      const b = el<HTMLButtonElement>('<button type="button" aria-pressed="false"></button>');
      this.lab(b, SPECIES_LABEL[s] ?? s);
      b.addEventListener('click', () => { this.spec.species = s; this.changed(); });
      sp.appendChild(b);
      this.species.set(s, b);
    }
    look.appendChild(sp);
    look.appendChild(this.head('Skin'));
    this.skin = this.swatches(SKINS, 'Skin', (c) => { this.spec.skin = c; });
    look.appendChild(this.skin.root);
    look.appendChild(this.head('Body'));
    for (const [k, name, min, max] of BODY) look.appendChild(this.slider(`body.${k}`, name, min, max, (v) => { this.spec.body[k] = v; }));
    const fr = el<HTMLElement>('<div class="fm-cb-seg" role="group"></div>');
    this.lab(fr, 'Frame', 'aria-label');
    for (const [k, name] of [['f', 'Frame A'], ['m', 'Frame B']] as const) {
      const b = el<HTMLButtonElement>('<button type="button" aria-pressed="false"></button>');
      this.lab(b, name);
      b.addEventListener('click', () => { this.spec.frame = k; this.changed(); });
      fr.appendChild(b);
      this.frames.set(k, b);
    }
    look.appendChild(fr);
    look.appendChild(this.head('Face'));
    look.appendChild(this.sub('Eye color'));
    this.eye = this.swatches(EYECOL, 'Eye color', (c) => { this.spec.face.eyeColor = c; });
    look.appendChild(this.eye.root);
    const jaw = this.slider('face.jaw', 'Jaw', 0.55, 1.05, (v) => { this.spec.face.jaw = v; });
    this.humanOnly.push(q<HTMLInputElement>(jaw, 'input'));
    look.appendChild(jaw);
    const chips = el<HTMLElement>('<div class="fm-cb-chips"></div>');
    for (const [k, name, human] of FLAGS) {
      const b = el<HTMLButtonElement>('<button type="button" class="fm-cb-chip" aria-pressed="false"></button>');
      this.lab(b, name);
      b.addEventListener('click', () => { this.spec.face[k] = !this.spec.face[k]; this.changed(); });
      chips.appendChild(b);
      this.flags.set(k, b);
      if (human) this.humanOnly.push(b);
    }
    look.appendChild(chips);
    look.appendChild(this.sub('Facial hair'));
    const beards = el<HTMLElement>('<div class="fm-cb-chips" role="group"></div>');
    this.lab(beards, 'Facial hair', 'aria-label');
    for (const [k, name] of BEARDS) {
      const b = el<HTMLButtonElement>('<button type="button" class="fm-cb-chip" aria-pressed="false"></button>');
      this.lab(b, name);
      b.addEventListener('click', () => { this.spec.face.beard = k; this.changed(); });
      beards.appendChild(b);
      this.beards.set(k, b);
      this.humanOnly.push(b);
    }
    look.appendChild(beards);
    look.appendChild(this.sub('Lip color'));
    this.lip = this.swatches(LIPS, 'Lip color', (c) => { this.spec.face.lip = c; });
    this.humanOnly.push(...this.lip.buttons, this.lip.custom);
    look.appendChild(this.lip.root);
    const row = el<HTMLElement>('<div class="fm-cb-row"><button type="button" class="cv-btn" data-act="random"></button><button type="button" class="cv-btn fm-cb-ghost" data-act="reset"></button></div>');
    const rnd = q<HTMLButtonElement>(row, '[data-act="random"]');
    rnd.insertAdjacentHTML('afterbegin', RANDOM);
    rnd.appendChild(this.lab(el('<span></span>'), 'Randomize'));
    rnd.addEventListener('click', () => this.randomize());
    this.resetBtn = q<HTMLButtonElement>(row, '[data-act="reset"]');
    this.resetBtn.insertAdjacentHTML('afterbegin', RESET);
    this.resetBtn.appendChild(el('<span class="fm-cb-reset-text"></span>'));
    this.resetBtn.addEventListener('click', () => { this.spec = clone(this.base); this.changed(); });
    look.appendChild(row);

    const hair = this.panes.get('hair') as HTMLElement;
    hair.appendChild(this.head('Style'));
    const hg = el<HTMLElement>('<div class="fm-cb-tgrid" role="group"></div>');
    this.lab(hg, 'Hair style', 'aria-label');
    for (let i = -1; i < HAIRS.length; i++) {
      const tile = this.tile(HEAD_PX, HEAD_PX, i < 0 ? 'None' : HAIRS[i].name);
      const at = i;
      tile.btn.addEventListener('click', () => { this.spec.hair.style = at; this.changed(); });
      hg.appendChild(tile.btn);
      this.hairTiles.push(tile);
    }
    hair.appendChild(hg);
    hair.appendChild(this.head('Color'));
    this.hairCol = this.swatches(HAIRCOL, 'Hair color', (c) => { this.spec.hair.color = c; });
    hair.appendChild(this.hairCol.root);

    const outfit = this.panes.get('outfit') as HTMLElement;
    outfit.appendChild(this.head('Outfit'));
    const og = el<HTMLElement>('<div class="fm-cb-tgrid is-tall" role="group"></div>');
    this.lab(og, 'Outfit', 'aria-label');
    OUTFITS.forEach((o, i) => {
      const tile = this.tile(TALL_W, TALL_H, o.name);
      tile.btn.addEventListener('click', () => { this.spec.outfit = i; this.changed(); });
      og.appendChild(tile.btn);
      this.outfitTiles.push(tile);
    });
    outfit.appendChild(og);
    this.colHead = el<HTMLElement>('<h4 class="fm-cb-h"></h4>');
    outfit.appendChild(this.colHead);
    const cols = el<HTMLElement>('<div class="fm-cb-cols"></div>');
    for (let i = 0; i < 3; i++) {
      const lab = el<HTMLElement>('<label class="fm-cb-col"><input type="color"><span></span></label>');
      const input = q<HTMLInputElement>(lab, 'input'), at = i;
      input.addEventListener('input', () => {
        const of = OUTFITS[this.spec.outfit];
        const now = (this.spec.colors[this.spec.outfit] ?? of.def).slice();
        now[at] = input.value;
        this.spec.colors[this.spec.outfit] = now;
        this.changed();
      });
      cols.appendChild(lab);
      this.cols.push({ input, label: q(lab, 'span') });
    }
    const colReset = el<HTMLButtonElement>('<button type="button" class="cv-btn fm-cb-ghost fm-cb-sm"></button>');
    this.lab(colReset, 'Reset colors');
    colReset.addEventListener('click', () => { delete this.spec.colors[this.spec.outfit]; this.changed(); });
    cols.appendChild(colReset);
    outfit.appendChild(cols);

    this.saveBtn = this.dlg.button('Save to Characters', 'ghost', () => { void this.save(); });
    this.addBtn = this.dlg.button('Add to Movie', 'primary', () => { void this.add(); });
    this.applyBtn = this.dlg.button('Apply', 'primary', () => { void this.apply(); });
    this.saveBtn.classList.add('cv-btn-apart');

    this.dlg.onClose = () => { cancelAnimationFrame(this.raf); this.raf = 0; window.clearTimeout(this.thumbTimer); };
    new ResizeObserver(() => this.fitCanvas()).observe(this.wrap);

    this.setPresets(presets);
    this.base = clone(this.presetSpecs[0] ?? mkSpec(STUDIO_PRESETS[0]));
    this.spec = clone(this.base);
    this.presetAt = this.presetSpecs.length ? 0 : -1;
  }

  get isOpen(): boolean { return this.dlg.isOpen; }

  /** The presets roster, any list of recipe inputs: rows are patched in place by id. */
  setPresets(list: readonly CastInput[]): void {
    this.presets = list.slice();
    this.presetSpecs = this.presets.map(mkSpec);
    for (const [g, grid] of this.rosterGrids) {
      const keep = new Set<string>();
      this.presets.forEach((p, i) => {
        if (p.group !== g) return;
        keep.add(p.id);
        let tile = this.rosterTiles.get(p.id);
        if (!tile) {
          tile = this.tile(HEAD_PX, HEAD_PX, p.name, true);
          tile.btn.classList.add('fm-cb-rc');
          tile.btn.dataset.preset = p.id;
          tile.btn.addEventListener('click', () => this.pick(tile?.btn.dataset.preset ?? ''));
          this.rosterTiles.set(p.id, tile);
        }
        setText(tile.label, p.name);
        setTitle(tile.btn, `${p.name} · ${p.tag}`);
        if (tile.btn.parentElement !== grid) grid.appendChild(tile.btn);
        drawThumb(tile.cv, this.presetSpecs[i], 'head');
      });
      for (const child of Array.from(grid.children)) if (!keep.has((child as HTMLElement).dataset.preset ?? '')) { this.rosterTiles.delete((child as HTMLElement).dataset.preset ?? ''); child.remove(); }
    }
  }

  /** Opens on a fresh recipe: the first preset, or the one last picked. */
  open(): void {
    if (this.dlg.isOpen) return;
    this.editing = null;
    if (this.presetAt < 0 && this.presetSpecs.length) { this.presetAt = 0; this.base = clone(this.presetSpecs[0]); this.spec = clone(this.base); }
    this.show();
  }

  openPreset(id: string): void {
    const i = this.presets.findIndex((p) => p.id === id);
    if (i < 0) { this.open(); return; }
    if (this.dlg.isOpen) { if (!this.editing) this.pick(id); return; }
    this.editing = null;
    this.presetAt = i;
    this.base = clone(this.presetSpecs[i]);
    this.spec = clone(this.base);
    this.show();
  }

  /** Opens on a character of the movie whose recipe is known; Apply rebuilds it from the edited recipe. */
  edit(charId: string): void {
    if (this.dlg.isOpen) return;
    const g = this.engine.selected.find((c) => c.id === charId) ?? null;
    const spec = g?.character?.build;
    if (!g || !spec) return;
    this.editing = charId;
    this.presetAt = -1;
    this.base = clone(spec);
    this.spec = clone(spec);
    this.show();
  }

  private show(): void {
    for (const [n, en] of this.labels) this.relabel(n, en);
    setHidden(this.applyBtn, !this.editing);
    setClass(this.addBtn, 'cv-btn-primary', !this.editing);
    this.floor = getComputedStyle(this.wrap).getPropertyValue('--fm-cb-floor').trim();
    this.thumbsFor.clear();
    this.sync();
    this.setTab(this.tab);
    this.dlg.open(this.tabs.get(this.tab) ?? null);
    this.fitCanvas();
    this.previewDirty = true;
    this.schedule();
  }

  private lab<T extends HTMLElement>(n: T, en: string, attr: 'text' | 'aria-label' = 'text'): T {
    n.dataset.cbEn = en;
    n.dataset.cbAttr = attr;
    this.labels.push([n, en]);
    this.relabel(n, en);
    return n;
  }

  private relabel(n: HTMLElement, en: string): void {
    const s = t(en);
    if (n.dataset.cbAttr === 'aria-label') { if (n.getAttribute('aria-label') !== s) n.setAttribute('aria-label', s); }
    else setText(n, s);
  }

  private head(en: string): HTMLElement { return this.lab(el<HTMLElement>('<h4 class="fm-cb-h"></h4>'), en); }
  private sub(en: string): HTMLElement { return this.lab(el<HTMLElement>('<div class="fm-cb-lbl"></div>'), en); }

  private slider(key: string, en: string, min: number, max: number, set: (v: number) => void): HTMLElement {
    const row = el<HTMLElement>(`<label class="fm-cb-sl"><span></span><input type="range" min="${min}" max="${max}" step="0.01"><output class="fm-cb-out"></output></label>`);
    this.lab(q(row, 'span'), en);
    const input = q<HTMLInputElement>(row, 'input'), out = q(row, 'output');
    input.addEventListener('input', () => { const v = +input.value; set(v); setText(out, v.toFixed(2)); this.changed(); });
    this.sliders.set(key, { input, out });
    return row;
  }

  private swatches(cols: readonly string[], en: string, set: (c: string) => void): Swatches {
    const root = el<HTMLElement>('<div class="fm-cb-sws" role="group"></div>');
    this.lab(root, en, 'aria-label');
    const buttons = cols.map((c) => {
      const b = el<HTMLButtonElement>('<button type="button" class="fm-cb-sw" aria-pressed="false"></button>');
      b.style.background = c;
      b.setAttribute('aria-label', c);
      b.title = c;
      b.dataset.col = c;
      b.addEventListener('click', () => { set(c); this.changed(); });
      root.appendChild(b);
      return b;
    });
    const custom = el<HTMLInputElement>('<input type="color" class="fm-cb-custom">');
    this.lab(custom, 'Custom color', 'aria-label');
    custom.addEventListener('input', () => { set(custom.value); this.changed(); });
    root.appendChild(custom);
    return { root, buttons, custom };
  }

  private tile(w: number, h: number, en: string, plain = false): Tile {
    const btn = el<HTMLButtonElement>('<button type="button" class="fm-cb-tc" aria-pressed="false"><canvas></canvas><span></span></button>');
    const cv = q<HTMLCanvasElement>(btn, 'canvas'), label = q(btn, 'span');
    cv.width = w * 2; cv.height = h * 2;
    if (plain) setText(label, en); else this.lab(label, en);
    return { btn, cv, label };
  }

  private setTab(id: Tab): void {
    this.tab = id;
    for (const [k, b] of this.tabs) {
      const on = k === id;
      setClass(b, 'is-on', on);
      if (b.getAttribute('aria-selected') !== String(on)) b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const [k, p] of this.panes) setHidden(p, k !== id);
    this.thumbs();
  }

  private pick(id: string): void {
    const i = this.presets.findIndex((p) => p.id === id);
    if (i < 0) return;
    this.presetAt = i;
    this.base = clone(this.presetSpecs[i]);
    this.spec = clone(this.base);
    this.changed();
  }

  /** The studio's Randomize: hair, its colour and the outfit at random, a human's skin from the human tones, and the
   *  outfit's colours with each channel's red, green and blue turned round at random. */
  private randomize(): void {
    const r = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
    const c = this.spec;
    c.hair.style = Math.floor(Math.random() * HAIRS.length);
    c.hair.color = r(HAIRCOL);
    c.outfit = Math.floor(Math.random() * OUTFITS.length);
    if (c.species === 'human') c.skin = r(SKINS.slice(0, 10));
    c.colors[c.outfit] = OUTFITS[c.outfit].def.map((h) => { const [rr, g, b] = hex2rgb(h), k = Math.floor(Math.random() * 3); return k === 0 ? h : k === 1 ? rgb2hex(g, b, rr) : rgb2hex(b, rr, g); });
    this.changed();
  }

  private changed(): void {
    this.previewDirty = true;
    this.sync();
    this.schedule();
    window.clearTimeout(this.thumbTimer);
    this.thumbTimer = window.setTimeout(() => this.thumbs(), 140);
  }

  private schedule(): void {
    if (this.raf || !this.dlg.isOpen) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.drawPreview(); });
  }

  private syncName(): void {
    setText(this.stageName, this.spec.tag ? `${this.spec.name} · ${this.spec.tag}` : this.spec.name);
    setText(q(this.resetBtn, '.fm-cb-reset-text'), tf('Reset {name}', { name: this.base.name }));
  }

  /** Every control shows the recipe: classes, values and text only. */
  private sync(): void {
    const c = this.spec, f = c.face, human = c.species === 'human';
    setValue(this.nameIn, c.name);
    setText(this.tagOut, c.tag);
    this.syncName();
    for (const [k, b] of this.species) this.press(b, c.species === k);
    for (const [k, b] of this.frames) this.press(b, c.frame === k);
    for (const [k] of BODY) this.slide(`body.${k}`, c.body[k]);
    this.slide('face.jaw', f.jaw);
    for (const [k, b] of this.flags) this.press(b, !!f[k]);
    for (const [k, b] of this.beards) this.press(b, f.beard === k);
    for (const n of this.humanOnly) setDisabled(n, !human);
    this.swatch(this.skin, c.skin);
    this.swatch(this.eye, f.eyeColor);
    this.swatch(this.lip, f.lip);
    this.swatch(this.hairCol, c.hair.color);
    this.hairTiles.forEach((tl, i) => this.press(tl.btn, c.hair.style === i - 1));
    this.outfitTiles.forEach((tl, i) => this.press(tl.btn, c.outfit === i));
    for (const [id, tl] of this.rosterTiles) this.press(tl.btn, this.presetAt >= 0 && this.presets[this.presetAt]?.id === id);
    const of = OUTFITS[c.outfit], col = c.colors[c.outfit] ?? of.def;
    setText(this.colHead, tf('{outfit} colors', { outfit: t(of.name) }));
    this.cols.forEach((x, i) => { setValue(x.input, col[i]); setText(x.label, t(of.labels[i])); if (x.input.getAttribute('aria-label') !== t(of.labels[i])) x.input.setAttribute('aria-label', t(of.labels[i])); });
  }

  private press(b: HTMLButtonElement, on: boolean): void {
    setClass(b, 'is-on', on);
    if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
  }

  private slide(key: string, v: number): void {
    const s = this.sliders.get(key);
    if (!s) return;
    setValue(s.input, String(v));
    setText(s.out, v.toFixed(2));
  }

  private swatch(s: Swatches, val: string): void {
    for (const b of s.buttons) this.press(b, same(b.dataset.col ?? '', val));
    if (/^#[0-9a-f]{6}$/i.test(val)) setValue(s.custom, val.toLowerCase());
  }

  /** The canvas's pixels follow its box: resized in the same task, so it is never shown blank. */
  private fitCanvas(): void {
    const r = this.wrap.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w; this.canvas.height = h;
    this.drawPreview(false);
  }

  private drawPreview(rebuild = true): void {
    if (rebuild && this.previewDirty) { this.drawn = compile(build(this.spec)); this.previewDirty = false; }
    else if (!this.drawn.length) { this.drawn = compile(build(this.spec)); this.previewDirty = false; }
    const cv = this.canvas, ctx = cv.getContext('2d');
    if (!ctx) return;
    const k = Math.min(cv.width / VIEW_W, cv.height / VIEW_H), ox = (cv.width - VIEW_W * k) / 2, oy = (cv.height - VIEW_H * k) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (this.floor) {
      ctx.fillStyle = this.floor;
      ctx.beginPath();
      ctx.ellipse(ox + 300 * k, oy + VIEW_H * k, 430 * k, 92 * k, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    paint(ctx, this.drawn, [k * ROOT[0], 0, 0, k * ROOT[3], ox + ROOT[4] * k, oy + ROOT[5] * k]);
  }

  /** The open tab's tiles show the recipe with each choice; only redrawn when the recipe changed since. */
  private thumbs(): void {
    if (!this.dlg.isOpen) return;
    const hair = this.tab === 'hair';
    const tiles = hair ? this.hairTiles : this.tab === 'outfit' ? this.outfitTiles : [];
    tiles.forEach((tl, i) => {
      const k = clone(this.spec);
      if (hair) k.hair.style = i - 1; else k.outfit = i;
      const { id: _id, name: _name, tag: _tag, colors, ...look } = k;
      const key = JSON.stringify([look, colors[k.outfit] ?? null]);
      if (this.thumbsFor.get(tl.cv) === key) return;
      this.thumbsFor.set(tl.cv, key);
      drawThumb(tl.cv, k, hair ? 'head' : 'full');
    });
  }

  private async made(movie: Movie): Promise<CharacterSource> {
    const r = await castToCharacterGroup(clone(this.spec), movie, 0);
    return { group: r.contents[0], width: movie.width, height: movie.height, assets: new Map(r.assets.map((a) => [a.asset.id, a])) };
  }

  private async preload(src: CharacterSource['assets']): Promise<void> {
    const pics = new Map<string, Blob>();
    for (const [id, { asset, blob }] of src) if (asset.kind === 'image' || asset.kind === 'pixels') pics.set(id, blob);
    await this.deps.renderer.preload(pics);
  }

  private async run(job: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    // marked busy rather than disabled, so the focused button keeps focus and Escape still reaches the dialog
    const btns = [this.addBtn, this.saveBtn, this.applyBtn];
    for (const b of btns) { b.setAttribute('aria-disabled', 'true'); setClass(b, 'is-busy', true); }
    try { await job(); } catch (e) { toast(e instanceof Error ? e.message : t('The character could not be built.'), 'error'); } finally {
      this.busy = false;
      for (const b of btns) { b.removeAttribute('aria-disabled'); setClass(b, 'is-busy', false); }
    }
  }

  /** Add to Movie: a new character at the Playhead, standing on the movie's floor like a starter; one undo step. */
  private add(): Promise<void> {
    return this.run(async () => {
      const m = this.engine.movie;
      if (!m) { toast(t('Open or create a movie first.')); return; }
      const name = this.spec.name;
      const src = await this.made(m);
      const id = await placeCharacter(this.engine, this.deps.renderer, src, 'playhead', floorOf(this.engine.movie?.guides));
      if (id) toast(tf('{name} added to the movie.', { name }));
    });
  }

  /** Save to Characters: into Mine, the recipe kept with it so it opens here again. */
  private save(): Promise<void> {
    return this.run(async () => {
      const m = this.engine.movie ?? newMovie({ width: 1920, height: 1080 });
      const src = await this.made(m);
      await this.preload(src.assets);
      await this.deps.characters.save(src.group, src);
    });
  }

  /** Apply: the character being edited rebuilt from the recipe, keeping its keys and actions; one undo step. */
  private apply(): Promise<void> {
    return this.run(async () => {
      const id = this.editing;
      if (!id) return;
      const spec = clone(this.spec), m = this.engine.movie;
      if (!m) return;
      const prep = await prepareApply(m, id, spec);
      for (const { asset, blob } of prep.assets) if (!this.engine.assets.has(asset.id)) this.engine.assets.set(asset.id, blob);
      await this.preload(new Map(prep.assets.map((a) => [a.asset.id, a])));
      let hidden: string[] = [];
      const ok = this.engine.run('Apply Character Builder', (mv) => { const r = prep.merge(mv); hidden = r.hidden; return { movie: r.movie, select: [id] }; });
      if (ok) toast(hidden.length ? tf('{name} updated. Parts it no longer draws are hidden: {parts}.', { name: spec.name, parts: hidden.join(', ') }) : tf('{name} updated.', { name: spec.name }));
    });
  }
}

/** The one place Apply meets the engine's rebuild: an async build, then a synchronous merge run inside the undo step
 *  against the movie as it is then. */
async function prepareApply(movie: Movie, charId: string, spec: CastSpec): Promise<{ assets: CastPrepared['assets']; merge: (mv: Movie) => { movie: Movie; hidden: string[] } }> {
  const prepared = await prepareRebuild(spec, movie);
  return {
    assets: prepared.assets,
    merge: (mv) => { const r = mergeRebuild(mv, charId, prepared); return { movie: r.movie, hidden: r.hidden }; },
  };
}
