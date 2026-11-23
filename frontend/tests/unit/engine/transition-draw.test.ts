import { describe, expect, it } from 'vitest';
import { mixTransition } from '@src/engine/transition-draw';
import type { ActiveTransition } from '@src/engine/transitions';
import { content } from '@src/engine/model';
import type { Transition } from '@src/engine/types';

interface Draw { img: unknown; alpha: number; op: string; x: number; y: number }
interface Fill { alpha: number; style: string; rect: number[] }

class Recorder {
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle = '';
  draws: Draw[] = [];
  fills: Fill[] = [];
  rects: number[][] = [];
  clips = 0;
  depth = 0;
  private stack: { a: number; op: string }[] = [];
  save(): void { this.depth++; this.stack.push({ a: this.globalAlpha, op: this.globalCompositeOperation }); }
  restore(): void {
    this.depth--;
    const s = this.stack.pop();
    if (s) { this.globalAlpha = s.a; this.globalCompositeOperation = s.op; }
  }
  setTransform(): void {}
  beginPath(): void {}
  clip(): void { this.clips++; }
  rect(x: number, y: number, w: number, h: number): void { this.rects.push([x, y, w, h]); }
  fillRect(x: number, y: number, w: number, h: number): void { this.fills.push({ alpha: this.globalAlpha, style: this.fillStyle, rect: [x, y, w, h] }); }
  drawImage(img: unknown, x: number, y: number): void { this.draws.push({ img, alpha: this.globalAlpha, op: this.globalCompositeOperation, x, y }); }
}

const A = { name: 'a' } as unknown as CanvasImageSource;
const B = { name: 'b' } as unknown as CanvasImageSource;
const frame = { x: 10, y: 20, w: 200, h: 100 };

function active(tr: Transition, p: number): ActiveTransition {
  return { a: content('solid', 0, 10), b: content('solid', 10, 10), tr, aLocal: 0, bLocal: 0, p };
}

function mix(tr: Transition, p: number, oa = 1, ob = 1, a: CanvasImageSource | null = A, b: CanvasImageSource | null = B): Recorder {
  const rec = new Recorder();
  mixTransition(rec as unknown as OffscreenCanvasRenderingContext2D, a, b, oa, ob, active(tr, p), frame);
  return rec;
}

describe('mixTransition', () => {
  it('adds both sides of a crossfade weighted by progress and block opacity', () => {
    const rec = mix({ kind: 'crossfade', duration: 4 }, 0.25, 0.8, 0.5);
    expect(rec.draws).toHaveLength(2);
    expect(rec.draws[0].img).toBe(A);
    expect(rec.draws[0].alpha).toBeCloseTo(0.6, 9);
    expect(rec.draws[1].img).toBe(B);
    expect(rec.draws[1].alpha).toBeCloseTo(0.125, 9);
    expect(rec.draws.every((d) => d.op === 'lighter')).toBe(true);
  });

  it('skips a missing side and a side with no opacity', () => {
    expect(mix({ kind: 'crossfade', duration: 4 }, 0.5, 1, 1, null, B).draws.map((d) => d.img)).toEqual([B]);
    expect(mix({ kind: 'crossfade', duration: 4 }, 0.5, 0, 1).draws.map((d) => d.img)).toEqual([B]);
  });

  it('leaves the surface state as it found it', () => {
    for (const kind of ['crossfade', 'dip', 'wipe', 'push'] as const) {
      const rec = mix({ kind, duration: 4 }, 0.4);
      expect(rec.depth).toBe(0);
      expect(rec.globalAlpha).toBe(1);
      expect(rec.globalCompositeOperation).toBe('source-over');
    }
  });

  it('dips the outgoing side into the colour during the first half', () => {
    const rec = mix({ kind: 'dip', duration: 4, color: '#ff0000' }, 0.25);
    expect(rec.draws.map((d) => d.img)).toEqual([A]);
    expect(rec.fills).toEqual([{ alpha: 0.5, style: '#ff0000', rect: [10, 20, 200, 100] }]);
  });

  it('lifts the incoming side out of the colour during the second half', () => {
    const rec = mix({ kind: 'dip', duration: 4 }, 0.75);
    expect(rec.draws.map((d) => d.img)).toEqual([B]);
    expect(rec.fills[0].alpha).toBeCloseTo(0.5, 9);
    expect(rec.fills[0].style).toBe('#000000');
  });

  it('is fully the colour at the middle of a dip', () => {
    expect(mix({ kind: 'dip', duration: 4 }, 0.5).fills[0].alpha).toBe(1);
  });

  it('reveals the incoming side of a wipe from the named edge', () => {
    const cases: [Transition['dir'], number[]][] = [
      ['l', [10, 20, 50, 100]], ['r', [160, 20, 50, 100]], ['u', [10, 95, 200, 25]], ['d', [10, 20, 200, 25]],
    ];
    for (const [dir, want] of cases) {
      const rec = mix({ kind: 'wipe', duration: 4, dir }, 0.25);
      expect(rec.draws.map((d) => d.img)).toEqual([A, B]);
      expect(rec.rects).toEqual([want]);
      expect(rec.clips).toBe(1);
    }
  });

  it('wipes from the left when no direction is set', () => {
    expect(mix({ kind: 'wipe', duration: 4 }, 0.5).rects).toEqual([[10, 20, 100, 100]]);
  });

  it('slides both sides of a push one frame size apart', () => {
    const left = mix({ kind: 'push', duration: 4, dir: 'l' }, 0.25);
    expect(left.draws.map((d) => [d.x, d.y])).toEqual([[50, 0], [-150, 0]]);
    const right = mix({ kind: 'push', duration: 4, dir: 'r' }, 0.25);
    expect(right.draws.map((d) => [d.x, d.y])).toEqual([[-50, 0], [150, 0]]);
    const up = mix({ kind: 'push', duration: 4, dir: 'u' }, 0.25);
    expect(up.draws.map((d) => [d.x, d.y])).toEqual([[0, -25], [0, 75]]);
    const down = mix({ kind: 'push', duration: 4, dir: 'd' }, 0.25);
    expect(down.draws.map((d) => [d.x, d.y])).toEqual([[0, 25], [0, -75]]);
    expect(left.rects).toEqual([[10, 20, 200, 100]]);
  });

  it('rounds the frame rectangle and never lets it collapse', () => {
    const rec = new Recorder();
    mixTransition(rec as unknown as OffscreenCanvasRenderingContext2D, A, B, 1, 1, active({ kind: 'dip', duration: 4 }, 0.25), { x: 1.4, y: 2.6, w: 0, h: 0.2 });
    expect(rec.fills[0].rect).toEqual([1, 3, 1, 1]);
  });
});
