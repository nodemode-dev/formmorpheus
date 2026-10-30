// Turns a dropped or picked file into assets and content for the movie: pictures, animated pictures
// (a Flipbook row), video, sound and fonts. Nothing here touches the movie; the caller places the result.
import type { Asset, Content, FlipTrack, FlipbookFrame, Movie } from '../engine/types';
import { content, drawingLayer, identity, uid } from '../engine/model';
import { registerFont } from './fonts';
import { decodeGif, isGif } from './gif-decode';
import { decodeTiff, isTiff } from './tiff-decode';
import { UndecodableVideo, VideoPool } from './video';

export interface ImportResult {
  assets: { asset: Asset; blob: Blob }[];
  contents: Content[];
  ownTrack: boolean[];
  notice?: string;
}

type Sniff = 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'bmp' | 'tiff' | 'font' | 'media' | 'unknown';

const EXT: Record<string, Sniff> = {
  png: 'png', apng: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp', avif: 'avif', bmp: 'bmp', tif: 'tiff', tiff: 'tiff',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font', ttc: 'font',
  mp4: 'media', m4v: 'media', mov: 'media', webm: 'media', mkv: 'media', ogv: 'media', ogg: 'media', oga: 'media', opus: 'media',
  wav: 'media', mp3: 'media', aac: 'media', m4a: 'media', flac: 'media', mpg: 'media', mpeg: 'media', ts: 'media',
};

function ascii(b: Uint8Array, at: number, s: string): boolean {
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
}

function sniff(file: File, b: Uint8Array): Sniff {
  if (b[0] === 0x89 && ascii(b, 1, 'PNG')) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (ascii(b, 0, 'GIF8')) return 'gif';
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'webp';
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return 'media';
  if (ascii(b, 4, 'ftyp') && (ascii(b, 8, 'avif') || ascii(b, 8, 'avis'))) return 'avif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (isTiff(b)) return 'tiff';
  if (ascii(b, 0, 'OTTO') || ascii(b, 0, 'true') || ascii(b, 0, 'wOFF') || ascii(b, 0, 'wOF2') || ascii(b, 0, 'ttcf') || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'font';
  if (ascii(b, 4, 'ftyp') || (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) || ascii(b, 0, 'OggS') || ascii(b, 0, 'fLaC') || ascii(b, 0, 'ID3')) return 'media';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'media';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT[ext] ?? 'unknown';
}

const baseName = (n: string): string => n.replace(/\.[^.]+$/, '') || n;

/** Scale that fits a picture inside the movie without enlarging it (as a dropped Image does). */
function fit(m: Movie, w: number, h: number): number {
  return Math.round(Math.min(1, m.width / w, m.height / h) * 1000) / 1000;
}

function place(m: Movie, w: number, h: number): Content['transform'] {
  return { ...identity(), scale: fit(m, w, h) };
}

// ---- pictures

async function importPicture(file: File, m: Movie, at: number, kind: Sniff): Promise<ImportResult> {
  let blob: Blob = file;
  let bmp: ImageBitmap;
  let mime = file.type;
  if (kind === 'tiff') {
    let dec: ReturnType<typeof decodeTiff>;
    try { dec = decodeTiff(new Uint8Array(await file.arrayBuffer())); } catch (e) {
      throw new Error(`${file.name} is a TIFF this version cannot read (${e instanceof Error ? e.message : 'unsupported'}).`);
    }
    const cv = new OffscreenCanvas(dec.width, dec.height);
    cv.getContext('2d')!.putImageData(new ImageData(dec.rgba as Uint8ClampedArray<ArrayBuffer>, dec.width, dec.height), 0, 0);
    blob = await cv.convertToBlob({ type: 'image/png' });
    mime = 'image/png';
    bmp = await createImageBitmap(blob);
  } else {
    try { bmp = await createImageBitmap(file); } catch { throw new Error(`${file.name} could not be read as a picture.`); }
    if (!mime) mime = kind === 'jpeg' ? 'image/jpeg' : `image/${kind}`;
  }
  const asset: Asset = { id: uid('a'), kind: 'image', name: baseName(file.name), mime, width: bmp.width, height: bmp.height, frames: 0, size: blob.size };
  bmp.close();
  const c = content('image', at, Math.max(1, m.duration - at), { name: asset.name, asset: asset.id, transform: place(m, asset.width, asset.height) });
  return { assets: [{ asset, blob }], contents: [c], ownTrack: [false] };
}

const MAX_ANIMATION_FRAMES = 1000;

interface RawFrame { image: CanvasImageSource | null; rgba: Uint8ClampedArray | null; w: number; h: number; delayMs: number }

/** Builds the Flipbook content for a list of picture frames (each a PNG asset the size of the movie). */
async function flipbookFrom(all: RawFrame[], name: string, m: Movie, at: number): Promise<ImportResult> {
  // every frame becomes a movie-sized picture: cap how many so a huge animation cannot exhaust memory
  const frames = all.slice(0, MAX_ANIMATION_FRAMES);
  const cut = all.length > frames.length ? ` Only the first ${MAX_ANIMATION_FRAMES} of ${all.length} pictures were imported.` : '';
  const W = m.width;
  const H = m.height;
  const assets: { asset: Asset; blob: Blob }[] = [];
  const out: FlipbookFrame[] = [];
  let cum = 0;
  let prevEnd = 0;
  const jobs: Promise<void>[] = [];
  const run = async (i: number): Promise<void> => {
    const f = frames[i];
    const cv = new OffscreenCanvas(W, H);
    const ctx = cv.getContext('2d')!;
    const s = Math.min(1, W / f.w, H / f.h);
    const dw = f.w * s;
    const dh = f.h * s;
    if (f.rgba) {
      const tmp = new OffscreenCanvas(f.w, f.h);
      tmp.getContext('2d')!.putImageData(new ImageData(f.rgba as Uint8ClampedArray<ArrayBuffer>, f.w, f.h), 0, 0);
      ctx.drawImage(tmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else if (f.image) {
      ctx.drawImage(f.image, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
    const blob = await cv.convertToBlob({ type: 'image/png' });
    const asset: Asset = { id: uid('a'), kind: 'pixels', name: `${name} ${i + 1}`, mime: 'image/png', width: W, height: H, frames: 0, size: blob.size };
    assets[i] = { asset, blob };
  };
  // encode a few at a time so a long animation does not hold every canvas at once
  const lanes = 4;
  let nextIndex = 0;
  for (let l = 0; l < lanes; l++) {
    jobs.push((async () => {
      for (;;) {
        const i = nextIndex++;
        if (i >= frames.length) return;
        await run(i);
        frames[i].rgba = null;
        if (frames[i].image && 'close' in (frames[i].image as object)) (frames[i].image as ImageBitmap).close();
        frames[i].image = null;
      }
    })());
  }
  await Promise.all(jobs);
  for (let i = 0; i < frames.length; i++) {
    cum += frames[i].delayMs / 1000;
    const end = Math.round(cum * m.fps);
    const hold = Math.max(1, end - prevEnd);
    prevEnd += hold;
    const layer = drawingLayer('Picture');
    layer.pixels = assets[i].asset.id;
    out.push({ id: uid('f'), hold, layers: [layer] });
  }
  const row: FlipTrack = { id: uid('ft'), name: 'Row 1', hidden: false, opacity: 1, blend: 'normal', highlight: 'none', frames: out };
  const total = out.reduce((n, f) => n + f.hold, 0);
  const c = content('flipbook', at, Math.max(1, total), { name, flip: [row] });
  return { assets, contents: [c], ownTrack: [false], notice: `${frames.length} pictures, ${(prevEnd / m.fps).toFixed(1)} s at ${m.fps} fps.${cut}` };
}

interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(o: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
}
type ImageDecoderCtor = (new (init: { data: ArrayBuffer; type: string }) => ImageDecoderLike) & { isTypeSupported(t: string): Promise<boolean> };

/** Animated WebP, APNG or AVIF through the browser's ImageDecoder; null when the file is a still or unsupported. */
async function viaImageDecoder(file: File, type: string): Promise<RawFrame[] | null> {
  const ID = (globalThis as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  if (!ID || !(await ID.isTypeSupported(type))) return null;
  const dec = new ID({ data: await file.arrayBuffer(), type });
  try {
    await dec.tracks.ready;
    const n = Math.min(MAX_ANIMATION_FRAMES, dec.tracks.selectedTrack?.frameCount ?? 1);
    if (n < 2) return null;
    const frames: RawFrame[] = [];
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const bmp = await createImageBitmap(image);
      const delayMs = image.duration ? image.duration / 1000 : 100;
      frames.push({ image: bmp, rgba: null, w: bmp.width, h: bmp.height, delayMs: delayMs <= 10 ? 100 : delayMs });
      image.close();
    }
    return frames;
  } catch {
    return null;
  } finally {
    dec.close();
  }
}

async function importAnimated(file: File, m: Movie, at: number, kind: Sniff): Promise<ImportResult | null> {
  if (kind === 'gif') {
    let gif: ReturnType<typeof decodeGif>;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isGif(bytes)) return null;
    try { gif = decodeGif(bytes); } catch { throw new Error(`${file.name} is a damaged GIF.`); }
    if (gif.frames.length < 2) return null;
    return flipbookFrom(gif.frames.map((f) => ({ image: null, rgba: f.rgba, w: gif.width, h: gif.height, delayMs: f.delayMs })), baseName(file.name), m, at);
  }
  if (kind === 'webp' || kind === 'png' || kind === 'avif') {
    const type = file.type || (kind === 'png' ? 'image/png' : `image/${kind}`);
    const frames = await viaImageDecoder(file, type);
    if (frames) return flipbookFrom(frames, baseName(file.name), m, at);
  }
  return null;
}

// ---- video and sound

async function importTimed(file: File, m: Movie, at: number): Promise<ImportResult> {
  let info: Awaited<ReturnType<typeof VideoPool.probe>> | null = null;
  try { info = await VideoPool.probe(file); } catch (e) { if (e instanceof UndecodableVideo) throw new Error(`${file.name}: ${e.message}`); info = null; }
  const name = baseName(file.name);
  if (info && info.hasVideo) {
    const seconds = Math.max(info.duration, 1 / m.fps);
    const frames = Math.max(1, Math.round(seconds * m.fps));
    const asset: Asset = {
      id: uid('a'), kind: 'video', name, mime: file.type || info.mime, width: info.width, height: info.height,
      frames, size: file.size, seconds, hasAudio: info.hasAudio,
    };
    const room = Math.max(1, m.duration - at);
    const c = content('video', at, Math.max(1, Math.min(frames, room)), { name, asset: asset.id, transform: place(m, info.width, info.height) });
    return { assets: [{ asset, blob: file }], contents: [c], ownTrack: [false], notice: info.hasAudio ? undefined : 'This video has no sound.' };
  }
  let seconds = info?.duration ?? 0;
  let mime = file.type || info?.mime || 'audio/mpeg';
  if (!info) {
    // not a container mediabunny knows: let the browser try to decode it as sound
    try {
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      seconds = buf.duration;
      void ctx.close();
    } catch {
      throw new Error(`${file.name} is not a video or sound this browser can decode.`);
    }
  }
  seconds = Math.max(seconds, 1 / m.fps);
  const frames = Math.max(1, Math.ceil(seconds * m.fps));
  const asset: Asset = { id: uid('a'), kind: 'audio', name, mime, width: 0, height: 0, frames, size: file.size, seconds };
  const c = content('audio', at, frames, { name, asset: asset.id });
  return { assets: [{ asset, blob: file }], contents: [c], ownTrack: [true] };
}

// ---- fonts

/** Family name from an OpenType name table (typographic family first), or null. */
function sfntFamily(b: Uint8Array): string | null {
  if (!(b[0] === 0 || ascii(b, 0, 'OTTO') || ascii(b, 0, 'true'))) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    const n = dv.getUint16(4);
    for (let i = 0; i < n; i++) {
      const r = 12 + i * 16;
      if (!ascii(b, r, 'name')) continue;
      const off = dv.getUint32(r + 8);
      const count = dv.getUint16(off + 2);
      const strings = off + dv.getUint16(off + 4);
      let best: { id: number; s: string } | null = null;
      for (let k = 0; k < count; k++) {
        const e = off + 6 + k * 12;
        const platform = dv.getUint16(e);
        const id = dv.getUint16(e + 6);
        if (id !== 1 && id !== 16) continue;
        const len = dv.getUint16(e + 8);
        const so = strings + dv.getUint16(e + 10);
        let s = '';
        if (platform === 1) for (let j = 0; j < len; j++) s += String.fromCharCode(b[so + j]);
        else for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(dv.getUint16(so + j));
        s = s.trim();
        if (!s) continue;
        if (!best || (id === 16 && best.id !== 16) || (id === best.id && platform !== 1 && best.s.length === 0)) best = { id, s };
      }
      return best ? best.s : null;
    }
  } catch { /* fall through to the file name */ }
  return null;
}

async function importFont(file: File): Promise<ImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const family = (sfntFamily(bytes) ?? baseName(file.name).replace(/[-_](Regular|Bold|Italic|Light|Medium)$/i, '')).replace(/["\\]/g, '');
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'ttf';
  const mime = file.type || (ext === 'otf' ? 'font/otf' : ext === 'woff' ? 'font/woff' : ext === 'woff2' ? 'font/woff2' : 'font/ttf');
  const asset: Asset = { id: uid('a'), kind: 'font', name: baseName(file.name), mime, width: 0, height: 0, frames: 0, size: file.size, family };
  // a face the browser refuses should fail here, not later in Text
  try {
    await registerFont(asset.id, family, file);
  } catch {
    throw new Error(`${file.name} is not a font this browser can load.`);
  }
  return { assets: [{ asset, blob: file }], contents: [], ownTrack: [], notice: `${family} is ready for Text.` };
}

export async function importMedia(file: File, movie: Movie, at: number): Promise<ImportResult> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const kind = sniff(file, head);
  switch (kind) {
    case 'font': return importFont(file);
    case 'media': return importTimed(file, movie, at);
    case 'png': case 'jpeg': case 'gif': case 'webp': case 'avif': case 'bmp': case 'tiff': {
      const anim = await importAnimated(file, movie, at, kind);
      return anim ?? importPicture(file, movie, at, kind);
    }
    default:
      throw new Error(`${file.name} is not a picture, video, sound or font formmorpheus can place.`);
  }
}
