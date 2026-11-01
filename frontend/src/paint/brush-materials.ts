// Gives every starter brush its stamp and grain from the authored libraries (tips-lib.ts, grains-lib.ts),
// so pencil, graphite, charcoal, chalk, bristle, sponge and wash families look like different materials.
// Data, not code paths: a brush stores `tipId` / `grainId`, and the Brush Studio can change both.
// Brushes that are clean line tools (technical pens, monolines) keep their plain procedural tip.

import type { Brush } from './types';
import { hasGrain } from './grains-lib';
import { hasTip } from './tips-lib';
import { dryResponse } from './dry-media';

const parse = (s: string): Map<string, string> => {
  const m = new Map<string, string>();
  for (const line of s.split('\n')) {
    const i = line.lastIndexOf('=');
    if (i > 0) m.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return m;
};

/** Stamp by brush name; an `a:` prefix is for the Animation library only. */
const TIPS = parse(`
pencil hb=lead-hb
soft pencil=lead-2b
graphite 2b=lead-2b
hard 4h=lead-hard
mechanical=lead-mechanical
color pencil=lead-coloured
hatch pencil=lead-flat
carpenter=lead-flat
soft lead=lead-2b
a:scribble=lead-hb
blue lead=lead-coloured
rough hatch=stamp-rake-fine
side shade=lead-worn
sepia pencil=lead-coloured
ghost line=lead-hard
shaky pencil=lead-hb
felt tip=marker-felt
marker=marker-bullet
chisel marker=marker-chisel
highlighter=marker-highlighter
crayon=lead-coloured
wax stick=chalk-stick
dry ink=flat-dry
rough ink=nib-bleed
ink splatter=spatter-splash
flat paint=paint-flat
oil bristle=filbert-medium
impasto=flat-coarse
fan brush=flat-splay
a:bark=paint-plain
a:rust=paint-plain
a:weathered=paint-plain
a:plaster=paint-plain
a:stone=paint-plain
acrylic=paint-round
round paint=paint-round
gouache=paint-gouache
filbert=paint-filbert
dry brush=flat-dry
rake=stamp-rake
dabber=sponge-natural
stipple=sponge-stipple
cross-hatcher=stamp-crosshatch
leaf stamp=stamp-leaf
petal=stamp-leaf
scribble=stamp-scribble
splash=spatter-splash
soft airbrush=air-gauss
medium airbrush=air-smooth
hard airbrush=air-core
fine mist=air-gauss
wide mist=air-smooth
fade=air-linear
grain airbrush=air-gauss
shader=air-sharp
speckle=spatter-mist
dust=chalk-dust
stone=charcoal-chunk
foam=sponge-foam
dot cluster=stamp-dotgrid
chalk=chalk-stick
pastel=pastel-soft
charcoal stick=charcoal-vine
compressed=charcoal-compressed
powder=charcoal-powder
willow=charcoal-willow
conte=chalk-side
a:conte=lead-flat
chalk block=chalk-side
stump=pastel-soft
leaves=stamp-leaf
embers=spatter-coarse
smoke=stamp-cloud
clouds=stamp-cloud
fur=stamp-wire
spray can=spray-mist
fat cap=spray-mist
thin cap=spray-mist
drip splat=spatter-splash
stencil mist=air-gauss
grit spray=spatter-mist
fade spray=spray-mist
leather=stamp-cells
wood grain=stamp-wire
sandpaper=spatter-mist
brushed metal=stamp-wire
letterpress=nib-bleed
halftone=stamp-halftone
mimeograph=sponge-stipple
soft glow=air-gauss
halo=air-halo
aurora=air-smooth
rust=sponge-stipple
grid dots=stamp-dotgrid
gritty marker=marker-chisel
moss=sponge-sea
bark=stamp-wire
fern=stamp-fern
coral=sponge-natural
wet blend=air-smooth
soft wash=air-gauss
bleed=nib-bleed
droplets=spatter-coarse
salt=spatter-mist
ink wash=air-smooth
smoother=air-smooth
blender=air-gauss
streak blend=flat-fine
grain smudge=pastel-soft
dry-edge outline=marker-felt
marker outline=marker-felt
trembling chalk=chalk-board
felt script=marker-felt
stick chalk=chalk-stick
soft pastel=pastel-soft
blackboard=chalk-board
pavement=charcoal-chunk
pastel side=chalk-side
dust chalk=chalk-dust
crumbly=pastel-crumb
oil pastel=lead-coloured
sidewalk=chalk-side
splatter ink=spatter-splash
sumi=round-medium
stipple ink=sponge-stipple
oil blend=filbert-medium
mixed color=round-medium
fan=flat-splay
hog hair=round-coarse
streaky=stamp-rake-fine
flat bristle=flat-medium
rigger=round-fine
stiff=flat-coarse
splay=round-tuft
toothbrush=spatter-mist
worn comb=stamp-rake
salt wash=spatter-mist
natural=sponge-natural
sea sponge=sponge-sea
lichen=sponge-sea
porous=sponge-stipple
mop=sponge-foam
dab sponge=sponge-natural
rough pad=sponge-stipple
round soft=air-gauss
spray fine=air-spray
mist=air-gauss
tint=air-smooth
glow=air-gauss
fade tip=air-linear
spatter mist=spatter-mist
grain=spatter-mist
film grain=spatter-mist
sand=spatter-mist
fibres=stamp-wire
rough=sponge-stipple
cloud noise=stamp-cloud
weathered=sponge-natural
plaster=stamp-cloud
dot row=stamp-dotgrid
hatch row=stamp-crosshatch
rain of dots=spatter-coarse
comb row=stamp-rake
foliage=stamp-leaf
cloud=stamp-cloud
haze=air-gauss
`);

/** Grain by name pattern, first match wins. Applied only to brushes that have grain depth. */
const GRAINS: [RegExp, string][] = [
  // texture brushes: a strong, even surface (paint/fam-paint-grains.ts), so the band reads as one material
  [/^canvas weave$|^canvas$|^fabric weave$/, 'tex-weave'],
  [/^burlap$/, 'tex-burlap'],
  [/^concrete$/, 'tex-concrete'],
  [/^linen$/, 'tex-linen'],
  [/^gritty marker$|^faded print$|^grain smudge$/, 'tex-tooth'],
  [/^paper tooth$/, 'tex-tooth'],
  [/charcoal|willow|stump|compressed|powder/, 'charcoal-grit'],
  [/pastel|conte/, 'pastel-grit'],
  [/pavement|sidewalk|concrete|stone/, 'concrete'],
  [/chalk|blackboard|crumbly|wax stick/, 'chalk-pits'],
  [/crayon/, 'crayon-wax'],
  [/color pencil|blue lead|sepia/, 'paper-fine'],
  [/pencil|lead|graphite|hatch|side shade|shaky|ghost|mechanical|4h/, 'graphite-tooth'],
  [/canvas/, 'canvas-weave'],
  [/linen|fabric/, 'linen'],
  [/burlap/, 'burlap'],
  [/leather/, 'leather'],
  [/wood grain/, 'wood-grain'],
  [/sandpaper/, 'paper-pastel'],
  [/brushed metal/, 'brushed-metal'],
  [/rust/, 'sandstone'],
  [/weathered/, 'cracked'],
  [/plaster/, 'plaster'],
  [/bark/, 'bark'],
  [/paper tooth|faded print/, 'paper-cold-press'],
  [/granulate/, 'paper-rough'],
  // paper tooth, not the bloom blobs: those read as round white holes in a wash (granulation needs fine tooth)
  [/watercolor|wash|stain|bleed|dilute|tide|sky|puddle|wet/, 'paper-cold-press'],
  [/dry brush|dry-edge|dry script|dry ink/, 'dry-brush'],
  [/gouache|acrylic|blender/, 'paper-fine'],
  [/impasto|hog|oil|stiff|splay|streaky|worn comb|mixed|flat|fan|filbert|bristle|knife|sumi|fibre|fur|rough pad/, 'bristle-drag'],
  [/sponge|natural|sea |foam|lichen|porous|coral|mop|dabber|moss/, 'sponge'],
  [/halftone/, 'halftone'],
  [/woodcut|etching/, 'hatch-lines'],
  [/letterpress|mimeograph|ink stamp/, 'paper-newsprint'],
  [/film grain|grain airbrush|^mist$/, 'film-grain'],
  [/fine grain|stencil mist/, 'noise-fine'],
  [/coarse grain/, 'noise-medium'],
  [/grain wash/, 'paper-fine'],
  [/grain smudge|gritty marker|reed/, 'paper-rough'],
  [/^grain$|static/, 'noise-medium'],
  [/^sand$|salt/, 'speckle-fine'],
  [/^rough$|rough/, 'noise-ridged'],
  [/cloud/, 'cloud'],
  [/smoke/, 'smoke'],
  [/torn edge|fibres/, 'paper-fibre'],
  [/felt|marker|ballpoint|brush ink|brush script|fountain|uncial/, 'paper-hot-press'],
];

const SET_GRAIN: Record<string, string> = {
  sketching: 'graphite-tooth', sketch: 'graphite-tooth', charcoals: 'charcoal-grit', chalk: 'chalk-pits',
  water: 'paper-cold-press', wash: 'paper-cold-press', textures: 'noise-medium', texture: 'noise-medium',
  noise: 'noise-medium', materials: 'paper-fine',
};

/** Weaves and tight patterns need a coarser repeat to read at 100% zoom. */
const COARSER: Record<string, number> = { 'paper-cold-press': 0.55, 'canvas-weave': 1.6, linen: 1.6, burlap: 1.2, 'ordered-dither': 2, halftone: 1.6, mesh: 1.6, denim: 1.6 };

export function tipFor(b: Brush): string | undefined {
  const n = b.name.toLowerCase();
  const id = (b.lib === 'animation' ? TIPS.get(`a:${n}`) : undefined) ?? TIPS.get(n);
  return id && hasTip(id) ? id : undefined;
}

export function grainFor(b: Brush): string | undefined {
  if (!(b.grain > 0)) return undefined;
  const n = b.name.toLowerCase();
  for (const [re, id] of GRAINS) if (re.test(n)) return hasGrain(id) ? id : undefined;
  return SET_GRAIN[b.set.toLowerCase()] ?? 'paper-fine';
}

/** The starter brush with its library stamp and grain, and sizes that reach a large canvas. */
export function withMaterials(b0: Brush): Brush {
  const b = dryResponse(b0);
  const out: Brush = { ...b };
  const tip = tipFor(b);
  if (tip) out.tipId = tip;
  const g = grainFor(b);
  if (g) {
    out.grainId = g;
    const k = COARSER[g];
    if (k) out.grainScale = (b.grainScale ?? 1) * k;
  }
  // Stamps that scatter turn at random so the same specks do not trace tracks along the stroke.
  if (out.tipId && /^(air-spray|spatter|pastel-crumb|chalk-dust|sponge|charcoal|chalk-stick|stamp-wire)/.test(out.tipId) && !out.followStroke) out.rotationJitter = Math.max(out.rotationJitter, 1);
  // A wider slider range with the default sizes kept: presets shrink by the same factor the maximum grows.
  // Line tools (pens, markers, liners) keep their own range: a pen that reaches 100 px at 45 percent is no pen.
  if (b.maxSize >= 24) {
    const f = /^(inking|drawing|outline|monoline|script|ink|calligraphy)$/i.test(b.set) ? 1 : 1.6;
    out.maxSize = Math.round(b.maxSize * f * 10) / 10;
    out.presets = b.presets.map((p) => ({ ...p, size: p.size / f }));
  }
  return out;
}
