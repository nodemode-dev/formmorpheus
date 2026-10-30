// formvis project documents (.fvd): a ZIP with manifest.json and images/*.png. Pure bytes in, bytes out (fflate):
// no DOM, no canvas. Layers here run top first with a group's members following it, like a Drawing's list; the
// document itself lists them bottom to top with a folder after its members.
import { strFromU8, strToU8, unzipSync, zipSync, zlibSync, type Zippable } from 'fflate';
import { safeUnzipOr } from './safe-unzip';
import type { BlendMode } from '../engine/types';

export const FORMVIS_FORMAT = 'com.nodemode.formvis';
export const FORMVIS_EXT = 'fvd';

/** One layer, as a Drawing holds it. `image` and `mask` are PNG bytes (the mask an opaque grey picture, white reveals). */
export interface FvLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  group: boolean;
  parent: string | null;
  collapsed: boolean;
  alphaLock: boolean;
  clipping: boolean;
  image: Uint8Array | null;
  mask: Uint8Array | null;
  maskOn: boolean;
  maskLinked: boolean;
}

export interface FvPlacement { x: number; y: number; w: number; h: number; rotation: number; flipX: boolean; flipY: boolean }

/** A layer read from a document: the Drawing fields plus where its picture sat on the canvas. */
export interface FvRead extends FvLayer {
  placement: FvPlacement;
  maskPlacement: FvPlacement | null;
}

export interface FvDocument {
  name: string;
  width: number;
  height: number;
  /** Top first. */
  layers: FvRead[];
  documentId: string | null;
  /** What formmorpheus could not carry, as short sentences. */
  notes: string[];
}

const LABELS: Partial<Record<BlendMode, string>> = {
  normal: 'Normal', multiply: 'Multiply', darken: 'Darken', 'color-burn': 'Color Burn', screen: 'Screen', lighten: 'Lighten',
  'color-dodge': 'Color Dodge', add: 'Linear Dodge (Add)', overlay: 'Overlay', 'soft-light': 'Soft Light', 'hard-light': 'Hard Light',
  difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity',
  'linear-burn': 'Linear Burn', 'darker-color': 'Darker Color', 'lighter-color': 'Lighter Color', 'vivid-light': 'Vivid Light', 'linear-light': 'Linear Light',
  'pin-light': 'Pin Light', 'hard-mix': 'Hard Mix', subtract: 'Subtract', divide: 'Divide',
};
const FROM_LABEL = new Map<string, BlendMode>(Object.entries(LABELS).map(([k, v]) => [v as string, k as BlendMode]));

export function blendLabelOf(b: BlendMode): string {
  return LABELS[b] ?? 'Normal';
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];

export function isPng(b: Uint8Array): boolean {
  return b.length > 24 && PNG_SIG.every((v, i) => b[i] === v);
}

/** Width and height from a PNG's header; null when it is not one. */
export function pngSize(b: Uint8Array): { w: number; h: number } | null {
  if (!isPng(b)) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

let crcTable: Uint32Array | null = null;
function crc32(parts: Uint8Array[]): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = crcTable[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  const t = strToU8(type);
  out.set(t, 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32([t, data]));
  return out;
}

const blanks = new Map<string, Uint8Array>();

/** A fully transparent RGBA PNG (a layer with no pixels still needs a picture in the document). */
export function blankPng(w: number, h: number): Uint8Array {
  const key = `${w}x${h}`;
  const hit = blanks.get(key);
  if (hit) return hit;
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6;
  const idat = zlibSync(new Uint8Array((w * 4 + 1) * h), { level: 6 });
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  if (blanks.size > 4) blanks.clear();
  blanks.set(key, out);
  return out;
}

export interface FvWrite {
  name: string;
  width: number;
  height: number;
  /** Top first, a group's members after it. */
  layers: FvLayer[];
  /** Kept so the same file coming back can be matched to the Drawing it left from. */
  documentId?: string;
  thumbnail?: Uint8Array | null;
}

/** The document as a ZIP (a formvis project): one picture per layer, one per mask. */
export function writeFormvis(doc: FvWrite): Uint8Array {
  const bottomUp = doc.layers.slice().reverse();
  const files: Zippable = {};
  const records: Record<string, unknown>[] = [];
  const key = new Map<string, string>();
  const groups = new Set(doc.layers.filter((l) => l.group).map((l) => l.id));
  bottomUp.forEach((l, i) => key.set(l.id, `L${i + 1}`));
  const collapsed: string[] = [];
  bottomUp.forEach((l, i) => {
    const id = key.get(l.id) as string;
    const r: Record<string, unknown> = { id, name: l.name, isVisible: l.visible };
    if (l.group) {
      r.transform = { origin: [0, 0], size: [doc.width, doc.height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' };
      r.isGroup = true;
      // pass through is a folder that does not isolate; any other mode needs the folder composited on its own
      if (l.blend !== 'passthrough') r.isolate = true;
      if (l.collapsed) collapsed.push(id);
    } else {
      const png = l.image ?? blankPng(doc.width, doc.height);
      const size = pngSize(png) ?? { w: doc.width, h: doc.height };
      r.transform = { origin: [0, 0], size: [size.w, size.h], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' };
      r.imageFile = `${id}.png`;
      files[`images/${id}.png`] = [png, { level: 0 }];
    }
    if (l.parent && groups.has(l.parent)) r.parentID = key.get(l.parent);
    if (l.opacity !== 1) r.opacity = l.opacity;
    if (l.blend !== 'normal' && l.blend !== 'passthrough') r.blendMode = blendLabelOf(l.blend);
    if (l.alphaLock) r.locks = { transparency: true };
    if (l.clipping && !l.group) {
      // the clip base is the nearest picture layer below this one in the same folder
      for (let j = i - 1; j >= 0; j--) {
        const b = bottomUp[j];
        if ((b.parent ?? null) !== (l.parent ?? null) || b.group) continue;
        if (!b.clipping) { r.maskSourceID = key.get(b.id); break; }
      }
    }
    if (l.mask && !l.group) {
      r.maskFile = `${id}.mask.png`;
      files[`images/${id}.mask.png`] = [l.mask, { level: 0 }];
      r.maskEnabled = l.maskOn;
      if (!l.maskLinked) r.maskLinked = false;
    }
    records.push(r);
  });
  const manifest: Record<string, unknown> = {
    format: FORMVIS_FORMAT, version: 1, colorSpace: 'sRGB', resolution: 72, documentID: doc.documentId ?? `fm-${Date.now().toString(36)}`,
    width: doc.width, height: doc.height, layers: records,
  };
  const active = bottomUp.find((l) => !l.group);
  if (active) manifest.activeLayerID = key.get(active.id);
  if (collapsed.length) manifest.collapsedFolders = collapsed;
  files['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }];
  if (doc.thumbnail && isPng(doc.thumbnail)) {
    files['thumbnail.png'] = [doc.thumbnail, { level: 0 }];
    files['QuickLook/Thumbnail.png'] = [doc.thumbnail, { level: 0 }];
    files['QuickLook/Preview.png'] = [doc.thumbnail, { level: 0 }];
  }
  return zipSync(files);
}

// ---- reading

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pair = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null);

function placementOf(raw: unknown, w: number, h: number): FvPlacement {
  const t = obj(raw), at = pair(t.origin) ?? [0, 0], size = pair(t.size) ?? [w, h];
  return { x: at[0], y: at[1], w: Math.max(1, size[0]), h: Math.max(1, size[1]), rotation: num(t.rotation, 0), flipX: t.flipX === true, flipY: t.flipY === true };
}

/** True when the bytes are a ZIP holding a formvis (or kin) manifest. */
export function looksLikeFormvis(bytes: Uint8Array): boolean {
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return false;
  try {
    const found = unzipSync(bytes, { filter: (f) => /(^|\/)manifest\.json$/.test(f.name) && f.originalSize < 8_000_000 });
    for (const [path, data] of Object.entries(found)) {
      if (path.split('/').length > 2) continue;
      const m = obj(JSON.parse(strFromU8(data)));
      if (typeof m.format === 'string' && /^com\.nodemode\.(formvis|canvasor)$/.test(m.format)) return true;
    }
  } catch { /* not a formvis document */ }
  return false;
}

/** Reads a formvis project. Throws a sentence the person can read. */
export function parseFormvis(bytes: Uint8Array, fileName = 'formvis document'): FvDocument {
  let entries: Record<string, Uint8Array>;
  entries = safeUnzipOr(bytes, `${fileName} is not a formvis document (not a ZIP archive).`);
  let root = '';
  let raw: Uint8Array | undefined;
  for (const [path, data] of Object.entries(entries)) {
    const parts = path.replace(/\\/g, '/').split('/');
    if (parts.includes('__MACOSX') || parts[parts.length - 1] !== 'manifest.json' || parts.length > 2) continue;
    raw = data;
    root = parts.length === 2 ? `${parts[0]}/` : '';
    break;
  }
  if (!raw) throw new Error(`${fileName} has no manifest.json, so it is not a formvis document.`);
  let m: Record<string, unknown>;
  try { m = obj(JSON.parse(strFromU8(raw))); } catch { throw new Error(`${fileName}: the manifest is damaged.`); }
  if (typeof m.format !== 'string' || !/^com\.nodemode\.(formvis|canvasor)$/.test(m.format)) throw new Error(`${fileName} is not a formvis document.`);
  if (m.version !== 1) throw new Error(`${fileName} uses format version ${String(m.version)}, which this version cannot read.`);
  const width = Math.round(num(m.width, 0)), height = Math.round(num(m.height, 0));
  if (width < 1 || height < 1) throw new Error(`${fileName}: the canvas size is invalid.`);
  if (width > 30000 || height > 30000 || width * height > 256_000_000) throw new Error(`${fileName}: the canvas is larger than 30000 px a side or 256 megapixels, so it was not opened.`);
  const records = (Array.isArray(m.layers) ? m.layers : []).map(obj);
  const image = (name: string | null): Uint8Array | null => (name ? entries[`${root}images/${name}`] ?? null : null);
  const collapsed = new Set(Array.isArray(m.collapsedFolders) ? m.collapsedFolders.filter((v): v is string => typeof v === 'string') : []);
  const ids = new Set(records.map((r) => str(r.id)).filter((v): v is string => !!v));
  const folders = new Set(records.filter((r) => r.isGroup === true).map((r) => str(r.id) as string));
  const out: FvRead[] = [];
  let adjustments = 0, flattened = 0, styled = 0, options = 0, modes = 0, rotated = 0;
  const kinds = new Set<string>();
  for (const r of records) {
    const id = str(r.id);
    if (!id) continue;
    const group = r.isGroup === true;
    if (!group && (r.adjustment || r.psdAdjustment) && !str(r.imageFile)) { adjustments++; continue; }
    const png = group ? null : image(str(r.imageFile));
    const size = png ? pngSize(png) : null;
    const placement = placementOf(r.transform, size?.w ?? width, size?.h ?? height);
    if (placement.rotation) rotated++;
    const label = str(r.blendMode) ?? 'Normal';
    let blend = FROM_LABEL.get(label);
    if (!blend) { modes++; blend = 'normal'; }
    if (group && r.isolate !== true && blend === 'normal') blend = 'passthrough';
    for (const k of ['text', 'smart', 'smartSourceFile', 'vector', 'video', 'extrude3d', 'fillContent', 'relight']) if (r[k]) { kinds.add(k === 'smartSourceFile' ? 'smart' : k); flattened++; break; }
    if (r.effects && Object.keys(obj(r.effects)).length) styled++;
    if (r.blendIf || (r.knockout && r.knockout !== 'none') || (typeof r.fill === 'number' && r.fill !== 1) || r.vectorMask || r.blendChannels) options++;
    const maskName = str(r.maskFile);
    const mask = image(maskName);
    const locks = obj(r.locks);
    out.push({
      id, name: str(r.name) ?? 'Layer', visible: r.isVisible !== false, opacity: Math.min(1, Math.max(0, num(r.opacity, 1))), blend, group,
      parent: str(r.parentID) && folders.has(str(r.parentID) as string) ? (str(r.parentID) as string) : null,
      collapsed: group && collapsed.has(id), alphaLock: locks.transparency === true || locks.all === true,
      clipping: !!str(r.maskSourceID) && ids.has(str(r.maskSourceID) as string),
      image: png, mask, maskOn: r.maskEnabled !== false, maskLinked: r.maskLinked !== false,
      placement, maskPlacement: r.maskPlacement ? placementOf(r.maskPlacement, width, height) : null,
    });
  }
  const notes: string[] = [];
  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  if (flattened) notes.push(`${plural(flattened, 'layer', 'layers')} (${[...kinds].join(', ')}) kept as pixels.`);
  if (adjustments) notes.push(`${plural(adjustments, 'adjustment layer', 'adjustment layers')} left out.`);
  if (styled) notes.push(`Layer styles on ${plural(styled, 'layer', 'layers')} are not drawn.`);
  if (options) notes.push(`Blending options (Blend If, knockout, fill, vector masks) on ${plural(options, 'layer', 'layers')} are dropped.`);
  if (modes) notes.push(`${plural(modes, 'layer uses', 'layers use')} a blend mode formmorpheus does not have and show${modes === 1 ? 's' : ''} as Normal.`);
  if (rotated) notes.push(`${plural(rotated, 'transformed layer was', 'transformed layers were')} baked in place.`);
  const id = str(m.documentID);
  // bottom to top in the file; a Drawing lists top first
  return { name: fileName.replace(/\.[^.]+$/, ''), width, height, layers: out.reverse(), documentId: id, notes };
}
