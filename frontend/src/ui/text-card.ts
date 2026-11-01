import type { Engine } from '../engine/engine';
import { locate } from '../engine/model';
import * as ops from '../engine/ops';
import type { Content, TextStyle } from '../engine/types';
import { ensureTextFont, familyFaces, fontCatalog, previewFont } from '../media/fonts';
import { el, q, setClass, setText } from './dom';
import { icon } from './icons';
import { Popover } from './popover';
import { TextFxPanes } from './text-fx-panes';
import { textSel } from './text-sel';
import { diffText, shiftRuns } from '../engine/text-rich';

const ALIGNS: Array<[TextStyle['align'], string, string]> = [['left', 'alignLeftEdge', 'Align left'], ['center', 'alignHcenterEdge', 'Align centre'], ['right', 'alignRightEdge', 'Align right'], ['justify', 'alignJustify', 'Justify']];
const CAPS: Array<[TextStyle['caps'] | '', string, string]> = [['', 'Aa', 'Normal case'], ['upper', 'AA', 'All caps'], ['lower', 'aa', 'Lower case'], ['small', 'Aa', 'Small caps']];
const KERNS: Array<[TextStyle['kerning'] | '', string, string]> = [['', 'Font', 'The font\'s own pair kerning'], ['none', 'None', 'No pair kerning'], ['optical', 'Optical', 'Spacing measured from the letter shapes']];
const WEIGHT_NAMES: Record<number, string> = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };

interface NumField { key: 'size' | 'tracking' | 'leading' | 'baseline'; label: string; min: number; max: number; step: number; def: number | null }
const NUMS: NumField[] = [
  { key: 'size', label: 'Size', min: 8, max: 600, step: 1, def: null },
  { key: 'tracking', label: 'Tracking', min: -200, max: 1000, step: 5, def: 0 },
  { key: 'leading', label: 'Leading', min: 0.6, max: 3, step: 0.05, def: 1.2 },
  { key: 'baseline', label: 'Baseline', min: -300, max: 300, step: 1, def: 0 },
];

interface Slider { range: HTMLInputElement; num: HTMLInputElement }

/** Glass card for Text content: a Fonts tab (typeface list, variant, color) and a Format tab (size, tracking, kerning, leading,
 *  baseline, alignment, case, underline, outline, strikethrough, vertical, wrap width). One merged undo step per gesture. */
/** Where the person last dragged the card to (kept while the page lives). */
let tcMoved: { x: number; y: number } | null = null;

export class TextCard {
  private readonly pop = new Popover('fm-tc', 340);
  private id = '';
  private readonly area: HTMLTextAreaElement;
  private readonly tabs = new Map<string, HTMLButtonElement>();
  private readonly panes = new Map<string, HTMLElement>();
  private readonly list: HTMLElement;
  private readonly groups = new Map<string, HTMLElement>();
  private readonly faces = new Map<string, HTMLButtonElement>();
  private readonly weight: HTMLSelectElement;
  private readonly color: HTMLInputElement;
  private readonly hex: HTMLElement;
  private readonly sliders = new Map<string, Slider>();
  private readonly aligns = new Map<string, HTMLButtonElement>();
  private readonly caps = new Map<string, HTMLButtonElement>();
  private readonly kerns = new Map<string, HTMLButtonElement>();
  private readonly flags = new Map<string, HTMLButtonElement>();
  private readonly strokeColor: HTMLInputElement;
  private readonly strokeW: HTMLInputElement;
  private readonly wrapW: HTMLInputElement;
  private readonly wrapAuto: HTMLButtonElement;
  private weightKey = '';
  private readonly rich: TextFxPanes;
  /** Called when Import font is pressed (the app opens its file picker). */
  onImportFont: (() => void) | null = null;

  constructor(private readonly engine: Engine) {
    const root = el<HTMLElement>(`<div class="fm-tc-body">
      <textarea class="fm-tc-text" rows="3" spellcheck="false" aria-label="Text"></textarea>
      <div class="fm-tc-tabs" role="tablist"></div>
      <div class="fm-tc-panes">
      <div class="fm-tc-pane" data-pane="fonts">
        <div class="fm-tc-fonts" role="listbox" aria-label="Typeface"></div>
        <div class="fm-tc-row"><span>Add</span><button class="fm-tc-mini" type="button" data-f="importFont" title="Bring in a font file: otf, ttf, woff or woff2">Import font...</button></div>
        <label class="fm-tc-row"><span>Font</span><select class="fm-tc-select" data-f="weight" aria-label="Font variant"></select></label>
        <div class="fm-tc-row"><span>Color</span><label class="fm-tc-swatch"><input type="color" data-f="color" aria-label="Color"></label><span class="fm-tc-hex"></span></div>
        <div class="fm-tc-row"><span>Style</span><div class="fm-tc-seg" data-g="flags"></div></div>
      </div>
      <div class="fm-tc-pane" data-pane="format" hidden>
        <div data-g="nums"></div>
        <div class="fm-tc-row"><span>Kerning</span><div class="fm-tc-seg fm-tc-seg-wide" data-g="kern"></div></div>
        <div class="fm-tc-row"><span>Align</span><div class="fm-tc-seg" data-g="align"></div></div>
        <div class="fm-tc-row"><span>Case</span><div class="fm-tc-seg" data-g="caps"></div></div>
        <div class="fm-tc-row"><span>Lines</span><div class="fm-tc-seg" data-g="lines"></div></div>
        <div class="fm-tc-row"><span>Outline</span><label class="fm-tc-swatch"><input type="color" data-f="strokeColor" aria-label="Outline color"></label><input class="fm-tc-num" type="number" min="0" max="80" step="1" data-f="strokeW" aria-label="Outline width in pixels"></div>
        <div class="fm-tc-row"><span>Wrap</span><input class="fm-tc-num fm-tc-wide" type="number" min="20" max="8000" step="10" data-f="wrapW" aria-label="Wrap width in pixels"><button class="fm-tc-mini" type="button" data-f="wrapAuto">Auto</button></div>
      </div>
      </div>
    </div>`);
    this.pop.body.appendChild(root);
    this.area = q<HTMLTextAreaElement>(root, 'textarea');
    this.list = q(root, '.fm-tc-fonts');
    this.weight = q<HTMLSelectElement>(root, '[data-f="weight"]');
    this.color = q<HTMLInputElement>(root, '[data-f="color"]');
    this.hex = q(root, '.fm-tc-hex');
    this.strokeColor = q<HTMLInputElement>(root, '[data-f="strokeColor"]');
    this.strokeW = q<HTMLInputElement>(root, '[data-f="strokeW"]');
    this.wrapW = q<HTMLInputElement>(root, '[data-f="wrapW"]');
    this.wrapAuto = q<HTMLButtonElement>(root, '[data-f="wrapAuto"]');
    q<HTMLButtonElement>(root, '[data-f="importFont"]').addEventListener('click', () => this.onImportFont?.());

    const tabBar = q(root, '.fm-tc-tabs');
    this.grab(tabBar);
    // Spans, Effects and Animate: styled words, shadow and box, build on / off (ui/text-fx-panes.ts)
    this.rich = new TextFxPanes(engine, () => this.id);
    const paneHost = q(root, '.fm-tc-panes');
    paneHost.append(this.rich.spans, this.rich.effects, this.rich.animate);
    for (const [id, label] of [['fonts', 'Fonts'], ['format', 'Format'], ['spans', 'Spans'], ['effects', 'Effects'], ['animate', 'Animate']] as const) {
      const b = el<HTMLButtonElement>(`<button class="fm-tc-tab" type="button" role="tab" aria-selected="false">${label}</button>`);
      b.addEventListener('click', () => this.showTab(id));
      this.tabs.set(id, b);
      this.panes.set(id, q(root, `[data-pane="${id}"]`));
      tabBar.appendChild(b);
    }
    for (const g of ['bundled', 'movie', 'system'] as const) {
      const head = el(`<div class="fm-tc-group" hidden>${g === 'bundled' ? 'Built in' : g === 'movie' ? 'In this movie' : 'On this computer'}</div>`);
      const box = el('<div class="fm-tc-group-list"></div>');
      this.list.append(head, box);
      this.groups.set(g, box);
      box.dataset.head = '';
      (box as unknown as { _head: HTMLElement })._head = head;
    }

    // Fonts tab
    const flagBox = q(root, '[data-g="flags"]');
    const mkToggle = (host: HTMLElement, store: Map<string, HTMLButtonElement>, key: string, html: string, title: string, run: () => void, cls = ''): void => {
      const b = el<HTMLButtonElement>(`<button class="fm-tc-seg-btn ${cls}" type="button" title="${title}" aria-label="${title}" aria-pressed="false">${html}</button>`);
      b.addEventListener('click', () => { run(); this.endGesture(); });
      store.set(key, b);
      host.appendChild(b);
    };
    mkToggle(flagBox, this.flags, 'bold', 'B', 'Bold', () => this.toggleBold(), 'fm-tc-b');
    mkToggle(flagBox, this.flags, 'italic', 'I', 'Italic', () => this.commit({ italic: this.cur()?.italic ? undefined : true }, 'italic'), 'fm-tc-i');
    mkToggle(flagBox, this.flags, 'underline', 'U', 'Underline', () => this.commit({ underline: this.cur()?.underline ? undefined : true }, 'underline'), 'fm-tc-u');
    mkToggle(flagBox, this.flags, 'strike', 'S', 'Strikethrough', () => this.commit({ strike: this.cur()?.strike ? undefined : true }, 'strike'), 'fm-tc-s');

    // Format tab
    const nums = q(root, '[data-g="nums"]');
    for (const f of NUMS) {
      const row = el(`<div class="fm-tc-row"><span>${f.label}</span><input class="fm-cm-range fm-tc-range" type="range" min="${f.min}" max="${f.max}" step="${f.step}" aria-label="${f.label}"><input class="fm-tc-num" type="number" step="${f.step}" aria-label="${f.label} value"></div>`);
      const range = q<HTMLInputElement>(row, 'input[type="range"]'), num = q<HTMLInputElement>(row, 'input[type="number"]');
      const put = (v: number): void => {
        if (!Number.isFinite(v)) return;
        const val = f.key === 'size' ? Math.min(2000, Math.max(1, Math.round(v))) : v;
        this.commit({ [f.key]: f.def !== null && Math.abs(val - f.def) < 1e-6 ? undefined : val } as Partial<TextStyle>, f.key);
        this.paintSlider(f, val, range, num, true);
      };
      range.addEventListener('input', () => put(range.valueAsNumber));
      range.addEventListener('change', () => this.endGesture());
      num.addEventListener('input', () => { if (num.value !== '') put(num.valueAsNumber); });
      num.addEventListener('change', () => this.endGesture());
      this.sliders.set(f.key, { range, num });
      nums.appendChild(row);
    }
    for (const [k, label, title] of KERNS) mkToggle(q(root, '[data-g="kern"]'), this.kerns, k ?? '', label, title, () => this.commit({ kerning: k || undefined }, 'kerning'));
    for (const [a, ic, label] of ALIGNS) mkToggle(q(root, '[data-g="align"]'), this.aligns, a, icon(ic, 16), label, () => this.commit({ align: a }, 'align'));
    for (const [k, label, title] of CAPS) mkToggle(q(root, '[data-g="caps"]'), this.caps, k ?? '', k === 'small' ? '<span class="fm-tc-sc">Aa</span>' : label, title, () => this.commit({ caps: k || undefined }, 'caps'));
    mkToggle(q(root, '[data-g="lines"]'), this.flags, 'underline2', '<span class="fm-tc-u">U</span>', 'Underline', () => this.commit({ underline: this.cur()?.underline ? undefined : true }, 'underline'));
    mkToggle(q(root, '[data-g="lines"]'), this.flags, 'strike2', '<span class="fm-tc-s">S</span>', 'Strikethrough', () => this.commit({ strike: this.cur()?.strike ? undefined : true }, 'strike'));
    mkToggle(q(root, '[data-g="lines"]'), this.flags, 'vertical', icon('tTypeV', 16), 'Vertical text', () => this.commit({ vertical: this.cur()?.vertical ? undefined : true }, 'vertical'));

    // events
    this.area.addEventListener('input', () => {
      const c = this.cur();
      if (c) void ensureTextFont({ ...c, text: this.area.value });
      // spans follow the edit: letters typed or cut before a span move it
      const d = c ? diffText(c.text, this.area.value) : null;
      const runs = c && d ? shiftRuns(c.runs, d.at, d.removed, d.added) : undefined;
      this.commit({ text: this.area.value, runs }, 'text');
    });
    const mark = (): void => { if (this.id) textSel.set(this.id, this.area.selectionStart, this.area.selectionEnd); };
    for (const ev of ['select', 'keyup', 'mouseup', 'input']) this.area.addEventListener(ev, mark);
    this.area.addEventListener('change', () => this.endGesture());
    this.weight.addEventListener('change', () => { void this.setFace(Number(this.weight.value)); this.endGesture(); });
    this.color.addEventListener('input', () => { this.commit({ color: this.color.value }, 'color'); setText(this.hex, this.color.value.toUpperCase()); });
    this.color.addEventListener('change', () => this.endGesture());
    const stroke = (): void => {
      const w = Math.max(0, Math.round(this.strokeW.valueAsNumber || 0));
      this.commit({ stroke: w > 0 ? { color: this.strokeColor.value, width: w } : undefined }, 'stroke');
    };
    this.strokeColor.addEventListener('input', () => { if (this.strokeW.valueAsNumber > 0) stroke(); else { this.strokeW.value = '4'; stroke(); } });
    this.strokeColor.addEventListener('change', () => this.endGesture());
    this.strokeW.addEventListener('input', stroke);
    this.strokeW.addEventListener('change', () => this.endGesture());
    this.wrapW.addEventListener('input', () => { const v = this.wrapW.valueAsNumber; if (Number.isFinite(v) && v >= 20) this.commit({ boxW: Math.round(v) }, 'boxW'); });
    this.wrapW.addEventListener('change', () => this.endGesture());
    this.wrapAuto.addEventListener('click', () => { this.commit({ boxW: undefined }, 'boxW'); this.endGesture(); });

    this.pop.onHide(() => { this.endGesture(); this.id = ''; });
    engine.on('movie', () => { if (this.pop.isOpen) this.sync(); });
    engine.on('selection', () => { if (this.pop.isOpen && !this.engine.selection.content.includes(this.id)) this.close(); });
    this.showTab('fonts');
  }

  open(anchor: HTMLElement | { x: number; y: number }, contentId: string, tab: 'fonts' | 'format' | 'spans' | 'effects' | 'animate' = 'fonts'): void {
    const m = this.engine.movie;
    const at = m ? locate(m, contentId) : null;
    if (!at || at.content.kind !== 'text' || !at.content.text) return;
    this.id = contentId;
    // Edit Style from the inline editor with words selected goes to the Spans tab
    this.showTab(tab === 'format' && textSel.range(contentId) ? 'spans' : tab);
    this.sync(true);
    if (anchor instanceof HTMLElement) this.pop.showFor(anchor, 'below');
    else this.pop.showAt(anchor.x, anchor.y);
    this.dock();
    this.fit();
    // a range picked in the inline editor stays picked: the Spans tab styles it
    if (textSel.range(contentId)) return;
    this.area.focus();
    this.area.select();
  }

  close(): void {
    this.pop.hide();
  }

  private showTab(id: string): void {
    for (const [k, b] of this.tabs) { setClass(b, 'is-on', k === id); b.setAttribute('aria-selected', String(k === id)); }
    for (const [k, p] of this.panes) if (p.hidden !== (k !== id)) p.hidden = k !== id;
    if (this.pop.isOpen) this.fit();
  }

  /** Puts the card beside the Stage (right of it when there is room, else in its top right corner), or where the person last dragged it; its height stays inside the Stage so the Timeline is never covered. */
  private dock(): void {
    const e = this.pop.el, st = document.querySelector('.fm-stage-wrap')?.getBoundingClientRect();
    if (st) e.style.maxHeight = `${Math.max(240, Math.round(st.height - 16))}px`;
    const w = e.offsetWidth, h = e.offsetHeight;
    let x = tcMoved ? tcMoved.x : st ? (window.innerWidth - st.right >= w + 16 ? st.right + 8 : st.right - w - 8) : window.innerWidth - w - 8;
    let y = tcMoved ? tcMoved.y : st ? st.top + 8 : 8;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
    e.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  /** The tab strip is a handle: dragging it moves the card, and the place is kept for the next one. */
  private grab(handle: HTMLElement): void {
    handle.classList.add('fm-tc-grab');
    handle.addEventListener('pointerdown', (ev) => {
      if ((ev.target as HTMLElement).closest('button') || ev.button !== 0) return;
      const e = this.pop.el, r = e.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
      handle.setPointerCapture(ev.pointerId);
      const move = (m: PointerEvent): void => {
        const x = Math.max(8, Math.min(m.clientX - dx, window.innerWidth - r.width - 8)), y = Math.max(8, Math.min(m.clientY - dy, window.innerHeight - 40));
        e.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        tcMoved = { x, y };
      };
      const up = (): void => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  /** Keeps the card on screen after its height changed (a tab switch). */
  private fit(): void {
    const e = this.pop.el, r = e.getBoundingClientRect();
    const floor = document.querySelector('.cv-status')?.getBoundingClientRect().top ?? window.innerHeight;
    const top = Math.max(8, Math.min(r.top, Math.min(window.innerHeight, floor) - 8 - r.height));
    if (Math.abs(top - r.top) > 0.5) e.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(top)}px)`;
  }

  private current(): Content | null {
    const m = this.engine.movie;
    const at = m && this.id ? locate(m, this.id) : null;
    return at && at.content.text ? at.content : null;
  }

  private cur(): TextStyle | null {
    return this.current()?.text ?? null;
  }

  /** Applies a patch; a key set to undefined is removed so a movie only carries what is used. */
  private commit(patch: Partial<TextStyle>, field: string): void {
    const id = this.id;
    if (!id) return;
    this.engine.run('Edit Text', (m) => ops.updateContent(m, id, (c) => {
      if (!c.text) return c;
      const text = { ...c.text, ...patch } as TextStyle;
      for (const k of Object.keys(patch) as Array<keyof TextStyle>) if (patch[k] === undefined) delete text[k];
      const named = patch.text !== undefined ? { name: patch.text.split('\n')[0].slice(0, 40) || c.name } : {};
      return { ...c, ...named, text };
    }), `text-${id}-${field}`);
  }

  private endGesture(): void {
    this.engine.endGesture();
  }

  private toggleBold(): void {
    const t = this.cur();
    if (!t) return;
    const ws = familyFaces(t.font).weights;
    const near = (target: number): number => ws.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a), ws[0] ?? target);
    void this.setFace(t.weight >= 600 ? near(400) : near(700));
  }

  private async setFace(weight: number): Promise<void> {
    const t = this.cur();
    if (!t) return;
    await ensureTextFont({ ...t, weight });
    this.commit({ weight }, 'weight');
    this.endGesture();
  }

  private pickFont(family: string): void {
    const t = this.cur();
    if (!t) return;
    const faces = familyFaces(family);
    const weight = faces.weights.includes(t.weight) ? t.weight : faces.weights.reduce((a, b) => (Math.abs(b - t.weight) < Math.abs(a - t.weight) ? b : a), faces.weights[0] ?? 400);
    void ensureTextFont({ ...t, font: family, weight }).then(() => {
      this.commit({ font: family, weight }, 'font');
      this.endGesture();
    });
  }

  private paintSlider(f: NumField, v: number, range: HTMLInputElement, num: HTMLInputElement, fromInput = false): void {
    const r = Math.min(f.max, Math.max(f.min, v));
    range.style.setProperty('--fm-pct', `${((r - f.min) / (f.max - f.min)) * 100}%`);
    if (!fromInput || document.activeElement !== range) { if (range.valueAsNumber !== r) range.value = String(r); }
    if (document.activeElement !== num) num.value = String(f.step < 1 ? Math.round(v * 100) / 100 : Math.round(v));
  }

  /** Builds the typeface buttons once per family set and patches them after that. */
  private syncFonts(t: TextStyle): void {
    const cat = fontCatalog(this.engine.movie);
    const all: Record<string, string[]> = { bundled: cat.bundled, movie: cat.movie, system: cat.system };
    if (!Object.values(all).some((l) => l.includes(t.font))) all.movie = [...all.movie, t.font];
    const wanted = new Set<string>();
    for (const [g, fams] of Object.entries(all)) {
      const box = this.groups.get(g) as HTMLElement;
      for (const fam of fams) {
        wanted.add(fam);
        if (this.faces.has(fam)) continue;
        const b = el<HTMLButtonElement>('<button class="fm-tc-face" type="button" role="option"></button>');
        b.textContent = fam;
        b.style.fontFamily = `"${fam}", Inter, sans-serif`;
        previewFont(fam);
        b.addEventListener('click', () => this.pickFont(fam));
        this.faces.set(fam, b);
        box.appendChild(b);
      }
      (box as unknown as { _head: HTMLElement })._head.hidden = !fams.length;
    }
    for (const [fam, b] of this.faces) if (!wanted.has(fam)) { b.remove(); this.faces.delete(fam); }
    for (const [fam, b] of this.faces) { const on = fam === t.font; setClass(b, 'is-on', on); b.setAttribute('aria-selected', String(on)); }
  }

  /** Patch the fields from the content; the focused field keeps what the person is typing. */
  private sync(first = false): void {
    const c = this.current();
    if (!c || !c.text) return;
    const t = c.text;
    this.syncFonts(t);
    this.rich.sync(t);
    if (first) this.faces.get(t.font)?.scrollIntoView({ block: 'nearest' });
    if (this.area.value !== t.text && document.activeElement !== this.area) this.area.value = t.text;
    // variants of the family
    const fc = familyFaces(t.font);
    const ws = fc.weights.includes(t.weight) ? fc.weights : [...fc.weights, t.weight].sort((a, b) => a - b);
    const key = `${t.font}|${ws.join()}`;
    if (key !== this.weightKey) {
      this.weightKey = key;
      this.weight.textContent = '';
      for (const w of ws) {
        const o = document.createElement('option');
        o.value = String(w);
        o.textContent = WEIGHT_NAMES[w] ?? String(w);
        this.weight.appendChild(o);
      }
    }
    if (this.weight.value !== String(t.weight)) this.weight.value = String(t.weight);
    if (/^#[0-9a-f]{6}$/i.test(t.color) && this.color.value !== t.color.toLowerCase()) this.color.value = t.color.toLowerCase();
    setText(this.hex, t.color.toUpperCase());
    for (const f of NUMS) {
      const s = this.sliders.get(f.key) as Slider;
      const v = (t[f.key] as number | undefined) ?? f.def ?? t.size;
      this.paintSlider(f, v, s.range, s.num);
    }
    const on = (b: HTMLButtonElement | undefined, v: boolean): void => { if (!b) return; setClass(b, 'is-on', v); b.setAttribute('aria-pressed', String(v)); };
    on(this.flags.get('bold'), t.weight >= 600);
    on(this.flags.get('italic'), !!t.italic);
    on(this.flags.get('underline'), !!t.underline);
    on(this.flags.get('underline2'), !!t.underline);
    on(this.flags.get('strike'), !!t.strike);
    on(this.flags.get('strike2'), !!t.strike);
    on(this.flags.get('vertical'), !!t.vertical);
    const italicBtn = this.flags.get('italic');
    if (italicBtn) italicBtn.disabled = !fc.italic;
    for (const [a, b] of this.aligns) on(b, a === t.align);
    for (const [k, b] of this.caps) on(b, k === (t.caps ?? ''));
    for (const [k, b] of this.kerns) on(b, k === (t.kerning ?? ''));
    if (document.activeElement !== this.strokeW) this.strokeW.value = String(t.stroke?.width ?? 0);
    const sc = t.stroke?.color ?? '#000000';
    if (/^#[0-9a-f]{6}$/i.test(sc) && this.strokeColor.value !== sc.toLowerCase()) this.strokeColor.value = sc.toLowerCase();
    if (document.activeElement !== this.wrapW) this.wrapW.value = t.boxW ? String(Math.round(t.boxW)) : '';
    this.wrapW.placeholder = 'Auto';
    this.wrapAuto.disabled = !t.boxW;
  }
}
