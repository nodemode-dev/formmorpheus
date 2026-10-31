// Media bin: the movie's files (pictures, video, sound, fonts and the pictures Drawings own) with a thumbnail, size,
// length and where each is used. Click a row to select its blocks; drag a row onto the Timeline or the Stage (or press
// Place) to add it again; Replace swaps the file under every block that uses it as one undo step; Relink does the same
// for a file whose source went missing; Remove unused drops files nothing uses. Built once, rows patched in place.
import type { Engine } from '../engine/engine';
import { binEntries, removeAssets, replaceAsset, totalSize, unusedIds, type BinEntry } from '../engine/bin-ops';
import { content as makeContent, identity } from '../engine/model';
import * as ops from '../engine/ops';
import type { Renderer } from '../engine/render';
import type { Asset, Content, Movie } from '../engine/types';
import { importScale } from '../media/import-size';
import { importMedia } from '../media/import';
import type { VideoPool } from '../media/video';
import { el, patchList, q, setClass, setDisabled, setHidden, setText } from './dom';
import { t } from './i18n';
import { toast } from './toast';
import type { TimelineView } from './timeline';
import '../styles/media-bin.css';

const MIME = 'application/x-fm-asset';

export interface BinDeps {
  renderer: Renderer;
  video: VideoPool;
  timeline: () => TimelineView | null;
  stageWrap: () => HTMLElement | null;
}

export function bytesText(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const SPEAKER = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const ACCEPT: Record<string, string> = {
  image: 'image/*,.tif,.tiff,.tga,.heic,.heif',
  video: 'video/*,.mkv,.mov,.mpg,.mpeg',
  audio: 'audio/*,.flac,.ogg,.opus,.m4a,.aif,.aiff,.caf,.ac3,.mp2',
  font: '.ttf,.otf,.woff,.woff2',
};

const TEMPLATE = `<section class="fm-bin" role="dialog" aria-label="Media" hidden>
  <div class="fm-bin-head"><span class="fm-bin-title"></span><span class="fm-bin-total"></span><button class="fm-bin-btn fm-bin-x" type="button" data-act="close">${CLOSE}</button></div>
  <div class="fm-bin-tools"><button class="fm-bin-btn" type="button" data-act="unused"></button></div>
  <div class="fm-bin-list" role="list"></div>
  <div class="fm-bin-empty"></div>
  <input type="file" hidden>
</section>`;

const ROW = `<div class="fm-bin-row" role="listitem">
  <button class="fm-bin-main" type="button" draggable="true"><span class="fm-bin-thumb"><canvas width="112" height="84"></canvas><span class="fm-bin-glyph" hidden></span></span><span class="fm-bin-info"><span class="fm-bin-name"></span><span class="fm-bin-meta"></span><span class="fm-bin-use"></span></span></button>
  <span class="fm-bin-acts"><button class="fm-bin-btn" type="button" data-act="place"></button><button class="fm-bin-btn" type="button" data-act="replace"></button><button class="fm-bin-btn" type="button" data-act="relink"></button></span>
</div>`;

function lengthText(a: Asset): string {
  if (!a.seconds) return '';
  const s = a.seconds;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export class MediaBin {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly picker: HTMLInputElement;
  private readonly entries = new Map<string, BinEntry>();
  private raf = 0;
  private pickFor: { entry: BinEntry; relink: boolean } | null = null;
  private opener: HTMLElement | null = null;
  private unusedCount = 0;

  constructor(private readonly engine: Engine, private readonly deps: BinDeps) {
    this.root = el(TEMPLATE);
    this.list = q(this.root, '.fm-bin-list');
    this.picker = q<HTMLInputElement>(this.root, 'input[type="file"]');
    setText(q(this.root, '.fm-bin-title'), t('Media'));
    q(this.root, '[data-act="close"]').setAttribute('aria-label', t('Close'));
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
    const sync = (): void => { if (!this.root.hidden) this.schedule(); };
    engine.on('movie', sync);
    engine.on('selection', sync);
    engine.on('projects', sync);

    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b) { this.act(b.dataset.act ?? '', b.closest<HTMLElement>('.fm-bin-row')?.dataset.key ?? ''); return; }
      const row = (e.target as HTMLElement).closest<HTMLElement>('.fm-bin-main');
      if (row) this.selectUses(row.closest<HTMLElement>('.fm-bin-row')?.dataset.key ?? '');
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.hide(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const rows = Array.from(this.list.querySelectorAll<HTMLElement>('.fm-bin-main'));
      const at = rows.indexOf(document.activeElement as HTMLElement);
      if (at < 0) return;
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    });
    this.root.addEventListener('dragstart', (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('.fm-bin-row')?.dataset.key ?? '';
      const entry = this.entries.get(key);
      if (!entry || !this.placeable(entry) || !e.dataTransfer) { e.preventDefault(); return; }
      e.dataTransfer.setData(MIME, key);
      e.dataTransfer.effectAllowed = 'copy';
    });
    this.picker.addEventListener('change', () => {
      const f = this.picker.files?.[0];
      const job = this.pickFor;
      this.picker.value = '';
      this.pickFor = null;
      if (f && job) void this.swap(job.entry, f, job.relink);
    });
    // a row dropped on the Timeline or the Stage
    window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes(MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    window.addEventListener('drop', (e) => {
      const key = e.dataTransfer?.getData(MIME);
      if (!key) return;
      e.preventDefault();
      const entry = this.entries.get(key);
      if (!entry) return;
      const tl = this.deps.timeline()?.dropTarget(e.clientX, e.clientY);
      const onStage = !tl && !!(e.target instanceof Element && this.deps.stageWrap()?.contains(e.target));
      if (tl) this.place(entry, { frame: tl.frame, index: tl.index });
      else if (onStage) this.place(entry, 'stage');
    });
  }

  get isOpen(): boolean { return !this.root.hidden; }

  toggle(opener?: HTMLElement | null): void { if (this.isOpen) this.hide(); else this.show(opener); }

  show(opener?: HTMLElement | null): void {
    this.opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setHidden(this.root, false);
    this.refresh();
    (this.list.querySelector<HTMLElement>('.fm-bin-main') ?? q(this.root, '[data-act="close"]')).focus();
  }

  hide(): void {
    if (this.root.hidden) return;
    setHidden(this.root, true);
    this.opener?.focus?.();
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.refresh(); });
  }

  private missing(e: BinEntry): boolean {
    return e.kind !== 'drawing' && !this.engine.assets.has(e.asset.id);
  }

  private placeable(e: BinEntry): boolean {
    return (e.kind === 'image' || e.kind === 'video' || e.kind === 'audio') && !this.missing(e);
  }

  private refresh(): void {
    const m = this.engine.movie;
    const list = m ? binEntries(m) : [];
    this.entries.clear();
    for (const e of list) this.entries.set(e.key, e);
    const sel = new Set(this.engine.selection.content);
    patchList(this.list, list, {
      key: (e) => e.key,
      create: (e) => { const row = this.createRow(e); this.updateRow(row, e, sel); return row; },
      update: (node, e) => this.updateRow(node, e, sel),
    });
    setText(q(this.root, '.fm-bin-total'), m ? `${list.length} · ${bytesText(m ? totalSize(m) : 0)}` : '');
    this.unusedCount = m ? unusedIds(m).length : 0;
    const un = q<HTMLButtonElement>(this.root, '[data-act="unused"]');
    setText(un, this.unusedCount ? `${t('Remove unused')} (${this.unusedCount})` : t('Remove unused'));
    setDisabled(un, !this.unusedCount);
    const empty = q(this.root, '.fm-bin-empty');
    setText(empty, t('Nothing imported yet. Import a picture, video, sound or font and it appears here.'));
    setHidden(empty, list.length > 0);
  }

  private createRow(e: BinEntry): HTMLElement {
    const row = el(ROW);
    row.dataset.key = e.key;
    setText(q(row, '[data-act="place"]'), t('Place'));
    setText(q(row, '[data-act="replace"]'), t('Replace'));
    setText(q(row, '[data-act="relink"]'), t('Relink'));
    this.paintThumb(row, e);
    return row;
  }

  private updateRow(row: HTMLElement, e: BinEntry, sel: Set<string>): void {
    const missing = this.missing(e);
    setText(q(row, '.fm-bin-name'), e.name);
    const a = e.asset;
    const parts: string[] = [];
    if (e.kind === 'drawing') parts.push(`${e.count} ${t(e.count === 1 ? 'picture' : 'pictures')}`);
    else if (e.kind === 'font') parts.push(a.family ?? '');
    else {
      if (a.width && a.height) parts.push(`${a.width} x ${a.height}`);
      const len = lengthText(a);
      if (len) parts.push(len);
    }
    parts.push(bytesText(e.size));
    setText(q(row, '.fm-bin-meta'), missing ? t('Source missing') : parts.join(' · '));
    const n = e.uses.length;
    setText(q(row, '.fm-bin-use'), n ? `${t('Used in')} ${n} ${t(n === 1 ? 'block' : 'blocks')}` : t('Not used'));
    setClass(row, 'is-missing', missing);
    setClass(row, 'is-unused', n === 0);
    setClass(row, 'is-selected', e.uses.some((u) => sel.has(u.id)));
    const drawing = e.kind === 'drawing';
    const place = q<HTMLButtonElement>(row, '[data-act="place"]');
    const replace = q<HTMLButtonElement>(row, '[data-act="replace"]');
    const relink = q<HTMLButtonElement>(row, '[data-act="relink"]');
    setHidden(place, !this.placeable(e));
    setHidden(replace, drawing || missing);
    setHidden(relink, !missing);
    const main = q(row, '.fm-bin-main');
    main.draggable = this.placeable(e);
    const label = `${e.name}, ${n ? `${t('Used in')} ${n}` : t('Not used')}`;
    if (main.getAttribute('aria-label') !== label) main.setAttribute('aria-label', label);
  }

  /** Draws the thumbnail once, when the row is made (a new file is a new row). */
  private paintThumb(row: HTMLElement, e: BinEntry): void {
    const cv = q<HTMLCanvasElement>(row, '.fm-bin-thumb canvas');
    const glyph = q(row, '.fm-bin-glyph');
    const showGlyph = (html: string, font?: string): void => {
      setHidden(cv, true); setHidden(glyph, false);
      if (font) { glyph.textContent = html; glyph.style.fontFamily = `"${font}", sans-serif`; } else glyph.innerHTML = html;
    };
    if (e.kind === 'audio') { showGlyph(SPEAKER); return; }
    if (e.kind === 'font') { showGlyph('Aa', e.asset.family); return; }
    const draw = (src: CanvasImageSource, w: number, h: number): void => {
      const ctx = cv.getContext('2d');
      if (!ctx || !w || !h) return;
      const s = Math.min(cv.width / w, cv.height / h);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(src, (cv.width - w * s) / 2, (cv.height - h * s) / 2, w * s, h * s);
    };
    if (e.kind === 'video') {
      let tries = 0;
      const poll = (): void => {
        if (!row.isConnected && tries > 0) return;
        const img = this.deps.video.thumb(e.asset.id, Math.min(0.2, (e.asset.seconds ?? 0) / 2), cv.width, cv.height);
        if (img) { draw(img, cv.width, cv.height); return; }
        if (++tries < 60) window.setTimeout(poll, 250);
      };
      poll();
      return;
    }
    const blob = this.engine.assets.get(e.asset.id);
    if (!blob) { showGlyph('?'); return; }
    createImageBitmap(blob).then((b) => { draw(b, b.width, b.height); b.close(); }).catch(() => undefined);
  }

  private act(act: string, key: string): void {
    if (act === 'close') { this.hide(); return; }
    if (act === 'unused') { this.removeUnused(); return; }
    const entry = this.entries.get(key);
    if (!entry) return;
    if (act === 'place') this.place(entry, 'playhead');
    else if (act === 'replace' || act === 'relink') {
      this.pickFor = { entry, relink: act === 'relink' };
      this.picker.accept = ACCEPT[entry.kind] ?? '';
      this.picker.click();
    }
  }

  private selectUses(key: string): void {
    const e = this.entries.get(key);
    if (!e || !e.uses.length) { toast(t('Not used in any block.')); return; }
    this.engine.select(e.uses.map((u) => u.id));
  }

  private removeUnused(): void {
    const ids = this.engine.movie ? unusedIds(this.engine.movie) : [];
    if (!ids.length) return;
    this.engine.run('Remove Unused Media', (m) => removeAssets(m, unusedIds(m)));
    toast(`${ids.length} ${t(ids.length === 1 ? 'unused file removed.' : 'unused files removed.')}`);
  }

  /** Puts a file in the movie again as a new block: at the Playhead, on the Timeline row and frame, or on the Stage. */
  private place(entry: BinEntry, where: 'playhead' | 'stage' | { frame: number; index: number }): void {
    const m = this.engine.movie;
    if (!m || !this.placeable(entry)) return;
    const a = entry.asset;
    const at = typeof where === 'object' ? where.frame : this.engine.frame;
    const room = Math.max(1, m.duration - at);
    const scale = a.width && a.height ? { ...identity(), scale: importScale(m.width, m.height, a.width, a.height) } : identity();
    let c: Content;
    if (entry.kind === 'image') c = makeContent('image', at, room, { name: a.name, asset: a.id, transform: scale });
    else if (entry.kind === 'video') c = makeContent('video', at, Math.min(Math.max(1, a.frames), room), { name: a.name, asset: a.id, transform: scale });
    else c = makeContent('audio', at, Math.max(1, a.frames), { name: a.name, asset: a.id });
    const selected = this.engine.selection.track ? Math.max(0, m.tracks.findIndex((tr) => tr.id === this.engine.selection.track)) : 0;
    this.engine.run(`Add ${a.name}`, (mv) => {
      if (typeof where === 'object') {
        const row = Math.min(where.index, mv.tracks.length);
        return { movie: ops.placeContent(mv, mv.tracks[row]?.id ?? null, c, row).movie, select: [c.id] };
      }
      if (where === 'stage') return { movie: ops.placeContent(mv, mv.tracks[0]?.id ?? null, c, 0).movie, select: [c.id] };
      if (entry.kind === 'audio') {
        const added = ops.addTrack(mv, Math.min(mv.tracks.length, selected + 1), c.name);
        return { movie: ops.placeContent(added.movie, added.track.id, c).movie, select: [c.id] };
      }
      return { movie: ops.placeContent(mv, null, c, selected).movie, select: [c.id] };
    });
  }

  /** Replace and Relink: the picked file takes the place of the old one under every block, as one undo step. */
  private async swap(entry: BinEntry, file: File, relink: boolean): Promise<void> {
    const m: Movie | null = this.engine.movie;
    if (!m) return;
    try {
      const r = await importMedia(file, m, 0);
      const got = r.assets.length === 1 ? r.assets[0] : null;
      const want = entry.asset.kind;
      if (!got || got.asset.kind !== want) throw new Error(`${file.name}: ${t('pick a file of the same kind')}.`);
      const next: Asset = got.asset;
      this.engine.assets.set(next.id, got.blob);
      if (next.kind === 'image') await this.deps.renderer.preload(new Map([[next.id, got.blob]]));
      this.engine.run(`${relink ? 'Relink' : 'Replace'} ${entry.name}`, (mv) => replaceAsset(mv, entry.asset.id, next));
      toast(`${entry.name} ${t(relink ? 'relinked to' : 'replaced by')} ${file.name}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('The file could not be read.'), 'error');
    }
  }
}
