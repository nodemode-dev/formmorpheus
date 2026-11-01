// How blocks look on the Timeline: a Flipbook as a strip of paper cells with white seams, a Group as a dim picture of what it holds,
// a coloured name chip. Canvas drawing only; the caller clips to the block first.
import '../styles/timeline-look.css';
import { end } from '../engine/model';
import type { Content } from '../engine/types';

type Ctx = CanvasRenderingContext2D;

/** The paper of a Flipbook cell. */
export const FLIP_PAPER = '#ebc9b0';

/**
 * A Flipbook block: one paper cell per drawing (as long as it is held), each showing its drawing, a white seam between cells.
 * `tile(local)` returns a small picture of the content at a content-local frame, or null while it is not ready.
 */
export function drawFlipCells(c: Ctx, item: Content, x0: number, y: number, h: number, ppf: number, viewW: number, tileW: number, tile: (local: number) => HTMLCanvasElement | null): void {
  const row = item.flip.find((r) => !r.hidden) ?? item.flip[0];
  c.fillStyle = FLIP_PAPER;
  c.fillRect(x0, y, Math.max(0, (item.duration) * ppf), h);
  if (!row || !row.frames.length) return;
  let pos = 0, i = 0;
  const total = row.frames.reduce((n, f) => n + Math.max(1, f.hold), 0);
  // the row repeats while the block is longer than one pass
  for (let guard = 0; pos < item.duration && guard < 20000; guard++, i = (i + 1) % row.frames.length) {
    const hold = Math.max(1, row.frames[i].hold);
    const a = x0 + pos * ppf, b = a + hold * ppf;
    if (b >= 0 && a <= viewW && total > 0) {
      const cw = Math.min(b, x0 + item.duration * ppf) - a;
      const img = tile(pos);
      if (img && cw > 2) {
        c.save();
        c.beginPath();
        c.rect(a, y, cw, h);
        c.clip();
        c.drawImage(img, a, y, tileW, h);
        c.restore();
      }
      if (cw >= 5 && pos > 0) {
        c.fillStyle = 'rgba(255,255,255,.92)';
        c.fillRect(Math.round(a) - 0.5, y, 1.5, h);
      }
    }
    pos += hold;
    if (a > viewW) break;
  }
}

/** A Group block: its children as dim bars in the group's own frames, one row per inner track, over a deeper ground. */
export function drawGroupPreview(c: Ctx, g: Content, x0: number, y: number, w: number, h: number, ppf: number, ink: string): void {
  const n = g.tracks.length;
  if (!n) return;
  c.fillStyle = 'rgba(0,0,0,.28)';
  c.fillRect(x0, y, w, h);
  const top = y + 6, bandH = h - 12, rowH = Math.min(8, bandH / n), gap = Math.min(2, rowH / 4);
  c.fillStyle = ink;
  c.globalAlpha = 0.34;
  g.tracks.forEach((t, i) => {
    const ry = top + i * (rowH + gap);
    if (ry + rowH > y + h - 2) return;
    for (const it of t.content) {
      const a = x0 + (it.start - g.offset) * ppf, b = x0 + (end(it) - g.offset) * ppf;
      if (b < x0 || a > x0 + w) continue;
      c.beginPath();
      c.roundRect(Math.max(x0, a), ry, Math.max(2, Math.min(b, x0 + w) - Math.max(x0, a)), rowH, 2);
      c.fill();
    }
  });
  c.globalAlpha = 1;
}

/** The name chip: a coloured pill when the block has a highlight (its own text is then white), else the dark one. */
export function chipFill(highlight: string, chip: string, hl: Record<string, string>): { fill: string; ink: string | null } {
  return highlight === 'none' ? { fill: chip, ink: null } : { fill: hl[highlight], ink: '#ffffff' };
}
