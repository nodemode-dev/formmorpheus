// Small canvas marks the Timeline draws on blocks: lock hatch, mute and solo, trim brackets, the lift ghost and the drop cues.
type Ctx = CanvasRenderingContext2D;

/** Diagonal hatch over a locked track's block (clip to the block first). */
export function drawLockHatch(c: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.strokeStyle = color;
  c.globalAlpha = 0.28;
  c.lineWidth = 1;
  c.beginPath();
  for (let i = -h; i < w; i += 8) { c.moveTo(x + i, y + h); c.lineTo(x + i + h, y); }
  c.stroke();
  c.restore();
}

/** A speaker (with a slash when silenced) or an S badge for solo, in the block's top right corner. */
export function drawSoundMark(c: Ctx, right: number, y: number, kind: 'mute' | 'quiet' | 'solo', chip: string, ink: string, accent: string): void {
  const w = 18, h = 15, x = right - w - 5, top = y + 5;
  c.save();
  c.fillStyle = kind === 'solo' ? accent : chip;
  c.beginPath();
  c.roundRect(x, top, w, h, 4);
  c.fill();
  c.strokeStyle = kind === 'solo' ? '#fff' : ink;
  c.fillStyle = kind === 'solo' ? '#fff' : ink;
  c.lineWidth = 1.3;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (kind === 'solo') {
    c.font = '700 10px Inter, system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('S', x + w / 2, top + h / 2 + 0.5);
  } else {
    const cx = x + 6, cy = top + h / 2;
    c.beginPath();
    c.moveTo(cx - 3, cy - 1.8); c.lineTo(cx - 1, cy - 1.8); c.lineTo(cx + 2, cy - 4); c.lineTo(cx + 2, cy + 4); c.lineTo(cx - 1, cy + 1.8); c.lineTo(cx - 3, cy + 1.8);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(cx + 4.5, cy - 3.5); c.lineTo(cx + 9.5, cy + 3.5);
    c.stroke();
  }
  c.restore();
}

/** The "(" and ")" trim handles of a selected block; solid when armed (held or Free Trim). */
export function drawBrackets(c: Ctx, x0: number, x1: number, y: number, h: number, armed: boolean, color: string): void {
  const bh = Math.min(h - 8, armed ? 26 : 20), top = y + (h - bh) / 2, r = 4, bw = armed ? 6 : 4;
  c.save();
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = bw / 2 + 1;
  c.lineCap = 'round';
  if (armed) {
    c.beginPath(); c.roundRect(x0 + 2, top, bw, bh, 2); c.fill();
    c.beginPath(); c.roundRect(x1 - 2 - bw, top, bw, bh, 2); c.fill();
  } else {
    c.beginPath(); c.moveTo(x0 + 3 + r, top); c.quadraticCurveTo(x0 + 3, top, x0 + 3, top + r); c.lineTo(x0 + 3, top + bh - r); c.quadraticCurveTo(x0 + 3, top + bh, x0 + 3 + r, top + bh); c.stroke();
    c.beginPath(); c.moveTo(x1 - 3 - r, top); c.quadraticCurveTo(x1 - 3, top, x1 - 3, top + r); c.lineTo(x1 - 3, top + bh - r); c.quadraticCurveTo(x1 - 3, top + bh, x1 - 3 - r, top + bh); c.stroke();
  }
  c.restore();
}

/** A downward chevron when open, a rightward one when closed, centred on (cx, cy). */
export function drawChevron(c: Ctx, cx: number, cy: number, open: boolean, color: string): void {
  c.save();
  c.strokeStyle = color;
  c.lineWidth = 1.6;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  if (open) { c.moveTo(cx - 3.5, cy - 1.8); c.lineTo(cx, cy + 1.8); c.lineTo(cx + 3.5, cy - 1.8); } else { c.moveTo(cx - 1.8, cy - 3.5); c.lineTo(cx + 1.8, cy); c.lineTo(cx - 1.8, cy + 3.5); }
  c.stroke();
  c.restore();
}

export interface LiftGeom {
  /** Where the block began (dashed placeholder). */
  origin: { x: number; y: number; w: number; h: number } | null;
  /** The ghost under the pointer. */
  ghost: { x: number; y: number; w: number; h: number };
  /** A drop outline for the wanted span when it is blocked (red). */
  blocked: { x: number; y: number; w: number; h: number } | null;
  /** A new track will be made at this y (a line across the lanes). */
  insertY: number | null;
}

export function drawLift(c: Ctx, g: LiftGeom, width: number, accent: string, red: string, fill: string, label: string): void {
  c.save();
  c.setLineDash([4, 3]);
  c.lineWidth = 1.5;
  c.strokeStyle = accent;
  c.globalAlpha = 0.7;
  if (g.origin) { c.beginPath(); c.roundRect(g.origin.x + 0.5, g.origin.y + 0.5, Math.max(4, g.origin.w - 1), g.origin.h - 1, 6); c.stroke(); }
  c.globalAlpha = 1;
  if (g.blocked) {
    c.strokeStyle = red;
    c.fillStyle = red;
    c.globalAlpha = 0.16;
    c.beginPath(); c.roundRect(g.blocked.x, g.blocked.y, Math.max(4, g.blocked.w), g.blocked.h, 6); c.fill();
    c.globalAlpha = 1;
    c.beginPath(); c.roundRect(g.blocked.x + 0.5, g.blocked.y + 0.5, Math.max(4, g.blocked.w - 1), g.blocked.h - 1, 6); c.stroke();
  }
  c.setLineDash([]);
  if (g.insertY !== null) {
    c.strokeStyle = accent;
    c.fillStyle = accent;
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(8, g.insertY); c.lineTo(width - 8, g.insertY); c.stroke();
    c.font = '600 10px Inter, system-ui, sans-serif';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    const lw = c.measureText(label).width + 12;
    c.beginPath(); c.roundRect(10, g.insertY - 8, lw, 16, 8); c.fill();
    c.fillStyle = '#fff';
    c.fillText(label, 16, g.insertY + 0.5);
  }
  c.globalAlpha = 0.6;
  c.fillStyle = fill;
  c.beginPath(); c.roundRect(g.ghost.x, g.ghost.y, Math.max(4, g.ghost.w), g.ghost.h, 6); c.fill();
  c.globalAlpha = 0.95;
  c.lineWidth = 1.5;
  c.strokeStyle = g.blocked ? red : accent;
  c.beginPath(); c.roundRect(g.ghost.x + 0.5, g.ghost.y + 0.5, Math.max(4, g.ghost.w - 1), g.ghost.h - 1, 6); c.stroke();
  c.restore();
}
