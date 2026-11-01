// Pen response of dry media: a pencil, graphite, charcoal or pastel must show at a light touch and still grow with
// pressure. Pressure starts a soft curve (light presses register sooner), and each brush keeps a floor for the
// size and for the flow a press of 0.1 lays down, so a light line is faint but never lost. Data on the brush,
// applied once to the starter library (brush-materials.ts); a person's own brushes are left alone.

import type { Brush } from './types';

/** Floors by family: the effective flow at the lightest touch, the size share at the lightest touch, the grain floor. */
interface Floor { flow: number; size: number; gamma: number; grainMin: number }

const GRAPHITE: Floor = { flow: 0.28, size: 0.45, gamma: 0.8, grainMin: 0.3 };
const COLOURED: Floor = { flow: 0.38, size: 0.5, gamma: 0.8, grainMin: 0.35 };
const CHARCOAL: Floor = { flow: 0.3, size: 0.42, gamma: 0.8, grainMin: 0.25 };
const PASTEL: Floor = { flow: 0.32, size: 0.5, gamma: 0.8, grainMin: 0.3 };
// the first pen a person meets: a light press is a fine, faint line and a hard press a broad, dark one
const STUB: Floor = { flow: 0.3, size: 0.2, gamma: 0.9, grainMin: 0.3 };

const FAMILIES: [RegExp, Floor][] = [
  [/^lead stub$/, STUB],
  [/color pencil|blue lead|sepia|crayon/, COLOURED],
  [/charcoal|willow|stump|compressed|powder|stone/, CHARCOAL],
  [/pastel|chalk|conte|wax stick|oil pastel/, PASTEL],
  [/pencil|lead|graphite|hatch|carpenter|mechanical|4h|scribble|stub|shader|side shade|ghost/, GRAPHITE],
];

/** The floors a starter brush gets, or undefined when it is not a dry medium. */
export function dryFloor(b: Brush): Floor | undefined {
  const n = b.name.toLowerCase();
  for (const [re, f] of FAMILIES) if (re.test(n)) return f;
  const s = b.set.toLowerCase();
  if (s === 'charcoals' || s === 'charcoal') return CHARCOAL;
  if (s === 'chalk') return PASTEL;
  return undefined;
}

/** The brush with its pen response lifted to the floors of its family. Technical pens and inks are not touched. */
export function dryResponse(b: Brush): Brush {
  const f = dryFloor(b);
  if (!f || b.grain <= 0 && !/pencil|graphite|lead|charcoal|chalk|pastel|crayon|conte/i.test(b.name)) return b;
  const out: Brush = { ...b };
  // a soft curve: light presses register sooner, but not so soon that pressure stops mattering
  out.pressureGamma = Math.min(b.pressureGamma ?? 1, f.gamma);
  // response table (a press of 0.15 against a full press): the size is 0.5 to 0.6 and the flow 0.25 to 0.45 of full
  out.pressureSize = [f.size, b.pressureSize[1]];
  // the flow of the lightest touch is a share of full flow, never so low that the mark is lost
  out.pressureFlow = [Math.min(1, Math.max(f.flow, 0.07 / Math.max(0.05, b.flow))), b.pressureFlow[1]];
  if (b.grain > 0) out.grainDepthMin = Math.max(b.grainDepthMin ?? 0, f.grainMin);
  // charcoal and pastel lie on their side: the wider mark is a row of stamps, so the tip's grit keeps its size
  if ((f === CHARCOAL || f === PASTEL) && b.tilt > 0 && b.tiltCompress === undefined) out.tiltCompress = true;
  return out;
}
