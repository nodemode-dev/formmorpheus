// A character out to a vector app as SVG: one <g id="part name"> per part in the Stage's stacking order, nested by parent where that order allows, shapes as <path>,
// pictures as embedded PNG, one pivot circle per part. Each part is written at rest in its own space with no
// transform of its own: the importer bakes transforms into the art and Update from Source keeps each part's transform.
import { canvasOf } from '../engine/canvas';
import { animate } from '../engine/keys';
import { bounds, outline, paintStops, shapeBase, type ShapeVals, type Sub } from '../engine/shape';
import type { BezNode, ShapeDef } from '../engine/shape-types';
import { findContent, mul, ownMatrix, type Mat } from '../engine/transform';
import type { CanvasRect, Content, DrawingLayer, Movie, Track } from '../engine/types';
import { tf } from '../ui/i18n-fill';

type BlobOf = (id: string) => Blob | undefined;

export interface SvgOut { blob: Blob; name: string; text: string; parts: number; note?: string }

const n = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const safe = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Character';
const alpha = (a: number | undefined): number => Math.min(1, Math.max(0, a ?? 1));

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A picture as a PNG data URL; another format is redrawn as PNG where the browser can, else kept as it is. */
async function pngUrl(blob: Blob): Promise<string> {
  let out = blob;
  if (blob.type !== 'image/png' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
    try {
      const bm = await createImageBitmap(blob);
      const cv = new OffscreenCanvas(bm.width, bm.height);
      (cv.getContext('2d') as OffscreenCanvasRenderingContext2D).drawImage(bm, 0, 0);
      bm.close();
      out = await cv.convertToBlob({ type: 'image/png' });
    } catch { /* kept in its own format */ }
  }
  return `data:${out.type || 'image/png'};base64,${await base64(out)}`;
}

function matrixAttr(m: Mat): string {
  if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && Math.abs(m[4]) < 1e-9 && Math.abs(m[5]) < 1e-9) return '';
  return ` transform="matrix(${m.map(n).join(' ')})"`;
}

function bezier(nodes: BezNode[], closed: boolean, ox: number, oy: number): string {
  if (nodes.length < 2) return '';
  const P = (x: number, y: number): string => `${n(x + ox)} ${n(y + oy)}`;
  let d = `M${P(nodes[0].x, nodes[0].y)}`;
  const last = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < last; i++) {
    const a = nodes[i], b = nodes[(i + 1) % nodes.length];
    d += ` C${P(a.x + a.ox, a.y + a.oy)} ${P(b.x + b.ix, b.y + b.iy)} ${P(b.x, b.y)}`;
  }
  return closed ? `${d} Z` : d;
}

function polyline(subs: Sub[], ox: number, oy: number): string {
  return subs.map((s) => {
    let d = '';
    for (let i = 0; i < s.p.length; i += 2) d += `${i ? ' L' : 'M'}${n(s.p[i] + ox)} ${n(s.p[i + 1] + oy)}`;
    return s.closed ? `${d} Z` : d;
  }).join(' ');
}

class Writer {
  defs: string[] = [];
  left: string[] = [];
  private grads = 0;
  private at: Mat = [1, 0, 0, 1, 0, 0];
  /** An inner block of a part hidden in the app: its elements are written not displayed. */
  private off = false;
  constructor(readonly movie: Movie, readonly blobOf: BlobOf, readonly parts: Set<string>) {}

  private gradient(d: ShapeDef, v: ShapeVals, box: [number, number, number, number]): string {
    const f = d.fill;
    if (!f || f.kind === 'solid') return '';
    const id = `fm-grad-${++this.grads}`;
    const w = Math.max(1, box[2] - box[0]), h = Math.max(1, box[3] - box[1]);
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
    let last = 0;
    const stops = paintStops(f).map((s) => {
      const o = Math.min(1, Math.max(last, s.o));
      last = o;
      return `<stop offset="${n(o)}" stop-color="${esc(s.color)}"${alpha(s.alpha) < 1 ? ` stop-opacity="${n(alpha(s.alpha))}"` : ''}/>`;
    }).join('');
    if (f.kind === 'linear') {
      const a = (v.ga * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
      const L = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
      this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(cx - dx * L)}" y1="${n(cy - dy * L)}" x2="${n(cx + dx * L)}" y2="${n(cy + dy * L)}">${stops}</linearGradient>`);
    } else {
      const gx = cx + v.gcx * (w / 2), gy = cy + v.gcy * (h / 2);
      this.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(gx)}" cy="${n(gy)}" r="${n(Math.max(w, h) / 2)}">${stops}</radialGradient>`);
    }
    return id;
  }

  shape(c: Content, label = ''): string {
    const d = c.shape as ShapeDef;
    const W = this.movie.width, H = this.movie.height;
    let v = shapeBase(d);
    if (c.kind === 'solid' && (v.w <= 0 || v.h <= 0)) v = { ...v, w: v.w > 0 ? v.w : W, h: v.h > 0 ? v.h : H };
    const subs = outline(d, v);
    if (!subs.length) return '';
    const ox = W / 2, oy = H / 2;
    const path = d.type === 'path' ? bezier(d.nodes ?? [], d.closed === true, ox, oy)
      : d.type === 'ellipse' ? `M${n(ox - v.w / 2)} ${n(oy)} A${n(v.w / 2)} ${n(v.h / 2)} 0 1 0 ${n(ox + v.w / 2)} ${n(oy)} A${n(v.w / 2)} ${n(v.h / 2)} 0 1 0 ${n(ox - v.w / 2)} ${n(oy)} Z`
      : polyline(subs, ox, oy);
    if (!path) return '';
    const b = bounds(subs) as [number, number, number, number];
    const box: [number, number, number, number] = [b[0] + ox, b[1] + oy, b[2] + ox, b[3] + oy];
    let attrs = '';
    const f = d.fill;
    if (f && v.fillA > 0 && subs.some((s) => s.closed)) {
      const g = this.gradient(d, v, box);
      attrs += g ? ` fill="url(#${g})"` : ` fill="${esc(f.color)}"`;
      if (v.fillA < 1) attrs += ` fill-opacity="${n(v.fillA)}"`;
    } else attrs += ' fill="none"';
    const s = d.stroke;
    if (s && s.width > 0) {
      attrs += ` stroke="${esc(s.color)}" stroke-width="${n(s.width)}"`;
      if (alpha(s.alpha) < 1) attrs += ` stroke-opacity="${n(alpha(s.alpha))}"`;
      if (s.cap && s.cap !== 'butt') attrs += ` stroke-linecap="${s.cap}"`;
      if (s.join && s.join !== 'miter') attrs += ` stroke-linejoin="${s.join}"`;
      if (s.miter !== undefined && s.miter !== 4) attrs += ` stroke-miterlimit="${n(s.miter)}"`;
      if ((s.dash ?? 0) > 0) attrs += ` stroke-dasharray="${n(s.dash as number)} ${n(Math.max(0, s.gap ?? 0))}"${s.dashOffset ? ` stroke-dashoffset="${n(s.dashOffset)}"` : ''}`;
    }
    return `<path${label ? ` data-name="${esc(label)}"` : ''} d="${path}"${attrs}${matrixAttr(this.at)}${this.off ? ' style="display:none"' : ''}/>`;
  }

  private async image(id: string | null, r: CanvasRect, opacity: number): Promise<string> {
    const blob = id ? this.blobOf(id) : undefined;
    if (!blob) return '';
    const op = opacity < 1 ? ` opacity="${n(opacity)}"` : '';
    return `<image x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" preserveAspectRatio="none"${op}${matrixAttr(this.at)}${this.off ? ' style="display:none"' : ''} xlink:href="${await pngUrl(blob)}"/>`;
  }

  /** Leaf layers bottom first, with their groups' visibility and opacity carried down. */
  private async layers(list: DrawingLayer[], r: CanvasRect, base = 1): Promise<string> {
    const byId = new Map(list.map((l) => [l.id, l]));
    const shown = (l: DrawingLayer): number => {
      let o = l.visible ? l.opacity : 0;
      for (let p = l.parent ? byId.get(l.parent) : undefined, k = 0; p && k < 64; p = p.parent ? byId.get(p.parent) : undefined, k++) o *= p.visible ? p.opacity : 0;
      return o * base;
    };
    let out = '';
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i], o = shown(l);
      if (!l.group && o > 0) out += await this.image(l.pixels, r, o);
    }
    return out;
  }

  async art(c: Content, label = ''): Promise<string> {
    const W = this.movie.width, H = this.movie.height;
    switch (c.kind) {
      case 'shape': case 'solid': return c.shape ? this.shape(c, label) : '';
      case 'group': {
        // a part drawn with several shapes: its inner blocks are its art, named so a re-import keeps the names; an inner
        // transform goes on each element, since a <g> inside a part would read back as a part of its own
        let out = '';
        const was = this.at, wasOff = this.off;
        for (let i = c.tracks.length - 1; i >= 0; i--) for (const k of c.tracks[i].content) {
          if (this.parts.has(k.id)) continue;
          this.at = mul(was, ownMatrix(animate({ ...k, keys: [] }, 0), this.movie));
          this.off = wasOff || c.tracks[i].hidden || k.hidden === true;
          out += await this.art(k, k.name);
        }
        this.at = was;
        this.off = wasOff;
        return out;
      }
      case 'image': {
        const a = c.asset ? this.movie.assets[c.asset] : undefined;
        return a ? this.image(c.asset, { x: (W - a.width) / 2, y: (H - a.height) / 2, w: a.width, h: a.height }, 1) : '';
      }
      case 'drawing': return this.layers(c.layers, canvasOf(c, this.movie));
      case 'flipbook': {
        let out = '';
        for (let i = c.flip.length - 1; i >= 0; i--) {
          const row = c.flip[i];
          if (!row.hidden && row.opacity > 0 && row.frames.length && (!row.mask || row.mask === 'none')) out += await this.layers(row.frames[0].layers, canvasOf(c, this.movie), row.opacity);
        }
        return out;
      }
      default:
        this.left.push(c.name);
        return '';
    }
  }
}

/** The SVG of a character at the movie's size, its parts named as the character names them. */
export async function characterToSvg(movie: Movie, charId: string, blobOf: BlobOf): Promise<SvgOut> {
  const g = findContent(movie, charId);
  if (!g || g.kind !== 'group' || !g.character) throw new Error('Select a character first.');
  const nameOf = new Map<string, string>();
  for (const [name, id] of Object.entries(g.character.parts)) nameOf.set(id, name);
  // back to front, as the Stage draws them; a part on a hidden track or hidden by itself is written hidden
  const order: Content[] = [];
  const off = new Set<string>();
  const walk = (tracks: Track[], hid: boolean): void => {
    for (let i = tracks.length - 1; i >= 0; i--) for (const c of tracks[i].content) {
      const h = hid || tracks[i].hidden || c.hidden === true;
      if (nameOf.has(c.id)) { order.push(c); if (h) off.add(c.id); }
      if (c.kind === 'group') walk(c.tracks, h);
    }
  };
  walk(g.tracks, false);
  if (!order.length) throw new Error('This character has no parts to write.');
  const byId = new Map(order.map((c) => [c.id, c]));
  const parentOf = (c: Content): string | null => (c.parent && c.parent !== c.id && byId.has(c.parent) ? c.parent : null);
  const under = (id: string, anc: string): boolean => {
    let p = parentOf(byId.get(id) as Content);
    for (let k = 0; p && k < 64; p = parentOf(byId.get(p) as Content), k++) if (p === anc) return true;
    return false;
  };
  const w = new Writer(movie, blobOf, new Set(nameOf.keys()));
  const used = new Set<string>();
  // Document order is paint order, so the parts go out in the Stage's order. A part nests in its parent's group only
  // where that keeps the order (its parent's art and everything between are of that parent); otherwise it is written
  // where it is drawn and names its parent in data-fm-parent, which the importer reads back. A hidden part holds no
  // other part, since display none would hide them too.
  const level = async (items: Content[], box: string | null, depth: number): Promise<string[]> => {
    const out: string[] = [];
    const pad = '  '.repeat(depth + 1);
    for (let i = 0; i < items.length; i++) {
      const x = items[i];
      if (used.has(x.id)) continue;
      if (x.id === box) {
        const own = await w.art(x);
        if (own) out.push(`${pad}${own}`);
        used.add(x.id);
        continue;
      }
      const chain: string[] = [];
      for (let p: string | null = x.id, k = 0; p && p !== box && k < 64; p = parentOf(byId.get(p) as Content), k++) chain.unshift(p);
      let root = x, run: Content[] = [x];
      for (const a of chain) {
        if (used.has(a)) continue;
        if (off.has(a) && a !== x.id) continue;
        let j = i;
        while (j < items.length && !used.has(items[j].id) && items[j].id !== box && (items[j].id === a || (!off.has(a) && under(items[j].id, a)))) j++;
        const span = items.slice(i, j);
        if (span.some((c) => c.id === a)) { root = byId.get(a) as Content; run = span; break; }
      }
      const name = nameOf.get(root.id) as string;
      const rest = animate({ ...root, keys: [] }, 0);
      const up = parentOf(root);
      const attrs = `${up && up !== box ? ` data-fm-parent="${esc(nameOf.get(up) as string)}"` : ''}${off.has(root.id) ? ' style="display:none"' : ''}${rest.opacity < 1 ? ` opacity="${n(Math.max(0, rest.opacity))}"` : ''}`;
      const inner = depth < 64 ? await level(run, root.id, depth + 1) : [];
      const px = movie.width / 2 + (rest.px ?? 0), py = movie.height / 2 + (rest.py ?? 0);
      const pivot = `${pad}  <circle id="pivot-${esc(name)}" data-role="pivot" cx="${n(px)}" cy="${n(py)}" r="4" fill="none" stroke="#ff2d7a" stroke-width="1"/>`;
      out.push(`${pad}<g id="${esc(name)}"${attrs}>`, ...inner, pivot, `${pad}</g>`);
    }
    return out;
  };
  const body = await level(order, null, 0);
  const W = movie.width, H = movie.height;
  const text = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `  <title>${esc(g.character.name)}</title>`,
    ...(w.defs.length ? ['  <defs>', ...w.defs.map((d) => `    ${d}`), '  </defs>'] : []),
    ...body,
    '</svg>',
    '',
  ].join('\n');
  const note = w.left.length ? tf('Written without their art: {names}.', { names: w.left.join(', ') }) : undefined;
  return { blob: new Blob([text], { type: 'image/svg+xml' }), name: `${safe(g.character.name)}.svg`, text, parts: order.length, ...(note ? { note } : {}) };
}
