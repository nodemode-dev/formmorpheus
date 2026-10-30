// Brush export: a brush, a set or a library back out as .brush, .brushset and .brushlib, the same containers
// io/brush-import.ts reads. Pure: no DOM (the PNG tip is encoded here with fflate's deflate).
//
// What public write-ups of the format confirm (checked while building this):
//   - a .brush / .brushset is a zip; a brush is a folder (or the zip root) holding Brush.archive, Shape.png
//     (grey tip, white is paint), Grain.png (grey texture) and QuickLook/Thumbnail.png (preview);
//   - Brush.archive is an NSKeyedArchiver graph in a binary property list: $archiver, $version, $top.root,
//     $objects with "$null" first and the settings dictionary at $objects[1]; strings are references (UIDs);
//   - a .brushset carries brushset.plist (XML) with the set's name and the brushes' folder order;
//   - setting names: name, plotSpacing, plotJitter, shapeScatter, shapeRandomise, shapeInverted, shapeRotation,
//     shapeAzimuth, textureScale, textureMovement, maxOpacity, maxSize, dynamicsPressure*, dynamicsSpeed*,
//     dynamicsJitter*, taper*, dynamicsWetAccumulation, dynamicsMix, dynamicsLoad.
// formmorpheus's own assumption (a file from elsewhere may use other names or scales):
//   - the settings class name, the value scales (maxSize 0 to 1 over 12 to 200 px, rotation in turns,
//     pressure as 1 minus the low end), and every key for stabilization, motion filter, expression, texture
//     depth, depth jitter, bump, wet mix, colour dynamics, rendering mode, wet edges, burnout, fall off, wiggle,
//     shape count and taper start / end lengths;
//   - brushset.plist's key names beyond name and brushes, the .brushlib layout (one .brushset per set, stored
//     inside the zip, named by the set) and its brushlib.plist;
//   - roundness (shapeRoundness), tilt (dynamicsTilt: one 0 to 1 amount that flattens the dab) and wet pickup
//     (wetPickup) are our own key names, not seen in a file from elsewhere; Shape.png is written round and
//     shapeRoundness carries the squash, so the importer does not apply it twice;
//   - QuickLook/Thumbnail.png is a 256 by 96 PNG of a stroke drawn with the brush (ui/brush-thumb.ts); the path
//     is confirmed, its size and the white ground are our choice. It is skipped when no canvas is available.

import { zipSync, zlibSync } from 'fflate';
import { writeBinaryPlist, Uid, type PlistValue } from './bplist-write';
import { getTip } from '../paint/tips';
import type { Brush } from '../paint/types';

const SHAPE_SIDE = 256;
const GRAIN_SIDE = 256;

// ---- grey PNG ------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;
function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** An 8-bit greyscale PNG, no filtering; white is full coverage. */
export function encodeGreyPng(w: number, h: number, data: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(data.subarray(y * w, y * w + w), y * (w + 1) + 1);
  const idat = zlibSync(raw, { level: 6 });
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length), dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, w); hv.setUint32(4, h);
  ihdr[8] = 8; // depth
  ihdr[9] = 0; // grey
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ---- Brush.archive -------------------------------------------------------------------

const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** The settings the importer maps, under the names it reads. Absent ones are left out. */
export function brushSettings(b: Brush): Record<string, number | boolean | string> {
  const s: Record<string, number | boolean | string> = {};
  const put = (k: string, v: number | boolean | string | undefined): void => { if (v !== undefined && (typeof v !== 'number' || Number.isFinite(v))) s[k] = v; };
  put('plotSpacing', b.spacing);
  put('plotJitter', b.scatter);
  put('shapeRandomise', b.rotationJitter);
  put('orientToScreen', !b.followStroke);
  // maxSize is 0 to 1 over 12 to 200 px on import; the smallest size is its share of the largest
  const maxV = (b.maxSize - 12) / 188;
  put('maxSize', maxV === 0 ? 1e-9 : maxV);
  put('minSize', b.maxSize > 0 ? (b.minSize / b.maxSize) * (maxV === 0 ? 1e-9 : maxV) : 0);
  put('maxOpacity', b.presets[0]?.opacity ?? 1);
  put('shapeRoundness', b.roundness);   // the Shape.png is written round (see shapePng), so the nib's squash is only here
  put('dynamicsTilt', finite(b.tilt) && b.tilt > 0 ? b.tilt : undefined);
  put('wetPickup', b.pickup);
  if (b.pixelPerfect) put('pixelPerfect', true);
  put('dynamicsPressureSize', 1 - b.pressureSize[0]);
  put('dynamicsPressureOpacity', 1 - b.pressureFlow[0]);
  if (b.grainImage || b.grain > 0) put('textureDepth', b.grain);
  if ((b.grainImage || b.grain > 0) && finite(b.grainScale)) put('textureScale', b.grainScale);
  const pct = (v: number | undefined): number | undefined => (finite(v) ? v / 100 : undefined);
  put('stabilization', pct(b.stabilization));
  put('motionFilter', pct(b.motionFilter));
  put('expression', pct(b.expression));
  if (finite(b.taper) || finite(b.taperEnd)) {
    put('taperStartLength', b.taper ?? 0);
    put('taperEndLength', b.taperEnd ?? b.taper ?? 0);
  }
  if (finite(b.speedSize) && b.speedSize !== 0) put('dynamicsSpeedSize', b.speedSize);
  if (finite(b.speedOpacity) && b.speedOpacity !== 0) put('dynamicsSpeedOpacity', b.speedOpacity);
  if (finite(b.jitterSize) && b.jitterSize > 0) put('dynamicsJitterSize', b.jitterSize);
  if (finite(b.jitterOpacity) && b.jitterOpacity > 0) put('dynamicsJitterOpacity', b.jitterOpacity);
  if (finite(b.shapeCount) && b.shapeCount > 1) put('shapeCount', b.shapeCount);
  if (b.azimuth) put('shapeAzimuth', true);
  if (finite(b.baseRot) && b.baseRot !== 0) put('shapeRotation', b.baseRot / (Math.PI * 2)); // in turns
  if (b.grainMode) put('textureMovement', b.grainMode === 'moving' ? 0 : 1);
  if (finite(b.grainJitter) && b.grainJitter > 0) put('textureDepthJitter', b.grainJitter);
  if (finite(b.bump) && b.bump > 0) put('bumpDepth', b.bump);
  if (finite(b.wetEdges) && b.wetEdges > 0) put('wetEdges', b.wetEdges);
  if (finite(b.burnout) && b.burnout > 0) put('burnout', b.burnout);
  if (finite(b.fallOff) && b.fallOff > 0) put('fallOff', b.fallOff);
  if (finite(b.wiggle) && b.wiggle > 0) put('wiggle', b.wiggle);
  if (b.render) put('renderingMode', b.render);
  if (b.wet) {
    put('wetDilution', b.wet.dilution); put('wetCharge', b.wet.charge); put('wetAttack', b.wet.attack);
    put('wetPull', b.wet.pull); put('wetGrade', b.wet.grade);
  }
  const cd = b.colorDyn;
  if (cd) {
    const names: [keyof typeof cd, string][] = [
      ['stampHue', 'colorDynStampHue'], ['stampSat', 'colorDynStampSat'], ['stampBri', 'colorDynStampBright'],
      ['strokeHue', 'colorDynStrokeHue'], ['strokeSat', 'colorDynStrokeSat'], ['strokeBri', 'colorDynStrokeBright'],
      ['pressureHue', 'colorDynPressureHue'], ['pressureSat', 'colorDynPressureSat'], ['pressureBri', 'colorDynPressureBright'],
      ['tiltHue', 'colorDynTiltHue'], ['tiltSat', 'colorDynTiltSat'], ['tiltBri', 'colorDynTiltBright'],
    ];
    for (const [k, name] of names) { const v = cd[k]; if (finite(v) && v !== 0) put(name, v); }
  }
  return s;
}

/** Brush.archive: an NSKeyedArchiver graph, binary property list. */
export function brushArchive(b: Brush): Uint8Array {
  const settings: { [key: string]: PlistValue } = { $class: new Uid(2), name: new Uid(3), ...brushSettings(b) };
  const root: PlistValue = {
    $archiver: 'NSKeyedArchiver',
    $version: 100000,
    $top: { root: new Uid(1) },
    $objects: ['$null', settings, { $classname: 'Brush', $classes: ['Brush', 'NSObject'] }, b.name],
  };
  return writeBinaryPlist(root);
}

// ---- containers ------------------------------------------------------------------------

/** The tip as a grey picture: the sampled pixels, or the procedural shape drawn once at a fixed size. */
function shapePng(b: Brush): Uint8Array | null {
  if (b.tipImage) return encodeGreyPng(b.tipImage.w, b.tipImage.h, b.tipImage.data);
  if (b.tip === 'sampled') return null;
  const t = getTip(b.tip, SHAPE_SIDE, b.softness, 1, 0);
  return encodeGreyPng(t.size, t.size, t.data);
}

/** A PNG preview per brush (null: none); made in the UI layer (ui/brush-thumb.ts) because it needs a canvas. */
export type Thumbs = (Uint8Array | null | undefined)[];

function brushFiles(b: Brush, dir: string, out: Record<string, Uint8Array>, thumb?: Uint8Array | null): void {
  out[`${dir}Brush.archive`] = brushArchive(b);
  if (thumb) out[`${dir}QuickLook/Thumbnail.png`] = thumb;
  const shape = shapePng(b);
  if (shape) out[`${dir}Shape.png`] = shape;
  if (b.grainImage && b.grainImage.length === GRAIN_SIDE * GRAIN_SIDE) out[`${dir}Grain.png`] = encodeGreyPng(GRAIN_SIDE, GRAIN_SIDE, b.grainImage);
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function xmlPlist(entries: [string, string | string[]][]): Uint8Array {
  const body = entries.map(([k, v]) => `<key>${esc(k)}</key>${Array.isArray(v) ? `<array>${v.map((x) => `<string>${esc(x)}</string>`).join('')}</array>` : `<string>${esc(v)}</string>`}`).join('');
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${body}</dict></plist>\n`);
}

let folderN = 0;
function folderName(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID().toUpperCase();
  return `B${(folderN++).toString(36).toUpperCase().padStart(8, '0')}`;
}

const safeName = (s: string): string => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 60) || 'Set';

/** One brush as a .brush zip. */
export function exportBrush(b: Brush, thumb?: Uint8Array | null): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  brushFiles(b, '', files, thumb);
  return zipSync(files, { level: 0 });
}

/** A set as a .brushset zip: a folder per brush plus brushset.plist. */
export function exportBrushSet(name: string, brushes: Brush[], thumbs?: Thumbs): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const dirs: string[] = [];
  brushes.forEach((b, i) => { const d = folderName(); dirs.push(d); brushFiles(b, `${d}/`, files, thumbs?.[i]); });
  files['brushset.plist'] = xmlPlist([['name', name], ['brushes', dirs]]);
  return zipSync(files, { level: 0 });
}

/** A library as a .brushlib zip: one .brushset per set, named by the set. */
export function exportBrushLib(name: string, sets: { name: string; brushes: Brush[]; thumbs?: Thumbs }[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  const names: string[] = [];
  for (const s of sets) {
    if (!s.brushes.length) continue;
    let base = safeName(s.name), n = 1;
    while (used.has(base.toLowerCase())) base = `${safeName(s.name)} ${++n}`;
    used.add(base.toLowerCase());
    names.push(base);
    files[`${base}.brushset`] = exportBrushSet(s.name, s.brushes, s.thumbs);
  }
  files['brushlib.plist'] = xmlPlist([['name', name], ['sets', names]]);
  return zipSync(files, { level: 0 });
}

export const fileNameFor = (name: string, ext: 'brush' | 'brushset' | 'brushlib'): string => `${safeName(name)}.${ext}`;
