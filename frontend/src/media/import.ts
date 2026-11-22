// Turns a dropped or picked file into assets and content for the movie: pictures, animated pictures
// (a Flipbook row), video, sound and fonts. Nothing here touches the movie; the caller places the result.
import type { Asset, Content, FlipTrack, FlipbookFrame, Movie } from '../engine/types';
import { content, drawingLayer, identity, uid } from '../engine/model';
import { memory } from '../platform/ipad-memory';
import { formvfxToTracks, formvisToDrawing, sniffRoundTrip } from '../io/round-trip';
import { registerFont } from './fonts';
import { isCollection, splitCollection } from './fonts-ttc';
import { addToLibrary } from '../io/fonts-library';

/** An imported font is also installed in the app-wide Fonts library (the engine keeps it in the data folder). */
const keepInLibrary = (blob: Blob, fileName: string, family: string): Promise<boolean> => addToLibrary(blob, fileName, family, registerFont);
import { importScale } from './import-size';
import { gifFrames, gifInfo, isGif } from './gif-decode';
import { decodeTiff, isTiff } from './tiff-decode';
import { decodeTga, isTga } from './tga-decode';
import { showsAlpha, transcodeViaEngine } from './transcode';
import { tf } from '../ui/i18n-fill';
import { UndecodableVideo, VideoPool } from './video';
import { layeredToDrawing } from '../io/layered-import';
import { isKra, readKra } from '../io/kra-import';
import { isOra, readOra } from '../io/ora-import';
import { isPdn, readPdn } from '../io/pdn-import';
import { isPsd, readPsd } from '../io/psd-import';
import { isTiledArtwork, readTiledArtwork } from '../io/tiled-artwork-import';
import { sniffProject } from '../io/project-sniff';
import { tn } from '../ui/i18n';

export interface ImportResult {
  assets: { asset: Asset; blob: Blob }[];
  contents: Content[];
  ownTrack: boolean[];
  notice?: string;
  /** A formvis document that left from this Drawing: the caller swaps its layers for the new content's. */
  replaces?: string;
}

type Sniff = 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'bmp' | 'tiff' | 'tga' | 'heic' | 'psd' | 'ora' | 'kra' | 'pdn' | 'tiled-artwork' | 'font' | 'media' | 'unknown';

const EXT: Record<string, Sniff> = {
  png: 'png', apng: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp', avif: 'avif', bmp: 'bmp', tif: 'tiff', tiff: 'tiff',
  tga: 'tga', targa: 'tga', heic: 'heic', heif: 'heic', hif: 'heic', psd: 'psd', psb: 'psd', ora: 'ora', kra: 'kra', krz: 'kra', pdn: 'pdn',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font', ttc: 'font',
  mp4: 'media', m4v: 'media', mov: 'media', webm: 'media', mkv: 'media', ogv: 'media', ogg: 'media', oga: 'media', opus: 'media',
  wav: 'media', mp3: 'media', aac: 'media', m4a: 'media', flac: 'media', mpg: 'media', mpeg: 'media', ts: 'media',
  aif: 'media', aiff: 'media', aifc: 'media', caf: 'media', ac3: 'media', eac3: 'media', mp2: 'media', mxf: 'media', avi: 'media', wmv: 'media',
};

/** Brands of an ISO file that mark a HEIC or HEIF picture rather than a video. */
const HEIF_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'];

function ascii(b: Uint8Array, at: number, s: string): boolean {
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
}

function sniff(file: File, b: Uint8Array, tail?: Uint8Array): Sniff {
  if (b[0] === 0x89 && ascii(b, 1, 'PNG')) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (ascii(b, 0, 'GIF8')) return 'gif';
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'webp';
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return 'media';
  if (ascii(b, 4, 'ftyp') && (ascii(b, 8, 'avif') || ascii(b, 8, 'avis'))) return 'avif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (isTiff(b)) return 'tiff';
  if (isPsd(b)) return 'psd';
  if (ascii(b, 4, 'ftyp') && HEIF_BRANDS.some((x) => ascii(b, 8, x))) return 'heic';
  if (ascii(b, 0, 'FORM') && (ascii(b, 8, 'AIFF') || ascii(b, 8, 'AIFC'))) return 'media';
  if (ascii(b, 0, 'caff') || (b[0] === 0x0b && b[1] === 0x77)) return 'media';
  if (isTga(b, file.name, tail)) return 'tga';
  if (isOra(file.name, b)) return 'ora';
  if (isKra(file.name, b)) return 'kra';
  if (isPdn(file.name, b)) return 'pdn';
  if (isTiledArtwork(file.name, b)) return 'tiled-artwork';
  if (ascii(b, 0, 'OTTO') || ascii(b, 0, 'true') || ascii(b, 0, 'wOFF') || ascii(b, 0, 'wOF2') || ascii(b, 0, 'ttcf') || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'font';
  if (ascii(b, 4, 'ftyp') || (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) || ascii(b, 0, 'OggS') || ascii(b, 0, 'fLaC') || ascii(b, 0, 'ID3')) return 'media';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'media';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT[ext] ?? 'unknown';
}

const baseName = (n: string): string => n.replace(/\.[^.]+$/, '') || n;


function place(m: Movie, w: number, h: number): Content['transform'] {
  return { ...identity(), scale: importScale(m.width, m.height, w, h) };
}

// ---- pictures

/** HEIC / HEIF as PNG: the browser's ImageDecoder where it has the codec, else the engine when it can (pillow-heif), else a refusal. */
async function heicToPng(file: File): Promise<Blob> {
  const ID = (globalThis as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  if (ID) {
    for (const type of ['image/heic', 'image/heif']) {
      try {
        if (!(await ID.isTypeSupported(type))) continue;
        const dec = new ID({ data: await file.arrayBuffer(), type });
        try {
          const { image } = await dec.decode({ frameIndex: 0 });
          const cv = new OffscreenCanvas(image.displayWidth, image.displayHeight);
          cv.getContext('2d')!.drawImage(image, 0, 0);
          image.close();
          return await cv.convertToBlob({ type: 'image/png' });
        } finally { dec.close(); }
      } catch { /* try the next route */ }
    }
  }
  try {
    const bmp = await createImageBitmap(file);   // some browsers decode HEIC natively
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    cv.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    return await cv.convertToBlob({ type: 'image/png' });
  } catch { /* not in this browser */ }
  try {
    return (await transcodeViaEngine(file, 'image')).blob;
  } catch (e) {
    throw new Error(`${file.name} is a HEIC picture this browser cannot open. ${e instanceof Error ? e.message : ''}`.trim());
  }
}

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
  } else if (kind === 'tga') {
    let dec: ReturnType<typeof decodeTga>;
    try { dec = decodeTga(new Uint8Array(await file.arrayBuffer())); } catch (e) {
      throw new Error(`${file.name} is a TGA this version cannot read (${e instanceof Error ? e.message : 'unsupported'}).`);
    }
    const cv = new OffscreenCanvas(dec.width, dec.height);
    cv.getContext('2d')!.putImageData(new ImageData(dec.rgba as Uint8ClampedArray<ArrayBuffer>, dec.width, dec.height), 0, 0);
    blob = await cv.convertToBlob({ type: 'image/png' });
    mime = 'image/png';
    bmp = await createImageBitmap(blob);
  } else if (kind === 'heic') {
    blob = await heicToPng(file);
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
/** RGBA bytes of source pictures one animation import may decode. */
const maxDecodeBytes = (): number => memory.get('decodeBytes');

interface RawFrame { image: CanvasImageSource | null; rgba: Uint8ClampedArray | null; w: number; h: number; delayMs: number }

/** Pictures pulled one at a time, so a huge animation is never held whole in memory. */
interface FrameSource {
  /** Calls arrive in order; an async source must answer them in the same order. */
  next(): RawFrame | null | Promise<RawFrame | null>;
  total: number; limit: number; cap: 'count' | 'memory';
  /** Called once when the import is over, however it ended. */
  close?: () => void;
}

/** Builds the Flipbook content for a stream of picture frames (each a PNG asset the size of the movie). */
async function flipbookFrom(src: FrameSource, name: string, m: Movie, at: number): Promise<ImportResult> {
  // every frame becomes a movie-sized picture: the source is cut at a count and a memory budget so a huge animation cannot exhaust memory
  const W = m.width;
  const H = m.height;
  const assets: { asset: Asset; blob: Blob }[] = [];
  const out: FlipbookFrame[] = [];
  let cum = 0;
  let prevEnd = 0;
  const jobs: Promise<void>[] = [];
  const delays: number[] = [];
  const run = async (i: number, f: RawFrame): Promise<void> => {
    delays[i] = f.delayMs;
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
        if (nextIndex >= src.limit) return;
        // the index is taken before the (possibly async) pull so frames keep their order
        const i = nextIndex++;
        const f = await src.next();
        if (!f) return;
        await run(i, f);
        f.rgba = null;
        if (f.image && 'close' in (f.image as object)) (f.image as ImageBitmap).close();
        f.image = null;
      }
    })());
  }
  try { await Promise.all(jobs); } finally { src.close?.(); }
  const count = delays.length;
  if (!count) throw new Error(`${name} has no readable pictures.`);
  const cut = src.total > count ? ` Only the first ${count} of ${src.total} pictures were imported (${src.cap === 'memory' ? 'memory budget' : `${MAX_ANIMATION_FRAMES} picture limit`}).` : '';
  for (let i = 0; i < count; i++) {
    cum += delays[i] / 1000;
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
  return { assets, contents: [c], ownTrack: [false], notice: `${count} pictures, ${(prevEnd / m.fps).toFixed(1)} s at ${m.fps} fps.${cut}` };
}

interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(o: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
}
type ImageDecoderCtor = (new (init: { data: ArrayBuffer; type: string }) => ImageDecoderLike) & { isTypeSupported(t: string): Promise<boolean> };

/** Animated WebP, APNG or AVIF through the browser's ImageDecoder, one picture at a time under the same count and
 *  memory budget as a GIF; null when the file is a still or unsupported. */
async function viaImageDecoder(file: File, type: string): Promise<FrameSource | null> {
  const ID = (globalThis as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
  if (!ID || !(await ID.isTypeSupported(type))) return null;
  const dec = new ID({ data: await file.arrayBuffer(), type });
  let closed = false;
  const close = (): void => { if (!closed) { closed = true; dec.close(); } };
  try {
    await dec.tracks.ready;
    const count = dec.tracks.selectedTrack?.frameCount ?? 1;
    if (count < 2) { close(); return null; }
    let at = 0;
    const pull = async (): Promise<RawFrame | null> => {
      if (closed || at >= count) return null;
      try {
        const { image } = await dec.decode({ frameIndex: at++ });
        const bmp = await createImageBitmap(image);
        const delayMs = image.duration ? image.duration / 1000 : 100;
        image.close();
        return { image: bmp, rgba: null, w: bmp.width, h: bmp.height, delayMs: delayMs <= 10 ? 100 : delayMs };
      } catch { return null; }
    };
    // the first picture sizes the memory budget; later pulls are chained so they answer in order
    const first = await pull();
    if (!first) { close(); return null; }
    const byMemory = Math.max(1, Math.floor(maxDecodeBytes() / (first.w * first.h * 4)));
    let chain: Promise<unknown> = Promise.resolve();
    let served = false;
    return {
      next: () => {
        if (!served) { served = true; return first; }
        const p = chain.then(pull);
        chain = p.catch(() => undefined);
        return p;
      },
      total: count,
      limit: Math.min(MAX_ANIMATION_FRAMES, byMemory),
      cap: byMemory < MAX_ANIMATION_FRAMES ? 'memory' : 'count',
      close,
    };
  } catch {
    close();
    return null;
  }
}

async function importAnimated(file: File, m: Movie, at: number, kind: Sniff): Promise<ImportResult | null> {
  if (kind === 'gif') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isGif(bytes)) return null;
    let info: ReturnType<typeof gifInfo>;
    try { info = gifInfo(bytes); } catch { throw new Error(`${file.name} is a damaged GIF.`); }
    if (info.count < 2) return null;
    // streamed: one picture at a time is composed and encoded, so a 4K GIF never sits in memory whole
    const byMemory = Math.max(1, Math.floor(maxDecodeBytes() / (info.width * info.height * 4)));
    const it = gifFrames(bytes);
    const src: FrameSource = {
      next: () => {
        try {
          const r = it.next();
          return r.done ? null : { image: null, rgba: r.value.rgba, w: info.width, h: info.height, delayMs: r.value.delayMs };
        } catch { return null; }
      },
      total: info.count,
      limit: Math.min(MAX_ANIMATION_FRAMES, byMemory),
      cap: byMemory < MAX_ANIMATION_FRAMES ? 'memory' : 'count',
    };
    return flipbookFrom(src, baseName(file.name), m, at);
  }
  if (kind === 'webp' || kind === 'png' || kind === 'avif') {
    const type = file.type || (kind === 'png' ? 'image/png' : `image/${kind}`);
    const src = await viaImageDecoder(file, type);
    if (src) return flipbookFrom(src, baseName(file.name), m, at);
    // no ImageDecoder for it: the first picture only, and the notice says so (the engine's ffmpeg reads neither animated
    // WebP nor AVIF, and no picture library is installed with it, so there is no engine route to the pictures)
    if (await isAnimatedPicture(file, kind)) {
      const first = await importPicture(file, m, at, kind);
      return { ...first, notice: tf('Only the first picture of {name} was imported: this system cannot read animated WebP, APNG or AVIF. Convert it to a GIF to bring in every picture.', { name: file.name }) };
    }
  }
  return null;
}

/** True when the file's own headers say it holds more than one picture (animated WebP, APNG, AVIF sequence). */
async function isAnimatedPicture(file: Blob, kind: Sniff): Promise<boolean> {
  const b = new Uint8Array(await file.slice(0, 1 << 18).arrayBuffer());
  if (kind === 'webp') {
    // RIFF....WEBPVP8X: the animation flag is bit 1 of the flags byte, the ANIM chunk follows
    return ascii(b, 12, 'VP8X') && (b[20] & 0x02) !== 0;
  }
  if (kind === 'avif') {
    // an AVIF image sequence names the 'avis' brand among the first bytes
    for (let i = 8; i + 4 <= Math.min(b.length, 64); i += 4) if (ascii(b, i, 'avis')) return true;
    return false;
  }
  if (kind === 'png') {
    // chunks are length, type, data, crc; acTL sits before the first IDAT
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let at = 8;
    while (at + 8 <= b.length) {
      if (ascii(b, at + 4, 'acTL')) return at + 16 <= b.length && dv.getUint32(at + 8) > 1;
      if (ascii(b, at + 4, 'IDAT')) return false;
      at += 12 + dv.getUint32(at);
    }
  }
  return false;
}

// ---- video and sound

const RISKY_SOUND = /\.(aif|aiff|aifc|caf|ac3|eac3|mp2)$/i;

async function browserDecodes(file: Blob): Promise<number | null> {
  try {
    const ctx = new AudioContext();
    try { return (await ctx.decodeAudioData(await file.arrayBuffer())).duration; } finally { void ctx.close(); }
  } catch { return null; }
}

async function importTimed(source: File, m: Movie, at: number, onProgress?: (p: number, what: string) => void): Promise<ImportResult> {
  let file = source;
  let info: Awaited<ReturnType<typeof VideoPool.probe>> | null = null;
  const name = baseName(source.name);
  let lostAlpha = '';
  try { info = await VideoPool.probe(file); } catch (e) {
    if (!(e instanceof UndecodableVideo)) info = null;
    else {
      // no video decoder at all: converting would give a file this window cannot play either, so say what fixes it
      if (typeof VideoDecoder === 'undefined') throw new Error(tf('{name} is a video this system cannot play: its web component has no video decoder. Update the system (macOS 13 or later, or a system web component from version 2.44 on with its media codec packages installed).', { name: source.name }));
      // ProRes, some HEVC and alpha video: the engine converts it to a file the browser decodes
      const out = await transcodeViaEngine(source, 'video', (p) => onProgress?.(p, `Converting ${source.name}`)).catch((er: unknown) => {
        throw new Error(`${source.name}: ${e.message} ${er instanceof Error ? er.message : ''}`.trim());
      });
      file = new File([out.blob], `${name}.${out.mime === 'video/webm' ? 'webm' : out.mime === 'video/quicktime' ? 'mov' : 'mp4'}`, { type: out.mime });
      try { info = await VideoPool.probe(file); } catch { throw new Error(tf('{name} was converted by the engine, but this system still cannot play it. Update the system web component or its media codec packages.', { name: source.name })); }
      if (out.alpha && (await showsAlpha(file)) === false) lostAlpha = tf('{name} was converted with its transparency, but this device shows its first frame with none, so it may play without transparency here.', { name: source.name });
    }
  }
  // a risky sound is decoded once; the length it gave is reused below
  let decoded: number | null | undefined;
  const decodes = async (): Promise<number | null> => (decoded === undefined ? (decoded = await browserDecodes(file)) : decoded);
  if (info && !info.hasVideo && RISKY_SOUND.test(source.name) && (await decodes()) === null) info = null;
  if (!info && RISKY_SOUND.test(source.name) && (await decodes()) === null) {
    const out = await transcodeViaEngine(source, 'audio', (p) => onProgress?.(p, `Converting ${source.name}`)).catch((er: unknown) => {
      throw new Error(`${source.name} is a sound this browser cannot decode. ${er instanceof Error ? er.message : ''}`.trim());
    });
    file = new File([out.blob], `${name}.wav`, { type: 'audio/wav' });
    info = null;
    decoded = undefined;   // the converted file is a different one
  }
  if (info && info.hasVideo) {
    const seconds = Math.max(info.duration, 1 / m.fps);
    const frames = Math.max(1, Math.round(seconds * m.fps));
    const asset: Asset = {
      id: uid('a'), kind: 'video', name, mime: file.type || info.mime, width: info.width, height: info.height,
      frames, size: file.size, seconds, hasAudio: info.hasAudio,
    };
    const room = Math.max(1, m.duration - at);
    const c = content('video', at, Math.max(1, Math.min(frames, room)), { name, asset: asset.id, transform: place(m, info.width, info.height) });
    return { assets: [{ asset, blob: file }], contents: [c], ownTrack: [false], notice: [lostAlpha, info.hasAudio ? '' : 'This video has no sound.'].filter(Boolean).join(' ') || undefined };
  }
  let seconds = info?.duration ?? 0;
  let mime = file.type || info?.mime || 'audio/mpeg';
  if (!info) {
    // not a container mediabunny knows: let the browser try to decode it as sound
    const secs = await decodes();
    if (secs === null) throw new Error(`${file.name} is not a video or sound this browser can decode.`);
    seconds = secs;
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
  // a collection (.ttc): every face becomes a font of its own, so all of them appear in Text
  if (isCollection(bytes)) {
    const faces = splitCollection(bytes);
    if (!faces.length) throw new Error(`${file.name} is not a font this browser can load.`);
    const made: ImportResult['assets'] = [];
    const names: string[] = [];
    for (let i = 0; i < faces.length; i++) {
      const blob = new Blob([faces[i].buffer as ArrayBuffer], { type: 'font/ttf' });
      const fam = (sfntFamily(faces[i]) ?? `${baseName(file.name)} ${i + 1}`).replace(/["\\]/g, '');
      const asset: Asset = { id: uid('a'), kind: 'font', name: `${baseName(file.name)} ${i + 1}`, mime: 'font/ttf', width: 0, height: 0, frames: 0, size: blob.size, family: fam };
      try { await registerFont(asset.id, fam, blob); } catch { continue; }
      made.push({ asset, blob });
      if (!names.includes(fam)) names.push(fam);
      void keepInLibrary(blob, `${asset.name}.ttf`, fam);
    }
    if (!made.length) throw new Error(`${file.name} is not a font this browser can load.`);
    return { assets: made, contents: [], ownTrack: [], notice: `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} ready for Text.` };
  }
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
  void keepInLibrary(file, `${baseName(file.name)}.${ext}`, family);
  return { assets: [{ asset, blob: file }], contents: [], ownTrack: [], notice: `${family} is ready for Text.` };
}

// ---- numbered picture sequences

const SEQ_EXT = /\.(png|jpe?g|webp|bmp|avif)$/i;
const SEQ_NAME = /^(.*?)(\d+)(\.[^.]+)$/;

/** The largest run of at least three pictures whose names differ only by a number (frame_001.png, frame_002.png ...),
 *  in numeric order; null when there is none. */
export function findSequence(files: File[]): File[] | null {
  const groups = new Map<string, { n: number; f: File }[]>();
  for (const f of files) {
    if (!SEQ_EXT.test(f.name)) continue;
    const m = SEQ_NAME.exec(f.name);
    if (!m) continue;
    const key = `${m[1]}\u0000${m[3].toLowerCase()}`;
    const g = groups.get(key) ?? [];
    g.push({ n: Number(m[2]), f });
    groups.set(key, g);
  }
  let best: { n: number; f: File }[] | null = null;
  for (const g of groups.values()) if (g.length >= 3 && new Set(g.map((x) => x.n)).size === g.length && (!best || g.length > best.length)) best = g;
  return best ? best.sort((a, b) => a.n - b.n).map((x) => x.f) : null;
}

/** A numbered picture sequence as one Flipbook at `fps` pictures per second (the names carry no rate). */
export async function importSequence(files: File[], movie: Movie, at: number, fps: number): Promise<ImportResult> {
  const m = SEQ_NAME.exec(files[0].name);
  const name = (m ? m[1] : baseName(files[0].name)).replace(/[\s._-]+$/, '') || 'Frames';
  const rate = Math.min(240, Math.max(1, fps));
  let first: ImageBitmap;
  try { first = await createImageBitmap(files[0]); } catch { throw new Error(tf('{name} could not be read as a picture.', { name: files[0].name })); }
  const byMemory = Math.max(1, Math.floor(maxDecodeBytes() / (first.width * first.height * 4)));
  let at0 = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const pull = async (): Promise<RawFrame | null> => {
    const i = at0++;
    if (i >= files.length) return null;
    try {
      const bmp = i === 0 ? first : await createImageBitmap(files[i]);
      return { image: bmp, rgba: null, w: bmp.width, h: bmp.height, delayMs: 1000 / rate };
    } catch { return null; }
  };
  const src: FrameSource = {
    // chained so the lanes in flipbookFrom are answered in file order
    next: () => { const p = chain.then(pull); chain = p.catch(() => undefined); return p; },
    total: files.length,
    limit: Math.min(MAX_ANIMATION_FRAMES, byMemory, files.length),
    cap: byMemory < MAX_ANIMATION_FRAMES ? 'memory' : 'count',
  };
  const r = await flipbookFrom(src, name, movie, at);
  return { ...r, notice: tf('{n} numbered pictures became one Flipbook at {fps} frames per second.', { n: r.contents[0]?.flip?.[0]?.frames.length ?? files.length, fps: rate }) + (r.notice?.includes('Only the first') ? r.notice.slice(r.notice.indexOf(' Only the first')) : '') };
}

// ---- project files from other animation apps

/** Reads nothing of the timeline: only plain media found inside the container is lifted out, into the media bin. */
async function importProjectFile(file: File, movie: Movie, at: number): Promise<ImportResult> {
  const whole = tf('{name} is a project file from another animation app. Its format is not publicly documented, so the timeline, keyframes and drawings cannot be read here. To bring your work over, open it in that app and export a video of the finished picture, a numbered PNG frame sequence (note its frame rate), or an animated GIF, then import that. Layered artwork saved as .procreate, .psd, .ora or .kra files can be imported as it is. If the project was made with an older version of that app, upgrade it there first.', { name: file.name });
  const sn = await sniffProject(file);
  if (sn.container === 'unknown' || sn.container === 'bplist') {
    throw new Error(sn.container === 'bplist'
      ? tf('{name} could not be read. It is a property list, not a container that holds media, so nothing from it was imported. In the app that made it, export a video, a numbered PNG frame sequence or an animated GIF, then import those.', { name: file.name })
      : tf('{name} could not be read. It is not a container this app recognises, so nothing from it was imported. In the app that made it, export a video, a numbered PNG frame sequence or an animated GIF, then import those.', { name: file.name }));
  }
  if (!sn.media.length) throw new Error(whole);
  const out: ImportResult = { assets: [], contents: [], ownTrack: [] };
  let pictures = 0, videos = 0, sounds = 0;
  for (const f of sn.media) {
    try {
      const r = await importMedia(f.file, movie, at);
      // the media bin only: the timeline of the project is not rebuilt, so nothing is placed
      out.assets.push(...r.assets);
      if (f.kind === 'picture') pictures++; else if (f.kind === 'video') videos++; else sounds++;
    } catch { /* an entry that does not decode is left out of the count */ }
  }
  if (!out.assets.length) throw new Error(whole);
  const parts: string[] = [];
  if (pictures) parts.push(tn(pictures, '{n} picture', '{n} pictures'));
  if (videos) parts.push(tn(videos, '{n} video', '{n} videos'));
  if (sounds) parts.push(tn(sounds, '{n} sound', '{n} sounds'));
  out.notice = tf('Part of this project was read. {found} found and added to the media bin. The timeline, keyframes, effects and undo history cannot be read because their format is not documented. To bring over the full picture, export a video, a numbered PNG frame sequence or an animated GIF from the app that made it.', { found: parts.join(', ') })
    + (sn.extra ? ' ' + tf('{n} more items were left out.', { n: sn.extra }) : '');
  return out;
}

export async function importMedia(file: File, movie: Movie, at: number, onProgress?: (p: number, what: string) => void): Promise<ImportResult> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  // a TGA 2.0 file is told by the footer at its end, not by anything at the start
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 26)).arrayBuffer());
  const kind0 = sniff(file, head, tail);
  // layered artwork: each reader gives a neutral document that becomes a Drawing with its layers
  if (kind0 === 'psd' || kind0 === 'ora' || kind0 === 'kra' || kind0 === 'pdn' || kind0 === 'tiled-artwork') {
    const doc = await (kind0 === 'psd' ? readPsd(file) : kind0 === 'ora' ? readOra(file) : kind0 === 'kra' ? readKra(file) : kind0 === 'tiled-artwork' ? readTiledArtwork(file) : readPdn(file));
    return layeredToDrawing(doc, file.name, movie, at);
  }
  const trip = await sniffRoundTrip(file, head);
  if (trip === 'formvis') return formvisToDrawing(file, movie, at);
  if (trip === 'formvfx') return formvfxToTracks(file, movie);
  const kind = kind0;
  switch (kind) {
    case 'font': return importFont(file);
    case 'media': return importTimed(file, movie, at, onProgress);
    case 'png': case 'jpeg': case 'gif': case 'webp': case 'avif': case 'bmp': case 'tiff': case 'tga': case 'heic': {
      const anim = await importAnimated(file, movie, at, kind);
      return anim ?? importPicture(file, movie, at, kind);
    }
    default:
      if (/\.drm$/i.test(file.name)) return importProjectFile(file, movie, at);
      throw new Error(`${file.name} is not a picture, video, sound or font FormMorpheus can place.`);
  }
}
