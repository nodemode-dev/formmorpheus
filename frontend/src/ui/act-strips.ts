// The actions placed on a character, as labelled strips along the lower edge of its Timeline block. Drawn into the
// Timeline's canvas with the block, so they follow every change with no element of their own to rebuild.
import { blockFrame, findAction } from '../engine/action-ops';
import type { Content } from '../engine/types';
import { t } from './i18n';

/** The strip last pressed: the character's id and the span's index. */
export const actPick: { id: string | null; index: number } = { id: null, index: -1 };

const STRIP_H = 13;
const INSET = 2;

/** The Timeline palette's colors the strips use. */
export interface StripInk { chip: string; text: string; accent: string; onAccent: string }

/** The span's left and right in px from the block's left edge, written into `EDGE` (the Timeline redraws often). */
const EDGE = [0, 0];
function edges(g: Content, from: number, to: number, ppf: number): number[] {
  const a = blockFrame(g, from) * ppf, b = blockFrame(g, to) * ppf;
  EDGE[0] = Math.min(a, b);
  EDGE[1] = Math.max(a, b);
  return EDGE;
}

/** The label of a placed action: a starter action's name in the interface language, the person's own as written. */
export function actLabel(g: Content, action: string): string {
  const def = g.character ? findAction(g.character, action) : null;
  if (!def) return '?';
  return def.id.startsWith('builtin:') ? t(def.name) : def.name;
}

export function drawActStrips(c: CanvasRenderingContext2D, g: Content, x0: number, w: number, y: number, blockH: number, ppf: number, ink: StripInk): void {
  const acts = g.character?.acts;
  if (!acts || !acts.length) return;
  const top = y + blockH - STRIP_H - INSET;
  c.save();
  c.beginPath();
  c.rect(x0 + 1, top, w - 2, STRIP_H);
  c.clip();
  c.font = '600 9px Inter, system-ui, sans-serif';
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  for (let i = 0; i < acts.length; i++) {
    const s = acts[i];
    const e = edges(g, s.from, s.to, ppf), a = e[0], b = e[1];
    const sx = x0 + a + 1, sw = Math.max(3, b - a - 2);
    if (sx > x0 + w || sx + sw < x0) continue;
    const on = actPick.id === g.id && actPick.index === i;
    c.fillStyle = on ? ink.accent : ink.chip;
    c.beginPath();
    c.roundRect(sx, top, sw, STRIP_H, Math.min(4, sw / 2));
    c.fill();
    if (sw > 18) {
      c.fillStyle = on ? ink.onAccent : ink.text;
      c.save();
      c.beginPath();
      c.rect(sx + 3, top, sw - 6, STRIP_H);
      c.clip();
      c.fillText(actLabel(g, s.action), sx + 4, top + STRIP_H / 2 + 0.5);
      c.restore();
    }
  }
  c.restore();
}

/** The index of the strip under (lx, ly), measured from the block's top-left; -1 when none. */
export function actStripAt(g: Content, lx: number, ly: number, blockH: number, ppf: number): number {
  const acts = g.character?.acts;
  if (!acts || ly < blockH - STRIP_H - INSET - 1 || ly > blockH) return -1;
  for (let i = 0; i < acts.length; i++) {
    const e = edges(g, acts[i].from, acts[i].to, ppf);
    if (lx >= e[0] - 1 && lx <= e[1] + 1) return i;
  }
  return -1;
}
