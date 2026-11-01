/** Maps the settings of one brush-file preset onto this app's Brush. Each group of settings (tip, shape dynamics, scatter,
 *  texture, colour, transfer, extras) is one function that reads its keys through a tracking reader, writes the Brush fields
 *  it can express, and says in `notes` what it approximated or left out. Keys nobody read come back in `skipped`.
 *  Percent values are stored as 0 to 100 numbers in the file. */

import type { Brush, ColorDyn } from '../paint/types';
import type { BlendMode } from '../engine/types';
import { makePresets } from '../paint/brushes';
import { isNode, isEnum, numOf, textOf, dynOf, type DescNode, type DescValue, type Dyn } from './abr-desc';
import type { AbrSample, AbrLegacy } from './abr';
import type { AbrPattern } from './abr-patt';
import { patternToGrain } from './abr-patt';
import { dualToGrain, DUAL_DAB } from './abr-dual';
import { t } from '../ui/i18n';
import { tf } from '../ui/i18n-fill';

export interface MapCtx {
  samples: Map<string, AbrSample>;
  patterns: Map<string, AbrPattern>;
  newId: () => string;
  /** False: tip, size and spacing only. */
  applySettings: boolean;
  /** Sizes stay the file's pixels instead of scaling with the canvas. */
  absoluteSizes: boolean;
}

export interface Mapped { brush: Brush; notes: string[]; skipped: string[] }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const r2 = (v: number): number => Math.round(v * 1000) / 1000;

/** Keys that are read by nobody on purpose and not worth listing as skipped. */
const QUIET = new Set(['Nm  ', 'protectTexture', 'useBrushSize', 'interpretation', 'Intr', 'toolOptions', 'brushPosePressure', 'brushPoseTiltX', 'brushPoseTiltY', 'brushPoseAngle', 'overridePoseAngle', 'overridePoseTiltX', 'overridePoseTiltY', 'overridePosePressure', 'useBrushPose']);

/** A node read through `get`, remembering which keys were looked at. */
class Src {
  readonly used = new Set<string>();
  constructor(readonly n: DescNode) {}
  v(k: string): DescValue | undefined { this.used.add(k); return this.n.items.get(k); }
  num(k: string): number | null { return numOf(this.v(k)); }
  bool(k: string): boolean | null { const x = this.v(k); return typeof x === 'boolean' ? x : null; }
  text(k: string): string | null { return textOf(this.v(k)); }
  dyn(k: string): Dyn | null { return dynOf(this.v(k)); }
  enumId(k: string): string | null { const x = this.v(k); return isEnum(x) ? x.e : null; }
  node(k: string): DescNode | null { const x = this.v(k); return isNode(x) ? x : null; }
  has(k: string): boolean { return this.n.items.has(k); }
}

const BLEND: Record<string, BlendMode> = {
  Mltp: 'multiply', Drkn: 'darken', Lghn: 'lighten', Scrn: 'screen', Ovrl: 'overlay', HrdL: 'hard-light', SftL: 'soft-light',
  CDdg: 'color-dodge', CBrn: 'color-burn', LnBr: 'linear-burn', Dfrn: 'difference', Xclu: 'exclusion', Nrml: 'normal',
  Hue: 'hue', Strt: 'saturation', Clr: 'color', Lmns: 'luminosity',
};

/** Control codes of the dynamics groups: 0 off, 1 fade, 2 pen pressure, 3 pen tilt, 4 stylus wheel, 5 rotation, 6 initial direction, 7 direction. */
const CONTROL_NAME = ['off', 'fade', 'pen pressure', 'pen tilt', 'stylus wheel', 'pen rotation', 'initial direction', 'direction'];
const ctlName = (c: number): string => (CONTROL_NAME[c] ? t(CONTROL_NAME[c]) : tf('control {n}', { n: c }));
/** A note on one setting: the sentence whole through t(), the control's name as its own value. */
const ctlNote = (sentence: string, c: number): string => tf(sentence, { control: ctlName(c) });

function baseBrush(id: string, name: string, tipsOnly: boolean): Brush {
  return {
    id, name: name.slice(0, 60), set: 'Imported', tip: 'round', softness: 0, maxSize: 30, minSize: 2, spacing: 0.25, flow: 1,
    pressureSize: tipsOnly ? [0.5, 1] : [1, 1], pressureFlow: tipsOnly ? [0.7, 1] : [1, 1], tilt: 0, scatter: 0, rotationJitter: 0,
    followStroke: false, roundness: 1, grain: 0, smoothing: 0.2, pickup: 0.5, presets: makePresets(1), custom: true,
  };
}

// ---- tip -----------------------------------------------------------------------

function sizesFrom(b: Brush, dia: number, ctx: MapCtx, notes: string[]): void {
  const d = Math.max(1, dia);
  if (d > 400) notes.push(tf('Size {n} px is capped at 400 px.', { n: Math.round(d) }));
  b.maxSize = clamp(Math.round(d), 1, 400);
  b.minSize = Math.max(1, Math.round(b.maxSize * 0.06 * 10) / 10);
  if (ctx.absoluteSizes) b.sizeAbs = true;
}

function mapTip(p: Src, tipNode: DescNode | null, b: Brush, ctx: MapCtx, notes: string[]): void {
  const ts = tipNode ? new Src(tipNode) : p;
  const sid = ts.text('sampledData')?.trim();
  const dmtr = ts.num('Dmtr');
  const cls = tipNode?.cls ?? '';
  const sample = sid ? ctx.samples.get(sid) : undefined;
  if (cls === 'dBrush') {
    b.tip = 'bristle';
    notes.push(t('Bristle tip drawn as this app\'s bristle tip.'));
  } else if (cls === 'dTips') {
    b.tip = 'round'; b.softness = 0.5;
    notes.push(t('Erodible or airbrush tip drawn as a soft round tip.'));
  } else if (sid) {
    if (sample) {
      b.tip = 'sampled';
      b.tipImage = { w: sample.w, h: sample.h, data: sample.data, key: b.id };
    } else {
      b.tip = 'round'; b.softness = 0.5;
      notes.push(t('The tip picture is not in the file; a soft round tip is used.'));
    }
  } else {
    // computed (round) tip
    b.tip = 'round';
    const hard = ts.num('Hrdn');
    if (hard !== null) b.softness = r2(clamp(1 - hard / 100, 0, 1));
  }
  const natural = sample ? Math.max(sample.srcW, sample.srcH) : 30;
  sizesFrom(b, dmtr ?? natural, ctx, notes);
  const rn = ts.num('Rndn');
  if (rn !== null) b.roundness = r2(clamp(rn / 100, 0.05, 1));
  const ang = ts.num('Angl');
  // the file turns counter-clockwise, the canvas clockwise
  if (ang) b.baseRot = r2((-ang * Math.PI) / 180);
  const fx = ts.bool('flipX') ?? p.bool('flipX'), fy = ts.bool('flipY') ?? p.bool('flipY');
  if (fx) b.flipX = true;
  if (fy) b.flipY = true;
  const sp = p.num('Spcn') ?? ts.num('Spcn');
  const auto = (p.bool('Intr') ?? ts.bool('Intr')) === false;
  b.spacing = r2(clamp((sp ?? 25) / 100, 0.02, 2));
  if (auto) { b.speedSpacing = 0.3; notes.push(t('Automatic spacing is approximated: gaps widen with pen speed.')); }
  for (const k of ['Dmtr', 'Hrdn', 'Rndn', 'Angl', 'flipX', 'flipY', 'Spcn', 'Intr', 'sampledData', 'Nm  ']) ts.used.add(k);
  p.v('flipX'); p.v('flipY');
}

// ---- shape dynamics ----------------------------------------------------------------

function mapShape(p: Src, b: Brush, notes: string[]): void {
  const on = p.bool('useTipDynamics');
  const sz = p.dyn('szVr'), ang = p.dyn('angleDynamics'), rd = p.dyn('roundnessDynamics');
  const minD = (p.num('minimumDiameter') ?? 0) / 100, minR = (p.num('minimumRoundness') ?? 25) / 100;
  const tiltScale = clamp((p.num('tiltScale') ?? 100) / 100, 0, 1);
  const proj = p.bool('brushProjection');
  if (!on) return;
  if (sz) {
    const drop = 1 - minD;
    if (sz.control === 2) b.pressureSize = [r2(minD), 1];
    else if (sz.control === 3) b.tiltSize = r2(-drop * Math.max(0.3, tiltScale));
    else if (sz.control === 1) {
      b.fallOff = r2(clamp(drop / 0.85, 0.15, 1));
      notes.push(tf('Size fade over {n} steps is approximated by a fixed length.', { n: sz.steps }));
    } else if (sz.control === 5) { b.rollSize = r2(drop); notes.push(t('Size follows pen rotation, approximated.')); }
    else if (sz.control === 4) notes.push(t('Size control by stylus wheel is not carried.'));
    if (sz.jitter > 0) b.jitterSize = r2(clamp((sz.jitter / 100) * drop / 0.7, 0, 1));
  }
  if (ang) {
    if (ang.jitter > 0) b.rotationJitter = r2(clamp(ang.jitter / 100, 0, 1));
    if (ang.control === 6 || ang.control === 7) {
      b.followStroke = true;
      // the file's angle 0 lies along the stroke; this engine's lies across it
      b.baseRot = r2((b.baseRot ?? 0) - Math.PI / 2);
      if (ang.control === 6) notes.push(t('Initial direction is approximated as following the stroke.'));
    } else if (ang.control === 3) { b.azimuth = true; notes.push(t('Angle follows the lean of the pen, approximated.')); }
    else if (ang.control !== 0) notes.push(ctlNote('Angle control "{control}" is not carried.', ang.control));
  }
  if (rd) {
    const amt = clamp((1 - minR) / 0.9, 0, 1);
    if (rd.jitter > 0) b.roundJitterH = r2(clamp((rd.jitter / 100) * amt, 0, 1));
    if (rd.control === 2) b.pressureRoundness = r2(amt);
    else if (rd.control === 3) b.tiltRoundness = r2(amt);
    else if (rd.control !== 0) notes.push(ctlNote('Roundness control "{control}" is not carried.', rd.control));
  }
  if (proj && !b.tiltRoundness) { b.tiltRoundness = 0.5; notes.push(t('Brush projection is approximated: leaning flattens the tip.')); }
}

// ---- scatter and count --------------------------------------------------------------

function mapScatter(p: Src, b: Brush, notes: string[]): void {
  const on = p.bool('useScatter');
  const sc = p.dyn('scatterDynamics'), cd = p.dyn('countDynamics');
  const both = p.bool('bothAxes'), count = p.num('Cnt ');
  if (!on) return;
  if (sc && sc.jitter > 0) {
    if (both) b.scatter = r2(clamp(sc.jitter / 100, 0, 1));
    else b.pathJitter = r2(clamp(sc.jitter / 50, 0, 1));
    if (sc.jitter > 100) notes.push(tf('Scatter {n}% is capped at the largest this app draws.', { n: Math.round(sc.jitter) }));
    if (sc.control !== 0) notes.push(ctlNote('Scatter control "{control}" is not carried; the amount stays constant.', sc.control));
  }
  if (count && count > 1) {
    b.shapeCount = clamp(Math.round(count), 1, 16);
    notes.push(t('Count draws smaller tips inside the dab instead of full-size ones.'));
  }
  if (cd) {
    if (cd.jitter > 0) b.countJitter = r2(clamp(cd.jitter / 100, 0, 1));
    if (cd.control !== 0) notes.push(ctlNote('Count control "{control}" is not carried.', cd.control));
  }
}

// ---- texture ---------------------------------------------------------------------

function mapTexture(p: Src, b: Brush, ctx: MapCtx, notes: string[]): void {
  const on = p.bool('useTexture');
  const tx = p.node('Txtr');
  const depth = p.num('textureDepth'), scale = p.num('textureScale'), minDepth = p.num('minimumDepth'), dd = p.dyn('textureDepthDynamics');
  const mode = p.enumId('textureBlendMode'), each = p.bool('TxtC'), inv = p.bool('InvT');
  const bri = p.num('textureBrightness'), con = p.num('textureContrast');
  if (!on) return;
  if (!tx) { notes.push(t('Texture is on, but the file names no pattern.')); return; }
  const tn = new Src(tx);
  const pid = tn.text('Idnt')?.trim(), pname = tn.text('Nm  ')?.trim();
  tn.used.add('Idnt');
  let pat = pid ? ctx.patterns.get(pid) : undefined;
  if (!pat && pname) for (const q of ctx.patterns.values()) if (q.name === pname) { pat = q; break; }
  if (!pat) { notes.push(pname ? tf('Texture pattern "{name}" is not in the file, so the texture is left out.', { name: pname }) : t('Texture pattern is not in the file, so the texture is left out.')); return; }
  const fit = patternToGrain(pat);
  b.grainImage = fit.tile;
  if (fit.seamless) b.grainSeamless = true;
  b.grain = r2(clamp((depth ?? 100) / 100, 0, 1));
  const sc = ((scale ?? 100) / 100) * fit.fit;
  b.grainScale = r2(clamp(sc, 0.25, 4));
  if (sc < 0.25 || sc > 4) notes.push(tf('Texture scale {n}% is held to the range this app draws.', { n: Math.round(scale ?? 100) }));
  if (inv) b.grainInvert = true;
  if (each) { b.grainMode = 'moving'; b.grainMovement = 1; } else b.grainMode = 'texturized';
  if (mode === 'Sbtr') b.grainBlend = 'subtract';
  else if (mode && mode !== 'Mltp') notes.push(tf('Texture mode {mode} is drawn as Multiply.', { mode }));
  if (minDepth) b.grainDepthMin = r2(clamp(minDepth / 100, 0, 1));
  if (dd) {
    if (dd.jitter > 0) b.grainJitter = r2(clamp(dd.jitter / 100, 0, 1));
    if (dd.control !== 0) notes.push(ctlNote('Texture depth control "{control}" is not carried.', dd.control));
  }
  if (bri) b.grainBright = r2(clamp(bri / 150, -1, 1));
  if (con) b.grainContrast = r2(clamp(con / 150, -1, 1));
}

// ---- colour dynamics --------------------------------------------------------------

function mapColour(p: Src, b: Brush, notes: string[]): void {
  const on = p.bool('useColorDynamics');
  const fb = p.dyn('clVr'), hue = p.num('H   '), sat = p.num('Strt'), bri = p.num('Brgh'), pur = p.num('purity'), each = p.bool('colorDynamicsPerTip');
  if (!on) return;
  const cd: ColorDyn = {};
  const f = (v: number | null): number => r2(clamp((v ?? 0) / 100, 0, 1));
  if (each) { cd.stampHue = f(hue); cd.stampSat = f(sat); cd.stampBri = f(bri); if (fb && fb.jitter > 0) cd.stampSecondary = f(fb.jitter); }
  else { cd.strokeHue = f(hue); cd.strokeSat = f(sat); cd.strokeBri = f(bri); if (fb && fb.jitter > 0) cd.strokeSecondary = f(fb.jitter); }
  for (const k of Object.keys(cd) as (keyof ColorDyn)[]) if (!cd[k]) delete cd[k];
  if (Object.keys(cd).length) b.colorDyn = cd;
  if (fb && fb.control !== 0) notes.push(ctlNote('Foreground and background control "{control}" is not carried.', fb.control));
  if (pur) notes.push(t('Purity is not carried.'));
}

// ---- transfer, wet edges, noise ---------------------------------------------------------

function mapTransfer(p: Src, b: Brush, notes: string[]): void {
  const on = p.bool('usePaintDynamics');
  const op = p.dyn('opVr'), fl = p.dyn('prVr');
  if (!on) return;
  if (op) {
    const lo = clamp(op.min / 100, 0, 1);
    if (op.control === 2) b.pressureOpacity = r2(1 - lo);
    else if (op.control === 3) b.tiltOpacity = r2(-(1 - lo));
    else if (op.control === 1) { b.burnout = r2(clamp(1 - lo, 0.2, 1)); notes.push(tf('Opacity fade over {n} steps is approximated by a fixed length.', { n: op.steps })); }
    else if (op.control !== 0) notes.push(ctlNote('Opacity control "{control}" is not carried.', op.control));
  }
  if (fl) {
    const lo = clamp(fl.min / 100, 0, 1);
    if (fl.control === 2) b.pressureFlow = [r2(lo), 1];
    else if (fl.control === 1) { b.burnout = Math.max(b.burnout ?? 0, r2(clamp(1 - lo, 0.2, 1))); notes.push(t('Flow fade is approximated by a fixed length.')); }
    else if (fl.control !== 0) notes.push(ctlNote('Flow control "{control}" is not carried.', fl.control));
  }
  const j = Math.max(op?.jitter ?? 0, fl?.jitter ?? 0);
  if (j > 0) { b.jitterOpacity = r2(clamp(j / 100, 0, 1)); if ((op?.jitter ?? 0) > 0 && (fl?.jitter ?? 0) > 0) notes.push(t('Opacity and flow jitter are merged into one.')); }
}

/** The second tip of a dual brush as the grain, when no texture already holds it. */
function mapDual(dual: DescNode, b: Brush, ctx: MapCtx, notes: string[]): void {
  const d = new Src(dual);
  const tipNode = d.node('Brsh');
  const t2 = tipNode ? new Src(tipNode) : d;
  const sid = t2.text('sampledData')?.trim();
  const sample = sid ? ctx.samples.get(sid) : undefined;
  if (b.grainImage || b.grainId) { notes.push(t('Dual brush is not carried (the texture is kept).')); return; }
  if (sid && !sample) { notes.push(t('The dual brush tip is not in the file, so the dual brush is left out.')); return; }
  const dia = Math.max(2, t2.num('Dmtr') ?? (sample ? Math.max(sample.srcW, sample.srcH) : 30));
  const sp = (d.num('Spcn') ?? t2.num('Spcn') ?? 25) / 100;
  const scat = d.bool('useScatter') ? (d.dyn('scatterDynamics')?.jitter ?? d.num('Sctr') ?? 0) / 100 : 0;
  const cnt = d.bool('useScatter') ? d.num('Cnt ') ?? 1 : 1;
  for (const k of ['Hrdn', 'Rndn', 'Angl', 'Intr', 'flipX', 'flipY', 'Nm  ', 'bothAxes', 'countDynamics', 'useDualBrush']) { t2.used.add(k); d.used.add(k); }
  b.grainImage = dualToGrain({
    tip: sample ? { w: sample.w, h: sample.h, data: sample.data } : null, hardness: (t2.num('Hrdn') ?? 100) / 100,
    spacing: clamp(sp, 0.05, 2), scatter: clamp(scat, 0, 2), count: cnt, flip: !!(d.bool('Flip') ?? t2.bool('flipX')),
  });
  b.grainSeamless = true;
  b.grain = 0.85;
  b.grainScale = r2(clamp(dia / DUAL_DAB, 0.25, 4));
  b.grainMode = 'texturized';
  const bm = d.enumId('BlnM');
  if (bm === 'Sbtr') b.grainBlend = 'subtract';
  else if (bm && bm !== 'Mltp') notes.push(tf('Dual brush mode {mode} is drawn as Multiply.', { mode: bm }));
  notes.push(t('Dual brush is approximated: its second tip is laid out as a grain over the main tip.'));
}

function mapExtras(p: Src, b: Brush, ctx: MapCtx, notes: string[]): void {
  if (p.bool('Wtdg')) { b.wetEdges = 0.6; }
  if (p.bool('Nose')) {
    if (!b.grainImage && !b.grainId) { b.grainId = 'noise-fine'; b.grain = Math.max(b.grain, 0.3); notes.push(t('Noise is approximated by a fine grain.')); }
    else notes.push(t('Noise is not carried (the texture is kept).'));
  }
  if (p.bool('Rpt ')) notes.push(t('Build-up is not carried.'));
  if (p.has('wtVr') || p.has('mxVr')) { p.v('wtVr'); p.v('mxVr'); }
  const dual = p.node('dualBrush');
  if (dual && new Src(dual).bool('useDualBrush')) mapDual(dual, b, ctx, notes);
  if (p.bool('useBrushPose')) notes.push(t('Brush pose is not carried.'));
  if (p.bool('protectTexture')) notes.push(t('Protect texture is a panel mode, not carried.'));
  const to = p.node('toolOptions');
  if (!to) return;
  const tool = new Src(to);
  const flow = tool.num('flow'), opct = tool.num('Opct'), md = tool.enumId('Md  ');
  if (flow !== null && flow > 0 && flow < 100) b.flow = r2(clamp(flow / 100, 0.05, 1));
  if (opct !== null && opct > 0 && opct < 100) b.presets = makePresets(r2(clamp(opct / 100, 0.05, 1)));
  if (md && BLEND[md] && BLEND[md] !== 'normal') b.blend = BLEND[md];
  const smooth = tool.num('smoothingValue') ?? tool.num('Smoo');
  if (smooth !== null && smooth > 0) { b.smoothing = r2(clamp(smooth / 100, 0, 1)); b.stabilization = Math.round(clamp(smooth, 0, 100) / 2); }
  if (tool.bool('pressureSmoothing')) b.pressureSmooth = 0.5;
  const prs = tool.num('Prs ');
  if (prs !== null) { b.pickup = r2(clamp(prs / 100, 0, 1)); notes.push(t('This preset belongs to the smudge tool.')); }
  if (to.cls === 'MixB') notes.push(t('Mixer brush settings are not carried.'));
}

// ---- entry points ------------------------------------------------------------------------

function finish(p: Src, b: Brush, notes: string[]): Mapped {
  const skipped: string[] = [];
  for (const k of p.n.items.keys()) if (!p.used.has(k) && !QUIET.has(k)) skipped.push(k.trim());
  return { brush: b, notes, skipped };
}

/** One preset descriptor as a brush. `index` names a preset the file left unnamed. */
export function mapPreset(node: DescNode, ctx: MapCtx, index: number, base: string): Mapped {
  const p = new Src(node);
  const notes: string[] = [];
  const tipNode = p.node('Brsh');
  const tipAsSelf = !tipNode && (node.items.has('sampledData') || node.items.has('Dmtr'));
  const tn = tipNode ?? (tipAsSelf ? node : null);
  const name = (p.text('Nm  ') ?? (tn ? textOf(tn.items.get('Nm  ')) : null) ?? '').trim() || `${base} ${index + 1}`;
  const b = baseBrush(ctx.newId(), name, !ctx.applySettings);
  mapTip(p, tn, b, ctx, notes);
  if (ctx.applySettings) {
    mapShape(p, b, notes);
    mapScatter(p, b, notes);
    mapTexture(p, b, ctx, notes);
    mapColour(p, b, notes);
    mapTransfer(p, b, notes);
    mapExtras(p, b, ctx, notes);
  }
  return finish(p, b, notes);
}

/** A brush of a version 1 or 2 file. */
export function mapLegacy(l: AbrLegacy, ctx: MapCtx): Mapped {
  const b = baseBrush(ctx.newId(), l.name, true);
  const notes: string[] = [];
  b.spacing = r2(clamp(l.spacing, 0.02, 2));
  if (l.tip) {
    b.tip = 'sampled';
    b.tipImage = { w: l.tip.w, h: l.tip.h, data: l.tip.data, key: b.id };
    sizesFrom(b, Math.max(l.tip.srcW, l.tip.srcH), ctx, notes);
  } else if (l.computed) {
    const c = l.computed;
    b.tip = 'round';
    b.softness = r2(clamp(1 - c.hardness / 100, 0, 1));
    b.roundness = r2(clamp(c.roundness / 100, 0.05, 1));
    if (c.angle) b.baseRot = r2((-c.angle * Math.PI) / 180);
    sizesFrom(b, c.diameter || 20, ctx, notes);
  }
  return { brush: b, notes, skipped: [] };
}

/** A tip no preset names: a tip-only brush. */
export function mapSample(s: AbrSample, ctx: MapCtx, index: number, base: string): Mapped {
  const b = baseBrush(ctx.newId(), `${base} ${index + 1}`, true);
  const notes: string[] = [];
  b.tip = 'sampled';
  b.tipImage = { w: s.w, h: s.h, data: s.data, key: b.id };
  b.spacing = 0.25;
  sizesFrom(b, Math.max(s.srcW, s.srcH), ctx, notes);
  return { brush: b, notes, skipped: [] };
}
