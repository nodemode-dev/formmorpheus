import type { Track } from '../../engine/types';
import { addMySceneToMovie, freeSceneName, inByDefault, packScene, scenesApi, trackSort, type SceneItem, type TrackSort } from '../../io/my-scenes';
import { PERSON_SVG } from '../../ui/character-glyph';
import { chooseOrCancel, confirmAction, Dialog, promptName } from '../../ui/dialogs';
import { el, patchList, q, setChecked, setClass, setDisabled, setHidden, setText, swapMedia } from '../../ui/dom';
import { t } from '../../ui/i18n';
import { tf } from '../../ui/i18n-fill';
import { icon } from '../../ui/icons';
import { Popover, popRow } from '../../ui/popover';
import { toast } from '../../ui/toast';
import type { FeatureKit } from '../feature-kit';
import '../../styles/my-scenes.css';

const SVG = (body: string): string => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const SORT_ICON: Record<TrackSort, string> = {
  picture: SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>'),
  character: PERSON_SVG,
  sound: SVG('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  empty: SVG('<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3 3"/>'),
};
const SORT_TAG: Record<TrackSort, string> = { picture: '', character: 'Character', sound: 'Sound', empty: 'Empty' };
const SCENE_GLYPH = `<svg viewBox="0 0 48 27" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 22h44"/><path d="M6 22l9-10 7 7 5-5 9 8"/><circle cx="35" cy="8" r="3"/></svg>`;
const MORE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/></svg>`;

interface SaveChoice { name: string; tracks: Set<string>; background: boolean }

/** The Save as Scene card: a name, the movie's tracks to tick (characters and sound start unticked) and the background colour. */
class SaveSceneCard extends Dialog {
  private readonly input = el<HTMLInputElement>('<input class="cv-input" type="text" spellcheck="false" autocomplete="off">');
  private readonly what = el<HTMLElement>('<p class="cv-note fm-ms-what"></p>');
  private readonly list = el<HTMLElement>('<div class="fm-ms-trks" role="group"></div>');
  private readonly bg = el<HTMLElement>(`<label class="fm-ms-trk fm-ms-bg"><input type="checkbox"><span class="fm-ms-trk-ico"><i class="fm-ms-swatch"></i></span><span class="fm-ms-trk-name"></span><span class="fm-ms-trk-tag"></span></label>`);
  private readonly none = el<HTMLElement>('<p class="cv-note fm-ms-none"></p>');
  private readonly ok: HTMLButtonElement;
  private resolve: ((v: SaveChoice | null) => void) | null = null;

  constructor() {
    super('Save as Scene', 460);
    q<HTMLElement>(this.scrim, '.cv-dialog').classList.add('fm-ms-card');
    this.field('Name', this.input);
    this.body.append(this.what, this.list, this.bg, this.none);
    this.button('Cancel', 'ghost', () => this.finish(null));
    this.ok = this.button('Save Scene', 'primary', () => this.submit());
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.submit(); } });
    this.input.addEventListener('input', () => this.check());
    this.body.addEventListener('change', () => this.check());
    this.onClose = () => this.finish(null);
  }

  ask(name: string, tracks: Track[], background: string): Promise<SaveChoice | null> {
    setText(this.what, t('Everything on the ticked tracks goes into the scene. Characters and sound are left out unless you tick them.'));
    setText(q(this.bg, '.fm-ms-trk-name'), t('Background color'));
    q<HTMLElement>(this.bg, '.fm-ms-swatch').style.background = background;
    setText(this.none, t('Tick at least one track or the background color.'));
    const fill = (row: HTMLElement, tr: Track): void => {
      const sort = trackSort(tr);
      if (row.dataset.sort !== sort) { row.dataset.sort = sort; q(row, '.fm-ms-trk-ico').innerHTML = SORT_ICON[sort]; }
      setText(q(row, '.fm-ms-trk-name'), tr.name);
      setText(q(row, '.fm-ms-trk-tag'), SORT_TAG[sort] ? t(SORT_TAG[sort]) : '');
      setChecked(q<HTMLInputElement>(row, 'input'), inByDefault(tr));
    };
    patchList(this.list, tracks, {
      key: (tr) => tr.id,
      create: (tr) => { const row = el<HTMLElement>(`<label class="fm-ms-trk"><input type="checkbox"><span class="fm-ms-trk-ico"></span><span class="fm-ms-trk-name" data-no-i18n></span><span class="fm-ms-trk-tag"></span></label>`); fill(row, tr); return row; },
      update: fill,
    });
    setChecked(q<HTMLInputElement>(this.bg, 'input'), background.toLowerCase() !== '#ffffff');
    this.input.value = name;
    this.check();
    this.open(this.input);
    this.input.select();
    return new Promise((r) => { this.resolve = r; });
  }

  private picked(): Set<string> {
    const out = new Set<string>();
    for (const row of Array.from(this.list.children) as HTMLElement[]) if (q<HTMLInputElement>(row, 'input').checked && row.dataset.key) out.add(row.dataset.key);
    return out;
  }

  private check(): void {
    const any = this.picked().size > 0 || q<HTMLInputElement>(this.bg, 'input').checked;
    setClass(this.none, 'is-shown', !any);
    setDisabled(this.ok, !any || !this.input.value.trim());
  }

  private submit(): void {
    if (this.ok.disabled) return;
    this.finish({ name: this.input.value.trim(), tracks: this.picked(), background: q<HTMLInputElement>(this.bg, 'input').checked });
  }

  private finish(v: SaveChoice | null): void {
    const done = this.resolve;
    this.resolve = null;
    if (this.isOpen) this.close();
    done?.(v);
  }
}

export function installMyScenes(kit: FeatureKit): void {
  const { engine, renderer, commands } = kit;
  let items: SceneItem[] = [];
  let read = false;
  let readErr = '';
  let busy: string | null = null;
  let saving = false;
  let card: SaveSceneCard | null = null;
  const posters = new Map<string, { want: string; url: string }>();

  const root = el<HTMLElement>(
    `<div class="fm-ms"><div class="fm-build-sec"></div>` +
    `<div class="fm-build-rows"><button class="fm-build-row is-lead fm-ms-save" type="button"><span class="fm-build-rowicon">${icon('plus', 18)}</span><span class="fm-build-rowlabel"></span></button></div>` +
    `<div class="fm-build-tiles is-wide fm-ms-tiles" role="group"></div>` +
    `<div class="fm-build-tiles is-wide fm-ms-ph"><div class="fm-build-tile fm-ms-ghost" aria-hidden="true"><span class="fm-build-thumb"></span><span class="fm-build-name">&nbsp;</span></div><p class="fm-build-note fm-ms-empty"></p></div></div>`);
  const saveBtn = q<HTMLButtonElement>(root, '.fm-ms-save');
  const list = q<HTMLElement>(root, '.fm-ms-tiles');
  const empty = q<HTMLElement>(root, '.fm-ms-empty');
  const ph = q<HTMLElement>(root, '.fm-ms-ph');

  const canSave = (): boolean => !!engine.movie && engine.movie.tracks.some((tr) => tr.content.length > 0) && !saving;

  const paint = (): void => {
    setText(q(root, '.fm-build-sec'), t('My scenes'));
    setText(q(saveBtn, '.fm-build-rowlabel'), t('Save as Scene...'));
    setDisabled(saveBtn, !canSave());
    list.setAttribute('aria-label', t('My scenes'));
    patchList(list, items, { key: (s) => s.name, create: makeTile, update: fillTile });
    const keys = new Set(items.map((s) => s.name));
    for (const [k, p] of posters) if (!keys.has(k)) { if (p.url) URL.revokeObjectURL(p.url); posters.delete(k); }
    setText(empty, !read ? '' : readErr || t('No scenes saved yet. Build scenery in a movie, then choose Save as Scene... to keep it here and lay it behind any movie.'));
    setHidden(ph, read && items.length > 0);
    setHidden(list, items.length === 0);
  };

  const makeTile = (s: SceneItem): HTMLElement => {
    const n = el<HTMLElement>(
      `<div class="fm-ms-tile"><button class="fm-build-tile" type="button"><span class="fm-build-thumb"><img alt="" hidden><span class="fm-build-glyph fm-ms-glyph">${SCENE_GLYPH}</span></span><span class="fm-build-name" data-no-i18n></span></button>` +
      `<button class="fm-ms-more" type="button" aria-haspopup="menu">${MORE}</button></div>`);
    const img = q<HTMLImageElement>(n, 'img');
    img.addEventListener('load', () => { setHidden(img, false); setHidden(q(n, '.fm-ms-glyph'), true); });
    img.addEventListener('error', () => { setHidden(img, true); setHidden(q(n, '.fm-ms-glyph'), false); });
    fillTile(n, s);
    return n;
  };

  const fillTile = (n: HTMLElement, s: SceneItem): void => {
    const tile = q<HTMLButtonElement>(n, '.fm-build-tile');
    const more = q<HTMLButtonElement>(n, '.fm-ms-more');
    setText(q(n, '.fm-build-name'), s.name);
    if (tile.title !== s.name) tile.title = s.name;
    const name = tf('Add {name} behind the movie', { name: s.name });
    if (tile.getAttribute('aria-label') !== name) tile.setAttribute('aria-label', name);
    const moreName = tf('More for {name}', { name: s.name });
    if (more.getAttribute('aria-label') !== moreName) { more.setAttribute('aria-label', moreName); more.title = moreName; }
    setClass(tile, 'is-busy', busy === s.name);
    setDisabled(tile, busy !== null || !engine.movie);
    loadPoster(n, q<HTMLImageElement>(n, 'img'), s);
  };

  const loadPoster = (n: HTMLElement, img: HTMLImageElement, s: SceneItem): void => {
    const want = `${s.name}\n${s.modified}`;
    const had = posters.get(s.name);
    if (had?.want === want) return;
    const slot = { want, url: had?.url ?? '' };
    posters.set(s.name, slot);
    void scenesApi.poster(s.name, s.modified, n).then((blob) => {
      if (!blob || posters.get(s.name) !== slot) return;
      const url = URL.createObjectURL(blob);
      swapMedia(img, url).then(() => {
        if (posters.get(s.name) !== slot) { URL.revokeObjectURL(url); return; }
        if (slot.url) URL.revokeObjectURL(slot.url);
        slot.url = url;
      }, () => URL.revokeObjectURL(url));
    });
  };

  const refresh = async (): Promise<void> => {
    try { items = (await scenesApi.list()).items; readErr = ''; } catch (e) {
      items = [];
      readErr = e instanceof Error && e.message ? t(e.message) : t('My scenes could not be read.');
    }
    read = true;
    paint();
  };

  const lay = async (name: string): Promise<void> => {
    if (busy || !engine.movie) return;
    busy = name;
    paint();
    try { await addMySceneToMovie(engine, renderer, name); } catch (e) {
      toast(e instanceof Error && e.message ? t(e.message) : t('The scene could not be added.'), 'error');
    } finally {
      busy = null;
      paint();
    }
  };

  const rename = async (name: string): Promise<void> => {
    const to = await promptName(t('Rename Scene'), name, t('Rename'));
    if (!to || to === name) return;
    try {
      const item = await scenesApi.rename(name, to);
      const old = posters.get(name);
      if (old) { posters.delete(name); posters.set(item.name, old); }
      items = items.map((s) => (s.name === name ? item : s));
      paint();
    } catch (e) { toast(e instanceof Error && e.message ? t(e.message) : t('The scene could not be renamed.'), 'error'); }
  };

  const remove = async (name: string): Promise<void> => {
    if (!(await confirmAction(t('Delete Scene'), tf('Move {name} to Recently Deleted?', { name }), t('Delete'), true))) return;
    try {
      await scenesApi.remove(name);
      items = items.filter((s) => s.name !== name);
      paint();
      toast(tf('{name} moved to Recently Deleted.', { name }));
    } catch (e) { toast(e instanceof Error && e.message ? t(e.message) : t('The scene could not be deleted.'), 'error'); }
  };

  const menu = new Popover('fm-ms-menu');
  const renameRow = popRow(null, '');
  const deleteRow = popRow('delete', '', { danger: true });
  menu.body.append(renameRow.el, deleteRow.el);
  let menuFor = '';
  let menuBtn: HTMLElement | null = null;
  menu.onHide(() => { menuBtn?.setAttribute('aria-expanded', 'false'); menuBtn = null; });
  renameRow.el.addEventListener('click', () => { menu.hide(); void rename(menuFor); });
  deleteRow.el.addEventListener('click', () => { menu.hide(); void remove(menuFor); });
  const openMenu = (name: string, at: HTMLElement | { x: number; y: number }): void => {
    menuFor = name;
    renameRow.setLabel(t('Rename...'));
    deleteRow.setLabel(t('Delete...'));
    if (at instanceof HTMLElement) { menu.showFor(at, 'below'); menuBtn = at; at.setAttribute('aria-expanded', 'true'); } else menu.showAt(at.x, at.y);
  };

  list.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const host = target.closest<HTMLElement>('.fm-ms-tile');
    const name = host?.dataset.key;
    if (!host || !name) return;
    const more = target.closest<HTMLButtonElement>('.fm-ms-more');
    if (more) { openMenu(name, more); return; }
    const tile = target.closest<HTMLButtonElement>('.fm-build-tile');
    if (tile && !tile.disabled) void lay(name);
  });
  list.addEventListener('contextmenu', (e) => {
    const name = (e.target as HTMLElement).closest<HTMLElement>('.fm-ms-tile')?.dataset.key;
    if (!name) return;
    e.preventDefault();
    openMenu(name, { x: e.clientX, y: e.clientY });
  });

  const saveAs = async (): Promise<void> => {
    const m = engine.movie;
    if (!m || saving) return;
    try { items = (await scenesApi.list()).items; } catch (e) { toast(e instanceof Error && e.message ? t(e.message) : t('My scenes could not be read.'), 'error'); return; }
    const base = m.name && !/^Untitled Movie( \d+)?$/.test(m.name) ? m.name : t('My Scene');
    card ??= new SaveSceneCard();
    const choice = await card.ask(freeSceneName(base, items.map((s) => s.name)), m.tracks.filter((tr) => tr.content.length > 0), m.background);
    if (!choice || !engine.movie) return;
    let name = freeSceneName(choice.name, []);
    if (items.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      const replace = await chooseOrCancel(t('Save as Scene'), tf('A scene named {name} is already saved. Replace it, or keep both?', { name }), t('Replace'), t('Keep Both'), true);
      if (replace === null) return;
      if (!replace) name = freeSceneName(name, items.map((s) => s.name));
    }
    saving = true;
    paint();
    try {
      const item = await scenesApi.write(name, await packScene(engine, renderer, choice.tracks, choice.background));
      items = [item, ...items.filter((s) => s.name.toLowerCase() !== item.name.toLowerCase())];
      toast(tf('{name} saved to My scenes.', { name: item.name }));
      kit.showBuild('scenes');
    } catch (e) {
      toast(e instanceof Error && e.message ? t(e.message) : t('The scene could not be saved.'), 'error');
    } finally {
      saving = false;
      paint();
    }
  };
  saveBtn.addEventListener('click', () => { void saveAs(); });

  commands.add({
    id: 'scene.save-as', label: 'Save as Scene...', icon: 'save', enabled: canSave, run: () => { void saveAs(); },
    group: 'File', description: 'Saves the tracks you choose from this movie (pictures, drawings, shapes, props) as a scene of your own, kept in My scenes on the Scenes tab.',
    when: 'Use when scenery built in one movie should be reused behind other movies.',
  });
  kit.menu('Movie', ['-', 'scene.save-as']);
  kit.buildSection('scenes', root, paint);
  const pane = root.parentElement;
  if (pane && pane.firstChild !== root) pane.insertBefore(root, pane.firstChild);
  void refresh();
}
