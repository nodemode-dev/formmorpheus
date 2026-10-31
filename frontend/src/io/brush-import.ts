// Brush import: .abr tip files and the companion painting app's .brush / .brushset zips
// (a Brush.archive property list plus Shape.png and Grain.png). Each brush becomes one of
// our brushes with a sampled tip; only the parameters that map cleanly are read.

import { safeUnzipOr } from './safe-unzip';
import { parseAbr } from './abr';
import { makePresets } from '../paint/brushes';
import type { Brush } from '../paint/types';
import { cleanPoints } from '../paint/curves';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const MAX_TIP_SIDE = 512;

export interface ImportResult {
  brushes: Brush[];
  skipped: number;
  /** A library file: its sets (folder or inner set file names) and the library's name. */
  sets?: { name: string; brushes: Brush[] }[];
  libName?: string;
  /** A brush set file: the name its brushset.plist gives (or the file's own name). */
  setName?: string;
}

// ---- property lists ----------------------------------------------------------

class Uid { constructor(readonly n: number) {} }

/** Binary property list (bplist00). */
function parseBinaryPlist(buf: Uint8Array): unknown {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 40) throw new Error('short');
  const t = buf.length - 32;
  const offSize = v.getUint8(t + 6), refSize = v.getUint8(t + 7);
  const count = Number(v.getBigUint64(t + 8)), top = Number(v.getBigUint64(t + 16)), tableAt = Number(v.getBigUint64(t + 24));
  if (count > 2_000_000 || tableAt + count * offSize > t) throw new Error('bad table');
  const uint = (at: number, n: number): number => { let x = 0; for (let i = 0; i < n; i++) x = x * 256 + v.getUint8(at + i); return x; };
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(uint(tableAt + i * offSize, offSize));
  const cache = new Map<number, unknown>();
  const read = (idx: number, depth: number): unknown => {
    if (depth > 64) throw new Error('deep');
    if (cache.has(idx)) return cache.get(idx);
    let p = offsets[idx];
    const m = v.getUint8(p++), hi = m >> 4;
    let lo = m & 15;
    const len = (): number => {
      if (lo !== 15) return lo;
      const im = v.getUint8(p++), n = 1 << (im & 15);
      const x = uint(p, n);
      p += n;
      return x;
    };
    let out: unknown = null;
    switch (hi) {
      case 0: out = m === 8 ? false : m === 9 ? true : null; break;
      case 1: { const n = 1 << lo; out = n <= 8 ? uint(p, n) : 0; break; }
      case 2: out = lo === 2 ? v.getFloat32(p) : v.getFloat64(p); break;
      case 3: out = v.getFloat64(p); break;
      case 4: { const n = len(); out = buf.subarray(p, p + n); break; }
      case 5: { const n = len(); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(p + i)); out = s; break; }
      case 6: { const n = len(); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint16(p + i * 2)); out = s; break; }
      case 8: out = new Uid(uint(p, lo + 1)); break;
      case 10: case 12: {
        const n = len(), arr: unknown[] = [];
        cache.set(idx, arr);
        for (let i = 0; i < n; i++) arr.push(read(uint(p + i * refSize, refSize), depth + 1));
        return arr;
      }
      case 13: {
        const n = len(), obj: Record<string, unknown> = {};
        cache.set(idx, obj);
        for (let i = 0; i < n; i++) {
          const k = read(uint(p + i * refSize, refSize), depth + 1);
          obj[String(k)] = read(uint(p + (n + i) * refSize, refSize), depth + 1);
        }
        return obj;
      }
      default: out = null;
    }
    lo = 0;
    cache.set(idx, out);
    return out;
  };
  return read(top, 0);
}

/** XML property list, for archives saved as text. */
function parseXmlPlist(text: string): unknown {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const node = (n: Element): unknown => {
    switch (n.tagName) {
      case 'dict': {
        const o: Record<string, unknown> = {};
        const kids = Array.from(n.children);
        for (let i = 0; i + 1 < kids.length; i += 2) o[kids[i].textContent ?? ''] = node(kids[i + 1]);
        return o;
      }
      case 'array': return Array.from(n.children).map(node);
      case 'integer': return parseInt(n.textContent ?? '0', 10);
      case 'real': return parseFloat(n.textContent ?? '0');
      case 'true': return true;
      case 'false': return false;
      default: return n.textContent ?? '';
    }
  };
  const root = doc.querySelector('plist > *');
  if (!root) throw new Error('empty');
  return node(root);
}

export function parsePlist(bytes: Uint8Array): unknown {
  const head = String.fromCharCode(...bytes.subarray(0, 8));
  if (head.startsWith('bplist')) return parseBinaryPlist(bytes);
  return parseXmlPlist(new TextDecoder().decode(bytes));
}

/** Follows an NSKeyedArchiver graph (UID references, NS.keys / NS.objects) into plain values. */
function unarchive(root: unknown): unknown {
  const r = root as Record<string, unknown> | null;
  const objects = r && Array.isArray(r.$objects) ? (r.$objects as unknown[]) : null;
  if (!objects) return root;
  const top = (r!.$top ?? {}) as Record<string, unknown>;
  const start = top.root instanceof Uid ? top.root : Object.values(top).find((x) => x instanceof Uid);
  const seen = new Set<number>();
  // a shared reference is resolved once: a graph where many objects point at the same few would otherwise expand exponentially
  const memo = new Map<number, unknown>();
  const walk = (x: unknown, depth: number): unknown => {
    if (depth > 40) return null;
    if (x instanceof Uid) {
      if (memo.has(x.n)) return memo.get(x.n);
      if (seen.has(x.n)) return null;
      seen.add(x.n);
      const out = walk(objects[x.n], depth + 1);
      seen.delete(x.n);
      memo.set(x.n, out);
      return out;
    }
    if (Array.isArray(x)) return x.map((i) => walk(i, depth + 1));
    if (x && typeof x === 'object' && !(x instanceof Uint8Array)) {
      const o = x as Record<string, unknown>;
      if (Array.isArray(o['NS.keys']) && Array.isArray(o['NS.objects'])) {
        const out: Record<string, unknown> = {};
        const keys = o['NS.keys'] as unknown[], vals = o['NS.objects'] as unknown[];
        keys.forEach((k, i) => { out[String(walk(k, depth + 1))] = walk(vals[i], depth + 1); });
        return out;
      }
      if (Array.isArray(o['NS.objects'])) return (o['NS.objects'] as unknown[]).map((i) => walk(i, depth + 1));
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(o)) if (k !== '$class') out[k] = walk(val, depth + 1);
      return out;
    }
    return x;
  };
  return walk(start, 0);
}

/** Every number, boolean and string in a tree by key name (lower case); the first one found wins. */
function flatten(x: unknown, out: Map<string, unknown>, depth = 0): void {
  if (depth > 12 || !x || typeof x !== 'object' || x instanceof Uint8Array) return;
  if (Array.isArray(x)) { for (const i of x) flatten(i, out, depth + 1); return; }
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    const key = k.toLowerCase();
    if ((typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') && !out.has(key)) out.set(key, v);
    else flatten(v, out, depth + 1);
  }
}

// ---- pictures ------------------------------------------------------------------

async function decodeGrey(bytes: Uint8Array, side: number | null): Promise<{ w: number; h: number; data: Uint8Array } | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes.slice()]));
    let w = bmp.width, h = bmp.height;
    if (side) { w = side; h = side; } else if (Math.max(w, h) > MAX_TIP_SIDE) { const k = MAX_TIP_SIDE / Math.max(w, h); w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)); }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const px = g.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h);
    for (let i = 0; i < data.length; i++) data[i] = Math.round(((0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) * px[i * 4 + 3]) / 255);
    return { w, h, data };
  } catch { return null; }
}

/** Box shrink of a sampled tip so no tip is larger than MAX_TIP_SIDE. */
function shrink(w: number, h: number, data: Uint8Array): { w: number; h: number; data: Uint8Array } {
  const k = Math.max(w, h) / MAX_TIP_SIDE;
  if (k <= 1) return { w, h, data };
  const nw = Math.max(1, Math.round(w / k)), nh = Math.max(1, Math.round(h / k)), out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * k), y1 = Math.min(h, Math.max(y0 + 1, Math.floor((y + 1) * k)));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * k), x1 = Math.min(w, Math.max(x0 + 1, Math.floor((x + 1) * k)));
      let s = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += data[yy * w + xx]; n++; }
      out[y * nw + x] = Math.round(s / Math.max(1, n));
    }
  }
  return { w: nw, h: nh, data: out };
}

let stampCount = 0;
const newId = (): string => `imp-${Date.now().toString(36)}-${(stampCount++).toString(36)}`;

// ---- .abr ------------------------------------------------------------------------

export function brushesFromAbr(buf: ArrayBuffer, base: string): ImportResult {
  const tips = parseAbr(buf, base);
  const brushes: Brush[] = [];
  for (const t of tips) {
    const s = shrink(t.tip.w, t.tip.h, t.tip.data);
    const id = newId();
    const top = clamp(Math.max(t.tip.w, t.tip.h), 12, 400);
    brushes.push({
      id, name: t.name.slice(0, 60), set: 'Imported', tip: 'sampled', softness: 0, maxSize: top, minSize: Math.max(2, top * 0.06),
      spacing: clamp(t.spacing, 0.03, 2), flow: 1, pressureSize: [0.5, 1], pressureFlow: [0.7, 1], tilt: 0, scatter: 0, rotationJitter: 0,
      followStroke: false, roundness: 1, grain: 0, smoothing: 0.2, pickup: 0.5, presets: makePresets(1),
      tipImage: { w: s.w, h: s.h, data: s.data, key: id }, custom: true,
    });
  }
  return { brushes, skipped: 0 };
}

// ---- .brush / .brushset ------------------------------------------------------------

function num(m: Map<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) { const v = m.get(k.toLowerCase()); if (typeof v === 'number' && Number.isFinite(v)) return v; }
  return null;
}

/** First finite number whose (lower-case) key matches; keys are searched in map order. */
function rx(m: Map<string, unknown>, re: RegExp): number | null {
  for (const [k, v] of m) if (typeof v === 'number' && Number.isFinite(v) && re.test(k)) return v;
  return null;
}

const unit = (v: number): number => clamp(Math.abs(v) > 1 ? v / 100 : v, -1, 1);

/**
 * Engine parameters beyond the basics. Key names seen in public write-ups of the format: plotSpacing, plotJitter,
 * shapeScatter, shapeRandomise, shapeInverted, shapeRotation, shapeAzimuth, textureScale, textureMovement,
 * dynamicsPressure*, dynamicsTilt*, dynamicsSpeed*, dynamicsJitter*, dynamicsWetAccumulation, dynamicsMix,
 * dynamicsLoad, maxOpacity. Everything else below (colour dynamics, dilution, rendering mode, wet edges, burnout,
 * fall off, shape count, grain depth jitter, bump) is matched by loose key patterns and is an assumption.
 */
function mapEngine(m: Map<string, unknown>, b: Brush): void {
  const sSize = rx(m, /^dynamicsspeed.*size|^speedsize/), sOp = rx(m, /^dynamicsspeed.*(opacity|flow)|^speedopacity/);
  if (sSize !== null && sSize !== 0) b.speedSize = unit(sSize);
  if (sOp !== null && sOp !== 0) b.speedOpacity = unit(sOp);
  const jSize = rx(m, /^dynamicsjitter.*size|^jittersize/), jOp = rx(m, /^dynamicsjitter.*(opacity|flow)|^jitteropacity/);
  if (jSize !== null && jSize > 0) b.jitterSize = clamp(jSize, 0, 1);
  if (jOp !== null && jOp > 0) b.jitterOpacity = clamp(jOp, 0, 1);
  const cnt = rx(m, /shapecount|stampcount/);
  if (cnt !== null && cnt > 1) b.shapeCount = clamp(Math.round(cnt), 1, 16);
  const az = m.get('shapeazimuth');
  if (az === true || (typeof az === 'number' && az > 0)) b.azimuth = true;
  const rot = num(m, 'shapeRotation');
  if (rot !== null && rot !== 0) b.baseRot = (rot <= 1 ? rot * Math.PI * 2 : rot) % (Math.PI * 2);
  const mov = num(m, 'textureMovement');
  if (mov !== null) b.grainMode = mov < 0.5 ? 'moving' : 'texturized';
  const gj = rx(m, /(texture|grain)depthjitter|dynamicsjitterdepth|dynamicsjitter.*(texture|grain)/);
  if (gj !== null && gj > 0) b.grainJitter = clamp(gj, 0, 1);
  const bump = rx(m, /bump|materialdepth|emboss/);
  if (bump !== null && bump > 0) b.bump = clamp(bump, 0, 1);
  const we = rx(m, /wetedge/), bo = rx(m, /burnout/), fo = rx(m, /falloff/);
  if (we !== null && we > 0) b.wetEdges = clamp(we, 0, 1);
  if (bo !== null && bo > 0) b.burnout = clamp(bo, 0, 1);
  if (fo !== null && fo > 0) b.fallOff = clamp(fo, 0, 1);
  const wig = rx(m, /wiggle|wobble/);
  if (wig !== null && wig > 0) b.wiggle = clamp(wig, 0, 1);

  const mode = m.get('renderingmode') ?? m.get('rendermode') ?? m.get('blendmode');
  const modes: NonNullable<Brush['render']>[] = ['light-glaze', 'uniform-glaze', 'intense-glaze', 'heavy-glaze', 'uniform-blending', 'intense-blending', 'heavy-blending'];
  if (typeof mode === 'number' && mode >= 0 && mode < modes.length) b.render = modes[Math.floor(mode)];
  else if (typeof mode === 'string') {
    const s = mode.toLowerCase().replace(/[^a-z]/g, '');
    const hit = modes.find((x) => s.includes(x.replace('-', '')));
    if (hit) b.render = hit;
  }

  // Wet mix. dynamicsLoad, dynamicsMix and dynamicsWetAccumulation are real keys whose meaning is inferred (charge, attack, pull).
  const dil = rx(m, /dilution|dynamicswetdilution/), chg = rx(m, /charge|^dynamicsload$/), atk = rx(m, /attack|^dynamicsmix$/);
  const pul = rx(m, /pull|wetaccumulation/), grd = rx(m, /wetgrade|^grade$|blur|bleed/);
  if (dil !== null || chg !== null || atk !== null || pul !== null || grd !== null) {
    b.wet = { dilution: clamp(dil ?? 0, 0, 1), charge: clamp(chg ?? 0.7, 0, 1), attack: clamp(atk ?? 0, 0, 1), pull: clamp(pul ?? 0, 0, 1), grade: clamp(grd ?? 0.5, 0, 1) };
    if ((dil ?? 0) <= 0 && (atk ?? 0) <= 0 && (pul ?? 0) <= 0 && (chg ?? 1) >= 1) delete b.wet;
  }

  // Colour dynamics.
  const cd: NonNullable<Brush['colorDyn']> = {};
  const pick = (re: RegExp): number | null => { const v = rx(m, re); return v === null || v === 0 ? null : clamp(v, -1, 1); };
  const set = (k: keyof typeof cd, re: RegExp): void => { const v = pick(re); if (v !== null) cd[k] = v; };
  set('stampHue', /(stamp|shape).*hue|hue.*(stamp|shape)jitter/); set('stampSat', /(stamp|shape).*sat|sat.*(stamp|shape)jitter/); set('stampBri', /(stamp|shape).*(bright|lightness)|(bright).*(stamp|shape)jitter/);
  set('strokeHue', /stroke.*hue|hue.*strokejitter/); set('strokeSat', /stroke.*sat|sat.*strokejitter/); set('strokeBri', /stroke.*(bright|lightness)/);
  set('pressureHue', /pressure.*hue/); set('pressureSat', /pressure.*sat/); set('pressureBri', /pressure.*(bright|lightness)/);
  set('tiltHue', /tilt.*hue/); set('tiltSat', /tilt.*sat/); set('tiltBri', /tilt.*(bright|lightness)/);
  const sec = (k: 'stampSecondary' | 'strokeSecondary', key: string): void => { const v = num(m, key); if (v !== null && v > 0) (cd[k] = clamp(v, 0, 1)); };
  sec('stampSecondary', 'fmColorStampSecondary'); sec('strokeSecondary', 'fmColorStrokeSecondary');
  if (Object.keys(cd).length) b.colorDyn = cd;
  mapStudio(m, b);
}

const BLENDS = ['multiply', 'screen', 'overlay', 'hard-light', 'soft-light', 'darken', 'lighten', 'color-dodge', 'color-burn', 'linear-burn', 'difference', 'exclusion', 'add', 'subtract'];

/** Brush Studio fields, under the key names brush-export writes (all start with fm: ours, not seen in a file from elsewhere). */
function mapStudio(m: Map<string, unknown>, b: Brush): void {
  const pos = (key: string, lo: number, hi: number): number | undefined => { const v = num(m, key); return v !== null && v > 0 ? clamp(v, lo, hi) : undefined; };
  const set = <K extends keyof Brush>(k: K, v: Brush[K] | undefined): void => { if (v !== undefined) b[k] = v; };
  set('pathJitter', pos('fmPathJitter', 0, 1)); set('pressureSmooth', pos('fmPressureSmooth', 0, 1));
  set('pTaper', pos('fmTaperPenStart', 0, 1)); set('pTaperEnd', pos('fmTaperPenEnd', 0, 1));
  const ts = num(m, 'fmTaperMinSize'); if (ts !== null) b.taperSize = clamp(ts, 0, 1);
  // pen response and shape dynamics
  const signed = (key: string, lo: number, hi: number): number | undefined => { const v = num(m, key); return v !== null && v !== 0 ? clamp(v, lo, hi) : undefined; };
  set('rollSize', signed('fmRollSize', -1, 1)); set('rollOpacity', signed('fmRollOpacity', -1, 1)); set('rollBleed', pos('fmRollEdgeSoft', 0, 1));
  if (m.get('fmrollrelative') === true) b.rollRelative = true;
  set('pressureRoundness', signed('fmPressureRound', -1, 1)); set('tiltRoundness', pos('fmTiltRound', 0, 1));
  set('roundJitterH', pos('fmRoundJitterH', 0, 1)); set('roundJitterV', pos('fmRoundJitterV', 0, 1));
  set('countJitter', pos('fmCountJitter', 0, 1)); set('spacingJitter', pos('fmSpacingJitter', 0, 1)); set('jitterLinear', pos('fmJitterLinear', 0, 1));
  set('speedSpacing', signed('fmSpeedSpacing', -1, 1));
  const curves: NonNullable<Brush['curves']> = {};
  for (const [k, key] of [['size', 'fmcurvesize'], ['opacity', 'fmcurveopacity'], ['flow', 'fmcurveflow'], ['bleed', 'fmcurvebleed'], ['roundness', 'fmcurveroundness'], ['tilt', 'fmcurvetilt']] as const) {
    const s = m.get(key);
    if (typeof s !== 'string' || s.length > 400) continue;
    const [list, sp] = s.split('@');
    const pts = list.split(',').map(Number);
    if (pts.length < 4 || pts.length > 12 || pts.length % 2 !== 0 || pts.some((v) => !Number.isFinite(v))) continue;
    const c: { pts: number[]; speed?: number } = { pts: cleanPoints(pts) };
    const spd = sp === undefined ? NaN : Number(sp);
    if (Number.isFinite(spd) && spd >= 0 && spd < 1) c.speed = spd;
    curves[k] = c;
  }
  if (Object.keys(curves).length) b.curves = curves;
  set('taperOpacity', pos('fmTaperFade', 0, 1));
  const tp = num(m, 'fmTaperPoint'); if (tp !== null) b.taperTip = clamp(tp, 0, 1);
  if (m.get('fmflipx') === true) b.flipX = true;
  if (m.get('fmflipy') === true) b.flipY = true;
  if (m.get('fmtipsharp') === true) b.tipSharp = true;
  set('grainZoom', pos('fmGrainZoom', 0, 1)); set('grainOffsetJitter', pos('fmGrainOffsetJitter', 0, 1));
  const gr = num(m, 'fmGrainTurn'); if (gr !== null && gr !== 0) b.grainRot = gr;
  const gbl = m.get('fmgrainblend'); if (gbl === 'subtract' || gbl === 'screen') b.grainBlend = gbl;
  const gbr = num(m, 'fmGrainBright'), gct = num(m, 'fmGrainContrast');
  if (gbr !== null && gbr !== 0) b.grainBright = clamp(gbr, -1, 1);
  if (gct !== null && gct !== 0) b.grainContrast = clamp(gct, -1, 1);
  set('burntEdges', pos('fmBurntEdges', 0, 1));
  const bl = m.get('fmbrushblend'); if (typeof bl === 'string' && BLENDS.includes(bl)) b.blend = bl as Brush['blend'];
  set('lumBlend', pos('fmLumBlend', 0, 1));
  set('pressureBleed', pos('fmPressureEdgeSoft', 0, 1)); set('pressureOpacity', pos('fmPressureOpacityRamp', 0, 1));
  set('tiltAngle', pos('fmTiltThreshold', 0, 80)); set('tiltGradation', pos('fmTiltGradation', 0, 1)); set('tiltBleed', pos('fmTiltEdgeSoft', 0, 1));
  const to = num(m, 'fmTiltOpacity'), tsz = num(m, 'fmTiltSize');
  if (to !== null && to !== 0) b.tiltOpacity = clamp(to, -1, 1);
  if (tsz !== null && tsz !== 0) b.tiltSize = clamp(tsz, -1, 1);
  if (m.get('fmorientscreen') === true) b.orientScreen = true;
  const pv = num(m, 'fmPreviewSize'); if (pv !== null && pv !== 1) b.previewSize = clamp(pv, 0.2, 1);
  set('minOpacity', pos('fmMinOpacity', 0, 1));
  const mx = num(m, 'fmMaxOpacity'); if (mx !== null && mx < 1) b.maxOpacity = clamp(mx, 0.05, 1);
  const au = m.get('fmauthor'); if (typeof au === 'string' && au.trim()) b.author = au.trim().slice(0, 80);
  const cr = num(m, 'fmCreated'); if (cr !== null && cr > 0) b.created = cr;
  const sg = m.get('fmsignature'); if (typeof sg === 'string' && sg.startsWith('data:image/png;base64,') && sg.length < 60000) b.signature = sg;
  const wb = pos('fmWetSpread', 0, 1), wbj = pos('fmWetSpreadJitter', 0, 1), wj = pos('fmWetnessJitter', 0, 1);
  if (wb !== undefined || wbj !== undefined || wj !== undefined) {
    const w = b.wet ?? { dilution: 0, charge: 1, attack: 0, pull: 0, grade: 0.5 };
    if (wb !== undefined) w.blur = wb;
    if (wbj !== undefined) w.blurJitter = wbj;
    if (wj !== undefined) w.wetJitter = wj;
    b.wet = w;
  }
}

/** The parameters we can use, from the archive's key names; absent ones keep the plain defaults. */
export function brushFromParams(plist: unknown, name: string, tip: { w: number; h: number; data: Uint8Array } | null, grain: Uint8Array | null): Brush {
  const m = new Map<string, unknown>();
  flatten(plist, m);
  const id = newId();
  const nm = typeof m.get('name') === 'string' && String(m.get('name')).trim() ? String(m.get('name')).trim() : name;
  const spacing = num(m, 'plotSpacing', 'spacing');
  const jitter = num(m, 'plotJitter', 'shapeScatter', 'scatter');
  const taper = Math.max(num(m, 'taperStartLength') ?? 0, num(m, 'taperEndLength') ?? 0, num(m, 'taperSize') ?? 0, num(m, 'taperOpacity') ?? 0);
  const tScale = num(m, 'textureScale', 'grainScale');
  const tDepth = num(m, 'textureDepth', 'grainDepth');
  const maxV = num(m, 'maxSize'), minV = num(m, 'minSize');
  const maxPx = maxV === null ? 48 : clamp(12 + maxV * 188, 1, 400);   // below 12 px is a negative share: brush-export writes it so a small brush round-trips
  const minPx = maxV && minV !== null ? clamp((minV / maxV) * maxPx, 0.1, maxPx) : Math.max(1, maxPx * 0.06);
  const opac = num(m, 'maxOpacity', 'opacity');
  const pSize = num(m, 'pressureSize', 'dynamicsPressureSize');
  const pOp = num(m, 'pressureOpacity', 'dynamicsPressureOpacity');
  const stab = num(m, 'stabilization', 'streamline', 'plotSmoothing', 'pressureSmoothing');
  const motion = num(m, 'motionFilter', 'motionFiltering');
  const expr = num(m, 'expression', 'motionFilteringExpression');
  const rand = num(m, 'shapeRandomise', 'shapeRandomize', 'rotationJitter');
  const orient = m.get('orienttoscreen');
  const hasTip = !!tip;
  const b: Brush = {
    id, name: nm.slice(0, 60), set: 'Imported', tip: hasTip ? 'sampled' : 'round', softness: hasTip ? 0 : 0.2, maxSize: maxPx, minSize: minPx,
    spacing: spacing === null ? 0.1 : clamp(spacing, 0.02, 2), flow: 1,
    pressureSize: [pSize === null ? 0.5 : clamp(1 - pSize, 0.02, 1), 1], pressureFlow: [pOp === null ? 0.7 : clamp(1 - pOp, 0.05, 1), 1],
    tilt: 0, scatter: jitter === null ? 0 : clamp(jitter, 0, 2), rotationJitter: rand === null ? 0 : clamp(rand, 0, 1),
    followStroke: orient === false, roundness: 1, grain: grain ? clamp(tDepth ?? 0.8, 0, 1) : clamp(tDepth ?? 0, 0, 1), smoothing: 0.2, pickup: 0.5,
    presets: makePresets(opac === null ? 1 : clamp(opac, 0.1, 1)), custom: true,
  };
  if (tip && m.get('shapeinverted') === true) tip = { w: tip.w, h: tip.h, data: tip.data.map((v) => 255 - v) };
  if (tip) { const s = shrink(tip.w, tip.h, tip.data); b.tipImage = { w: s.w, h: s.h, data: s.data, key: id }; }
  if (grain) b.grainImage = grain;
  if (tScale !== null && (grain || tDepth !== null)) b.grainScale = clamp(tScale, 0.25, 4);
  mapEngine(m, b);
  // only our own key names: a generic name in a file from elsewhere means something else
  const rnd = num(m, 'shapeRoundness'), tl = num(m, 'dynamicsTilt'), pk = num(m, 'wetPickup');
  if (m.get('pixelperfect') === true) b.pixelPerfect = true;
  if (rnd !== null) b.roundness = clamp(rnd, 0.05, 1);
  if (tl !== null) b.tilt = clamp(tl, 0, 1);
  if (pk !== null) b.pickup = clamp(pk, 0, 1);
  // Start and end lengths are separate keys in files from brush-export; other files only give one value
  const tStart = num(m, 'taperStartLength'), tEnd = num(m, 'taperEndLength');
  if (tStart !== null && tEnd !== null && tEnd !== tStart) {
    if (tStart > 0) b.taper = clamp(tStart, 0, 1);
    b.taperEnd = clamp(tEnd, 0, 1);
  } else if (taper > 0) b.taper = clamp(taper, 0, 1);
  if (stab !== null) b.stabilization = clamp(stab <= 1 ? stab * 100 : stab, 0, 100);
  if (motion !== null) b.motionFilter = clamp(motion <= 1 ? motion * 100 : motion, 0, 100);
  if (expr !== null) b.expression = clamp(expr <= 1 ? expr * 100 : expr, 0, 100);
  return b;
}

async function brushFromFolder(files: Record<string, Uint8Array>, dir: string, fallback: string): Promise<Brush | null> {
  const key = Object.keys(files).find((k) => k === `${dir}Brush.archive`);
  if (!key) return null;
  let tree: unknown;
  try { tree = unarchive(parsePlist(files[key])); } catch { return null; }
  const pick = (leaf: string): Uint8Array | undefined => files[`${dir}${leaf}`] ?? files[Object.keys(files).find((k) => k.toLowerCase() === `${dir}${leaf}`.toLowerCase()) ?? ''];
  const shape = pick('Shape.png'), grainPng = pick('Grain.png');
  const tip = shape ? await decodeGrey(shape, null) : null;
  const g = grainPng ? await decodeGrey(grainPng, 256) : null;
  return brushFromParams(tree, fallback, tip, g ? g.data : null);
}

export async function brushesFromZip(buf: ArrayBuffer, base: string): Promise<ImportResult> {
  let files: Record<string, Uint8Array>;
  files = safeUnzipOr(new Uint8Array(buf), 'This file is not a brush archive.', { entry: 64 * 1024 * 1024, total: 512 * 1024 * 1024 });
  const dirs = new Set<string>();
  for (const k of Object.keys(files)) { if (/(^|\/)Brush\.archive$/i.test(k)) dirs.add(k.slice(0, k.length - 'Brush.archive'.length)); }
  const out: Brush[] = [];
  let skipped = 0, n = 0;
  // brushset.plist lists the brush folders in the set's own order
  let order: string[] = [];
  let setName = '';
  const listFile = files['brushset.plist'];
  if (listFile) {
    try {
      const pl = parsePlist(listFile) as { brushes?: unknown; name?: unknown };
      if (typeof pl.name === 'string') setName = pl.name.trim();
      const l = pl.brushes;
      if (Array.isArray(l)) order = l.filter((x): x is string => typeof x === 'string').map((x) => `${x}/`);
    } catch { /* sorted by folder */ }
  }
  const rank = (d: string): number => { const i = order.indexOf(d); return i < 0 ? order.length : i; };
  for (const dir of Array.from(dirs).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))) {
    const folder = dir.replace(/\/$/, '').split('/').pop() ?? '';
    const b = await brushFromFolder(files, dir, dirs.size === 1 ? base : `${base} ${++n}` || folder);
    if (b) out.push(b); else skipped++;
  }
  return { brushes: out, skipped, setName: listFile ? setName || base : undefined };
}

/**
 * A library file is read as an archive of sets: nested .brushset / .brush archives, or folders holding Brush.archive
 * files (the folder above a brush folder names its set). The container layout is an assumption; both shapes are accepted.
 */
export async function brushesFromLib(buf: ArrayBuffer, base: string): Promise<ImportResult> {
  let files: Record<string, Uint8Array>;
  files = safeUnzipOr(new Uint8Array(buf), 'This file is not a brush library.', { entry: 128 * 1024 * 1024, total: 768 * 1024 * 1024 });
  const groups = new Map<string, Brush[]>();
  const add = (name: string, list: Brush[]): void => { if (list.length) groups.set(name, [...(groups.get(name) ?? []), ...list]); };
  let skipped = 0;
  for (const k of Object.keys(files).sort()) {
    const d = files[k];
    if (!/\.(brushset|brush)$/i.test(k) || d.length < 4 || d[0] !== 0x50 || d[1] !== 0x4b) continue;
    const nm = (k.split('/').pop() ?? k).replace(/\.[^.]+$/, '') || base;
    try {
      const r = await brushesFromZip(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer, nm);
      add(/\.brush$/i.test(k) ? (k.split('/').slice(-2, -1)[0] ?? base) : nm, r.brushes);
      skipped += r.skipped;
    } catch { skipped++; }
  }
  const dirs = new Set<string>();
  for (const k of Object.keys(files)) if (/(^|\/)Brush\.archive$/i.test(k)) dirs.add(k.slice(0, k.length - 'Brush.archive'.length));
  let n = 0;
  for (const dir of Array.from(dirs).sort()) {
    const parts = dir.split('/').filter(Boolean);
    const b = await brushFromFolder(files, dir, `${parts[parts.length - 1] ?? base} ${++n}`);
    if (b) add(parts.length >= 2 ? parts[parts.length - 2] : base, [b]); else skipped++;
  }
  const sets = Array.from(groups, ([name, brushes]) => ({ name, brushes }));
  return { brushes: sets.flatMap((s) => s.brushes), skipped, sets, libName: base };
}

/** Reads a brush file the person picked or dropped. */
export async function importBrushFile(file: File): Promise<ImportResult> {
  const base = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Brush';
  const buf = await file.arrayBuffer();
  if (/\.abr$/i.test(file.name)) return brushesFromAbr(buf, base);
  if (/\.brushlib$/i.test(file.name)) return brushesFromLib(buf, base);
  if (/\.(brush|brushset)$/i.test(file.name)) return brushesFromZip(buf, base);
  if (file.type.startsWith('image/')) {
    const tip = await decodeGrey(new Uint8Array(buf), null);
    if (!tip) throw new Error('The picture could not be read.');
    const b = brushFromParams({}, base, tip, null);
    return { brushes: [b], skipped: 0 };
  }
  throw new Error('Brush files are .abr, .brush, .brushset and .brushlib.');
}
