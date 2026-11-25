// The person glyph that marks a character: one outline (24 x 24 box), drawn as inline SVG in menus and panels and
// as a cached Path2D on the Timeline's canvas, so both read the same.

export const PERSON_D = 'M12 3.5a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4zM5.5 20.5c.6-4.2 3.2-6.8 6.5-6.8s5.9 2.6 6.5 6.8';

export const PERSON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PERSON_D}"/></svg>`;

let path: Path2D | null = null;

/** Strokes the glyph `size` px wide with its top-left at (x, y), in the context's current stroke colour. */
export function drawPerson(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  path ??= new Path2D(PERSON_D);
  const k = size / 24;
  c.save();
  c.translate(x, y);
  c.scale(k, k);
  c.lineWidth = 2.2;
  c.lineCap = 'round';
  c.stroke(path);
  c.restore();
}
