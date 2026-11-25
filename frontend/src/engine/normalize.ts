// Load-time normalisation: fills the fields older files lack (a v0.3 movie has no keys, no onion, a flipbook's
// `frames` instead of rows) so no code path meets undefined. Runs on a freshly parsed movie, in memory only: the
// file on disk stays as it was until the person saves. Pure, no DOM.
import { FORMAT_VERSION, type Movie } from './types';
import { hasKind } from './keys';
import './fx/index'; // registers the effect lane kinds before lanes are checked

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
let seq = 0;
const fresh = (prefix: string): string => `${prefix}n${Date.now().toString(36)}${(seq++).toString(36)}`;

function fillId(o: Obj, prefix: string): void {
  if (typeof o.id !== 'string' || !o.id) o.id = fresh(prefix);
}

function lane(l: unknown): Obj | null {
  if (!isObj(l) || typeof l.kind !== 'string') return null;
  l.expanded = bool(l.expanded, false);
  if (!isObj(l.channels)) l.channels = {};
  if (!isObj(l.options)) l.options = {};
  const ch = l.channels as Record<string, unknown>;
  for (const id of Object.keys(ch)) {
    ch[id] = arr(ch[id]).filter(isObj).map((k) => { k.frame = num(k.frame, 0); k.value = num(k.value, 0); k.ease = str(k.ease, 'linear'); return k; });
  }
  return l;
}

/** Splits lanes into the ones this build knows and the rest (from a newer file); the rest ride along under `unknownLanes`. */
function laneSplit(o: Obj): void {
  const all = [...arr(o.keys), ...arr(o.unknownLanes)].map(lane).filter((l): l is Obj => l !== null);
  const known = all.filter((l) => hasKind(l.kind));
  const rest = all.filter((l) => !hasKind(l.kind));
  o.keys = known;
  if (rest.length) o.unknownLanes = rest; else delete o.unknownLanes;
}

function layer(l: unknown, i: number): Obj | null {
  if (!isObj(l)) return null;
  fillId(l, 'l');
  l.name = str(l.name, `Layer ${i + 1}`);
  l.visible = bool(l.visible, true);
  l.opacity = num(l.opacity, 1);
  l.blend = str(l.blend, 'normal');
  l.alphaLock = bool(l.alphaLock, false);
  l.clipping = bool(l.clipping, false);
  if (l.pixels === undefined) l.pixels = null;
  return l;
}

function layerList(v: unknown): Obj[] {
  return arr(v).map(layer).filter((l): l is Obj => l !== null);
}

function flipRow(t: unknown, i: number): Obj | null {
  if (!isObj(t)) return null;
  fillId(t, 'ft');
  t.name = str(t.name, `Track ${i + 1}`);
  t.hidden = bool(t.hidden, false);
  t.opacity = num(t.opacity, 1);
  t.blend = str(t.blend, 'normal');
  t.highlight = str(t.highlight, 'none');
  t.frames = arr(t.frames).filter(isObj).map((f) => {
    fillId(f, 'f');
    f.hold = Math.max(1, num(f.hold, 1));
    f.layers = layerList(f.layers);
    return f;
  });
  return t;
}

function content(c: unknown): Obj | null {
  if (!isObj(c)) return null;
  fillId(c, 'c');
  const kind = str(c.kind, 'drawing');
  c.kind = kind;
  c.name = str(c.name, kind);
  c.start = Math.max(0, num(c.start, 0));
  c.duration = Math.max(1, num(c.duration, 1));
  c.offset = num(c.offset, 0);
  c.opacity = num(c.opacity, 1);
  c.blend = str(c.blend, 'normal');
  c.mask = str(c.mask, 'none');
  c.maskInvert = bool(c.maskInvert, false);
  c.highlight = str(c.highlight, 'none');
  const t = isObj(c.transform) ? c.transform : {};
  c.transform = { ...t, x: num(t.x, 0), y: num(t.y, 0), scale: num(t.scale, 1), rotation: num(t.rotation, 0), flipH: bool(t.flipH, false), flipV: bool(t.flipV, false) };
  if (c.asset === undefined) c.asset = null;
  c.layers = layerList(c.layers);
  // a v0.3 Flipbook kept one row of frames on the content itself
  if (!Array.isArray(c.flip) && kind === 'flipbook' && Array.isArray(c.frames)) {
    c.flip = [{ name: 'Track 1', frames: c.frames }];
  }
  delete c.frames;
  c.flip = arr(c.flip).map(flipRow).filter((t): t is Obj => t !== null);
  if (kind === 'flipbook' && !(c.flip as Obj[]).length) c.flip = [flipRow({ frames: [{ layers: [{}] }] }, 0) as Obj];
  c.onion = isObj(c.onion) ? onion(c.onion) : null;
  laneSplit(c);
  if (!isObj(c.text)) c.text = kind === 'text' ? { text: 'Text', font: 'Inter', size: 160, weight: 600, color: '#111111', align: 'center' } : null;
  c.tracks = trackList(c.tracks);
  c.volume = num(c.volume, 1);
  shapeDef(c, kind);
  character(c, kind);
  return c;
}

/** A character's own fields are checked; fields a newer build added stay as they are and are written back. */
function character(c: Obj, kind: string): void {
  const ch = c.character;
  if (ch === undefined) return;
  if (kind !== 'group' || !isObj(ch)) { delete c.character; return; }
  ch.name = str(ch.name, str(c.name, 'Character'));
  const parts: Record<string, string> = {};
  if (isObj(ch.parts)) for (const [k, v] of Object.entries(ch.parts)) if (typeof v === 'string' && v) parts[k] = v;
  ch.parts = parts;
  if (typeof ch.mouth !== 'string' || !ch.mouth) delete ch.mouth;
  characterDef(ch);
}

/** A character saved before actions existed reads as one with none; malformed actions and spans are dropped. */
function characterDef(ch: Obj): void {
  ch.actions = arr(ch.actions).filter(isObj).filter((a) => typeof a.id === 'string' && a.id !== '').map((a) => {
    a.name = str(a.name, 'Action');
    a.length = Math.max(1, Math.round(num(a.length, 1)));
    a.loop = bool(a.loop, false);
    a.lanes = arr(a.lanes).filter(isObj).filter((l) => typeof l.part === 'string').map((l) => { l.keys = arr(l.keys).map(lane).filter((k): k is Obj => k !== null); return l; });
    if (a.fps !== undefined) a.fps = Math.max(1, num(a.fps, 24));
    return a;
  });
  if (ch.acts === undefined) return;
  ch.acts = arr(ch.acts).filter(isObj).filter((s) => typeof s.action === 'string').map((s) => {
    s.from = Math.round(num(s.from, 0));
    s.to = Math.max(s.from as number, Math.round(num(s.to, s.from as number)));
    return s;
  });
}

/** Shape and Solid always carry a valid outline; an Adjustment's mask is optional; other kinds drop a stray one. */
function shapeDef(c: Obj, kind: string): void {
  if (kind !== 'shape' && kind !== 'solid' && kind !== 'adjust') { delete c.shape; return; }
  const s = c.shape;
  if (!isObj(s)) {
    delete c.shape;
    if (kind !== 'adjust') c.shape = kind === 'solid'
      ? { type: 'rect', w: 0, h: 0, fill: { kind: 'solid', color: '#3a8bff' }, stroke: null }
      : { type: 'rect', w: 400, h: 300, fill: { kind: 'solid', color: '#3a8bff' }, stroke: null };
    return;
  }
  const types = ['rect', 'ellipse', 'polygon', 'star', 'line', 'arrow', 'path'];
  if (!types.includes(str(s.type, ''))) s.type = 'rect';
  s.w = num(s.w, 400);
  s.h = num(s.h, 300);
  if (!isObj(s.fill)) s.fill = null;
  if (!isObj(s.stroke)) s.stroke = null;
  if (s.nodes !== undefined) s.nodes = arr(s.nodes).filter(isObj).map((n) => ({ x: num(n.x, 0), y: num(n.y, 0), ix: num(n.ix, 0), iy: num(n.iy, 0), ox: num(n.ox, 0), oy: num(n.oy, 0) }));
}

function onion(o: Obj): Obj {
  return {
    enabled: true, backFrames: 2, foreFrames: 1, opacity: 0.4, tint: true, backColor: '#ff4f7a', foreColor: '#3a9bff', blendPrimary: false, ...o,
  };
}

/** Tracks already filled in: history states share most tracks, and each is done once (the sharing survives opening a file). */
const done = new WeakSet<object>();

function trackList(v: unknown): Obj[] {
  return arr(v).map((t, i) => {
    if (!isObj(t)) return null;
    if (done.has(t)) return t;
    done.add(t);
    fillId(t, 't');
    t.name = str(t.name, `Track ${i + 1}`);
    t.hidden = bool(t.hidden, false);
    t.content = arr(t.content).map(content).filter((c): c is Obj => c !== null);
    return t;
  }).filter((t): t is Obj => t !== null);
}

/** Fills what an older movie lacks, in place, and returns it as a Movie. Anything already present is kept as is. */
export function normalizeMovie(raw: unknown): Movie {
  const m: Obj = isObj(raw) ? raw : {};
  fillId(m, 'm');
  m.format = num(m.format, FORMAT_VERSION);
  m.name = str(m.name, 'Untitled Movie');
  m.width = Math.max(1, num(m.width, 1920));
  m.height = Math.max(1, num(m.height, 1080));
  m.fps = Math.max(1, num(m.fps, 24));
  m.background = str(m.background, '#ffffff');
  m.transparent = bool(m.transparent, false);
  m.playback = str(m.playback, 'loop');
  m.addKeyAtStart = bool(m.addKeyAtStart, true);
  m.onion = onion(isObj(m.onion) ? m.onion : {});
  m.tracks = trackList(m.tracks);
  m.assets = isObj(m.assets) ? m.assets : {};
  if (isObj(m.camera)) { const cam: Obj = { ...m.camera }; laneSplit(cam); m.camera = cam; }
  else delete m.camera;
  let last = 0;
  const walk = (ts: Obj[]): void => { for (const t of ts) for (const c of t.content as Obj[]) { last = Math.max(last, (c.start as number) + (c.duration as number)); walk(c.tracks as Obj[]); } };
  walk(m.tracks as Obj[]);
  m.duration = Math.max(1, num(m.duration, Math.max(last, Math.round(m.fps as number))));
  return m as unknown as Movie;
}
