// Keyframe lane layout, drawing and hit-testing for the Timeline canvas. No DOM besides the glyph images.
import { channelSpec, easeAt, evalLane, kindSpec, laneChannels, laneFrames } from '../engine/keys';
import { EASES, type Content, type KeyKind, type KeyLane } from '../engine/types';

export const LANE_H = 28;
export const ROW_H = 24;
export const LANE_SPACING = 3;
/** Gap between a block and its first lane. */
export const LANES_GAP = 4;
const GLYPH = 14;
const KEY_HIT = 8;

export interface LaneRow { channel: string | null; label: string; y: number; h: number }
export interface LaneSlot { lane: KeyLane; y: number; h: number; rows: LaneRow[] }

const slotCache = new WeakMap<Content, LaneSlot[]>();

/** Lane slots of a content, with y relative to the first lane. Cached per (immutable) content. */
export function laneSlots(c: Content): LaneSlot[] {
  const have = slotCache.get(c);
  if (have) return have;
  let y = 0;
  const out: LaneSlot[] = [];
  for (const lane of c.keys) {
    const spec = kindSpec(lane.kind);
    const rows: LaneRow[] = lane.expanded
      ? laneChannels(lane).map((ch, i) => ({ channel: ch.id, label: ch.short, y: i * ROW_H, h: ROW_H }))
      : [{ channel: null, label: spec.label, y: 0, h: LANE_H }];
    const h = lane.expanded ? rows.length * ROW_H : LANE_H;
    out.push({ lane, y, h, rows });
    y += h + LANE_SPACING;
  }
  slotCache.set(c, out);
  return out;
}

/** Vertical space the lanes of a content take under its block, gap included; 0 without lanes. */
export function lanesHeight(c: Content): number {
  if (!c.keys.length) return 0;
  const s = laneSlots(c);
  const last = s[s.length - 1];
  return LANES_GAP + last.y + last.h;
}

export interface LanePalette { bar: string; row: string; accent: string; text: string; onAccent: string }
export interface LaneGeom { x(local: number): number; x0: number; x1: number; width: number }

const glyphs = new Map<string, HTMLImageElement>();
let onGlyphLoad: (() => void) | null = null;

export function setGlyphLoadHandler(fn: () => void): void { onGlyphLoad = fn; }

/** Kind icon tinted to a colour, as an image for canvas drawing; null until it has decoded. */
export function glyph(kind: KeyKind, color: string): HTMLImageElement | null {
  const key = `${kind}|${color}`;
  let img = glyphs.get(key);
  if (!img) {
    let s = kindSpec(kind).icon.replace(/currentColor/g, color).replace(/\swidth="\d+"/, ' width="56"').replace(/\sheight="\d+"/, ' height="56"');
    if (!s.includes('xmlns')) s = s.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    img = new Image();
    img.onload = () => onGlyph();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
    glyphs.set(key, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

function onGlyph(): void { onGlyphLoad?.(); }

function round(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.min(r, Math.max(0, w) / 2, h / 2));
}

function drawGlyph(c: CanvasRenderingContext2D, kind: KeyKind, color: string, cx: number, cy: number): void {
  const img = glyph(kind, color);
  if (img) { c.drawImage(img, cx - GLYPH / 2, cy - GLYPH / 2, GLYPH, GLYPH); return; }
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(cx, cy - 5); c.lineTo(cx + 5, cy); c.lineTo(cx, cy + 5); c.lineTo(cx - 5, cy);
  c.closePath();
  c.fill();
}

const CHEV_W = 18;
/** Centre x of the expand / collapse chevron at the right end of a lane's first row. */
function chevX(slot: LaneSlot, g: LaneGeom): number {
  return Math.min(g.x1, g.width) - 14 - (slot.lane.expanded && Math.min(g.x1, g.width) - Math.max(g.x0, 0) > 150 ? GRAPH_PILL_W + 6 : 0);
}
function hasChev(slot: LaneSlot, row: LaneRow, g: LaneGeom): boolean {
  return row === slot.rows[0] && Math.min(g.x1, g.width) - Math.max(g.x0, 0) > 60;
}

/** Draw every lane of `c`; `top` is the y of the first lane. `thumb` gives a small picture of the content with its effects at a local frame. */
export function drawLanes(c: CanvasRenderingContext2D, item: Content, top: number, g: LaneGeom, p: LanePalette, clipH: number, local?: number, chosen?: (kind: KeyKind, frame: number) => boolean, thumb?: (item: Content, local: number) => CanvasImageSource | null): void {
  const w = Math.max(3, g.x1 - g.x0);
  c.save();
  c.font = '600 9px Inter, system-ui, sans-serif';
  c.textBaseline = 'middle';
  for (const slot of laneSlots(item)) {
    const y0 = top + slot.y;
    if (y0 > clipH || y0 + slot.h < 0) continue;
    const kind = slot.lane.kind;
    for (const row of slot.rows) {
      const ry = y0 + row.y;
      c.fillStyle = slot.lane.expanded ? p.row : p.bar;
      round(c, g.x0, ry + (slot.lane.expanded ? 1 : 0), w, row.h - (slot.lane.expanded ? 2 : 0), 6);
      c.fill();
      const cy = ry + row.h / 2;
      const frames = laneFrames(slot.lane, row.channel ?? undefined);
      c.save();
      c.beginPath();
      c.rect(0, ry, g.width, row.h);
      c.clip();
      if (!row.channel && w > 120) {
        // a collapsed lane: a picture of the effect at the Playhead, then the lane's name
        const lx0 = Math.max(g.x0, 0) + 6;
        const tp = thumb && local !== undefined ? thumb(item, local) : null;
        let tx = lx0;
        if (tp) {
          const th = row.h - 6, tw = Math.round(th * 1.6);
          c.drawImage(tp, tx, ry + 3, tw, th);
          c.strokeStyle = p.accent;
          c.globalAlpha = 0.5;
          c.strokeRect(tx + 0.5, ry + 3.5, tw - 1, th - 1);
          c.globalAlpha = 1;
          tx += tw + 6;
        }
        c.fillStyle = p.text;
        c.textAlign = 'left';
        c.fillText(row.label, tx, cy);
      }
      if (hasChev(slot, row, g)) {
        const cx = chevX(slot, g);
        c.strokeStyle = p.text;
        c.globalAlpha = 0.7;
        c.lineWidth = 1.6;
        c.beginPath();
        if (slot.lane.expanded) { c.moveTo(cx - 4, cy + 2); c.lineTo(cx, cy - 2); c.lineTo(cx + 4, cy + 2); } else { c.moveTo(cx - 4, cy - 2); c.lineTo(cx, cy + 2); c.lineTo(cx + 4, cy - 2); }
        c.stroke();
        c.lineWidth = 1;
        c.globalAlpha = 1;
      }
      if (row.channel) {
        for (let i = 0; i + 1 < frames.length; i++) {
          const xa = g.x(frames[i]), xb = g.x(frames[i + 1]);
          if (xb < 0 || xa > g.width) continue;
          c.fillStyle = p.accent;
          round(c, xa, cy - 8, xb - xa, 16, 8);
          c.fill();
          const e = easeAt(slot.lane, frames[i], row.channel);
          const label = EASES.find((x) => x.id === e)?.label ?? (e === 'custom' ? 'Custom' : '');
          if (label && xb - xa > c.measureText(label).width + GLYPH * 2 + 6) {
            c.fillStyle = p.onAccent;
            c.textAlign = 'center';
            c.fillText(label, (xa + xb) / 2, cy);
          }
        }
      }
      for (let i = 0; i < frames.length; i++) {
        const x = g.x(frames[i]);
        if (x < -GLYPH || x > g.width + GLYPH) continue;
        const onBar = !!row.channel && frames.length > 1 && (i + 1 < frames.length || i > 0);
        if (chosen?.(kind, frames[i])) {
          // a chosen key: a ring in the text color behind its glyph
          c.strokeStyle = p.text;
          c.lineWidth = 2;
          c.beginPath();
          c.arc(x, cy, GLYPH / 2 + 2, 0, Math.PI * 2);
          c.stroke();
          c.lineWidth = 1;
        }
        drawGlyph(c, kind, onBar ? p.onAccent : p.accent, x, cy);
      }
      if (row.channel) {
        const lx = Math.max(g.x0, 0) + 12;
        const overBar = frames.length > 1 && g.x(frames[0]) - g.x0 < 36;
        c.fillStyle = overBar ? p.onAccent : p.accent;
        c.textAlign = 'left';
        c.fillText(row.label, lx, cy);
        if (hasGraphPill(slot, row, g)) {
          const px = graphPillX(g);
          c.fillStyle = p.text;
          c.globalAlpha = 0.18;
          round(c, px, cy - 8, GRAPH_PILL_W, 16, 8);
          c.fill();
          c.globalAlpha = 1;
          c.fillStyle = p.text;
          c.textAlign = 'center';
          c.fillText('Graph', px + GRAPH_PILL_W / 2, cy);
          c.textAlign = 'left';
        }
        if (local !== undefined) {
          // the channel's value at the Playhead, at the row's right end
          const ch = channelSpec(kind, row.channel);
          const v = evalLane(item, slot.lane, local)[row.channel];
          if (ch && Number.isFinite(v)) {
            const shown = Math.round(v * ch.display * 10) / 10;
            const text = `${shown}${ch.unit === 'deg' ? '°' : ch.unit === '%' ? '%' : ch.unit === 'x' ? 'x' : ''}`;
            const rx = Math.min(g.x1, g.width) - 10 - (hasGraphPill(slot, row, g) ? GRAPH_PILL_W + 6 : 0);
            const lastX = frames.length ? g.x(frames[frames.length - 1]) : g.x0;
            c.fillStyle = rx - lastX > 40 || frames.length < 2 ? p.text : p.onAccent;
            c.textAlign = 'right';
            c.fillText(text, rx, cy);
          }
        }
      }
      c.restore();
    }
  }
  c.restore();
}

export interface LaneHit {
  slot: LaneSlot;
  row: LaneRow;
  /** Content-local frame of the key under the pointer, if any. */
  key: number | null;
  /** Content-local frame under the pointer, unsnapped to keys. */
  at: number;
  /** The pointer is on the row's Graph button. */
  graph?: boolean;
  /** The pointer is on the row's expand / collapse chevron. */
  toggle?: boolean;
}

const GRAPH_PILL_W = 38;
const graphPillX = (g: LaneGeom): number => Math.min(g.x1, g.width) - 8 - GRAPH_PILL_W;
/** The Graph button sits at the right end of the first row of an expanded lane, when the block is wide enough. */
function hasGraphPill(slot: LaneSlot, row: LaneRow, g: LaneGeom): boolean {
  return slot.lane.expanded && row === slot.rows[0] && !!row.channel && Math.min(g.x1, g.width) - Math.max(g.x0, 0) > 150;
}

/**
 * Hit-test a point against the lanes of `item`. `top` is the y of the first lane, `x` and `y` are
 * canvas coordinates, `local` converts an x to a content-local frame (fractional).
 */
export function hitLanes(item: Content, top: number, x: number, y: number, g: LaneGeom, local: (x: number) => number): LaneHit | null {
  if (x < g.x0 - KEY_HIT || x > g.x1 + KEY_HIT) return null;
  for (const slot of laneSlots(item)) {
    for (const row of slot.rows) {
      const ry = top + slot.y + row.y;
      if (y < ry || y >= ry + row.h) continue;
      if (hasGraphPill(slot, row, g) && x >= graphPillX(g) && x <= graphPillX(g) + GRAPH_PILL_W) return { slot, row, key: null, at: Math.round(local(x)), graph: true };
      let key: number | null = null, best = KEY_HIT + 0.001;
      for (const f of laneFrames(slot.lane, row.channel ?? undefined)) {
        const d = Math.abs(g.x(f) - x);
        if (d < best) { best = d; key = f; }
      }
      if (key === null && hasChev(slot, row, g) && Math.abs(x - chevX(slot, g)) <= CHEV_W / 2) return { slot, row, key: null, at: Math.round(local(x)), toggle: true };
      return { slot, row, key, at: Math.round(local(x)) };
    }
  }
  return null;
}

/** Frame of the last key at or before `at` in the lane/row, or null when `at` is before the first key. */
export function keyBefore(lane: KeyLane, at: number, channel?: string): number | null {
  let prev: number | null = null;
  for (const f of laneFrames(lane, channel)) { if (f <= at) prev = f; else break; }
  return prev;
}
