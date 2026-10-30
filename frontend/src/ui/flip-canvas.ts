// Draw & Paint Settings > "Crop and resize": the picture of the open Drawing or Flipbook is cropped by insets
// and scaled about an anchor of the canvas. Every frame and layer is re-baked as a new PNG asset.
import type { Engine } from '../engine/engine';
import { uid } from '../engine/model';
import type { Asset, Content, DrawingLayer } from '../engine/types';
import { Dialog } from './dialogs';
import { el, q, setClass, setHidden } from './dom';

export interface CropResizeParams {
  /** Percent of the current size, 10 to 400. */
  scale: number;
  /** Anchor the scale grows from: column and row, 0 to 2. */
  ax: number;
  ay: number;
  /** Pixels cut away from each side before scaling. */
  crop: { l: number; t: number; r: number; b: number };
  /** Every frame of a Flipbook (otherwise only the open frame). */
  all: boolean;
}

const num = (v: string, lo: number, hi: number, def: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

export class CropResizeDialog extends Dialog {
  private resolve: ((p: CropResizeParams | null) => void) | null = null;
  private anchor = 4;
  private readonly scale = el<HTMLInputElement>('<input class="cv-input" type="number" min="10" max="400" step="1" value="100" aria-label="Scale">');
  private readonly crops = (['Left', 'Top', 'Right', 'Bottom'] as const).map((n) => el<HTMLInputElement>(`<input class="cv-input" type="number" min="0" step="1" value="0" aria-label="${n}">`));
  private readonly allBox = el<HTMLInputElement>('<input type="checkbox" checked aria-label="All frames">');
  private readonly allRow: HTMLElement;
  private readonly anchors: HTMLButtonElement[] = [];
  private readonly note = el<HTMLElement>('<p class="cv-note"></p>');

  constructor() {
    super('Crop and resize', 400);
    const field = (label: string, input: HTMLElement): HTMLElement => {
      const row = el<HTMLElement>('<label class="cv-field"><span></span></label>');
      q(row, 'span').textContent = label;
      row.append(input);
      return row;
    };
    const grid = el<HTMLElement>('<div class="cv-anchor-grid" role="group" aria-label="Anchor"></div>');
    for (let i = 0; i < 9; i++) {
      const b = el<HTMLButtonElement>(`<button type="button" aria-label="Anchor ${i + 1}"></button>`);
      b.addEventListener('click', () => { this.anchor = i; this.syncAnchor(); });
      this.anchors.push(b);
      grid.append(b);
    }
    const anchorRow = el<HTMLElement>('<div class="cv-field"><span>Anchor</span></div>');
    anchorRow.append(grid);
    this.allRow = el<HTMLElement>('<label class="cv-field"><span>All frames</span></label>');
    this.allRow.append(this.allBox);
    this.body.append(this.note, field('Scale %', this.scale), anchorRow,
      field('Crop left', this.crops[0]), field('Crop top', this.crops[1]), field('Crop right', this.crops[2]), field('Crop bottom', this.crops[3]), this.allRow);
    this.button('Cancel', 'ghost', () => this.close());
    this.button('Apply', 'primary', () => this.apply());
    this.onClose = () => { const r = this.resolve; this.resolve = null; r?.(null); };
    this.syncAnchor();
  }

  private syncAnchor(): void { this.anchors.forEach((b, i) => setClass(b, 'is-active', i === this.anchor)); }

  private apply(): void {
    const r = this.resolve;
    this.resolve = null;
    const p: CropResizeParams = {
      scale: num(this.scale.value, 10, 400, 100),
      ax: this.anchor % 3,
      ay: Math.floor(this.anchor / 3),
      crop: { l: num(this.crops[0].value, 0, 1e5, 0), t: num(this.crops[1].value, 0, 1e5, 0), r: num(this.crops[2].value, 0, 1e5, 0), b: num(this.crops[3].value, 0, 1e5, 0) },
      all: this.allBox.checked,
    };
    this.close();
    r?.(p);
  }

  /** Opens the dialog; resolves with the choice, or null when cancelled. */
  ask(size: { w: number; h: number }, flipbook: boolean): Promise<CropResizeParams | null> {
    this.note.textContent = `Canvas ${size.w} × ${size.h}. Cropped sides are cleared, then the picture is scaled about the anchor.`;
    setHidden(this.allRow, !flipbook);
    this.resolve?.(null);
    return new Promise((res) => { this.resolve = res; this.open(this.scale); });
  }
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

/** The cropped and scaled picture of one bitmap, drawn into a canvas of the same size. */
export function transformBitmap(src: ImageBitmap, p: CropResizeParams): OffscreenCanvas {
  const W = src.width, H = src.height;
  const out = new OffscreenCanvas(W, H);
  const g = out.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const s = p.scale / 100;
  const ox = (p.ax / 2) * W, oy = (p.ay / 2) * H;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.translate(ox, oy);
  g.scale(s, s);
  g.translate(-ox, -oy);
  const l = Math.min(W - 1, p.crop.l), t = Math.min(H - 1, p.crop.t);
  const w = Math.max(1, W - l - Math.min(W - l - 1, p.crop.r)), h = Math.max(1, H - t - Math.min(H - t - 1, p.crop.b));
  g.drawImage(src, l, t, w, h, l, t, w, h);
  return out;
}

/** Re-bakes every layer (and layer mask) of the Drawing or Flipbook; returns the content with new pixel ids and the new assets. */
export async function bakeCropResize(engine: Engine, c: Content, p: CropResizeParams, only?: { row: number; index: number }): Promise<{ content: Content; assets: { asset: Asset; blob: Blob }[] }> {
  const made = new Map<string, string>();
  const assets: { asset: Asset; blob: Blob }[] = [];
  const bake = async (id: string | null | undefined): Promise<string | null> => {
    if (!id) return null;
    const have = made.get(id);
    if (have) return have;
    const blob = engine.assets.get(id);
    if (!blob) return id;
    const bmp = await decode(blob);
    const cv = transformBitmap(bmp, p);
    bmp.close();
    const out = await cv.convertToBlob({ type: 'image/png' });
    const asset: Asset = { id: uid('p'), kind: 'pixels', name: 'Crop', mime: 'image/png', width: cv.width, height: cv.height, frames: 1, size: out.size };
    assets.push({ asset, blob: out });
    made.set(id, asset.id);
    return asset.id;
  };
  const layers = async (list: DrawingLayer[]): Promise<DrawingLayer[]> => {
    const out: DrawingLayer[] = [];
    for (const l of list) out.push({ ...l, pixels: await bake(l.pixels), ...(l.mask ? { mask: await bake(l.mask) } : {}) });
    return out;
  };
  if (c.kind !== 'flipbook') return { content: { ...c, layers: await layers(c.layers) }, assets };
  const flip = [];
  for (let r = 0; r < c.flip.length; r++) {
    const t = c.flip[r];
    const frames = [];
    for (let i = 0; i < t.frames.length; i++) {
      const f = t.frames[i];
      const doIt = p.all || (only !== undefined && only.row === r && only.index === i);
      frames.push(doIt ? { ...f, layers: await layers(f.layers) } : f);
    }
    flip.push({ ...t, frames });
  }
  return { content: { ...c, flip }, assets };
}
