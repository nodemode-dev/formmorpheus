// Dragging several chosen keyframes at once: all move by the same number of frames, the grabbed key snaps to the
// Playhead and to other keys (Alt turns that off), ghost outlines stay where the keys were, and a tooltip names the frame.
import type { Engine } from '../engine/engine';
import { deltaRange, moveRefs, shiftRefs } from '../engine/key-group-ops';
import type { KeyRef } from '../engine/key-sel-ops';
import * as ops from '../engine/ops';
import type { Content, KeyKind } from '../engine/types';
import { setKeyGhosts } from './key-lanes';
import { keyHome, keyTip, snapKeyFrame } from './key-snap';
import type { KeySelection } from './timeline-extras';

export class KeyGroupDrag {
  moved = false;
  private cur = 0;
  private readonly bases = new Map<string, Content>();
  private readonly refs = new Map<string, KeyRef[]>();
  private readonly tag = `keys-${Date.now()}`;

  constructor(private readonly engine: Engine, private readonly sel: KeySelection, private readonly grab: { id: string; kind: KeyKind; frame: number }, private readonly x0: number) {
    keyHome.frame = engine.frame;
    for (const id of sel.ids()) {
      const c = engine.movie?.tracks.flatMap((t) => t.content).find((it) => it.id === id);
      if (c) { this.bases.set(id, c); this.refs.set(id, sel.refs(id)); }
    }
  }

  move(clientX: number, clientY: number, alt: boolean, ppf: number): void {
    const gc = this.bases.get(this.grab.id);
    if (!gc) return;
    let lo = -Infinity, hi = Infinity;
    for (const [id, c] of this.bases) { const [a, b] = deltaRange(c, this.refs.get(id) ?? []); lo = Math.max(lo, a); hi = Math.min(hi, b); }
    const raw = this.grab.frame + Math.round((clientX - this.x0) / ppf);
    const near = snapKeyFrame(this.engine, gc, this.grab.kind, Math.max(0, Math.min(gc.duration - 1, raw)), ppf, alt);
    const delta = Math.max(lo, Math.min(hi, near.frame - this.grab.frame));
    if (delta !== 0 || this.moved) {
      const n = Array.from(this.refs.values()).reduce((a, r) => a + r.length, 0);
      const sign = delta > 0 ? '+' : '';
      keyTip.show(clientX, clientY, `Frame ${gc.start + this.grab.frame + delta} · ${sign}${delta} · ${n} keys${near.to === 'playhead' && delta === near.frame - this.grab.frame ? ' · Playhead' : ''}`);
    }
    if (delta === this.cur) return;
    const ok = this.engine.run('Move Keyframes', (mv) => {
      let acc = mv;
      for (const [id, base] of this.bases) acc = ops.updateContent(acc, id, () => moveRefs(base, this.refs.get(id) ?? [], delta));
      return acc;
    }, this.tag);
    if (!ok) return;
    this.cur = delta;
    this.moved = true;
    const next = new Map<string, KeyRef[]>();
    for (const [id, r] of this.refs) next.set(id, shiftRefs(r, delta));
    this.sel.set(next);
    setKeyGhosts(delta === 0 ? null : this.refs);
    this.engine.seek(gc.start + this.grab.frame + delta);
  }

  end(): void {
    keyTip.hide();
    setKeyGhosts(null);
    if (this.moved) this.engine.endGesture();
  }
}
