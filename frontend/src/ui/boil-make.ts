// "Make Boil Frames...": a Drawing becomes a looping Flipbook whose frames are the drawing displaced with different seeds.
import type { Engine } from '../engine/engine';
import * as flipOps from '../engine/flip-ops';
import { uid } from '../engine/model';
import * as ops from '../engine/ops';
import type { Asset, Content, DrawingLayer, FlipbookFrame, Movie } from '../engine/types';
import { boil } from '../paint/boil';
import type { Raster } from '../paint/types';
import { el, q, setText } from './dom';
import { Popover, popField, popRow, popSep, type PopField } from './popover';

const SPACING = 40;

export interface BoilFramesOptions { count: number; amount: number; hold: number }

const clampInt = (v: string, lo: number, hi: number, def: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

async function decode(blob: Blob): Promise<Raster> {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const x = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  x.drawImage(bmp, 0, 0);
  bmp.close();
  const img = x.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: img.data };
}

async function encode(r: Raster): Promise<Blob> {
  const c = new OffscreenCanvas(r.width, r.height);
  const x = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
  x.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}

/** Bakes the redraws of a Drawing: pixels of every layer (and mask) displaced by the same field per redraw, as new PNG assets. */
export async function bakeBoilFrames(engine: Engine, drawing: Content, opts: BoilFramesOptions): Promise<{ frames: FlipbookFrame[]; assets: Asset[] }> {
  const frames: FlipbookFrame[] = [];
  const assets: Asset[] = [];
  const cache = new Map<string, Raster>();
  const load = async (id: string): Promise<Raster | null> => {
    const have = cache.get(id);
    if (have) return have;
    const blob = engine.assets.get(id);
    if (!blob) return null;
    const r = await decode(blob);
    cache.set(id, r);
    return r;
  };
  const dst = (r: Raster): Raster => ({ width: r.width, height: r.height, data: new Uint8ClampedArray(r.data.length) });
  for (let k = 0; k < opts.count; k++) {
    const ids = new Map(drawing.layers.map((l) => [l.id, uid('l')]));
    const layers: DrawingLayer[] = [];
    for (const l of drawing.layers) {
      const out: DrawingLayer = { ...l, id: ids.get(l.id) as string };
      if (l.parent && ids.has(l.parent)) out.parent = ids.get(l.parent);
      for (const key of ['pixels', 'mask'] as const) {
        const src = l[key];
        if (!src || l.group) continue;
        const r = await load(src);
        if (!r) continue;
        const d = dst(r);
        boil(r, d, { amount: opts.amount, scale: SPACING, seed: k });
        const blob = await encode(d);
        const asset: Asset = { id: uid('p'), kind: 'pixels', name: `${l.name} boil ${k + 1}`, mime: 'image/png', width: r.width, height: r.height, frames: 0, size: blob.size };
        engine.assets.set(asset.id, blob);
        assets.push(asset);
        out[key] = asset.id;
      }
      layers.push(out);
    }
    frames.push({ id: uid('f'), hold: opts.hold, layers });
  }
  return { frames, assets };
}

export class BoilMake {
  private readonly pop = new Popover('fm-cm', 264);
  private readonly count: PopField;
  private readonly amount: PopField;
  private readonly hold: PopField;
  private id = '';
  private busy = false;

  constructor(private readonly engine: Engine) {
    this.count = popField('flipbook', 'Frames (2 to 8)', () => void this.make());
    this.amount = popField('flipbook', 'Amount in px (0 to 8)', () => void this.make());
    this.hold = popField('flipbook', 'Hold per frame', () => void this.make());
    const go = popRow('flipbook', 'Make Boil Frames');
    go.el.addEventListener('click', () => void this.make());
    const lab = (text: string): HTMLElement => {
      const r = el<HTMLElement>('<div class="fm-pop-row" style="pointer-events:none;min-height:0;padding-bottom:0;opacity:.7"><span class="fm-pop-label"></span></div>');
      setText(q(r, '.fm-pop-label'), text);
      return r;
    };
    this.pop.body.append(lab('Frames (2 to 8)'), this.count.el, lab('Amount in px (0 to 8)'), this.amount.el, lab('Hold per frame'), this.hold.el, popSep(), go.el);
  }

  open(x: number, y: number, id: string): void {
    this.id = id;
    this.count.set('4');
    this.amount.set('3');
    this.hold.set('2');
    this.pop.showAt(x, y);
  }

  private async make(): Promise<void> {
    if (this.busy) return;
    const m = this.engine.movie;
    const c = m?.tracks.flatMap((t) => t.content).find((x) => x.id === this.id);
    if (!m || !c || c.kind !== 'drawing') return;
    const opts: BoilFramesOptions = {
      count: clampInt(this.count.input.value, 2, 8, 4),
      amount: Math.min(8, Math.max(0, Number(this.amount.input.value) || 3)),
      hold: clampInt(this.hold.input.value, 1, 24, 2),
    };
    this.busy = true;
    this.pop.hide();
    try {
      const baked = await bakeBoilFrames(this.engine, c, opts);
      const id = this.id;
      this.engine.run('Make Boil Frames', (mv: Movie) => {
        const assets = { ...mv.assets };
        for (const a of baked.assets) assets[a.id] = a;
        const r = flipOps.tracksToFlipbook({ ...mv, assets }, [id]);
        const out = ops.updateContent(r.movie, r.id, (fb) => ({ ...fb, name: `${c.name} boil`, flip: fb.flip.map((t, i) => (i === 0 ? { ...t, frames: baked.frames } : t)) }));
        return { movie: out, select: [r.id] };
      });
    } catch {
      this.engine.notice('Boil frames could not be made.', 'error');
    } finally {
      this.busy = false;
    }
  }
}
