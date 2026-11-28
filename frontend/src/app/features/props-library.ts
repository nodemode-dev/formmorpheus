import { addPropToMovie, prefetchProp, PROP_CATEGORIES, PROP_STYLES, propFileUrl, readPropManifest, type PropEntry } from '../../io/starter-props';
import { el, q, setClass, setDisabled, setHidden, setText, setTitle } from '../../ui/dom';
import { t } from '../../ui/i18n';
import { tf } from '../../ui/i18n-fill';
import { icon } from '../../ui/icons';
import { toast } from '../../ui/toast';
import type { FeatureKit } from '../feature-kit';
import '../../styles/props-library.css';

const ALL = '';

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

interface PropTile { entry: PropEntry; node: HTMLButtonElement; words: string }

export function installPropsLibrary(kit: FeatureKit): void {
  const { engine } = kit;
  let style = ALL, category = ALL, query = '';
  let tiles: PropTile[] = [];
  let loaded = false;
  const busy = new Set<string>();

  const root = el<HTMLElement>(
    '<div class="fm-props">' +
    '<div class="fm-props-head">' +
    `<label class="fm-props-search"><span class="fm-props-searchicon">${icon('search', 14)}</span><input class="fm-props-input" type="search" spellcheck="false" autocomplete="off"></label>` +
    '<div class="fm-props-seg" role="group"></div>' +
    '<div class="fm-props-chips" role="group"></div>' +
    '</div>' +
    '<p class="fm-build-note fm-props-hint"></p>' +
    '<div class="fm-build-tiles fm-props-tiles" role="group"></div>' +
    '<p class="fm-build-note fm-props-empty" hidden></p>' +
    '</div>');
  const input = q<HTMLInputElement>(root, '.fm-props-input');
  input.placeholder = t('Search props');
  input.setAttribute('aria-label', t('Search props'));
  const seg = q(root, '.fm-props-seg');
  seg.setAttribute('aria-label', t('Style'));
  const chips = q(root, '.fm-props-chips');
  chips.setAttribute('aria-label', t('Category'));
  setText(q(root, '.fm-props-hint'), t('Click a prop to add it at the Playhead on a track of its own. It stands on the floor guide when the movie has one.'));
  const grid = q(root, '.fm-props-tiles');
  grid.setAttribute('aria-label', t('Props'));
  const empty = q(root, '.fm-props-empty');

  const choice = (host: HTMLElement, cls: string, value: string, label: string, pick: (v: string) => void): HTMLButtonElement => {
    const b = el<HTMLButtonElement>(`<button class="${cls}" type="button" aria-pressed="false"></button>`);
    b.dataset.value = value;
    setText(b, t(label));
    b.addEventListener('click', () => pick(value));
    host.appendChild(b);
    return b;
  };
  const styleBtns = [{ id: ALL, label: 'All', tip: 'Every style' }, ...PROP_STYLES].map((s) => {
    const b = choice(seg, 'fm-props-segbtn', s.id, s.label, (v) => { style = v; filter(); });
    b.title = t(s.tip);
    return b;
  });
  const chipBtns = [{ id: ALL, label: 'All' }, ...PROP_CATEGORIES].map((c) => choice(chips, 'fm-props-chip', c.id, c.label, (v) => { category = v; filter(); }));

  const pressed = (list: HTMLButtonElement[], value: string): void => {
    for (const b of list) {
      const on = b.dataset.value === value;
      setClass(b, 'is-on', on);
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
    }
  };

  function filter(): void {
    pressed(styleBtns, style);
    pressed(chipBtns, category);
    const words = fold(query).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const tile of tiles) {
      const e = tile.entry;
      const ok = (style === ALL || e.style === style) && (category === ALL || e.category === category) && words.every((w) => tile.words.includes(w));
      setHidden(tile.node, !ok);
      if (ok) shown++;
    }
    setText(empty, loaded && !tiles.length ? t('The props could not be read.') : t('No props match. Try another word, or choose All.'));
    setHidden(empty, !loaded || shown > 0);
  }

  input.addEventListener('input', () => { query = input.value; filter(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ''; query = ''; filter(); }
  });

  const styleLabel = (id: string): string => t(PROP_STYLES.find((s) => s.id === id)?.label ?? id);
  const catLabel = (id: string): string => t(PROP_CATEGORIES.find((c) => c.id === id)?.label ?? id);

  function makeTile(entry: PropEntry): PropTile {
    const node = el<HTMLButtonElement>('<button class="fm-build-tile fm-props-tile" type="button"><span class="fm-build-thumb fm-props-thumb"><img alt="" loading="lazy" decoding="async" draggable="false"></span><span class="fm-build-name" data-no-i18n></span></button>');
    const name = t(entry.name);
    setText(q(node, '.fm-build-name'), name);
    setTitle(node, `${name} · ${catLabel(entry.category)} · ${styleLabel(entry.style)}`);
    node.setAttribute('aria-label', tf('Add {name} to the movie', { name }));
    q<HTMLImageElement>(node, 'img').src = propFileUrl(entry);
    node.dataset.key = entry.id;
    node.addEventListener('pointerenter', () => prefetchProp(entry));
    node.addEventListener('focus', () => prefetchProp(entry));
    const words = fold([name, entry.name, catLabel(entry.category), entry.category, styleLabel(entry.style), ...(entry.tags ?? [])].join(' '));
    return { entry, node, words };
  }

  function paint(): void {
    const off = !engine.movie;
    for (const tile of tiles) {
      const b = busy.has(tile.entry.id);
      setClass(tile.node, 'is-busy', b);
      setDisabled(tile.node, off || b);
    }
  }

  async function add(entry: PropEntry): Promise<void> {
    if (busy.has(entry.id) || !engine.movie) return;
    busy.add(entry.id);
    paint();
    try {
      await addPropToMovie(engine, entry, t(entry.name));
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : tf('{name} could not be loaded.', { name: t(entry.name) }));
    } finally {
      busy.delete(entry.id);
      paint();
    }
  }

  grid.addEventListener('click', (e) => {
    const node = (e.target as HTMLElement).closest<HTMLButtonElement>('.fm-props-tile');
    const tile = node && !node.disabled ? tiles.find((x) => x.node === node) : undefined;
    if (tile) void add(tile.entry);
  });

  const catOrder = (id: string): number => { const i = PROP_CATEGORIES.findIndex((c) => c.id === id); return i < 0 ? PROP_CATEGORIES.length : i; };
  const styleOrder = (id: string): number => PROP_STYLES.findIndex((s) => s.id === id);

  void readPropManifest().then((list) => {
    const sorted = list.map((e, i) => ({ e, i })).sort((a, b) => catOrder(a.e.category) - catOrder(b.e.category) || styleOrder(a.e.style) - styleOrder(b.e.style) || a.i - b.i);
    tiles = sorted.map(({ e }) => makeTile(e));
    grid.append(...tiles.map((x) => x.node));
    loaded = true;
    setClass(grid, 'is-ready', true);
    filter();
    paint();
  });

  filter();
  kit.buildSection('props', root, paint);
  engine.on('projects', paint);
  engine.on('movie', paint);

  kit.commands.add({
    id: 'props.library',
    label: 'Add Prop...',
    icon: 'shape',
    enabled: () => !!engine.movie,
    run: () => { kit.showBuild('props'); requestAnimationFrame(() => input.focus()); },
    group: 'Content',
    description: 'Opens the Props tab of the Build panel: furniture, plants, signs and more, drawn in three styles, to add to the movie.',
    when: 'Use when the person wants a ready-made object (a chair, a tree, a sign) in the movie.',
  });
  kit.menu('Content', ['-', 'props.library']);
}
