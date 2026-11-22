// Brush panel: a glyph for every set. Fourteen drawings cover the starter sets by what they do (a pencil for
// sketching, a drop for water, a spray can for airbrush ...); a set made or imported by the person gets the tray.
// Inline SVG in currentColor, no library.

const S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

const G = {
  pencil: `<svg ${S}><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/></svg>`,
  nib: `<svg ${S}><path d="M12 3l5 8-5 10-5-10z"/><path d="M12 11v4"/><circle cx="12" cy="9" r="1"/></svg>`,
  brush: `<svg ${S}><path d="M18.5 4.5c-4 1-8 5-9.5 9l2.5 2.5c4-1.5 8-5.5 9-9.5z"/><path d="M9 13.5c-2.5 0-4 1.5-4 4 0 1.5-.5 2-1.5 2.5 3.5 1 7 .5 8.5-2"/></svg>`,
  drop: `<svg ${S}><path d="M12 3.5c3.5 4.5 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 2.5-6.5 6-11z"/><path d="M9.5 15a2.5 2.5 0 0 0 2 2.5"/></svg>`,
  wave: `<svg ${S}><path d="M3 9c3-4 6-4 9 0s6 4 9 0"/><path d="M3 15c3-4 6-4 9 0s6 4 9 0"/></svg>`,
  spray: `<svg ${S}><rect x="4" y="9" width="7" height="12" rx="1.5"/><path d="M6.5 9V6h2v3"/><circle cx="15" cy="7" r=".6"/><circle cx="18" cy="5" r=".6"/><circle cx="18.5" cy="9" r=".6"/><circle cx="21" cy="7" r=".6"/><circle cx="15.5" cy="11" r=".6"/></svg>`,
  grain: `<svg ${S}><circle cx="6" cy="7" r=".8"/><circle cx="12" cy="5.5" r=".8"/><circle cx="18" cy="8" r=".8"/><circle cx="8.5" cy="12" r=".8"/><circle cx="15" cy="12.5" r=".8"/><circle cx="5.5" cy="17.5" r=".8"/><circle cx="11.5" cy="18" r=".8"/><circle cx="18.5" cy="17" r=".8"/></svg>`,
  grid: `<svg ${S}><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>`,
  leaf: `<svg ${S}><path d="M5 19C5 9 11 4.5 20 4.5c0 9-4.5 15-13.5 14.5"/><path d="M5 19c3-5 6-8 10-10"/></svg>`,
  sun: `<svg ${S}><circle cx="12" cy="12" r="4"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/></svg>`,
  gear: `<svg ${S}><circle cx="12" cy="12" r="3"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/></svg>`,
  star: `<svg ${S}><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z"/></svg>`,
  flame: `<svg ${S}><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.2 2 2.5C11.5 8.5 11 5.5 12 3z"/></svg>`,
  ring: `<svg ${S}><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3" stroke-dasharray="1.5 2.5"/></svg>`,
  line: `<svg ${S}><circle cx="5" cy="19" r="1.4"/><circle cx="19" cy="5" r="1.4"/><path d="M6.2 17.8 17.8 6.2"/></svg>`,
  script: `<svg ${S}><path d="M4 16c3 4 5-9 8-9s-1 11 3 8 3-6 5-5"/></svg>`,
  comb: `<svg ${S}><path d="M5 20V8M9 20V5M13 20V7M17 20V4M21 20V9" transform="translate(-1 0)"/></svg>`,
  sponge: `<svg ${S}><path d="M5 10c0-3 3-5 7-5s7 2 7 5v6c0 2-3 3-7 3s-7-1-7-3z"/><circle cx="10" cy="11" r="1"/><circle cx="14.5" cy="13.5" r="1.2"/><circle cx="9.5" cy="15.5" r=".8"/></svg>`,
  hatch: `<svg ${S}><path d="M5 19 19 5M5 13l8-8M11 19l8-8M5 7l2-2M17 19l2-2"/></svg>`,
  diamonds: `<svg ${S}><path d="M12 3l4.5 4.5L12 12 7.5 7.5zM7.5 12 12 16.5 7.5 21 3 16.5zM16.5 12 21 16.5 16.5 21 12 16.5z"/></svg>`,
  skyline: `<svg ${S}><path d="M4 20V11h4v9M8 20V5h5v15M13 20v-8h4v8M3 20h18"/></svg>`,
  cube: `<svg ${S}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12 4 7.5M12 12l8-4.5M12 12v9"/></svg>`,
  triangle: `<svg ${S}><path d="M12 4l9 16H3z"/></svg>`,
  tray: `<svg ${S}><path d="M4 7.5V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18V9.5A1.5 1.5 0 0 0 18.5 8H12L10 6H5.5A1.5 1.5 0 0 0 4 7.5z"/></svg>`,
  clock: `<svg ${S}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`,
} as const;

type Key = keyof typeof G;

const BY_NAME: Record<string, Key> = {
  // Animation sets
  pencil: 'pencil', pastel: 'triangle', 'line art': 'ring', 'even line': 'line', 'boiling line': 'wave', pens: 'nib', lettering: 'script', watercolor: 'drop',
  'thick paint': 'brush', 'rough brush': 'comb', spray: 'spray', dabbing: 'sponge', grain: 'grain', surfaces: 'hatch', stamps: 'grid', motifs: 'diamonds',
  geometric: 'skyline', scenery: 'leaf',
  // Classic sets
  graphite: 'pencil', markers: 'line', 'comic ink': 'nib', 'studio paint': 'brush', 'mark making': 'star', nibs: 'script', mist: 'spray', grit: 'hatch',
  shapes: 'diamonds', charcoal: 'triangle', atmosphere: 'flame', graffiti: 'spray', finishes: 'cube', printmaking: 'clock', light: 'sun', metalwork: 'gear',
  nature: 'leaf', 'wet media': 'drop',
};

/** The glyph for a set by its name; the recent list has its own clock, sets of the person's own the tray. */
export function setGlyph(name: string, recent = false): string {
  if (recent) return G.clock;
  return G[BY_NAME[name.trim().toLowerCase()] ?? 'tray'];
}

/** How many different glyphs the starter sets use (for the record of FV-217: fourteen or more). */
export const GLYPH_COUNT = Object.keys(G).length;
