// OpenRaster (.ora) reader, adapted from the family's layered-image reader: a ZIP with stack.xml (topmost layer
// first, groups as nested stacks) and a PNG per layer. Reads positions, opacity, visibility, blend modes, groups and
// the alpha lock.
import { unzipSync } from 'fflate';
import type { BlendMode } from '../engine/types';
import { baseOf, decodePng, noteSet, type LayeredDoc, type LayerSpec } from './layered-import';

const FROM_ORA = new Map<string, BlendMode>([
  ['svg:src-over', 'normal'], ['svg:multiply', 'multiply'], ['svg:screen', 'screen'], ['svg:overlay', 'overlay'], ['svg:darken', 'darken'],
  ['svg:lighten', 'lighten'], ['svg:color-dodge', 'color-dodge'], ['svg:color-burn', 'color-burn'], ['svg:hard-light', 'hard-light'],
  ['svg:soft-light', 'soft-light'], ['svg:difference', 'difference'], ['svg:color', 'color'], ['svg:luminosity', 'luminosity'],
  ['svg:hue', 'hue'], ['svg:saturation', 'saturation'], ['svg:plus', 'add'], ['svg:exclusion', 'exclusion'], ['svg:linear-burn', 'linear-burn'],
  ['svg:vivid-light', 'vivid-light'], ['svg:linear-light', 'linear-light'], ['svg:pin-light', 'pin-light'], ['svg:hard-mix', 'hard-mix'],
  ['svg:subtract', 'subtract'], ['svg:divide', 'divide'], ['svg:darker-color', 'darker-color'], ['svg:lighter-color', 'lighter-color'],
]);

export const isOra = (name: string, head: Uint8Array): boolean => /\.ora$/i.test(name) && head[0] === 0x50 && head[1] === 0x4b;

export async function readOra(file: File): Promise<LayeredDoc> {
  let parts: Record<string, Uint8Array>;
  try { parts = unzipSync(new Uint8Array(await file.arrayBuffer())); } catch { throw new Error(`${file.name} is not a readable OpenRaster file.`); }
  const text = (n: string): string => new TextDecoder().decode(parts[n] ?? new Uint8Array());
  const xml = new DOMParser().parseFromString(text('stack.xml'), 'application/xml');
  const image = xml.querySelector('image');
  if (!image || xml.querySelector('parsererror')) throw new Error(`${file.name}: its stack.xml cannot be read.`);
  const W = Math.round(Number(image.getAttribute('w'))), H = Math.round(Number(image.getAttribute('h')));
  if (!(W >= 1 && H >= 1 && W <= 30000 && H <= 30000)) throw new Error(`${file.name}: its size cannot be opened.`);
  const notes = noteSet();
  const layers: LayerSpec[] = [];
  const num = (e: Element, a: string, d: number): number => { const v = Number(e.getAttribute(a)); return e.hasAttribute(a) && Number.isFinite(v) ? v : d; };
  let n = 0;
  const walk = async (stack: Element, parent: string | null): Promise<void> => {
    for (const e of [...stack.children]) {
      const op = e.getAttribute('composite-op') ?? 'svg:src-over';
      const blend = FROM_ORA.get(op) ?? 'normal';
      if (!FROM_ORA.has(op)) notes.add(`${op} is not a blend mode formmorpheus has; those layers open as Normal.`);
      const base = {
        visible: e.getAttribute('visibility') !== 'hidden', opacity: Math.min(1, Math.max(0, num(e, 'opacity', 1))), blend, parent, clipping: false,
        alphaLock: e.getAttribute('alpha-locked') === 'true' || e.getAttribute('alpha-preserve') === 'true', mask: null,
      };
      if (e.tagName === 'stack') {
        const id = `s${n++}`;
        layers.push({ ...base, id, name: e.getAttribute('name') || 'Group', group: true, pixels: null });
        await walk(e, id);
      } else if (e.tagName === 'layer') {
        const bytes = parts[e.getAttribute('src') ?? ''];
        if (!bytes) { notes.add('Some layers named pictures the file does not hold, and were left out.'); continue; }
        const px = await decodePng(bytes, num(e, 'x', 0), num(e, 'y', 0));
        layers.push({ ...base, id: `s${n++}`, name: e.getAttribute('name') || 'Layer', group: false, pixels: px });
      }
    }
  };
  const top = image.querySelector(':scope > stack');
  if (top) await walk(top, null);
  if (!layers.some((l) => !l.group)) {
    const merged = parts['mergedimage.png'];
    if (!merged) throw new Error(`${file.name} holds no layers and no merged picture.`);
    layers.length = 0;
    layers.push({ id: 'bg', name: 'Background', visible: true, opacity: 1, blend: 'normal', group: false, parent: null, clipping: false, alphaLock: false, pixels: await decodePng(merged), mask: null });
  }
  return { name: baseOf(file.name), width: W, height: H, layers, notes: notes.list() };
}
