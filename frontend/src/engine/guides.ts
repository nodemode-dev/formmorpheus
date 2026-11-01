// Stage guides: grid, rule of thirds, title and action safe areas, and guide lines dragged from the rulers.
// They are a drawing aid on the Stage only (never part of an exported picture). Pure maths, no DOM.
export interface GuideLine { axis: 'x' | 'y'; at: number }

export interface Guides {
  /** The Stage shows rulers along its top and left edges. */
  rulers?: boolean;
  grid?: boolean;
  /** Grid cell size in movie pixels (default 100) and the number of parts a cell is split into (default 1). */
  gridSize?: number;
  gridDiv?: number;
  thirds?: boolean;
  /** Broadcast style safe areas: titles inside 90 %, action inside 93 % of the frame. */
  titleSafe?: boolean;
  actionSafe?: boolean;
  /** Short vertical video: keeps clear of the top and bottom bars an app lays over a 9:16 picture. */
  verticalSafe?: boolean;
  /** Where a 1:1 or a 4:5 crop of the frame would fall (the largest centred rectangle of that shape). */
  squareFrame?: boolean;
  portraitFrame?: boolean;
  /** Guide lines in movie pixels from the frame's top left. */
  lines?: GuideLine[];
  /** Moving content snaps its edges and centre to guides (default on). */
  snap?: boolean;
  /** Everything is hidden but kept. */
  hide?: boolean;
}

export const SAFE_TITLE = 0.9;
export const SAFE_ACTION = 0.93;
/** Fractions of the frame kept clear: left, top, right, bottom. */
export const SAFE_VERTICAL: [number, number, number, number] = [0.06, 0.1, 0.12, 0.2];

export const GRID_DEFAULT = 100;

export interface Inset { x0: number; y0: number; x1: number; y1: number }

/** A rectangle inset by a fraction of the whole frame on every side. */
export function insetRect(w: number, h: number, keep: number): Inset {
  const mx = (w * (1 - keep)) / 2, my = (h * (1 - keep)) / 2;
  return { x0: mx, y0: my, x1: w - mx, y1: h - my };
}

export function verticalRect(w: number, h: number): Inset {
  const [l, t, r, b] = SAFE_VERTICAL;
  return { x0: w * l, y0: h * t, x1: w - w * r, y1: h - h * b };
}

/** The visible grid lines on one axis: cell lines (major) and the lines between them (minor). */
export function gridAxis(len: number, size: number, div: number): { major: number[]; minor: number[] } {
  const s = Math.max(4, size), d = Math.max(1, Math.round(div));
  const major: number[] = [], minor: number[] = [];
  if (len / (s / d) > 600) return { major, minor };
  for (let p = 0; p <= len + 0.01; p += s) {
    major.push(p);
    for (let i = 1; i < d; i++) if (p + (s * i) / d < len) minor.push(p + (s * i) / d);
  }
  return { major, minor };
}

/** Every line a moving content may snap to, per axis. */
export function guideLines(w: number, h: number, g: Guides | undefined): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = [];
  if (!g || g.hide || g.snap === false) return { xs, ys };
  for (const l of g.lines ?? []) (l.axis === 'x' ? xs : ys).push(l.at);
  if (g.thirds) { xs.push(w / 3, (2 * w) / 3); ys.push(h / 3, (2 * h) / 3); }
  const rect = (r: Inset): void => { xs.push(r.x0, r.x1); ys.push(r.y0, r.y1); };
  if (g.titleSafe) rect(insetRect(w, h, SAFE_TITLE));
  if (g.actionSafe) rect(insetRect(w, h, SAFE_ACTION));
  if (g.verticalSafe) rect(verticalRect(w, h));
  if (g.squareFrame) rect(aspectRect(w, h, 1));
  if (g.portraitFrame) rect(aspectRect(w, h, 4 / 5));
  if (g.grid) {
    const gx = gridAxis(w, g.gridSize ?? GRID_DEFAULT, g.gridDiv ?? 1), gy = gridAxis(h, g.gridSize ?? GRID_DEFAULT, g.gridDiv ?? 1);
    xs.push(...gx.major, ...gx.minor);
    ys.push(...gy.major, ...gy.minor);
  }
  return { xs, ys };
}

/** What is stored: only what differs from nothing, and null when nothing is left. */
export function tidyGuides(g: Guides | null | undefined): Guides | null {
  if (!g) return null;
  const out: Guides = {};
  if (g.rulers) out.rulers = true;
  if (g.grid) out.grid = true;
  if (g.gridSize && g.gridSize !== GRID_DEFAULT) out.gridSize = Math.min(2000, Math.max(4, Math.round(g.gridSize)));
  if (g.gridDiv && g.gridDiv > 1) out.gridDiv = Math.min(16, Math.round(g.gridDiv));
  if (g.thirds) out.thirds = true;
  if (g.titleSafe) out.titleSafe = true;
  if (g.actionSafe) out.actionSafe = true;
  if (g.verticalSafe) out.verticalSafe = true;
  const lines = (g.lines ?? []).filter((l) => (l.axis === 'x' || l.axis === 'y') && Number.isFinite(l.at)).slice(0, 200);
  if (lines.length) out.lines = lines;
  if (g.snap === false) out.snap = false;
  if (g.hide) out.hide = true;
  return Object.keys(out).length ? out : null;
}

/** Whether anything would be drawn on the Stage. */
export function anyGuide(g: Guides | undefined): boolean {
  return !!g && !g.hide && !!(g.grid || g.thirds || g.titleSafe || g.actionSafe || g.verticalSafe || g.squareFrame || g.portraitFrame || g.lines?.length);
}

/** The largest centred rectangle of a width : height shape inside a w x h frame. */
export function aspectRect(w: number, h: number, ratio: number): Inset {
  const rw = Math.min(w, h * ratio), rh = rw / ratio;
  return { x0: (w - rw) / 2, y0: (h - rh) / 2, x1: (w + rw) / 2, y1: (h + rh) / 2 };
}
