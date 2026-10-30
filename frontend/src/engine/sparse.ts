// Sparse pictures: a painted layer is mostly transparent, but a software canvas pays for every destination pixel
// a drawImage covers. Each decoded picture gets a few horizontal bands (rows with any ink, and the columns they span),
// and a draw clips to those bands, so only pixels near ink are filled. Output is identical: what is skipped is
// transparent, and the clip is padded by more than the resampling filter reaches.

interface Band { x0: number; x1: number; y0: number; y1: number }

/** Pictures smaller than this (pixels) are always drawn whole. */
const MIN_AREA = 160 * 1024;
/** A picture whose bands cover more than this share of it is drawn whole. */
const MAX_COVER = 0.75;
/** Device pixels added around each clip: covers bilinear taps and the minification kernel. */
const PAD = 8;
/** Compositing operations that change the destination where the source is transparent. */
const CLEARING = new Set<string>(['copy', 'source-in', 'source-out', 'destination-in', 'destination-out', 'destination-atop', 'xor']);

const NONE: Band[] = [];
/** What one clipped draw costs besides its pixels, in destination pixels (measured: 1000 to 30000 all give the same frame rate; 100000 loses). */
const CLIP_COST = 8000;

export class SparseIndex {
  private readonly bands = new WeakMap<ImageBitmap, Band[] | null>();
  private readonly queue: ImageBitmap[] = [];
  private timer = 0;
  private scratch: OffscreenCanvas | null = null;

  /** Queues a decoded picture to be indexed in a later task (a 4K scan is about 30 ms, so one per task). */
  note(bmp: ImageBitmap): void {
    if (bmp.width * bmp.height < MIN_AREA || this.bands.has(bmp)) return;
    this.bands.set(bmp, null);
    this.queue.push(bmp);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = 0; this.step(); }, 0) as unknown as number;
  }

  clear(): void {
    for (const b of this.queue) this.bands.delete(b);
    this.queue.length = 0;
    if (this.timer) { clearTimeout(this.timer); this.timer = 0; }
  }

  private step(): void {
    const bmp = this.queue.shift();
    if (bmp) {
      try { this.bands.set(bmp, this.scan(bmp)); } catch { this.bands.set(bmp, null); }
    }
    if (this.queue.length && !this.timer) this.timer = setTimeout(() => { this.timer = 0; this.step(); }, 0) as unknown as number;
  }

  private scan(bmp: ImageBitmap): Band[] | null {
    const w = bmp.width, h = bmp.height;
    const cv = this.scratch ?? (this.scratch = new OffscreenCanvas(w, h));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    g.globalCompositeOperation = 'copy';
    g.drawImage(bmp, 0, 0);
    const px = new Uint32Array(g.getImageData(0, 0, w, h).data.buffer);
    // alpha is the high byte on little-endian machines (every target); a big-endian host reads a wrong byte and draws whole
    const little = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    if (!little) return null;
    const rowMin = new Int32Array(h), rowMax = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let a = 0;
      while (a < w && (px[o + a] >>> 24) === 0) a++;
      if (a === w) { rowMin[y] = -1; rowMax[y] = -1; continue; }
      let b = w - 1;
      while ((px[o + b] >>> 24) === 0) b--;
      rowMin[y] = a; rowMax[y] = b + 1;
    }
    const n = 32, bh = Math.ceil(h / n), gap = Math.max(16, Math.round(w / 24));
    const out: Band[] = [];
    const col = new Uint8Array(w);
    for (let y0 = 0; y0 < h; y0 += bh) {
      const y1 = Math.min(h, y0 + bh);
      col.fill(0);
      let x0 = w, x1 = -1;
      for (let y = y0; y < y1; y++) {
        if (rowMin[y] < 0) continue;
        if (rowMin[y] < x0) x0 = rowMin[y];
        if (rowMax[y] > x1) x1 = rowMax[y];
        const o = y * w;
        for (let x = rowMin[y]; x < rowMax[y]; x++) if ((px[o + x] >>> 24) !== 0) col[x] = 1;
      }
      if (x1 < 0) continue;
      // columns with ink split into runs wherever the empty gap is wide
      let s = x0, last = x0;
      for (let x = x0; x < x1; x++) {
        if (!col[x]) continue;
        if (x - last > gap) { out.push({ x0: s, x1: last + 1, y0, y1 }); s = x; }
        last = x;
      }
      out.push({ x0: s, x1: last + 1, y0, y1 });
    }
    let area = 0;
    for (const b of out) area += (b.x1 - b.x0) * (b.y1 - b.y0);
    return area > w * h * MAX_COVER ? null : out.length ? out : NONE;
  }

  /** Draws `bmp` into the box (x, y, w, h) under ctx's transform, clipped to its inked bands. Returns false when the caller should draw it whole. */
  draw(ctx: OffscreenCanvasRenderingContext2D, bmp: ImageBitmap, x: number, y: number, w: number, h: number): boolean {
    const bands = this.bands.get(bmp);
    if (!bands) return false;
    if (bands.length === 0) return true;
    if (CLEARING.has(ctx.globalCompositeOperation) || ctx.filter !== 'none' || ctx.shadowBlur > 0 || ctx.shadowOffsetX !== 0 || ctx.shadowOffsetY !== 0) return false;
    const m = ctx.getTransform();
    if (m.b !== 0 || m.c !== 0 || m.a === 0 || m.d === 0) return false;
    const kx = w / bmp.width, ky = h / bmp.height;
    const rects: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const b of bands) {
      const ax = m.a * (x + b.x0 * kx) + m.e, bx = m.a * (x + b.x1 * kx) + m.e;
      const ay = m.d * (y + b.y0 * ky) + m.f, by = m.d * (y + b.y1 * ky) + m.f;
      rects.push({ x0: Math.floor(Math.min(ax, bx)) - PAD, x1: Math.ceil(Math.max(ax, bx)) + PAD, y0: Math.floor(Math.min(ay, by)) - PAD, y1: Math.ceil(Math.max(ay, by)) + PAD });
    }
    // every clipped draw has a fixed cost (about CLIP_COST pixels' worth), so boxes merge while one box is cheaper than two;
    // overlapping boxes always merge (a half-transparent pixel would be drawn twice)
    const C = CLIP_COST;
    for (;;) {
      let bi = -1, bj = -1, best = 0;
      for (let i = 0; i < rects.length; i++) {
        const p = rects[i];
        for (let j = i + 1; j < rects.length; j++) {
          const q = rects[j];
          const u = (Math.max(p.x1, q.x1) - Math.min(p.x0, q.x0)) * (Math.max(p.y1, q.y1) - Math.min(p.y0, q.y0));
          const touch = p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
          const save = touch ? 1e12 - u : (p.x1 - p.x0) * (p.y1 - p.y0) + (q.x1 - q.x0) * (q.y1 - q.y0) + C - u;
          if (save > best) { best = save; bi = i; bj = j; }
        }
      }
      if (bi < 0) break;
      const p = rects[bi], q = rects[bj];
      p.x0 = Math.min(p.x0, q.x0); p.y0 = Math.min(p.y0, q.y0); p.x1 = Math.max(p.x1, q.x1); p.y1 = Math.max(p.y1, q.y1);
      rects.splice(bj, 1);
    }
    for (const r of rects) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.clip();
      ctx.setTransform(m);
      ctx.drawImage(bmp, x, y, w, h);
      ctx.restore();
    }
    return true;
  }
}
