// Dragging an edge of an action strip on a character's block: where the edges are, which one is under the pointer and
// the handles drawn on them. Canvas drawing and plain maths; the Timeline owns the drag and runs `resizeAction`.
import { blockFrame, innerFrame } from '../engine/action-ops';
import type { Content } from '../engine/types';
import { actPick, actStripAt } from './act-strips';

/** The strips' band, as act-strips.ts draws it: 13 px tall, 2 px above the block's lower edge. */
const STRIP_H = 13;
const INSET = 2;

/** A strip edge under the pointer: the span, which of its frames the edge shows, and that edge's x from the block's left. */
export interface ActEdge { index: number; field: 'from' | 'to'; x: number }

/** The strip edge within `grip` px of (lx, ly) (measured from the block's top-left), the nearest one; null when none. */
export function actEdgeAt(g: Content, lx: number, ly: number, blockH: number, ppf: number, grip: number): ActEdge | null {
  const acts = g.character?.acts;
  if (!acts || !acts.length) return null;
  let best: ActEdge | null = null, bd = Infinity;
  for (let i = 0; i < acts.length; i++) {
    const p = blockFrame(g, acts[i].from) * ppf, q = blockFrame(g, acts[i].to) * ppf;
    const a = Math.min(p, q), b = Math.max(p, q);
    // inside the strip's own band only, so the block's edges above it still trim the block
    if (actStripAt(g, (a + b) / 2, ly, blockH, ppf) !== i) continue;
    const reach = Math.max(2, Math.min(grip, (b - a) / 3));
    for (let k = 0; k < 2; k++) {
      const x = k ? b : a, d = Math.abs(lx - x);
      if (d > reach) continue;
      // two strips that touch: the one the pointer is inside wins the shared line
      const score = d - (lx >= a && lx <= b ? 0.5 : 0);
      if (score < bd) { bd = score; best = { index: i, field: (x === p) ? 'from' : 'to', x }; }
    }
  }
  return best;
}

/** The frames of the character's tracks the block shows, low and high. */
export function shownFrames(g: Content): { lo: number; hi: number } {
  const a = innerFrame(g, 0), b = innerFrame(g, g.duration);
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

/** Grips on both edges of each strip of a selected character block; the strip being dragged (`armed`) shows them solid. */
export function drawActHandles(c: CanvasRenderingContext2D, g: Content, x0: number, w: number, y: number, blockH: number, ppf: number, armed: number, color: string, onAccent: string): void {
  const acts = g.character?.acts;
  if (!acts || !acts.length) return;
  const top = y + blockH - STRIP_H - INSET;
  c.save();
  c.beginPath();
  c.rect(x0, top - 2, w, STRIP_H + 4);
  c.clip();
  c.lineWidth = 1.5;
  c.lineCap = 'round';
  for (let i = 0; i < acts.length; i++) {
    const p = blockFrame(g, acts[i].from) * ppf, q = blockFrame(g, acts[i].to) * ppf;
    const a = x0 + Math.min(p, q) + 1, b = x0 + Math.max(p, q) - 1;
    if (b - a < 14 || b < x0 || a > x0 + w) continue;
    // the pressed strip is filled with the accent, so its grips take the ink on the accent
    const ink = actPick.id === g.id && actPick.index === i ? onAccent : color;
    c.fillStyle = ink;
    c.strokeStyle = ink;
    if (i === armed) {
      c.beginPath(); c.roundRect(a, top - 1, 3, STRIP_H + 2, 1.5); c.fill();
      c.beginPath(); c.roundRect(b - 3, top - 1, 3, STRIP_H + 2, 1.5); c.fill();
    } else {
      c.beginPath(); c.moveTo(a + 1.5, top + 2); c.lineTo(a + 1.5, top + STRIP_H - 2); c.stroke();
      c.beginPath(); c.moveTo(b - 1.5, top + 2); c.lineTo(b - 1.5, top + STRIP_H - 2); c.stroke();
    }
  }
  c.restore();
}
