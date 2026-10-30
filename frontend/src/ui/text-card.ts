import type { Engine } from '../engine/engine';
import { locate } from '../engine/model';
import * as ops from '../engine/ops';
import type { Content, TextStyle } from '../engine/types';
import { FONT_FAMILIES } from '../media/fonts';
import { el, q, setClass, setText } from './dom';
import { icon } from './icons';
import { Popover } from './popover';

const WEIGHTS: Array<[number, string]> = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']];
const ALIGNS: Array<[TextStyle['align'], string, string]> = [['left', 'alignLeftEdge', 'Align left'], ['center', 'alignHcenterEdge', 'Align centre'], ['right', 'alignRightEdge', 'Align right']];

/** Glass card for Text content: text, font, size, weight, colour and alignment. One merged undo step per gesture. */
export class TextCard {
  private readonly pop = new Popover('fm-tc', 320);
  private id = '';
  private readonly area: HTMLTextAreaElement;
  private readonly font: HTMLSelectElement;
  private readonly size: HTMLInputElement;
  private readonly sizeRange: HTMLInputElement;
  private readonly weight: HTMLSelectElement;
  private readonly color: HTMLInputElement;
  private readonly hex: HTMLElement;
  private readonly aligns = new Map<TextStyle['align'], HTMLButtonElement>();
  private fontKey = '';

  constructor(private readonly engine: Engine) {
    const body = this.pop.body;
    const root = el<HTMLElement>(`<div class="fm-tc-body">
      <textarea class="fm-tc-text" rows="3" spellcheck="false" aria-label="Text"></textarea>
      <label class="fm-tc-row"><span>Font</span><select class="fm-tc-select" data-f="font" data-native aria-label="Font"></select></label>
      <div class="fm-tc-row"><span>Size</span><input class="fm-cm-range fm-tc-range" type="range" min="8" max="600" step="1" aria-label="Size"><input class="fm-tc-num" type="number" min="1" max="2000" step="1" aria-label="Size in pixels"></div>
      <label class="fm-tc-row"><span>Weight</span><select class="fm-tc-select" data-f="weight" aria-label="Weight"></select></label>
      <div class="fm-tc-row"><span>Color</span><label class="fm-tc-swatch"><input type="color" aria-label="Color"></label><span class="fm-tc-hex"></span></div>
      <div class="fm-tc-row"><span>Align</span><div class="fm-tc-seg" role="group" aria-label="Alignment"></div></div>
    </div>`);
    body.appendChild(root);
    this.area = q<HTMLTextAreaElement>(root, 'textarea');
    this.font = q<HTMLSelectElement>(root, '[data-f="font"]');
    this.weight = q<HTMLSelectElement>(root, '[data-f="weight"]');
    this.sizeRange = q<HTMLInputElement>(root, '.fm-tc-range');
    this.size = q<HTMLInputElement>(root, '.fm-tc-num');
    this.color = q<HTMLInputElement>(root, 'input[type="color"]');
    this.hex = q<HTMLElement>(root, '.fm-tc-hex');
    for (const [w, label] of WEIGHTS) {
      const o = document.createElement('option');
      o.value = String(w);
      o.textContent = label;
      this.weight.appendChild(o);
    }
    const seg = q<HTMLElement>(root, '.fm-tc-seg');
    for (const [a, ic, label] of ALIGNS) {
      const b = el<HTMLButtonElement>(`<button class="fm-tc-seg-btn" type="button" title="${label}" aria-label="${label}" aria-pressed="false">${icon(ic, 16)}</button>`);
      b.addEventListener('click', () => { this.commit({ align: a }, 'align'); this.endGesture(); });
      this.aligns.set(a, b);
      seg.appendChild(b);
    }

    this.area.addEventListener('input', () => this.commit({ text: this.area.value }, 'text'));
    this.area.addEventListener('change', () => this.endGesture());
    this.font.addEventListener('change', () => { this.commit({ font: this.font.value }, 'font'); this.paintFont(); this.endGesture(); });
    this.weight.addEventListener('change', () => { this.commit({ weight: Number(this.weight.value) }, 'weight'); this.endGesture(); });
    this.sizeRange.addEventListener('input', () => { this.commit({ size: this.sizeRange.valueAsNumber }, 'size'); this.paintSize(this.sizeRange.valueAsNumber); });
    this.sizeRange.addEventListener('change', () => this.endGesture());
    this.size.addEventListener('input', () => {
      const v = this.size.valueAsNumber;
      if (!Number.isFinite(v) || v < 1) return;
      this.commit({ size: Math.min(2000, Math.round(v)) }, 'size');
      this.paintSize(v, true);
    });
    this.size.addEventListener('change', () => this.endGesture());
    this.color.addEventListener('input', () => { this.commit({ color: this.color.value }, 'color'); setText(this.hex, this.color.value.toUpperCase()); });
    this.color.addEventListener('change', () => this.endGesture());

    this.pop.onHide(() => { this.endGesture(); this.id = ''; });
    engine.on('movie', () => { if (this.pop.isOpen) this.sync(); });
    engine.on('selection', () => { if (this.pop.isOpen && !this.engine.selection.content.includes(this.id)) this.close(); });
  }

  open(anchor: HTMLElement | { x: number; y: number }, contentId: string): void {
    const m = this.engine.movie;
    const at = m ? locate(m, contentId) : null;
    if (!at || at.content.kind !== 'text' || !at.content.text) return;
    this.id = contentId;
    this.sync(true);
    if (anchor instanceof HTMLElement) this.pop.showFor(anchor, 'below');
    else this.pop.showAt(anchor.x, anchor.y);
    this.area.focus();
    this.area.select();
  }

  close(): void {
    this.pop.hide();
  }

  private current(): Content | null {
    const m = this.engine.movie;
    const at = m && this.id ? locate(m, this.id) : null;
    return at && at.content.text ? at.content : null;
  }

  private commit(patch: Partial<TextStyle>, field: string): void {
    const id = this.id;
    if (!id) return;
    this.engine.run('Edit Text', (m) => ops.updateContent(m, id, (c) => {
      if (!c.text) return c;
      const text = { ...c.text, ...patch };
      const named = patch.text !== undefined ? { name: patch.text.split('\n')[0].slice(0, 40) || c.name } : {};
      return { ...c, ...named, text };
    }), `text-${id}-${field}`);
  }

  private endGesture(): void {
    this.engine.endGesture();
  }

  private paintSize(v: number, fromNumber = false): void {
    const r = Math.min(600, Math.max(8, v));
    this.sizeRange.style.setProperty('--fm-pct', `${((r - 8) / 592) * 100}%`);
    if (fromNumber) { if (this.sizeRange.valueAsNumber !== r) this.sizeRange.value = String(r); }
    else if (document.activeElement !== this.size) this.size.value = String(Math.round(v));
  }

  private paintFont(): void {
    this.font.style.fontFamily = `"${this.font.value}", Inter, sans-serif`;
  }

  /** Patch the fields from the content; the focused field keeps what the person is typing. */
  private sync(rebuildFonts = false): void {
    const c = this.current();
    if (!c || !c.text) return;
    const t = c.text;
    const m = this.engine.movie;
    const families = m ? FONT_FAMILIES(m) : ['Inter'];
    if (!families.includes(t.font)) families.push(t.font);
    const key = families.join('|');
    if (rebuildFonts || key !== this.fontKey) {
      this.fontKey = key;
      const have = new Map(Array.from(this.font.options).map((o) => [o.value, o]));
      for (const f of families) {
        if (have.has(f)) continue;
        const o = document.createElement('option');
        o.value = f;
        o.textContent = f;
        o.style.fontFamily = `"${f}", Inter, sans-serif`;
        this.font.appendChild(o);
      }
      for (const [v, o] of have) if (!families.includes(v)) o.remove();
    }
    if (this.font.value !== t.font) this.font.value = t.font;
    this.paintFont();
    if (this.area.value !== t.text) this.area.value = t.text;
    const w = WEIGHTS.some(([n]) => n === t.weight) ? t.weight : WEIGHTS.reduce((a, b) => (Math.abs(b[0] - t.weight) < Math.abs(a[0] - t.weight) ? b : a))[0];
    if (this.weight.value !== String(w)) this.weight.value = String(w);
    this.sizeRange.value = String(Math.min(600, Math.max(8, t.size)));
    this.paintSize(t.size);
    if (document.activeElement !== this.size) this.size.value = String(Math.round(t.size));
    if (this.color.value !== t.color.toLowerCase() && /^#[0-9a-f]{6}$/i.test(t.color)) this.color.value = t.color.toLowerCase();
    setText(this.hex, t.color.toUpperCase());
    for (const [a, b] of this.aligns) { setClass(b, 'is-on', a === t.align); b.setAttribute('aria-pressed', String(a === t.align)); }
  }
}
