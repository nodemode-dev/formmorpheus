// Clipboard of Draw & Paint: Cut, Copy, Duplicate, Cut & Paste, Paste and Delete for the
// selection (or the whole layer when nothing is selected). Copies go to an internal
// clipboard at full fidelity and to the system clipboard as a PNG; Paste lands in a new
// layer above, centred on the canvas, and also takes an image from the system clipboard.

import type { PaintDoc } from '../paint/doc';
import { clearMask } from '../paint/fill';
import { readRect } from '../paint/history';
import { extract, rectMask } from '../paint/select';
import type { Mask, Raster, Rect } from '../paint/types';
import { popRow, popSep, Popover, type PopRow } from './popover';
import { t as tr } from './i18n';

export interface ClipHost {
  doc(): PaintDoc | null;
  selection(): Mask | null;
  setSelection(m: Mask | null): void;
  say(text: string): void;
  /** A paste landed in a new layer: let the person place it. */
  placed(): void;
}

interface Piece { raster: Raster; rect: Rect; mask?: Mask | null; layer?: string }

function alphaBox(r: Raster): Rect | null {
  const { width: w, height: h, data } = r;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4 + 3;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function writeOver(dst: Raster, src: Raster, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y++) {
    const dy = y + oy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x + ox;
      if (dx < 0 || dx >= dst.width) continue;
      const s = (y * src.width + x) * 4, d = (dy * dst.width + dx) * 4;
      dst.data[d] = src.data[s]; dst.data[d + 1] = src.data[s + 1]; dst.data[d + 2] = src.data[s + 2]; dst.data[d + 3] = src.data[s + 3];
    }
  }
}

export class PaintClip {
  private clip: Piece | null = null;
  private readonly pop = new Popover('fm-pclip', 210);
  private readonly rows: Record<'cut' | 'copy' | 'duplicate' | 'cutpaste' | 'paste' | 'clear', PopRow>;

  constructor(private readonly host: ClipHost) {
    const mk = (id: keyof PaintClip['rows'], icon: string | null, label: string, keys: string, run: () => void): PopRow => {
      const r = popRow(icon, tr(label));
      r.setValue(keys);
      r.el.addEventListener('click', () => { this.pop.hide(); run(); });
      return r;
    };
    this.rows = {
      cut: mk('cut', null, 'Cut', 'Ctrl+X', () => this.cut()),
      copy: mk('copy', null, 'Copy', 'Ctrl+C', () => this.copy()),
      duplicate: mk('duplicate', 'duplicate', 'Duplicate', 'Ctrl+J', () => this.duplicate()),
      cutpaste: mk('cutpaste', null, 'Cut & Paste', '', () => this.cutPaste()),
      paste: mk('paste', null, 'Paste', 'Ctrl+V', () => { void this.paste(); }),
      clear: mk('clear', 'delete', 'Clear', 'Del', () => this.clear()),
    };
    this.pop.el.append(this.rows.cut.el, this.rows.copy.el, this.rows.duplicate.el, this.rows.cutpaste.el, popSep(), this.rows.paste.el, popSep(), this.rows.clear.el);
  }

  hasClip(): boolean { return this.clip !== null; }

  openMenu(x: number, y: number): void {
    const has = this.source() !== null;
    this.rows.cut.setDisabled(!has);
    this.rows.copy.setDisabled(!has);
    this.rows.duplicate.setDisabled(!has);
    this.rows.cutpaste.setDisabled(!has);
    this.rows.clear.setDisabled(!has);
    this.pop.showAt(x, y);
  }

  hide(): void { this.pop.hide(); }

  isOpen(): boolean { return this.pop.isOpen; }

  /** The piece a clipboard action works on: the selection, else the whole layer's pixels. */
  private source(): (Piece & { mask: Mask | null; layer: string }) | null {
    const doc = this.host.doc();
    if (!doc || doc.maskEditing()) return null;
    const layer = doc.activeLayer();
    if (layer.group) return null;
    const sel = this.host.selection();
    if (sel) {
      const p = extract(layer.raster, sel);
      return p.rect.w > 0 ? { ...p, mask: sel, layer: layer.id } : null;
    }
    const box = alphaBox(layer.raster);
    if (!box) return null;
    const p = extract(layer.raster, rectMask(doc.width, doc.height, box));
    return { ...p, mask: null, layer: layer.id };
  }

  copy(): boolean {
    const s = this.source();
    if (!s) { this.host.say(tr('Nothing to copy on this layer')); return false; }
    this.clip = { raster: s.raster, rect: s.rect };
    void this.toSystem(s.raster);
    this.host.say(tr('Copied'));
    return true;
  }

  cut(): void {
    const s = this.source();
    if (!s) { this.host.say(tr('Nothing to cut on this layer')); return; }
    this.clip = { raster: s.raster, rect: s.rect };
    void this.toSystem(s.raster);
    this.remove(s, 'Cut');
    this.host.say(tr('Cut'));
  }

  /** A copy in a new layer above, in place. */
  duplicate(): void {
    const doc = this.host.doc();
    const s = this.source();
    if (!doc || !s) { this.host.say(tr('Nothing to duplicate on this layer')); return; }
    this.into(doc, s, s.rect.x, s.rect.y, 'Duplicate');
  }

  /** The piece moves to a new layer above, in place. */
  cutPaste(): void {
    const doc = this.host.doc();
    const s = this.source();
    if (!doc || !s) { this.host.say(tr('Nothing to cut on this layer')); return; }
    this.into(doc, s, s.rect.x, s.rect.y, 'Cut and paste');
    // the new layer is active now: clear the old one by id
    this.remove(s, 'Cut and paste', true);
    this.host.setSelection(null);
  }

  /** Delete key: clear the selection, or the whole layer when nothing is selected. */
  clear(): void {
    const doc = this.host.doc();
    if (!doc) return;
    const s = this.source();
    if (!s) { this.host.say(tr('Nothing to clear')); return; }
    this.remove(s, 'Clear');
  }

  async paste(): Promise<void> {
    const doc = this.host.doc();
    if (!doc) return;
    const sys = await this.fromSystem();
    if (sys) {
      const same = this.clip && this.clip.raster.width === sys.width && this.clip.raster.height === sys.height;
      if (!same) { this.pasteBitmap(sys); return; }
      sys.close();
    }
    const c = this.clip;
    if (!c) { this.host.say(tr('Nothing to paste')); return; }
    const ox = Math.round((doc.width - c.raster.width) / 2), oy = Math.round((doc.height - c.raster.height) / 2);
    this.into(doc, { raster: c.raster, rect: c.rect, mask: null, layer: '' }, ox, oy, 'Paste');
    this.host.placed();
  }

  /** An image (the system clipboard, a dropped file) as a new layer, fitted into the canvas and centred. */
  pasteBitmap(bmp: ImageBitmap, label = 'Paste'): void {
    const doc = this.host.doc();
    if (!doc) { bmp.close(); return; }
    const s = Math.min(1, doc.width / bmp.width, doc.height / bmp.height);
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const cv = new OffscreenCanvas(w, h);
    const x = cv.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    x.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const raster: Raster = { width: w, height: h, data: x.getImageData(0, 0, w, h).data };
    const ox = Math.round((doc.width - w) / 2), oy = Math.round((doc.height - h) / 2);
    this.into(doc, { raster, rect: { x: ox, y: oy, w, h }, mask: null, layer: '' }, ox, oy, label);
    this.host.placed();
  }

  /** From a paste event's clipboard data (no permission needed); true when it held an image. */
  async pasteEvent(data: DataTransfer | null): Promise<boolean> {
    if (!data) return false;
    for (const item of Array.from(data.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (!f) continue;
        this.pasteBitmap(await createImageBitmap(f));
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ internals

  private into(doc: PaintDoc, s: Piece, ox: number, oy: number, label: string): void {
    const above = doc.activeLayer();
    const fresh = doc.addLayer(above.id, label === 'Paste' ? tr('Pasted') : `${above.name} copy`);
    const rect = clipTo({ x: ox, y: oy, w: s.raster.width, h: s.raster.height }, doc.width, doc.height);
    if (!rect) return;
    const before = readRect(fresh.raster, rect);
    writeOver(fresh.raster, s.raster, ox, oy);
    doc.markDirty(fresh.id, rect);
    doc.commitPatch({ layer: fresh.id, rect, before, after: readRect(fresh.raster, rect) }, label);
  }

  private remove(s: { mask: Mask | null; layer: string; rect: Rect }, label: string, byId = false): void {
    const doc = this.host.doc();
    if (!doc) return;
    const layer = byId ? doc.layer(s.layer) : doc.activeLayer();
    if (!layer || layer.group) return;
    const mask = s.mask ?? rectMask(doc.width, doc.height, s.rect);
    const p = clearMask(layer.raster, mask, layer.id);
    if (p.rect.w && p.rect.h) { doc.markDirty(layer.id, p.rect); doc.commitPatch(p, label); }
  }

  private async toSystem(r: Raster): Promise<void> {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return;
      const cv = new OffscreenCanvas(r.width, r.height);
      (cv.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
      const blob = await cv.convertToBlob({ type: 'image/png' });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch { /* no permission or no secure context: the internal clipboard still works */ }
  }

  private async fromSystem(): Promise<ImageBitmap | null> {
    try {
      if (!navigator.clipboard?.read) return null;
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) return await createImageBitmap(await item.getType(type));
      }
    } catch { /* denied or empty */ }
    return null;
  }
}

function clipTo(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(w, r.x + r.w), y1 = Math.min(h, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
