// Oil and bristle family helpers (v0.17.0). Pure maths.
// A bundle's hairs touch the canvas only when the press is enough; at a light press a hair sits right at that
// threshold, so a small change in pressure or pen speed switched whole stretches of hairs on and off at once and the
// stroke showed tone blocks with square edges. The contact now eases along the path, over a fraction of the brush
// width, so a hair lifts and lands gradually like a real one.

/** Moves a hair's contact toward its target over a distance of `reach` brush diameters. */
export function easeContact(cur: number, target: number, ds: number, dia: number, reach: number): number {
  if (ds <= 0) return cur;
  const k = 1 - Math.exp(-ds / Math.max(1, dia * reach));
  return cur + (target - cur) * k;
}

/** A bundle laid on its side: the diameter the stroke gives the bundle. A flat blade (body) turns onto its edge and
 *  becomes a thin line; hairs spread wider (the diameter already grew with the lean). */
export function leanDia(dia: number, sizeMul: number, lean: number, body: number): number {
  if (body <= 0 || lean <= 0) return dia;
  return Math.max(1.5, (dia / Math.max(1, sizeMul)) * (1 - 0.9 * lean));
}

/** How far a hair at lateral place u (-1..1) is from the middle of a leaning bundle, 0 upright to 1 at the outer edge. */
export function outerness(u: number, lean: number): number {
  const a = Math.abs(u);
  return lean * a * Math.sqrt(a);
}

/** The pressure a lifting bundle leaves with: the stroke's own pressure, never a heavier one, so the tail does not
 *  end in a darker notch at a light touch. */
export function liftPressure(pressure: number): number {
  return Math.max(0.02, pressure);
}
