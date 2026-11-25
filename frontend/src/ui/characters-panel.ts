// Characters panel (View, Characters): Starter characters that ship with the app (read-only, made on use from their SVG
// or, for the studio's cast, from their recipe) and the person's own, saved in the Characters library on the engine. Add to Movie, or a drag onto the Stage or
// the Timeline, places a copy with fresh ids at the Playhead. Built once; rows are patched in place.
import { build, castToCharacterGroup, mkSpec, rigToSvg, STUDIO_PRESETS, type CastInput } from '../engine/cast';
import { attachMouthChart } from '../engine/character-ops';
import type { Engine } from '../engine/engine';
import { usedAssetIds } from '../engine/asset-gc';
import { floorOf } from '../engine/guides';
import { spotX, standOnFloor } from '../engine/starter-scene';
import { newMovie, track as makeTrack } from '../engine/model';
import * as ops from '../engine/ops';
import type { Renderer } from '../engine/render';
import type { Asset, Content, Movie } from '../engine/types';
import { ApiError } from '../io/api';
import { charactersApi, freeName, type CharacterItem } from '../io/characters-api';
import { packMovie, unpackMovie } from '../io/fmo';
import { svgToCharacterGroup, svgToMouthChart } from '../io/svg-import';
import { platform } from '../platform';
import { PERSON_SVG } from './character-glyph';
import { chooseOrCancel, confirmAction, promptName } from './dialogs';
import { el, patchList, q, setClass, setDisabled, setHidden, setText, swapMedia } from './dom';
import { t } from './i18n';
import { tf } from './i18n-fill';
import type { TimelineView } from './timeline';
import { toast } from './toast';
import '../styles/media-bin.css';
import '../styles/characters.css';

const MIME = 'application/x-fm-character';
const STARTERS = '/starters/characters/';

export interface StarterEntry { id: string; name: string; file: string; poster?: string; mouths?: string }

/** A character ready to place: its group, the size of the movie it was made in, and its pictures. */
export interface CharacterSource { group: Content; width: number; height: number; assets: Map<string, { asset: Asset; blob: Blob }> }

export interface CharactersDeps {
  renderer: Renderer;
  timeline: () => TimelineView | null;
  stageWrap: () => HTMLElement | null;
}

const CLOSE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const TEMPLATE = `<section class="fm-bin fm-chars" role="dialog" hidden>
  <div class="fm-bin-head"><span class="fm-bin-title"></span><button class="fm-bin-btn fm-chars-build" type="button" data-act="build"></button><button class="fm-bin-btn fm-bin-x" type="button" data-act="close">${CLOSE}</button></div>
  <div class="fm-chars-scroll">
    <div class="fm-chars-sec" data-sec="starter" hidden><div class="fm-chars-sub"></div><div class="fm-bin-list fm-chars-list" role="list"></div></div>
    <div class="fm-chars-sec" data-sec="mine"><div class="fm-chars-sub"></div><div class="fm-bin-list fm-chars-list" role="list"></div><div class="fm-bin-empty"></div></div>
  </div>
</section>`;

const ROW = `<div class="fm-bin-row" role="listitem">
  <button class="fm-bin-main" type="button" draggable="true"><span class="fm-bin-thumb"><img class="fm-chars-img" alt="" hidden><span class="fm-bin-glyph">${PERSON_SVG}</span></span><span class="fm-bin-info"><span class="fm-bin-name"></span><span class="fm-bin-meta"></span></span></button>
  <span class="fm-bin-acts"><button class="fm-bin-btn" type="button" data-act="add"></button><button class="fm-bin-btn" type="button" data-act="open" hidden></button><button class="fm-bin-btn" type="button" data-act="rename"></button><button class="fm-bin-btn" type="button" data-act="delete"></button></span>
</div>`;

type Where = 'playhead' | 'stage' | { frame: number; index: number };

/** The character group and its pictures packed as a small movie of the current movie's size: what the library keeps. */
export async function packCharacter(engine: Engine, renderer: Renderer, g: Content, made?: Omit<CharacterSource, 'group'>): Promise<Blob> {
  const m: Movie = made
    ? { ...newMovie({ width: made.width, height: made.height, fps: engine.movie?.fps ?? 24 }), tracks: [makeTrack('character', [g])], assets: Object.fromEntries([...made.assets].map(([id, a]) => [id, a.asset])) }
    : engine.movie as Movie;
  const name = g.character?.name ?? g.name;
  const table: Record<string, Asset> = {};
  const blobs = new Map<string, Blob>();
  for (const id of usedAssetIds([], [g])) {
    const a = m.assets[id], b = engine.assets.get(id) ?? made?.assets.get(id)?.blob;
    if (a && b) { table[id] = a; blobs.set(id, b); }
  }
  const own = new Set<string>();
  const collect = (c: Content): void => { own.add(c.id); for (const tr of c.tracks) tr.content.forEach(collect); };
  collect(g);
  // a link to content outside the character would dangle in the library copy
  const unlink = (c: Content): Content => {
    const { parent, ...rest } = c;
    const out: Content = parent && !own.has(parent) ? rest : c;
    return out.tracks.length ? { ...out, tracks: out.tracks.map((tr) => ({ ...tr, content: tr.content.map(unlink) })) } : out;
  };
  const { parent: _p, ...free } = unlink(g);
  const lib: Movie = { ...newMovie({ name, width: m.width, height: m.height, fps: m.fps }), duration: Math.max(1, g.duration), tracks: [makeTrack(name, [{ ...free, start: 0 }])], assets: table };
  let poster: Blob | null = null;
  try {
    const pw = 320, ph = Math.max(1, Math.round((320 * m.height) / m.width));
    const cv = document.createElement('canvas');
    cv.width = pw; cv.height = ph;
    const ctx = cv.getContext('2d');
    if (ctx) {
      renderer.thumb(ctx, m, g, made ? 0 : Math.max(0, Math.min(g.duration - 1, engine.frame - g.start)), pw, ph);
      poster = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/png'));
    }
  } catch { poster = null; }
  return packMovie(lib, [], [], blobs, poster, false);
}

/** A saved character read back from its .fmo. */
export async function unpackCharacter(data: Blob): Promise<CharacterSource> {
  const f = await unpackMovie(data);
  const groups = f.movie.tracks.flatMap((tr) => tr.content).filter((c) => c.kind === 'group');
  const group = groups.find((c) => c.character) ?? groups[0];
  if (!group) throw new Error(t('That character file holds no character.'));
  const assets = new Map<string, { asset: Asset; blob: Blob }>();
  for (const [id, blob] of f.assets) { const asset = f.movie.assets[id]; if (asset) assets.set(id, { asset, blob }); }
  return { group, width: f.movie.width, height: f.movie.height, assets };
}

/** A starter character made from its SVG (and its mouth chart SVG, when the manifest names one) for this movie. */
export async function starterCharacter(entry: StarterEntry, movie: Movie): Promise<CharacterSource> {
  const get = async (file: string): Promise<string> => {
    const res = await fetch(`${STARTERS}${file.split('/').map(encodeURIComponent).join('/')}`);
    if (!res.ok) throw new Error(tf('{name} could not be loaded.', { name: entry.name }));
    return res.text();
  };
  const r = await svgToCharacterGroup(await get(entry.file), entry.file, movie, 0);
  let group: Content = r.contents[0];
  group = { ...group, name: entry.name, character: { ...(group.character ?? { parts: {}, actions: [] }), name: entry.name } };
  const assets = new Map(r.assets.map((a) => [a.asset.id, a]));
  if (entry.mouths) {
    const chart = await svgToMouthChart(await get(entry.mouths), movie, 0, entry.mouths);
    const tmp: Movie = { ...movie, tracks: [makeTrack('starter', [group])] };
    group = attachMouthChart(tmp, group.id, chart.content).tracks[0].content[0];
    for (const a of chart.assets) assets.set(a.asset.id, a);
  }
  return { group, width: movie.width, height: movie.height, assets };
}

export async function castStarter(p: CastInput, movie: Movie): Promise<CharacterSource> {
  const r = await castToCharacterGroup(structuredClone(mkSpec(p)), movie, 0);
  return { group: r.contents[0], width: movie.width, height: movie.height, assets: new Map(r.assets.map((a) => [a.asset.id, a])) };
}

const castPosters = new Map<string, string>();

export function castPoster(p: CastInput): string {
  let url = castPosters.get(p.id);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rigToSvg(build(mkSpec(p)), { mode: 'full' }))}`;
    castPosters.set(p.id, url);
  }
  return url;
}

/** Places a fresh-id copy of a character at the Playhead (or the dropped frame), on a new track of its own; one undo step. */
export async function placeCharacter(engine: Engine, renderer: Renderer, src: CharacterSource, where: Where, floorY: number | null = null): Promise<string | null> {
  const m = engine.movie;
  if (!m) return null;
  const at = typeof where === 'object' ? where.frame : engine.frame;
  const copy = ops.cloneContent(src.group, at);
  delete copy.parent;
  // made in a larger movie: shrunk to fit, about the movie centre where its parts are placed from
  const k = Math.min(1, m.width / Math.max(1, src.width), m.height / Math.max(1, src.height));
  if (floorY !== null && src.width === m.width && src.height === m.height) copy.transform = standOnFloor(copy, m, floorY);
  else copy.transform = { ...copy.transform, scale: copy.transform.scale * k, x: copy.transform.x + spotX(m) - m.width / 2 };
  const table: Record<string, Asset> = {};
  const pics = new Map<string, Blob>();
  for (const [id, { asset, blob }] of src.assets) {
    table[id] = asset;
    if (!engine.assets.has(id)) engine.assets.set(id, blob);
    if (asset.kind === 'image' || asset.kind === 'pixels') pics.set(id, blob);
  }
  await renderer.preload(pics);
  const name = copy.character?.name ?? copy.name;
  const ok = engine.run(`Add ${name}`, (mv) => {
    const base: Movie = { ...mv, assets: { ...mv.assets, ...table } };
    const sel = engine.selection.track ? Math.max(0, mv.tracks.findIndex((tr) => tr.id === engine.selection.track)) : 0;
    const row = typeof where === 'object' ? Math.min(where.index, mv.tracks.length) : where === 'stage' ? 0 : sel;
    const added = ops.addTrack(base, row, name);
    return { movie: ops.placeContent(added.movie, added.track.id, copy).movie, select: [copy.id] };
  });
  return ok ? copy.id : null;
}

interface RowItem { key: string; name: string; meta: string; poster: string; v?: number; mine: boolean; cast?: boolean }

export class CharactersPanel {
  readonly root: HTMLElement;
  private readonly starterSec: HTMLElement;
  private readonly mineList: HTMLElement;
  private readonly starterList: HTMLElement;
  private readonly empty: HTMLElement;
  private starters: StarterEntry[] | null = null;
  private readonly manifest: Promise<void>;
  private mineRead = false;
  private opening = false;
  private mine: CharacterItem[] = [];
  private mineNote = '';
  private busy = new Set<string>();
  /** A saved character's poster per row: the version asked for and the object URL showing it. */
  private readonly posters = new Map<string, { want: string; url: string }>();
  private opener: HTMLElement | null = null;
  /** Build a character: opens the Character Builder. */
  onBuild: (() => void) | null = null;
  onOpenPreset: ((id: string) => void) | null = null;
  private shown = false;

  constructor(private readonly engine: Engine, private readonly deps: CharactersDeps) {
    this.root = el(TEMPLATE);
    this.root.setAttribute('aria-label', t('Characters'));
    setText(q(this.root, '.fm-bin-title'), t('Characters'));
    q(this.root, '[data-act="close"]').setAttribute('aria-label', t('Close'));
    setText(q(this.root, '[data-act="build"]'), t('Build a character'));
    this.starterSec = q(this.root, '[data-sec="starter"]');
    const mineSec = q(this.root, '[data-sec="mine"]');
    setText(q(this.starterSec, '.fm-chars-sub'), t('Starter'));
    setText(q(mineSec, '.fm-chars-sub'), t('Mine'));
    this.starterList = q(this.starterSec, '.fm-chars-list');
    this.mineList = q(mineSec, '.fm-chars-list');
    this.empty = q(mineSec, '.fm-bin-empty');
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);

    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      void this.act(b.dataset.act ?? '', b.closest<HTMLElement>('.fm-bin-row')?.dataset.key ?? '');
    });
    this.root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.hide(); } });
    this.root.addEventListener('dragstart', (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('.fm-bin-row')?.dataset.key ?? '';
      if (!key || !e.dataTransfer || !this.engine.movie) { e.preventDefault(); return; }
      e.dataTransfer.setData(MIME, key);
      e.dataTransfer.effectAllowed = 'copy';
    });
    window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes(MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    window.addEventListener('drop', (e) => {
      const key = e.dataTransfer?.getData(MIME);
      if (!key) return;
      e.preventDefault();
      const tl = this.deps.timeline()?.dropTarget(e.clientX, e.clientY);
      const onStage = !tl && !!(e.target instanceof Element && this.deps.stageWrap()?.contains(e.target));
      if (tl) void this.add(key, { frame: tl.frame, index: tl.index });
      else if (onStage) void this.add(key, 'stage');
    });
    engine.on('movie', () => { if (this.isOpen) this.paint(); });
    // read at startup, so the panel opens at its full height instead of growing a Starter section above Mine
    this.manifest = this.readManifest();
    void this.refresh();
  }

  get isOpen(): boolean { return !this.root.hidden; }

  toggle(opener?: HTMLElement | null): void { if (this.isOpen) this.hide(); else this.show(opener); }

  /** Opens once the starter list is known (it is read at startup), so no section appears above another after. */
  show(opener?: HTMLElement | null): void {
    this.opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (this.opening) return;
    this.opening = true;
    void this.manifest.then(() => {
      if (!this.opening) return;
      this.opening = false;
      this.shown = true;
      this.paint();
      setHidden(this.root, false);
      void this.refresh();
      q(this.root, '[data-act="close"]').focus();
    });
  }

  hide(): void {
    this.opening = false;
    if (this.root.hidden) return;
    setHidden(this.root, true);
    this.opener?.focus?.();
  }

  private async readManifest(): Promise<void> {
    try {
      const res = await fetch(`${STARTERS}manifest.json`);
      const body = res.ok ? ((await res.json()) as { format?: number; characters?: StarterEntry[] }) : null;
      this.starters = (body?.characters ?? []).filter((c) => c && typeof c.id === 'string' && typeof c.file === 'string' && typeof c.name === 'string');
    } catch { this.starters = null; }
  }

  /** Reads the library (after the starter manifest), then patches the rows. */
  async refresh(): Promise<void> {
    await this.manifest;
    try {
      this.mine = (await charactersApi.list()).items;
      this.mineNote = '';
    } catch (e) {
      this.mine = [];
      this.mineNote = e instanceof ApiError && e.status === 0 ? t(e.message) : t('The Characters library could not be read.');
    }
    this.mineRead = true;
    this.paint();
  }

  private paint(): void {
    const starters = this.starters ?? [];
    setHidden(this.starterSec, !starters.length && !STUDIO_PRESETS.length);
    const rows = (list: HTMLElement, items: RowItem[]): void => patchList(list, items, {
      key: (r) => r.key,
      create: (r) => { const n = this.createRow(r); this.updateRow(n, r); return n; },
      update: (n, r) => this.updateRow(n, r),
    });
    rows(this.starterList, [
      ...starters.map((s): RowItem => ({ key: `starter:${s.id}`, name: s.name, meta: t('Starter character'), poster: s.poster ? `${STARTERS}${s.poster}` : '', mine: false })),
      ...STUDIO_PRESETS.map((p): RowItem => ({ key: `cast:${p.id}`, name: p.name, meta: t(p.tag), poster: this.shown ? castPoster(p) : '', mine: false, cast: true })),
    ]);
    rows(this.mineList, this.mine.map((c) => ({ key: `mine:${c.name}`, name: c.name, meta: new Date(c.modified * (c.modified < 1e12 ? 1000 : 1)).toLocaleDateString(), poster: `${c.name}\n${c.modified}`, v: c.modified, mine: true })));
    const keys = new Set(this.mine.map((c) => `mine:${c.name}`));
    for (const [k, p] of this.posters) if (!keys.has(k)) { if (p.url) URL.revokeObjectURL(p.url); this.posters.delete(k); }
    setText(this.empty, this.mineNote || t('No characters saved yet. Choose Save to Characters on a character to keep it here.'));
    setHidden(this.empty, !this.mineRead || this.mine.length > 0);
  }

  private createRow(r: RowItem): HTMLElement {
    const row = el(ROW);
    row.dataset.key = r.key;
    setText(q(row, '[data-act="add"]'), t('Add to Movie'));
    setText(q(row, '[data-act="open"]'), t('Open in Character Builder'));
    setText(q(row, '[data-act="rename"]'), t('Rename'));
    setText(q(row, '[data-act="delete"]'), t('Delete'));
    const img = q<HTMLImageElement>(row, '.fm-chars-img');
    img.addEventListener('load', () => { setHidden(img, false); setHidden(q(row, '.fm-bin-glyph'), true); });
    img.addEventListener('error', () => { setHidden(img, true); setHidden(q(row, '.fm-bin-glyph'), false); });
    return row;
  }

  private updateRow(row: HTMLElement, r: RowItem): void {
    setText(q(row, '.fm-bin-name'), r.name);
    setText(q(row, '.fm-bin-meta'), r.meta);
    const img = q<HTMLImageElement>(row, '.fm-chars-img');
    if (r.mine) this.loadPoster(row, img, r);
    else if (r.poster && img.getAttribute('src') !== r.poster) {
      if (r.cast) setHidden(q(row, '.fm-bin-glyph'), true);
      img.setAttribute('src', r.poster);
    }
    setHidden(q(row, '[data-act="open"]'), !r.cast);
    setHidden(q(row, '[data-act="rename"]'), !r.mine);
    setHidden(q(row, '[data-act="delete"]'), !r.mine);
    const busy = this.busy.has(r.key);
    setDisabled(q<HTMLButtonElement>(row, '[data-act="add"]'), busy || !this.engine.movie);
    setClass(row, 'is-busy', busy);
    const main = q(row, '.fm-bin-main');
    main.draggable = !!this.engine.movie;
    if (main.getAttribute('aria-label') !== r.name) main.setAttribute('aria-label', r.name);
  }

  /** The glyph stays until the picture is decoded; a newer version replaces the old one in one write. */
  private loadPoster(row: HTMLElement, img: HTMLImageElement, r: RowItem): void {
    const had = this.posters.get(r.key);
    if (had?.want === r.poster) return;
    const slot = { want: r.poster, url: had?.url ?? '' };
    this.posters.set(r.key, slot);
    void charactersApi.poster(r.name, r.v, row).then((blob) => {
      if (!blob || this.posters.get(r.key) !== slot) return;
      const url = URL.createObjectURL(blob);
      swapMedia(img, url).then(() => {
        if (this.posters.get(r.key) !== slot) { URL.revokeObjectURL(url); return; }
        if (slot.url) URL.revokeObjectURL(slot.url);
        slot.url = url;
      }, () => URL.revokeObjectURL(url));
    });
  }

  private async act(act: string, key: string): Promise<void> {
    if (act === 'close') { this.hide(); return; }
    if (act === 'build') { this.onBuild?.(); return; }
    if (act === 'add') { await this.add(key, 'playhead'); return; }
    if (act === 'open') { if (key.startsWith('cast:')) this.onOpenPreset?.(key.slice(5)); return; }
    const name = key.startsWith('mine:') ? key.slice(5) : '';
    if (!name) return;
    if (act === 'rename') {
      const to = await promptName(t('Rename Character'), name, t('Rename'));
      if (!to || to === name) return;
      try { await charactersApi.rename(name, to); } catch (e) { toast(e instanceof Error ? e.message : t('The character could not be renamed.'), 'error'); }
      await this.refresh();
    } else if (act === 'delete') {
      if (!(await confirmAction(t('Delete character'), tf('Move {name} to Recently Deleted?', { name }), t('Delete'), true))) return;
      try { await charactersApi.remove(name); toast(tf('{name} moved to Recently Deleted.', { name })); } catch (e) { toast(e instanceof Error ? e.message : t('The character could not be deleted.'), 'error'); }
      await this.refresh();
    }
  }

  private async add(key: string, where: Where): Promise<void> {
    const m = this.engine.movie;
    if (!m) { toast(t('Open or create a movie first.')); return; }
    if (this.busy.has(key)) return;
    this.busy.add(key);
    this.paint();
    try {
      let src: CharacterSource;
      const starter = key.startsWith('starter:') || key.startsWith('cast:');
      if (key.startsWith('cast:')) {
        const p = STUDIO_PRESETS.find((c) => `cast:${c.id}` === key);
        if (!p) return;
        src = await castStarter(p, m);
      } else if (starter) {
        const entry = (this.starters ?? []).find((s) => `starter:${s.id}` === key);
        if (!entry) return;
        src = await starterCharacter(entry, m);
      } else src = await unpackCharacter(await charactersApi.read(key.slice(5)));
      // a starter scene's floor guide: the starter character stands on it at the scene's scale
      await placeCharacter(this.engine, this.deps.renderer, src, where, starter ? floorOf(this.engine.movie?.guides) : null);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('The character could not be added.'), 'error');
    } finally {
      this.busy.delete(key);
      this.paint();
    }
  }

  /** Save to Characters: the selected character into the library, under a free name unless the person replaces one. */
  async save(g: Content, made?: Omit<CharacterSource, 'group'>): Promise<void> {
    if (!g.character) return;
    const base = freeName(g.character.name || g.name, []);
    let taken: CharacterItem[];
    try { taken = (await charactersApi.list()).items; } catch (e) { toast(e instanceof Error ? e.message : t('The Characters library could not be read.'), 'error'); return; }
    let name = base;
    if (taken.some((c) => c.name.toLowerCase() === base.toLowerCase())) {
      const replace = await chooseOrCancel(t('Save to Characters'), tf('A character named {name} is already saved. Replace it, or keep both?', { name: base }), t('Replace'), t('Keep Both'), true);
      if (replace === null) return;
      if (!replace) name = freeName(base, taken.map((c) => c.name));
    }
    try {
      const data = await packCharacter(this.engine, this.deps.renderer, g, made);
      await charactersApi.write(name, data);
      toast(tf('{name} saved to Characters.', { name }));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('The character could not be saved.'), 'error');
    }
    if (this.isOpen) await this.refresh();
  }

  /** Use as Mouth Chart: a mouth chart SVG the person picks becomes the character's mouth, in one undo step. */
  async useMouthChart(g: Content): Promise<void> {
    const m = this.engine.movie;
    if (!m || !g.character) return;
    const [file] = await platform.files.pick({ accept: '.svg,image/svg+xml' });
    if (!file) return;
    let chart: Awaited<ReturnType<typeof svgToMouthChart>>;
    try { chart = await svgToMouthChart(await file.text(), m, 0, file.name); } catch (e) { toast(e instanceof Error ? e.message : t('This SVG file could not be read.'), 'error'); return; }
    const table: Record<string, Asset> = {};
    const pics = new Map<string, Blob>();
    for (const { asset, blob } of chart.assets) {
      table[asset.id] = asset;
      if (!this.engine.assets.has(asset.id)) this.engine.assets.set(asset.id, blob);
      pics.set(asset.id, blob);
    }
    await this.deps.renderer.preload(pics);
    this.engine.run('Use as Mouth Chart', (mv) => ({ movie: attachMouthChart({ ...mv, assets: { ...mv.assets, ...table } }, g.id, chart.content), select: [g.id] }));
  }
}
