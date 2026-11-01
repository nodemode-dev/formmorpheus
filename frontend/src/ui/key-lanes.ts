// Keyframe lane layout, drawing and hit-testing for the Timeline canvas. No DOM besides the glyph images.
import { channelSpec, easeAt, easeCurve, evalLane, kindSpec, laneChannels, laneFrames } from '../engine/keys';
import { EASES, type Content, type KeyKind, type KeyLane } from '../engine/types';
import { t as tt } from './i18n';

export const LANE_H = 28;
export const ROW_H = 24;
export const LANE_SPACING = 3;
/** Gap between a block and its first lane. */
export const LANES_GAP = 4;
const GLYPH = 16;
const KEY_HIT = 9;

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

/** The stretch between two keys a hold or a menu is on: its easing name and tick markers show over it (content-local frames). */
export interface EasePreview { id: string; kind: KeyKind; channel: string | null; a: number; b: number }
let preview: EasePreview | null = null;

/** Show (or clear, with null) the easing preview; the Timeline redraws. */
export function setEasePreview(p: EasePreview | null): void {
  if (!p && !preview) return;
  preview = p;
  onGlyphLoad?.();
}

/** Where the chosen keys stood before a group drag (id to refs): drawn as dashed outlines while the keys move. */
let ghosts: ReadonlyMap<string, ReadonlyArray<{ kind: KeyKind; frame: number }>> | null = null;
export function setKeyGhosts(g: typeof ghosts): void {
  if (!g && !ghosts) return;
  ghosts = g;
  onGlyphLoad?.();
}

/** The lane under the pointer: its name shows on a collapsed lane only while it is hovered. */
let hoverLane: { id: string; kind: KeyKind } | null = null;
export function setLaneHover(h: { id: string; kind: KeyKind } | null): void {
  if (hoverLane?.id === h?.id && hoverLane?.kind === h?.kind) return;
  hoverLane = h;
  onGlyphLoad?.();
}

/** Only the selected block shows its lanes (set once by the Action menu); the rows keep their room so nothing jumps. */
let laneShown: (item: Content) => boolean = () => true;
export function setLaneShown(fn: (item: Content) => boolean): void { laneShown = fn; }

/** The easing's name in the interface language. */
function easeName(e: string | null): string {
  if (!e) return '';
  const english = EASES.find((x) => x.id === e)?.label ?? (e === 'custom' ? 'Custom' : '');
  return english ? tt(english) : '';
}

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

/** Key glyph size, and the larger one for the key the Playhead stands on. */
const KEY_GLYPH = 14;
const KEY_GLYPH_NOW = 19;

function drawGlyph(c: CanvasRenderingContext2D, kind: KeyKind, color: string, cx: number, cy: number, size = KEY_GLYPH): void {
  const img = glyph(kind, color);
  if (img) { c.drawImage(img, cx - size / 2, cy - size / 2, size, size); return; }
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
let laneBase: (item: Content) => number = () => 1;
/** Lets the lanes read a picture's scale relative to its fit (set once by the Action menu). */
export function setLaneBase(fn: (item: Content) => number): void { laneBase = fn; }

export function drawLanes(c: CanvasRenderingContext2D, item: Content, top: number, g: LaneGeom, p: LanePalette, clipH: number, local?: number, chosen?: (kind: KeyKind, frame: number) => boolean, thumb?: (item: Content, local: number) => CanvasImageSource | null): void {
  if (!laneShown(item)) return;
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
      let nameAt: number | null = null;
      c.save();
      c.beginPath();
      c.rect(0, ry, g.width, row.h);
      c.clip();
      if (!row.channel && w > 120 && hoverLane && hoverLane.id === item.id && hoverLane.kind === kind) {
        // a collapsed lane is its key glyphs only; the lane's name shows while the pointer is over it, on a chip so keys never run over it
        nameAt = Math.max(g.x0, 0) + 8;
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
          round(c, xa, cy - 9, xb - xa, 18, 9);
          c.fill();
          const e = easeAt(slot.lane, frames[i], row.channel);
          const english = EASES.find((x) => x.id === e)?.label ?? (e === 'custom' ? 'Custom' : '');
          const label = english ? tt(english) : '';
          if (label && xb - xa > c.measureText(label).width + GLYPH * 2 + 6) {
            c.fillStyle = p.onAccent;
            c.textAlign = 'center';
            c.fillText(label, (xa + xb) / 2, cy);
          }
        }
      }
      // a collapsed lane names the easing of each stretch wide enough to hold it
      if (!row.channel && frames.length > 1) {
        const nameW = nameAt !== null ? c.measureText(tt(row.label)).width + 12 : 0;
        for (let i = 0; i + 1 < frames.length; i++) {
          const xa = g.x(frames[i]), xb = g.x(frames[i + 1]);
          if (xb < 0 || xa > g.width || xb - xa < 70) continue;
          const label = easeName(easeAt(slot.lane, frames[i]));
          const lw = c.measureText(label).width;
          const mid = (xa + xb) / 2;
          if (!label || xb - xa < lw + GLYPH * 2 + 8 || (nameAt !== null && mid - lw / 2 < nameAt + nameW)) continue;
          c.fillStyle = p.text;
          c.globalAlpha = 0.6;
          c.textAlign = 'center';
          c.fillText(label, mid, cy);
          c.globalAlpha = 1;
        }
      }
      // too many keys for glyphs at this zoom: one tick per key and a count, instead of a pile of overlapping glyphs
      const span = Math.min(g.x1, g.width) - Math.max(g.x0, 0);
      const dense = frames.length >= 8 && span / frames.length < 7;
      if (dense) {
        for (let i = 0; i < frames.length; i++) {
          const x = Math.round(g.x(frames[i])) + 0.5;
          if (x < -2 || x > g.width + 2) continue;
          const on = !!chosen?.(kind, frames[i]);
          c.strokeStyle = on ? p.text : p.accent;
          c.lineWidth = on ? 2 : 1;
          c.beginPath();
          c.moveTo(x, cy - (on ? 8 : 6));
          c.lineTo(x, cy + (on ? 8 : 6));
          c.stroke();
        }
        c.lineWidth = 1;
        if (span > 90) {
          const label = tt('{n} keys').replace('{n}', String(frames.length)), lw = c.measureText(label).width + 12;
          const lx = Math.max(g.x0, 0) + 6;
          c.fillStyle = p.bar;
          c.globalAlpha = 0.92;
          round(c, lx, cy - 8, lw, 16, 8);
          c.fill();
          c.globalAlpha = 1;
          c.fillStyle = p.accent;
          c.textAlign = 'left';
          c.fillText(label, lx + 6, cy);
        }
      } else {
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
          // the key under the Playhead is drawn larger (the pill sits over it)
          drawGlyph(c, kind, onBar ? p.onAccent : p.accent, x, cy, local === frames[i] ? KEY_GLYPH_NOW : KEY_GLYPH);
        }
      }
      // a group drag leaves a dashed outline where each chosen key stood
      const gh = ghosts?.get(item.id);
      if (gh) {
        c.strokeStyle = p.text;
        c.globalAlpha = 0.75;
        c.setLineDash([3, 3]);
        for (const r of gh) {
          if (r.kind !== kind) continue;
          const x = g.x(r.frame);
          if (x < -GLYPH || x > g.width + GLYPH) continue;
          c.beginPath();
          c.arc(x, cy, GLYPH / 2 + 1, 0, Math.PI * 2);
          c.stroke();
        }
        c.setLineDash([]);
        c.globalAlpha = 1;
      }
      // held or in the lane menu: the stretch's easing name at its midpoint and tick markers at the easing's cadence
      if (preview && preview.id === item.id && preview.kind === kind && preview.channel === row.channel) {
        const xa = g.x(preview.a), xb = g.x(preview.b);
        const e = easeAt(slot.lane, preview.a, row.channel ?? undefined);
        if (xb > xa && xb >= 0 && xa <= g.width) {
          const f = easeCurve(!e || e === 'custom' ? 'linear' : e);
          c.strokeStyle = p.text;
          c.lineWidth = 1.5;
          c.globalAlpha = 0.9;
          c.beginPath();
          for (let i = 0; i <= 10; i++) { const tx = Math.round(xa + (xb - xa) * f(i / 10)) + 0.5; c.moveTo(tx, cy - 9); c.lineTo(tx, cy + 9); }
          c.stroke();
          c.lineWidth = 1;
          c.globalAlpha = 1;
          const label = easeName(e);
          if (label) {
            const lw = c.measureText(label).width + 14, mid = (xa + xb) / 2;
            c.fillStyle = p.text;
            round(c, mid - lw / 2, cy - 9, lw, 18, 9);
            c.fill();
            c.fillStyle = p.bar;
            c.textAlign = 'center';
            c.fillText(label, mid, cy);
          }
        }
      }
      if (!row.channel && local !== undefined && span > 240 && frames.length) {
        // a collapsed lane reads out its values at the Playhead (and the easing of the stretch it is in) at the right end
        const spec = kindSpec(kind), parts: string[] = [];
        const vals = evalLane(item, slot.lane, local);
        for (const ch of spec.channels) {
          if (parts.length >= 2) break;
          if (!slot.lane.channels[ch.id]?.length || ch.id === 'px' || ch.id === 'py' || !Number.isFinite(vals[ch.id])) continue;
          const shown = Math.round(vals[ch.id] * ch.display / (ch.id === 'scaleX' || ch.id === 'scaleY' ? laneBase(item) : 1) * 10) / 10;
          parts.push(`${tt(ch.short)} ${shown}${ch.unit === 'deg' ? '°' : ch.unit === '%' ? '%' : ''}`);
        }
        const before = keyBefore(slot.lane, Math.floor(local)), after = before === null ? undefined : frames.find((f) => f > (before as number));
        const en = before !== null && after !== undefined && span > 380 ? easeName(easeAt(slot.lane, before)) : '';
        if (en) parts.push(en);
        if (parts.length) {
          const text = parts.join(' · '), tw = c.measureText(text).width + 12;
          const rx = Math.min(g.x1, g.width) - (hasChev(slot, row, g) ? 28 : 8);
          c.fillStyle = p.bar;
          c.globalAlpha = 0.88;
          round(c, rx - tw, cy - 8, tw, 16, 8);
          c.fill();
          c.globalAlpha = 1;
          c.fillStyle = p.text;
          c.textAlign = 'right';
          c.fillText(text, rx - 6, cy);
        }
      }
      if (nameAt !== null) {
        const tw = c.measureText(tt(row.label)).width;
        c.fillStyle = p.bar;
        c.globalAlpha = 0.92;
        round(c, nameAt - 4, cy - 9, tw + 8, 18, 6);
        c.fill();
        c.globalAlpha = 1;
        c.fillStyle = p.text;
        c.textAlign = 'left';
        c.fillText(tt(row.label), nameAt, cy);
      }
      if (row.channel) {
        const lx = Math.max(g.x0, 0) + 12;
        const overBar = frames.length > 1 && g.x(frames[0]) - g.x0 < 36;
        c.fillStyle = overBar ? p.onAccent : p.accent;
        c.textAlign = 'left';
        c.fillText(tt(row.label), lx, cy);
        if (hasGraphPill(slot, row, g)) {
          const px = graphPillX(g);
          c.fillStyle = p.text;
          c.globalAlpha = 0.18;
          round(c, px, cy - 8, GRAPH_PILL_W, 16, 8);
          c.fill();
          c.globalAlpha = 1;
          c.fillStyle = p.text;
          c.textAlign = 'center';
          c.fillText(tt('Graph'), px + GRAPH_PILL_W / 2, cy);
          c.textAlign = 'left';
        }
        if (local !== undefined) {
          // the channel's value at the Playhead, at the row's right end
          const ch = channelSpec(kind, row.channel);
          const v = evalLane(item, slot.lane, local)[row.channel];
          if (ch && Number.isFinite(v)) {
            const shown = Math.round(v * ch.display / (ch.id === 'scaleX' || ch.id === 'scaleY' ? laneBase(item) : 1) * 10) / 10;
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
  if (x < g.x0 - KEY_HIT || x > g.x1 + KEY_HIT || !laneShown(item)) return null;
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
