// Scene effects (weather, light, particles): Movie.sceneFx, drawn over the content and under the subtitles.
import type { Movie, SceneFx } from './types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export interface FrameView { scale: number; ox: number; oy: number; width: number; height: number }
export interface FxBox { x: number; y: number; w: number; h: number }

export type SceneFxGroup = 'weather' | 'particles' | 'light';
export interface SceneFxKind { kind: string; name: string; group: SceneFxGroup; amount: number }

export const SCENE_FX: readonly SceneFxKind[] = [
  { kind: 'rain', name: 'Rain', group: 'weather', amount: 0.6 },
  { kind: 'snow', name: 'Snow', group: 'weather', amount: 0.6 },
  { kind: 'fog', name: 'Fog', group: 'weather', amount: 0.6 },
  { kind: 'leaves', name: 'Blowing Leaves', group: 'weather', amount: 0.6 },
  { kind: 'dust', name: 'Dust', group: 'particles', amount: 0.6 },
  { kind: 'confetti', name: 'Confetti', group: 'particles', amount: 0.6 },
  { kind: 'fireflies', name: 'Fireflies', group: 'particles', amount: 0.6 },
  { kind: 'bubbles', name: 'Bubbles', group: 'particles', amount: 0.6 },
  { kind: 'sunrays', name: 'Sun Rays', group: 'light', amount: 0.6 },
  { kind: 'sunset', name: 'Sunset Glow', group: 'light', amount: 0.6 },
  { kind: 'night', name: 'Night', group: 'light', amount: 0.7 },
  { kind: 'spotlight', name: 'Spotlight', group: 'light', amount: 0.7 },
  { kind: 'lightning', name: 'Lightning', group: 'light', amount: 0.7 },
];

const KINDS = new Map(SCENE_FX.map((k) => [k.kind, k]));
export const sceneFxKind = (kind: string): SceneFxKind | undefined => KINDS.get(kind);

const TAU = Math.PI * 2;
const frac = (x: number): number => x - Math.floor(x);
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

function rnd(seed: number, i: number, k: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(k + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const count = (base: number, a: number, b: FxBox): number =>
  Math.round(base * (0.15 + 0.85 * a) * clamp(b.w / b.h / (16 / 9), 0.5, 2));

function rgb(hex: string | undefined, fallback: string): [number, number, number] {
  const s = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
}
const rgba = (c: [number, number, number], a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1).toFixed(4)})`;

type Draw = (ctx: Ctx, b: FxBox, t: number, a: number, s: number, fx: SceneFx | null) => void;

const rain: Draw = (ctx, b, t, a, s) => {
  ctx.fillStyle = `rgba(16,24,40,${(0.28 * a).toFixed(4)})`;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  const n = count(320, a, b);
  const slant = 0.2;
  ctx.lineCap = 'round';
  for (let layer = 0; layer < 2; layer++) {
    ctx.beginPath();
    for (let i = layer; i < n; i += 2) {
      const v = (layer ? 2.3 : 1.5) + rnd(s, i, 1) * 0.6;
      const len = b.h * (layer ? 0.07 : 0.04) * (0.7 + 0.6 * rnd(s, i, 2));
      const travel = b.h + 2 * len;
      const p = frac(rnd(s, i, 3) + t * v * b.h / travel);
      const y = b.y - len + p * travel;
      const x = b.x - slant * travel + rnd(s, i, 0) * (b.w + slant * travel) + slant * p * travel;
      ctx.moveTo(x, y);
      ctx.lineTo(x - slant * len, y - len);
    }
    ctx.lineWidth = b.h * (layer ? 0.0036 : 0.0021);
    ctx.strokeStyle = `rgba(214,224,240,${((layer ? 0.8 : 0.5) * (0.5 + 0.5 * a)).toFixed(4)})`;
    ctx.stroke();
  }
};

const snow: Draw = (ctx, b, t, a, s) => {
  const n = count(220, a, b);
  for (let layer = 0; layer < 2; layer++) {
    ctx.beginPath();
    for (let i = layer; i < n; i += 2) {
      const r = b.h * (layer ? 0.005 + 0.006 * rnd(s, i, 1) : 0.0022 + 0.002 * rnd(s, i, 1));
      const v = (layer ? 0.13 : 0.07) * (0.8 + 0.4 * rnd(s, i, 2));
      const travel = b.h + 2 * r;
      const y = b.y - r + frac(rnd(s, i, 3) + t * v * b.h / travel) * travel;
      const sway = Math.sin(t * (0.5 + rnd(s, i, 4) * 0.8) + rnd(s, i, 5) * TAU) * b.h * 0.03 + t * 0.02 * b.h;
      const span = b.w + 2 * r + b.h * 0.06;
      const x = b.x - r - b.h * 0.03 + frac(rnd(s, i, 0) + sway / span) * span;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
    ctx.fillStyle = layer ? 'rgba(255,255,255,0.92)' : 'rgba(240,246,255,0.6)';
    ctx.fill();
  }
};

const fog: Draw = (ctx, b, t, a, s, fx) => {
  const c = rgb(fx?.color, '#dfe5ec');
  const base = ctx.createLinearGradient(0, b.y + b.h * 0.3, 0, b.y + b.h);
  base.addColorStop(0, rgba(c, 0));
  base.addColorStop(1, rgba(c, 0.6 * a));
  ctx.fillStyle = base;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const r = b.h * (0.3 + 0.3 * rnd(s, i, 1));
    const rw = r * 2.4;
    const span = b.w + 2 * rw;
    const speed = b.h * (0.012 + 0.02 * rnd(s, i, 3));
    const x = b.x - rw + frac(rnd(s, i, 0) + t * speed / span) * span;
    const y = b.y + b.h * (0.4 + 0.55 * rnd(s, i, 2));
    const breathe = 0.75 + 0.25 * Math.sin(t * (0.2 + 0.2 * rnd(s, i, 4)) + rnd(s, i, 5) * TAU);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, rgba(c, 0.42 * a * breathe));
    g.addColorStop(1, rgba(c, 0));
    ctx.setTransform(2.4, 0, 0, 1, x, y);
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, 2 * r, 2 * r);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
};

const LEAF = ['#d9822b', '#c4501f', '#e8b13a', '#9a6b2f', '#b5462a'];
const leaves: Draw = (ctx, b, t, a, s) => {
  const n = count(40, a, b);
  for (let i = 0; i < n; i++) {
    const sz = b.h * (0.018 + 0.016 * rnd(s, i, 1));
    const m = 3 * sz;
    const vx = b.h * (0.25 + 0.2 * rnd(s, i, 2)) * (0.6 + 0.6 * a);
    const vy = b.h * (0.05 + 0.06 * rnd(s, i, 3));
    const x = b.x - m + frac(rnd(s, i, 0) + t * vx / (b.w + 2 * m)) * (b.w + 2 * m);
    const y = b.y - m + frac(rnd(s, i, 4) + t * vy / (b.h + 2 * m)) * (b.h + 2 * m) + Math.sin(t * (1.5 + rnd(s, i, 5)) + rnd(s, i, 6) * TAU) * b.h * 0.025;
    const ang = rnd(s, i, 7) * TAU + t * (1.5 + 2 * rnd(s, i, 8)) * (rnd(s, i, 9) < 0.5 ? -1 : 1);
    const flip = Math.cos(t * (2 + 2 * rnd(s, i, 5)) + rnd(s, i, 6) * TAU);
    const co = Math.cos(ang), si = Math.sin(ang);
    ctx.setTransform(co * sz * flip, si * sz * flip, -si * sz, co * sz, x, y);
    ctx.beginPath();
    ctx.moveTo(-1, 0);
    ctx.quadraticCurveTo(0, -0.62, 1, 0);
    ctx.quadraticCurveTo(0, 0.62, -1, 0);
    ctx.fillStyle = LEAF[Math.floor(rnd(s, i, 10) * LEAF.length)];
    ctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
};

const dust: Draw = (ctx, b, t, a, s, fx) => {
  const c = rgb(fx?.color, '#fff1d6');
  const glow = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
  glow.addColorStop(0, rgba(c, 0.1 * a));
  glow.addColorStop(0.6, rgba(c, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  const n = count(120, a, b);
  const m = b.h * 0.01;
  ctx.fillStyle = rgba(c, 1);
  for (let i = 0; i < n; i++) {
    const r = b.h * (0.0018 + 0.0045 * rnd(s, i, 1) ** 2);
    const x = b.x - m + frac(rnd(s, i, 0) + t * 0.004 + 0.012 * Math.sin(t * 0.3 * (1 + rnd(s, i, 2)) + rnd(s, i, 3) * TAU)) * (b.w + 2 * m);
    const y = b.y - m + frac(rnd(s, i, 4) - t * 0.006 * (0.5 + rnd(s, i, 5)) + 0.015 * Math.sin(t * 0.25 * (1 + rnd(s, i, 6)) + rnd(s, i, 7) * TAU)) * (b.h + 2 * m);
    ctx.globalAlpha = (0.35 + 0.6 * (0.5 + 0.5 * Math.sin(t * (0.8 + rnd(s, i, 8)) + rnd(s, i, 9) * TAU))) * (0.5 + 0.5 * a);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

const CONFETTI = ['#ff5a5f', '#ffc83d', '#3ec7a0', '#4aa8ff', '#b77bff', '#ff8ad0'];
const confetti: Draw = (ctx, b, t, a, s) => {
  const n = count(140, a, b);
  for (let c = 0; c < CONFETTI.length; c++) {
    ctx.beginPath();
    for (let i = c; i < n; i += CONFETTI.length) {
      const w = b.h * (0.016 + 0.01 * rnd(s, i, 1));
      const hh = w * 0.5;
      const m = 2 * w;
      const v = 0.12 + 0.12 * rnd(s, i, 2);
      const travel = b.h + 2 * m;
      const y = b.y - m + frac(rnd(s, i, 3) + t * v * b.h / travel) * travel;
      const x = b.x - m + frac(rnd(s, i, 0) + 0.015 * Math.sin(t * (1 + rnd(s, i, 4)) + rnd(s, i, 5) * TAU)) * (b.w + 2 * m);
      const ang = rnd(s, i, 6) * TAU + t * (2 + 3 * rnd(s, i, 7));
      const flip = Math.cos(t * (3 + 3 * rnd(s, i, 8)) + rnd(s, i, 9) * TAU);
      const co = Math.cos(ang), si = Math.sin(ang);
      const ux = co * w / 2, uy = si * w / 2;
      const vx = -si * hh / 2 * flip, vy = co * hh / 2 * flip;
      ctx.moveTo(x - ux - vx, y - uy - vy);
      ctx.lineTo(x + ux - vx, y + uy - vy);
      ctx.lineTo(x + ux + vx, y + uy + vy);
      ctx.lineTo(x - ux + vx, y - uy + vy);
      ctx.closePath();
    }
    ctx.fillStyle = CONFETTI[c];
    ctx.fill();
  }
};

const fireflies: Draw = (ctx, b, t, a, s, fx) => {
  const c = rgb(fx?.color, '#d9ff7a');
  ctx.fillStyle = `rgba(6,12,24,${(0.18 * a).toFixed(4)})`;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.globalCompositeOperation = 'lighter';
  const n = count(40, a, b);
  for (let i = 0; i < n; i++) {
    const x = b.x + b.w * (0.08 + 0.84 * rnd(s, i, 0) + 0.07 * Math.sin(t * (0.25 + 0.3 * rnd(s, i, 1)) + rnd(s, i, 2) * TAU) + 0.03 * Math.sin(t * (0.9 + 0.5 * rnd(s, i, 3)) + rnd(s, i, 4) * TAU));
    const y = b.y + b.h * (0.3 + 0.6 * rnd(s, i, 5) + 0.06 * Math.sin(t * (0.3 + 0.3 * rnd(s, i, 6)) + rnd(s, i, 7) * TAU));
    const blink = Math.max(0, Math.sin(t * (0.7 + 0.8 * rnd(s, i, 8)) + rnd(s, i, 9) * TAU)) ** 2;
    if (blink < 0.01) continue;
    const r = b.h * (0.03 + 0.015 * rnd(s, i, 10));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(c, 0.95 * blink));
    g.addColorStop(0.15, rgba(c, 0.5 * blink));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
};

const bubbles: Draw = (ctx, b, t, a, s) => {
  const n = count(36, a, b);
  const hl: number[] = [];
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const r = b.h * (0.008 + 0.03 * rnd(s, i, 1) ** 2);
    const v = 0.08 + 0.1 * rnd(s, i, 2);
    const travel = b.h + 2 * r;
    const y = b.y + b.h + r - frac(rnd(s, i, 3) + t * v * b.h / travel) * travel;
    const x = b.x + rnd(s, i, 0) * b.w + Math.sin(t * (1 + rnd(s, i, 4)) + rnd(s, i, 5) * TAU) * b.h * 0.02;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
    hl.push(x - r * 0.38, y - r * 0.38, r * 0.22);
  }
  ctx.fillStyle = `rgba(200,232,255,${(0.1 * (0.5 + 0.5 * a)).toFixed(4)})`;
  ctx.fill();
  ctx.lineWidth = b.h * 0.0022;
  ctx.strokeStyle = 'rgba(232,246,255,0.7)';
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < hl.length; i += 3) { ctx.moveTo(hl[i] + hl[i + 2], hl[i + 1]); ctx.arc(hl[i], hl[i + 1], hl[i + 2], 0, TAU); }
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fill();
};

const sunrays: Draw = (ctx, b, t, a, s, fx) => {
  const c = rgb(fx?.color, '#fff0c8');
  const px = b.x + b.w * clamp(fx?.params?.x ?? 0.14, -0.5, 1.5);
  const py = b.y - b.h * 0.2;
  const len = Math.hypot(b.w, b.h) * 1.4;
  ctx.globalCompositeOperation = 'screen';
  const glow = ctx.createRadialGradient(px, py, 0, px, py, b.h * 0.95);
  glow.addColorStop(0, rgba(c, 0.55 * a));
  glow.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  const g = ctx.createRadialGradient(px, py, 0, px, py, len);
  g.addColorStop(0, rgba(c, 0.6));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  const aim = Math.atan2(b.y + b.h * 0.6 - py, b.x + b.w * 0.5 - px);
  for (let i = 0; i < 8; i++) {
    const ang = aim - 0.55 + (i / 7) * 1.1 + 0.035 * Math.sin(t * 0.2 + rnd(s, i, 0) * TAU);
    const w = 0.025 + 0.045 * rnd(s, i, 1);
    ctx.globalAlpha = a * 0.6 * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * (0.3 + 0.4 * rnd(s, i, 2)) + rnd(s, i, 3) * TAU)));
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + len * Math.cos(ang - w), py + len * Math.sin(ang - w));
    ctx.lineTo(px + len * Math.cos(ang + w), py + len * Math.sin(ang + w));
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

const sunset: Draw = (ctx, b, _t, a) => {
  ctx.globalCompositeOperation = 'multiply';
  const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  g.addColorStop(0, '#ffb46e');
  g.addColorStop(0.55, '#ff8f6a');
  g.addColorStop(1, '#a8608a');
  ctx.globalAlpha = 0.7 * a;
  ctx.fillStyle = g;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'screen';
  const cx = b.x + b.w * 0.72, cy = b.y + b.h * 0.62;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, b.h * 0.75);
  glow.addColorStop(0, `rgba(255,150,70,${(0.55 * a).toFixed(4)})`);
  glow.addColorStop(1, 'rgba(255,150,70,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(b.x, b.y, b.w, b.h);
};

const night: Draw = (ctx, b, _t, a) => {
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.92 * a;
  ctx.fillStyle = '#25345e';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const cx = b.x + b.w / 2, cy = b.y + b.h * 0.45;
  const v = ctx.createRadialGradient(cx, cy, Math.min(b.w, b.h) * 0.3, cx, cy, Math.hypot(b.w, b.h) * 0.62);
  v.addColorStop(0, 'rgba(0,0,12,0)');
  v.addColorStop(1, `rgba(0,0,12,${(0.55 * a).toFixed(4)})`);
  ctx.fillStyle = v;
  ctx.fillRect(b.x, b.y, b.w, b.h);
};

const spotlight: Draw = (ctx, b, _t, a, _s, fx) => {
  const cx = b.x + b.w * clamp(fx?.params?.x ?? 0.5, 0, 1);
  const cy = b.y + b.h * clamp(fx?.params?.y ?? 0.58, 0, 1);
  const rin = b.h * 0.2, rout = b.h * 0.46;
  const g = ctx.createRadialGradient(cx, cy, rin, cx, cy, rout);
  g.addColorStop(0, 'rgba(4,4,10,0)');
  g.addColorStop(1, `rgba(4,4,10,${(0.9 * a).toFixed(4)})`);
  ctx.fillStyle = g;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.globalCompositeOperation = 'screen';
  const cone = ctx.createLinearGradient(0, b.y, 0, cy + rin);
  cone.addColorStop(0, `rgba(255,248,225,${(0.26 * a).toFixed(4)})`);
  cone.addColorStop(1, `rgba(255,248,225,${(0.06 * a).toFixed(4)})`);
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(cx - b.h * 0.025, b.y);
  ctx.lineTo(cx + b.h * 0.025, b.y);
  ctx.lineTo(cx + rin * 1.05, cy);
  ctx.ellipse(cx, cy, rin * 1.05, rin * 0.3, 0, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
};

function strike(dt: number): number {
  if (dt < 0) return 0;
  if (dt < 0.08) return 1;
  if (dt < 0.13) return 0.25;
  if (dt < 0.21) return 0.8;
  return 0.8 * Math.exp(-(dt - 0.21) * 9);
}

const lightning: Draw = (ctx, b, t, a, s) => {
  ctx.fillStyle = `rgba(12,16,30,${(0.32 * a).toFixed(4)})`;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  const win = 3.6 - 2 * a;
  const k = Math.floor(t / win);
  for (let kk = k - 1; kk <= k; kk++) {
    if (kk < 0 || rnd(s, kk, 0) > 0.8) continue;
    const at = kk * win + rnd(s, kk, 1) * Math.max(0.1, win - 0.6);
    const dt = t - at;
    const e = strike(dt);
    if (e < 0.005) continue;
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(225,232,255,${(0.6 * e * (0.4 + 0.6 * a)).toFixed(4)})`;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    if (dt > 0.3) continue;
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    let x = b.x + b.w * (0.15 + 0.7 * rnd(s, kk, 2));
    let y = b.y;
    const bottom = b.h * (0.45 + 0.35 * rnd(s, kk, 3));
    const steps = 14;
    ctx.moveTo(x, y);
    let bx = 0, by = 0;
    for (let j = 1; j <= steps; j++) {
      x += (rnd(s, kk, 10 + j) - 0.5) * b.h * 0.08;
      y = b.y + (bottom * j) / steps;
      ctx.lineTo(x, y);
      if (j === 5) { bx = x; by = y; }
    }
    ctx.moveTo(bx, by);
    const dir = rnd(s, kk, 4) < 0.5 ? -1 : 1;
    for (let j = 1; j <= 5; j++) {
      bx += dir * b.h * 0.025 + (rnd(s, kk, 40 + j) - 0.5) * b.h * 0.04;
      by += bottom / steps * 0.9;
      ctx.lineTo(bx, by);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = b.h * 0.014;
    ctx.strokeStyle = `rgba(170,190,255,${(0.3 * e).toFixed(4)})`;
    ctx.stroke();
    ctx.lineWidth = b.h * 0.0035;
    ctx.strokeStyle = `rgba(255,255,255,${e.toFixed(4)})`;
    ctx.stroke();
  }
};

const DRAW: Record<string, Draw> = { rain, snow, fog, leaves, dust, confetti, fireflies, bubbles, sunrays, sunset, night, spotlight, lightning };

/** One effect over `box` at `t` seconds: the Stage, every export and the Effects tab's previews draw through this. */
export function drawEffect(ctx: Ctx, kind: string, box: FxBox, t: number, amount: number, seed: number, fx: SceneFx | null = null): void {
  const d = DRAW[kind];
  if (!d || !(box.w > 0) || !(box.h > 0) || !(amount > 0)) return;
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    d(ctx, box, t, clamp(amount, 0, 1), seed | 0, fx);
  } finally {
    ctx.restore();
  }
}

/** The effect's strength at `frame`: a quarter second fade at an end inside the movie, shorter for a short effect. */
export function fxEnvelope(fx: SceneFx, frame: number, fps: number, duration: number): number {
  if (frame < fx.start || frame >= fx.end) return 0;
  const f = Math.min(Math.round(fps * 0.25), Math.floor((fx.end - fx.start) / 4));
  if (f < 1) return 1;
  const fadeIn = fx.start > 0 ? (frame - fx.start + 1) / (f + 1) : 1;
  const fadeOut = fx.end < duration ? (fx.end - frame) / (f + 1) : 1;
  return Math.min(1, fadeIn, fadeOut);
}

/** The list as read from a file, made safe; null when there is none. */
export function tidySceneFx(raw: unknown): SceneFx[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SceneFx[] = [];
  const ids = new Set<string>();
  raw.forEach((v, i) => {
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.kind !== 'string' || !KINDS.has(o.kind)) return;
    const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const start = num(o.start), end = num(o.end);
    if (start === null || end === null) return;
    const s = Math.max(0, Math.round(start)), e = Math.round(end);
    if (!(e > s)) return;
    let id = typeof o.id === 'string' && o.id && o.id.length <= 64 ? o.id : `sfx${i}`;
    while (ids.has(id)) id = `${id}_`;
    ids.add(id);
    const fx: SceneFx = {
      id, kind: o.kind, start: s, end: e,
      amount: clamp(num(o.amount) ?? KINDS.get(o.kind)!.amount, 0, 1),
      seed: (num(o.seed) ?? i * 7919 + 1) | 0,
    };
    if (typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color)) fx.color = o.color;
    if (o.params && typeof o.params === 'object' && !Array.isArray(o.params)) {
      const p: Record<string, number> = {};
      let n = 0;
      for (const [k, x] of Object.entries(o.params as Record<string, unknown>)) {
        if (n >= 16 || !/^[a-z][a-z0-9]{0,15}$/i.test(k) || typeof x !== 'number' || !Number.isFinite(x)) continue;
        p[k] = x; n++;
      }
      if (n) fx.params = p;
    }
    out.push(fx);
  });
  return out.length ? out : null;
}

/** Draws every effect that is on at `frame`. Called at the end of Renderer.drawFrame, before the subtitles. */
export function drawSceneFx(ctx: Ctx, m: Movie, frame: number, view: FrameView): void {
  const list = m.sceneFx;
  if (!list || !list.length) return;
  const box: FxBox = { x: view.ox, y: view.oy, w: m.width * view.scale, h: m.height * view.scale };
  const fps = m.fps > 0 ? m.fps : 24;
  const t = frame / fps;
  for (const fx of list) {
    const e = fxEnvelope(fx, frame, fps, m.duration);
    if (e > 0) drawEffect(ctx, fx.kind, box, t, fx.amount * e, fx.seed, fx);
  }
}

export function newSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}

/** Adds an effect at the end of the list (drawn over the others). */
export function addSceneFx(m: Movie, fx: SceneFx): Movie {
  return { ...m, sceneFx: [...(m.sceneFx ?? []), fx] };
}

export function patchSceneFx(m: Movie, id: string, patch: Partial<Pick<SceneFx, 'start' | 'end' | 'amount' | 'color' | 'params'>>): Movie {
  const list = m.sceneFx;
  const i = list ? list.findIndex((x) => x.id === id) : -1;
  if (!list || i < 0) return m;
  const cur = list[i];
  const next: SceneFx = { ...cur, ...patch };
  next.start = Math.max(0, Math.round(next.start));
  next.end = Math.max(next.start + 1, Math.round(next.end));
  next.amount = clamp(next.amount, 0, 1);
  if (next.start === cur.start && next.end === cur.end && next.amount === cur.amount && next.color === cur.color && next.params === cur.params) return m;
  const out = list.slice();
  out[i] = next;
  return { ...m, sceneFx: out };
}

export function removeSceneFx(m: Movie, id: string): Movie {
  const list = m.sceneFx;
  if (!list || !list.some((x) => x.id === id)) return m;
  const out = list.filter((x) => x.id !== id);
  if (out.length) return { ...m, sceneFx: out };
  const { sceneFx: _gone, ...rest } = m;
  return rest as Movie;
}
