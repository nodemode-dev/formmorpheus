// The Build panel (View, Build Panel): a column docked at the inline start of the Stage with what a movie is made of:
// characters, their actions, starter scenes, the Create rows and the camera. Built once; every list is patched in place.
// It shows only while a movie is open in the editor: never over Home, Draw & Paint or the full-screen preview.
import { CAST_PRESETS } from '../engine/cast';
import { BUILTIN_ACTIONS } from '../engine/actions-builtin';
import type { Engine } from '../engine/engine';
import type { SceneEntry } from '../engine/starter-scene';
import type { ActionDef, Content } from '../engine/types';
import { selectedCharacter } from '../app/action-commands';
import { charactersApi, type CharacterItem } from '../io/characters-api';
import { readSceneManifest, sceneFileUrl, withSvgImage } from '../io/starter-scenes';
import { cameraMode } from './camera-view';
import { PERSON_SVG } from './character-glyph';
import { castPoster, type StarterEntry } from './characters-panel';
import { el, patchList, q, setClass, setDisabled, setHidden, setText, swapMedia } from './dom';
import { t } from './i18n';
import { tf } from './i18n-fill';
import { icon } from './icons';
import { toast } from './toast';
import '../styles/build-panel.css';

export interface BuildPanelDeps {
  /** Runs a command by id (the app's registry) and says whether it is enabled now. */
  run(id: string): void;
  enabled(id: string): boolean;
  /** The command's English label, or null when no such command is registered (its row is left out). */
  label(id: string): string | null;
  /** The starter characters the Characters panel lists from its manifest. */
  starters(): Promise<StarterEntry[]>;
  /** Adds a character to the movie at the Playhead, as the Characters panel's Add to Movie does: `starter:<id>`, `cast:<id>` or `mine:<name>`. */
  addCharacter(key: string): Promise<void>;
  /** Applies an action to the selected character through the action picker's own path (it plays once and says so). */
  applyAction(actionId: string): void;
  /** Lays a starter scene behind everything in the open movie; says whether it did. */
  addScene(entry: SceneEntry): Promise<boolean>;
  /** Calls `listener` after the Characters library changes (a character saved, renamed or deleted), so Mine is read again. */
  onCharactersChanged(listener: () => void): void;
}

type Tab = 'characters' | 'actions' | 'scenes' | 'create' | 'camera';

const STORE = 'formmorpheus.build';
const NARROW = 1100;
const STARTERS = '/starters/characters/';
const THUMB_W = 320, THUMB_H = 180;

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: string }> = [
  { id: 'characters', label: 'Characters', icon: 'character' },
  { id: 'actions', label: 'Actions', icon: 'perform' },
  { id: 'scenes', label: 'Scenes', icon: 'image' },
  { id: 'create', label: 'Create', icon: 'plus' },
  { id: 'camera', label: 'Camera', icon: 'camera' },
];
const isTab = (v: unknown): v is Tab => typeof v === 'string' && TABS.some((x) => x.id === v);

/** The Create card's rows, in its order: what to make, the shapes, what to bring in, then sound and words. */
const CREATE: ReadonlyArray<{ title: string; rows: ReadonlyArray<readonly [string, string]> }> = [
  { title: 'Add new', rows: [['add-drawing', 'drawing'], ['add-flipbook', 'flipbook'], ['add-text', 'text'], ['add-track', 'track']] },
  { title: 'Shape', rows: [['add-shape-rect', 'shRect'], ['add-shape-ellipse', 'shEllipse'], ['add-shape-polygon', 'shPolygon'], ['add-shape-star', 'shStar'], ['add-shape-line', 'shLine'], ['add-shape-arrow', 'shArrow'], ['shape-tool', 'shape'], ['shape-pen', 'shPen'], ['add-solid', 'solid'], ['add-adjust', 'adjust']] },
  { title: 'Import', rows: [['import-photo', 'image'], ['import-video', 'video'], ['import-audio', 'audio'], ['import-file', 'upload']] },
  { title: 'Sound', rows: [['record-audio', 'record'], ['ai-voice', 'audio'], ['subtitles', 'text']] },
];
const TRANSITIONS: ReadonlyArray<string> = ['group-transition-crossfade', 'group-transition-dip', 'group-transition-wipe', 'group-transition-push', 'group-transition-none'];

interface Tile { key: string; name: string; meta: string; poster: string; v?: number; mine: boolean }

function loadState(): { open: boolean; tab: Tab } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as { open?: unknown; tab?: unknown };
    return { open: raw.open !== false, tab: isTab(raw.tab) ? raw.tab : 'characters' };
  } catch { return { open: true, tab: 'characters' }; }
}

export class BuildPanel {
  private readonly root: HTMLElement;
  private readonly tabBtns = new Map<Tab, HTMLButtonElement>();
  private readonly panes = new Map<Tab, HTMLElement>();
  private wanted: boolean;
  private tab: Tab;
  private shownNow = false;
  // characters
  private readonly starterList: HTMLElement;
  private readonly mineList: HTMLElement;
  private readonly mineNote: HTMLElement;
  private starters: StarterEntry[] = [];
  private mine: CharacterItem[] = [];
  private mineRead = false;
  private mineErr = '';
  private castShown = false;
  private readonly busy = new Set<string>();
  private readonly posters = new Map<string, { want: string; url: string }>();
  // actions
  private readonly actNone: HTMLElement;
  private readonly actOwnHead: HTMLElement;
  private readonly actOwnList: HTMLElement;
  private readonly actOwnEmpty: HTMLElement;
  private readonly actStarter: HTMLElement;
  private readonly actStarterRows: Array<{ id: string; node: HTMLButtonElement }> = [];
  // scenes
  private readonly sceneList: HTMLElement;
  private readonly sceneEmpty: HTMLElement;
  private scenes: SceneEntry[] | null = null;
  private readonly drawn = new Set<string>();
  private sceneBusy: string | null = null;
  // command rows (Create, Camera, Background Color)
  private readonly cmdRows: Array<{ id: string; node: HTMLButtonElement; label: HTMLElement; bound: boolean }> = [];
  private readonly camBtn: HTMLButtonElement;
  private patchFrame = 0;

  constructor(private readonly host: HTMLElement, private readonly engine: Engine, private readonly deps: BuildPanelDeps) {
    const saved = loadState();
    // a narrow window starts with the Stage whole; the stored choice is kept for a wider one
    this.wanted = saved.open && window.innerWidth >= NARROW;
    this.tab = saved.tab;

    this.root = el<HTMLElement>(
      '<aside class="fm-build" hidden>' +
      '<div class="fm-build-tabs" role="tablist" aria-orientation="horizontal"></div>' +
      '<div class="fm-build-panes"></div></aside>');
    this.root.setAttribute('aria-label', t('Build Panel'));
    const tabs = q(this.root, '.fm-build-tabs');
    tabs.setAttribute('aria-label', t('Build Panel'));
    const panes = q(this.root, '.fm-build-panes');
    for (const def of TABS) {
      const b = el<HTMLButtonElement>(`<button class="fm-build-tab" type="button" role="tab" id="fm-build-tab-${def.id}" aria-controls="fm-build-pane-${def.id}"><span class="fm-build-tabicon">${icon(def.icon, 16)}</span><span class="fm-build-tablabel"></span></button>`);
      setText(q(b, '.fm-build-tablabel'), t(def.label));
      b.title = t(def.label);
      b.addEventListener('click', () => this.select(def.id));
      tabs.appendChild(b);
      this.tabBtns.set(def.id, b);
      const p = el<HTMLElement>(`<div class="fm-build-pane" role="tabpanel" id="fm-build-pane-${def.id}" aria-labelledby="fm-build-tab-${def.id}" tabindex="-1" hidden></div>`);
      panes.appendChild(p);
      this.panes.set(def.id, p);
    }
    // arrows, Home and End move between tabs; in right to left the arrows follow the reading order
    tabs.addEventListener('keydown', (e) => {
      const order = TABS.map((x) => x.id);
      const at = order.indexOf(this.tab);
      const rtl = getComputedStyle(tabs).direction === 'rtl';
      let to = -1;
      if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) to = (at + 1) % order.length;
      else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) to = (at + order.length - 1) % order.length;
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = order.length - 1;
      if (to < 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.select(order[to]);
      this.tabBtns.get(order[to])?.focus();
    });

    const head = (label: string): HTMLElement => { const h = el<HTMLElement>('<div class="fm-build-sec"></div>'); setText(h, t(label)); return h; };
    const note = (label: string): HTMLElement => { const n = el<HTMLElement>('<p class="fm-build-note"></p>'); setText(n, t(label)); return n; };

    // ---- Characters ----
    const chars = this.pane('characters');
    const newChar = this.cmdRow('character.builder', 'plus', 'New Character...');
    newChar.classList.add('is-lead');
    this.starterList = el<HTMLElement>('<div class="fm-build-tiles" role="group"></div>');
    this.mineList = el<HTMLElement>('<div class="fm-build-tiles" role="group"></div>');
    this.mineNote = el<HTMLElement>('<p class="fm-build-note"></p>');
    chars.append(newChar, head('Mine'), this.mineList, this.mineNote, head('Starters'), this.starterList);
    for (const list of [this.starterList, this.mineList]) {
      list.addEventListener('click', (e) => {
        const tile = (e.target as HTMLElement).closest<HTMLButtonElement>('.fm-build-tile');
        if (tile && !tile.disabled && tile.dataset.key) void this.addCharacter(tile.dataset.key);
      });
    }

    // ---- Actions ----
    const acts = this.pane('actions');
    this.actNone = note('Select a character to see its actions.');
    this.actOwnHead = el<HTMLElement>('<div class="fm-build-sec" data-no-i18n></div>');
    this.actOwnList = el<HTMLElement>('<div class="fm-build-rows" role="group"></div>');
    this.actOwnEmpty = note('No actions of its own yet');
    this.actStarter = el<HTMLElement>('<div class="fm-build-group"></div>');
    const starterRows = el<HTMLElement>('<div class="fm-build-rows" role="group"></div>');
    for (const a of BUILTIN_ACTIONS) {
      const node = this.actionRow(a, false);
      this.actStarterRows.push({ id: a.id, node });
      starterRows.appendChild(node);
    }
    this.actStarter.append(head('Starter actions'), starterRows);
    acts.append(this.actNone, this.actOwnHead, this.actOwnList, this.actOwnEmpty, this.actStarter);
    for (const list of [this.actOwnList, starterRows]) {
      list.addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLButtonElement>('.fm-build-row');
        if (row && !row.disabled && row.dataset.action) this.deps.applyAction(row.dataset.action);
      });
    }

    // ---- Scenes ----
    const scenes = this.pane('scenes');
    this.sceneList = el<HTMLElement>('<div class="fm-build-tiles is-wide" role="group"></div>');
    this.sceneEmpty = note('The starter scenes could not be read.');
    setHidden(this.sceneEmpty, true);
    this.sceneList.addEventListener('click', (e) => {
      const tile = (e.target as HTMLElement).closest<HTMLButtonElement>('.fm-build-tile');
      const entry = tile && !tile.disabled ? this.scenes?.find((s) => s.id === tile.dataset.key) : undefined;
      if (entry) void this.addScene(entry);
    });
    scenes.append(head('Starter scenes'), this.sceneList, this.sceneEmpty, el<HTMLElement>('<div class="fm-build-gap"></div>'), this.cmdRow('stage-background', 'fill', 'Background Color...'));

    // ---- Create ----
    const create = this.pane('create');
    for (const g of CREATE) {
      const rows = el<HTMLElement>('<div class="fm-build-rows" role="group"></div>');
      for (const [id, ic] of g.rows) rows.appendChild(this.cmdRow(id, ic));
      create.append(head(g.title), rows);
    }

    // ---- Camera ----
    const cam = this.pane('camera');
    this.camBtn = el<HTMLButtonElement>(`<button class="fm-build-row" type="button" aria-pressed="false"><span class="fm-build-rowicon">${icon('camera', 18)}</span><span class="fm-build-rowlabel"></span></button>`);
    setText(q(this.camBtn, '.fm-build-rowlabel'), t('Camera mode'));
    this.camBtn.addEventListener('click', () => cameraMode.toggle());
    cameraMode.onChange(() => this.patchCamera());
    const transRows = el<HTMLElement>('<div class="fm-build-rows" role="group"></div>');
    for (const id of TRANSITIONS) transRows.appendChild(this.cmdRow(id, 'swap'));
    cam.append(this.camBtn, note('Drag the camera frame on the Stage to pan, a corner to zoom, the round handle to turn: each drag sets camera keys at the Playhead.'),
      head('Transitions'), transRows, note('A transition goes between two touching blocks inside the selected group, at the cut nearest the Playhead.'));

    host.appendChild(this.root);

    // ---- when it may show ----
    const sync = (): void => this.sync();
    engine.on('projects', sync);
    // Home, Draw & Paint and the full-screen preview say so only in the page: the Home screen's hidden attribute, the
    // app's is-painting class and the Stage's is-preview class (the same marks ui/a11y.ts reads)
    const watch = new MutationObserver(sync);
    const app = host.closest('.cv-app');
    const wrap = host.querySelector('.fm-stage-wrap');
    const home = host.querySelector('.cv-home');
    if (app) watch.observe(app, { attributes: true, attributeFilter: ['class'] });
    if (wrap) watch.observe(wrap, { attributes: true, attributeFilter: ['class'] });
    if (home) watch.observe(home, { attributes: true, attributeFilter: ['hidden'] });

    // ---- what it lists ----
    for (const ev of ['selection', 'movie', 'history', 'mode'] as const) engine.on(ev, () => this.schedule());
    engine.on('playing', (on) => { if (!on) this.schedule(); });
    engine.on('time', () => { if (!engine.playing && this.tab === 'camera') this.schedule(); });
    this.deps.onCharactersChanged(() => { void this.readMine(); });

    // the lists are read at startup, so the panel opens at its full height instead of growing a section after
    void this.deps.starters().then((list) => { this.starters = list; this.paintCharacters(); }, () => undefined);
    void readSceneManifest().then((list) => { this.scenes = list; this.paintScenes(); });
    void this.readMine();
    this.paintTabs();
    this.paintCharacters();
    this.sync();
  }

  get isOpen(): boolean { return this.wanted; }

  show(tab?: string): void {
    if (isTab(tab)) this.tab = tab;
    this.wanted = true;
    this.store();
    this.paintTabs();
    this.sync();
  }

  hide(): void {
    this.wanted = false;
    this.store();
    this.sync();
  }

  toggle(): void { if (this.wanted) this.hide(); else this.show(); }

  // ---- showing ----

  private allowed(): boolean {
    if (!this.engine.movie) return false;
    const home = this.host.querySelector<HTMLElement>('.cv-home');
    if (home && !home.hidden) return false;
    if (this.host.closest('.cv-app')?.classList.contains('is-painting')) return false;
    const paint = this.host.querySelector<HTMLElement>('.fm-paint');
    if (paint && !paint.hidden) return false;
    return !this.host.querySelector('.fm-stage-wrap')?.classList.contains('is-preview');
  }

  /** The column and the panel change in one write, so the Stage refits once. */
  private sync(): void {
    const on = this.wanted && this.allowed();
    if (on === this.shownNow) return;
    this.shownNow = on;
    if (on) this.patch();
    const inside = !on && this.root.contains(document.activeElement);
    setHidden(this.root, !on);
    setClass(this.host, 'has-build', on);
    if (inside) this.host.querySelector<HTMLElement>('.fm-stage')?.focus({ preventScroll: true });
    if (on) { void this.readMine(); this.lazyPaint(); }
  }

  private store(): void {
    try { localStorage.setItem(STORE, JSON.stringify({ open: this.wanted, tab: this.tab })); } catch { /* this session only */ }
  }

  private select(tab: Tab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.store();
    this.paintTabs();
    if (tab === 'characters') void this.readMine();
    this.patch();
    this.lazyPaint();
  }

  private paintTabs(): void {
    for (const def of TABS) {
      const on = def.id === this.tab;
      const b = this.tabBtns.get(def.id);
      const p = this.panes.get(def.id);
      if (b) {
        setClass(b, 'is-on', on);
        if (b.getAttribute('aria-selected') !== String(on)) b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      if (p) setHidden(p, !on);
    }
  }

  /** Pictures that cost a little to draw are made the first time their tab shows. */
  private lazyPaint(): void {
    if (!this.shownNow) return;
    if (this.tab === 'characters' && !this.castShown) { this.castShown = true; this.paintCharacters(); }
    if (this.tab === 'scenes') this.drawScenes();
  }

  private schedule(): void {
    if (!this.shownNow || this.patchFrame) return;
    this.patchFrame = requestAnimationFrame(() => { this.patchFrame = 0; this.patch(); });
  }

  private patch(): void {
    this.patchCommands();
    this.patchCamera();
    if (this.tab === 'actions') this.paintActions();
    if (this.tab === 'characters') this.paintCharacters();
    if (this.tab === 'scenes') this.paintScenes();
  }

  // ---- building blocks ----

  private pane(tab: Tab): HTMLElement {
    const p = this.panes.get(tab);
    if (!p) throw new Error(`missing pane: ${tab}`);
    return p;
  }

  /** A row that runs a command; its label is the command's own unless `label` is given. */
  private cmdRow(id: string, ic: string, label?: string): HTMLButtonElement {
    const node = el<HTMLButtonElement>(`<button class="fm-build-row" type="button"><span class="fm-build-rowicon">${icon(ic, 18)}</span><span class="fm-build-rowlabel"></span></button>`);
    const lab = q(node, '.fm-build-rowlabel');
    if (label) setText(lab, t(label));
    node.addEventListener('click', () => { if (!node.disabled) this.deps.run(id); });
    this.cmdRows.push({ id, node, label: lab, bound: !!label });
    return node;
  }

  private patchCommands(): void {
    for (const r of this.cmdRows) {
      const english = this.deps.label(r.id);
      setHidden(r.node, english === null);
      if (english === null) continue;
      if (!r.bound) setText(r.label, t(english));
      setDisabled(r.node, !this.deps.enabled(r.id));
    }
  }

  private patchCamera(): void {
    const on = cameraMode.on;
    setClass(this.camBtn, 'is-on', on);
    if (this.camBtn.getAttribute('aria-pressed') !== String(on)) this.camBtn.setAttribute('aria-pressed', String(on));
    setDisabled(this.camBtn, !this.engine.movie);
  }

  // ---- Characters ----

  private async readMine(): Promise<void> {
    try {
      this.mine = (await charactersApi.list()).items;
      this.mineErr = '';
    } catch (e) {
      this.mine = [];
      this.mineErr = e instanceof Error && e.message ? t(e.message) : t('The Characters library could not be read.');
    }
    this.mineRead = true;
    this.paintCharacters();
  }

  private paintCharacters(): void {
    const tiles = (list: HTMLElement, items: Tile[]): void => patchList(list, items, {
      key: (r) => r.key,
      create: (r) => { const n = this.makeTile(r); this.fillTile(n, r); return n; },
      update: (n, r) => this.fillTile(n, r),
    });
    tiles(this.starterList, [
      ...this.starters.map((s): Tile => ({ key: `starter:${s.id}`, name: s.name, meta: t('Starter character'), poster: s.poster ? `${STARTERS}${s.poster}` : '', mine: false })),
      ...CAST_PRESETS.map((p): Tile => ({ key: `cast:${p.id}`, name: p.name, meta: t(p.tag), poster: this.castShown ? castPoster(p) : '', mine: false })),
    ]);
    tiles(this.mineList, this.mine.map((c): Tile => ({ key: `mine:${c.name}`, name: c.name, meta: '', poster: `${c.name}\n${c.modified}`, v: c.modified, mine: true })));
    const keys = new Set(this.mine.map((c) => `mine:${c.name}`));
    for (const [k, p] of this.posters) if (!keys.has(k)) { if (p.url) URL.revokeObjectURL(p.url); this.posters.delete(k); }
    setText(this.mineNote, this.mineErr || t('No characters saved yet. Choose Save to Characters on a character to keep it here.'));
    setHidden(this.mineNote, !this.mineRead || this.mine.length > 0);
  }

  private makeTile(r: Tile): HTMLButtonElement {
    const n = el<HTMLButtonElement>(`<button class="fm-build-tile" type="button"><span class="fm-build-thumb"><img alt="" hidden><span class="fm-build-glyph">${PERSON_SVG}</span></span><span class="fm-build-name" data-no-i18n></span></button>`);
    const img = q<HTMLImageElement>(n, 'img');
    img.addEventListener('load', () => { setHidden(img, false); setHidden(q(n, '.fm-build-glyph'), true); });
    img.addEventListener('error', () => { setHidden(img, true); setHidden(q(n, '.fm-build-glyph'), false); });
    if (r.mine) n.classList.add('is-mine');
    return n;
  }

  private fillTile(n: HTMLElement, r: Tile): void {
    setText(q(n, '.fm-build-name'), r.name);
    const tip = r.meta ? `${r.name} · ${r.meta}` : r.name;
    if (n.title !== tip) n.title = tip;
    const name = tf('Add {name} to the movie', { name: r.name });
    if (n.getAttribute('aria-label') !== name) n.setAttribute('aria-label', name);
    const img = q<HTMLImageElement>(n, 'img');
    if (r.mine) this.loadPoster(n, img, r);
    else if (r.poster && img.getAttribute('src') !== r.poster) img.setAttribute('src', r.poster);
    const busy = this.busy.has(r.key);
    setClass(n, 'is-busy', busy);
    setDisabled(n as HTMLButtonElement, busy || !this.engine.movie);
  }

  /** The glyph stays until the saved poster is decoded; a newer version replaces the old one in one write. */
  private loadPoster(n: HTMLElement, img: HTMLImageElement, r: Tile): void {
    const had = this.posters.get(r.key);
    if (had?.want === r.poster) return;
    const slot = { want: r.poster, url: had?.url ?? '' };
    this.posters.set(r.key, slot);
    void charactersApi.poster(r.name, r.v, n).then((blob) => {
      if (!blob || this.posters.get(r.key) !== slot) return;
      const url = URL.createObjectURL(blob);
      swapMedia(img, url).then(() => {
        if (this.posters.get(r.key) !== slot) { URL.revokeObjectURL(url); return; }
        if (slot.url) URL.revokeObjectURL(slot.url);
        slot.url = url;
      }, () => URL.revokeObjectURL(url));
    });
  }

  private async addCharacter(key: string): Promise<void> {
    if (this.busy.has(key) || !this.engine.movie) return;
    this.busy.add(key);
    this.paintCharacters();
    try { await this.deps.addCharacter(key); } finally {
      this.busy.delete(key);
      this.paintCharacters();
    }
  }

  // ---- Actions ----

  private actionRow(a: ActionDef, own: boolean): HTMLButtonElement {
    const n = el<HTMLButtonElement>(`<button class="fm-build-row" type="button"><span class="fm-build-rowicon">${icon('perform', 18)}</span><span class="fm-build-rowlabel"></span><span class="fm-build-tag"></span></button>`);
    if (own) q(n, '.fm-build-rowlabel').setAttribute('data-no-i18n', '');
    this.fillAction(n, a, own);
    return n;
  }

  private fillAction(n: HTMLButtonElement, a: ActionDef, own: boolean): void {
    n.dataset.action = a.id;
    setText(q(n, '.fm-build-rowlabel'), own ? a.name : t(a.name));
    setText(q(n, '.fm-build-tag'), a.loop ? t('Loop') : '');
  }

  private paintActions(): void {
    const g: Content | null = selectedCharacter(this.engine);
    const ch = g?.character ?? null;
    setHidden(this.actNone, !!ch);
    setHidden(this.actOwnHead, !ch);
    setHidden(this.actOwnList, !ch);
    setHidden(this.actOwnEmpty, !ch || ch.actions.length > 0);
    setHidden(this.actStarter, !ch);
    if (!ch || !g) return;
    setText(this.actOwnHead, ch.name || g.name);
    patchList(this.actOwnList, ch.actions, {
      key: (a) => a.id,
      create: (a) => this.actionRow(a, true),
      update: (n, a) => this.fillAction(n as HTMLButtonElement, a, true),
    });
  }

  // ---- Scenes ----

  private paintScenes(): void {
    const list = this.scenes ?? [];
    patchList(this.sceneList, list, {
      key: (s) => s.id,
      create: (s) => {
        const n = el<HTMLButtonElement>(`<button class="fm-build-tile" type="button"><span class="fm-build-thumb"><canvas width="${THUMB_W}" height="${THUMB_H}" aria-hidden="true"></canvas></span><span class="fm-build-name"></span></button>`);
        this.fillScene(n, s);
        return n;
      },
      update: (n, s) => this.fillScene(n, s),
    });
    setHidden(this.sceneEmpty, !this.scenes || list.length > 0);
    this.lazyPaint();
  }

  private fillScene(n: HTMLElement, s: SceneEntry): void {
    setText(q(n, '.fm-build-name'), s.name);
    const props = s.layers.length - 1;
    const tip = `${s.name} · ${props === 1 ? t('1 prop') : tf('{n} props', { n: props })}`;
    if (n.title !== tip) n.title = tip;
    const name = tf('Add {name} behind the movie', { name: s.name });
    if (n.getAttribute('aria-label') !== name) n.setAttribute('aria-label', name);
    setClass(n, 'is-busy', this.sceneBusy === s.id);
    setDisabled(n as HTMLButtonElement, this.sceneBusy !== null || !this.engine.movie);
  }

  private drawScenes(): void {
    for (const s of this.scenes ?? []) if (!this.drawn.has(s.id)) { this.drawn.add(s.id); void this.thumb(s); }
  }

  /** The scene drawn small off screen, every layer in its place (one that cannot be drawn is left out), then shown in one copy. */
  private async thumb(s: SceneEntry): Promise<void> {
    const off = new OffscreenCanvas(THUMB_W, THUMB_H);
    const ctx = off.getContext('2d');
    if (!ctx) return;
    const k = Math.min(THUMB_W / s.width, THUMB_H / s.height);
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, THUMB_W, THUMB_H);
    for (const l of s.layers) {
      try {
        const res = await fetch(sceneFileUrl(s, l.file));
        if (!res.ok) continue;
        await withSvgImage(await res.text(), (img) => {
          const w = img.naturalWidth * l.scale * k, h = img.naturalHeight * l.scale * k;
          ctx.drawImage(img, l.x * k - w / 2, l.y * k - h / 2, w, h);
        });
      } catch { /* left out */ }
    }
    this.sceneList.querySelector<HTMLElement>(`[data-key="${CSS.escape(s.id)}"]`)?.querySelector('canvas')?.getContext('2d')?.drawImage(off, 0, 0);
  }

  private async addScene(entry: SceneEntry): Promise<void> {
    if (this.sceneBusy || !this.engine.movie) return;
    this.sceneBusy = entry.id;
    this.paintScenes();
    try {
      await this.deps.addScene(entry);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('The scene could not be added.'), 'error');
    } finally {
      this.sceneBusy = null;
      this.paintScenes();
    }
  }
}
