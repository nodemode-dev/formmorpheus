// Title presets: a look and a build (shadow, background box, gradient, animators) laid over a Text block's style.
// The words, font family and align a person chose stay; sizes follow the movie's height. Pure, no DOM.
import { DEFAULT_SIDE, type TextAnim } from './text-rich';
import type { TextStyle } from './types';

export interface TitlePreset {
  id: string;
  label: string;
  /** What it does, in one line. */
  hint: string;
  apply(s: TextStyle, movieW: number, movieH: number): TextStyle;
}

const CLEAR: Partial<TextStyle> = { runs: undefined, shadow: undefined, box: undefined, anim: undefined, fillTo: undefined, stroke: undefined, tracking: undefined, caps: undefined, italic: undefined };

function base(s: TextStyle, patch: Partial<TextStyle>): TextStyle {
  const o = { ...s, ...CLEAR, ...patch } as unknown as Record<string, unknown>;
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o as unknown as TextStyle;
}

const side = (patch: Partial<NonNullable<TextAnim['in']>>): NonNullable<TextAnim['in']> => ({ ...DEFAULT_SIDE, ...patch });

export const TITLE_PRESETS: TitlePreset[] = [
  {
    id: 'lower-third', label: 'Lower third', hint: 'A name on a bar that slides in from the left',
    apply: (s, _w, h) => base(s, {
      size: Math.round(h * 0.06), weight: 700, color: '#ffffff', align: 'left',
      box: { color: '#10131a', padding: Math.round(h * 0.022), radius: 6, opacity: 0.85, mode: 'block' },
      anim: { in: side({ unit: 'line', slide: { dir: 'left', dist: Math.round(h * 0.08) }, dur: 14, stagger: 4, ease: 'out' }), out: side({ unit: 'line', slide: { dir: 'left', dist: Math.round(h * 0.04) }, dur: 10, stagger: 3, ease: 'in', offset: 0 }) },
    }),
  },
  {
    id: 'subtitle', label: 'Subtitle', hint: 'Small centered lines on a dark strip, no motion',
    apply: (s, _w, h) => base(s, {
      size: Math.round(h * 0.045), weight: 500, color: '#ffffff', align: 'center',
      box: { color: '#000000', padding: Math.round(h * 0.01), radius: 4, opacity: 0.6, mode: 'line' },
    }),
  },
  {
    id: 'kinetic', label: 'Kinetic', hint: 'Heavy capitals that spin and scale in one by one',
    apply: (s, _w, h) => base(s, {
      size: Math.round(h * 0.16), weight: 900, color: '#ffffff', align: 'center', caps: 'upper', tracking: 40,
      shadow: { color: '#000000', angle: 90, distance: Math.round(h * 0.008), blur: Math.round(h * 0.015), opacity: 0.5 },
      anim: { in: side({ unit: 'char', fade: true, scale: 0.2, rotate: -25, slide: { dir: 'up', dist: Math.round(h * 0.05) }, dur: 10, stagger: 2, order: 'random', seed: 3, ease: 'overshoot' }), out: side({ unit: 'char', fade: true, scale: 0.6, dur: 8, stagger: 1, order: 'backward', ease: 'in' }) },
    }),
  },
  {
    id: 'pop', label: 'Pop', hint: 'Words bounce up to size, one after another',
    apply: (s, _w, h) => base(s, {
      size: Math.round(h * 0.12), weight: 800, align: 'center',
      anim: { in: side({ unit: 'word', fade: true, scale: 0, dur: 12, stagger: 5, ease: 'bounce' }), out: side({ unit: 'word', fade: true, scale: 0.5, dur: 8, stagger: 3, ease: 'in' }) },
    }),
  },
  {
    id: 'rise', label: 'Rise', hint: 'Lines float up and fade in',
    apply: (s, _w, h) => base(s, {
      size: Math.round(h * 0.09), weight: 600, align: 'center',
      anim: { in: side({ unit: 'line', fade: true, slide: { dir: 'up', dist: Math.round(h * 0.06) }, dur: 16, stagger: 6, ease: 'out' }), out: side({ unit: 'line', fade: true, slide: { dir: 'up', dist: Math.round(h * 0.03) }, dur: 12, stagger: 4, ease: 'in' }) },
    }),
  },
  {
    id: 'blur-in', label: 'Blur in', hint: 'Letters sharpen out of a blur',
    apply: (s, _w, h) => base(s, {
      size: Math.round(h * 0.11), weight: 300, align: 'center', tracking: 120,
      anim: { in: side({ unit: 'char', fade: true, blur: Math.round(h * 0.03), dur: 18, stagger: 2, order: 'center', ease: 'out' }), out: side({ unit: 'char', fade: true, blur: Math.round(h * 0.02), dur: 12, stagger: 1, ease: 'in' }) },
    }),
  },
  {
    id: 'typewriter', label: 'Typewriter', hint: 'Typed out with a cursor, then erased',
    apply: (s, _w, h) => base(s, {
      size: Math.round(h * 0.07), weight: 500, align: 'left',
      anim: { type: { cps: 14, cursor: true, offset: 6, erase: true, eraseOffset: 6 } },
    }),
  },
  {
    id: 'gradient', label: 'Gradient title', hint: 'A two-color fill with a soft shadow',
    apply: (s, _w, h) => base(s, {
      size: Math.round(h * 0.15), weight: 800, align: 'center', color: '#ff7a18', fillTo: { color: '#af002d', angle: 90 },
      shadow: { color: '#000000', angle: 90, distance: Math.round(h * 0.006), blur: Math.round(h * 0.012), opacity: 0.45 },
      anim: { in: side({ unit: 'line', fade: true, scale: 0.85, dur: 16, stagger: 5, ease: 'out' }) },
    }),
  },
  {
    id: 'outline', label: 'Outlined', hint: 'Hollow-looking capitals with a thick outline',
    apply: (s, _w, h) => base(s, {
      size: Math.round(h * 0.16), weight: 900, align: 'center', caps: 'upper', color: '#ffffff', stroke: { color: '#111111', width: Math.max(2, Math.round(h * 0.008)) },
    }),
  },
  {
    id: 'plain', label: 'Plain', hint: 'Take every effect off and keep the words',
    apply: (s) => base(s, {}),
  },
];
