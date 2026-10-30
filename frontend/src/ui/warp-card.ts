// The Warp and Distort cards of the Action menu: a hint, the mesh size (Warp), Reset and Done. The handles
// themselves live on the Stage (warp-view.ts); this card only chooses the mesh and resets the pose.
import type { Engine } from '../engine/engine';
import * as keyOps from '../engine/key-ops';
import * as ops from '../engine/ops';
import { laneChannels, laneOf, warpSize } from '../engine/keys';
import { WARP_MAX, WARP_MIN } from '../engine/warp-draw';
import type { Content, KeyLane } from '../engine/types';
import { el, setClass, setText } from './dom';
import { warpMode, type WarpKind } from './warp-view';

const HINT: Record<WarpKind, string> = {
  warp: 'Drag a node on the Stage to bend the picture. Each drag writes a keyframe at the Playhead.',
  distort: 'Drag a corner on the Stage to skew the picture. Each drag writes a keyframe at the Playhead.',
};

export class WarpCard {
  readonly root = el('<div class="fm-wc"></div>');
  private readonly sizes = new Map<number, HTMLButtonElement>();

  constructor(private readonly engine: Engine, private readonly kind: WarpKind, private readonly onDone: () => void) {
    const note = el('<p class="fm-wc-note"></p>');
    setText(note, HINT[kind]);
    this.root.appendChild(note);
    if (kind === 'warp') {
      const label = el('<div class="fm-wc-label"></div>');
      setText(label, 'Mesh size');
      const seg = el('<div class="fm-kc-seg" role="group" aria-label="Mesh size"></div>');
      for (let n = WARP_MIN; n <= WARP_MAX; n++) {
        const b = el<HTMLButtonElement>('<button class="fm-kc-segbtn" type="button"></button>');
        setText(b, `${n}x${n}`);
        b.addEventListener('click', () => this.resize(n));
        this.sizes.set(n, b);
        seg.appendChild(b);
      }
      this.root.append(label, seg);
    }
    const actions = el('<div class="fm-wc-actions"></div>');
    const reset = el<HTMLButtonElement>('<button class="fm-wc-btn" type="button"></button>');
    const done = el<HTMLButtonElement>('<button class="fm-wc-btn" type="button"></button>');
    setText(reset, 'Reset');
    setText(done, 'Done');
    reset.addEventListener('click', () => this.reset());
    done.addEventListener('click', () => { warpMode.set(null); this.onDone(); });
    actions.append(reset, done);
    this.root.appendChild(actions);
  }

  sync(_c: Content, lane: KeyLane | null): void {
    if (this.kind !== 'warp') return;
    const cur = warpSize(lane);
    for (const [n, b] of this.sizes) setClass(b, 'is-active', n === cur);
  }

  private target(): { c: Content; local: number } | null {
    const sel = this.engine.selected;
    const c = sel.length === 1 ? sel[0] : null;
    return c && this.engine.isOver(c) ? { c, local: this.engine.frame - c.start } : null;
  }

  /** Every node (or corner) back to rest at the Playhead, as a key. */
  private reset(): void {
    const t = this.target();
    const lane = t ? laneOf(t.c, this.kind) : null;
    if (!t || !lane) return;
    const zero: Record<string, number> = {};
    for (const s of laneChannels(lane)) zero[s.id] = 0;
    const { c, local } = t;
    this.engine.run(this.kind === 'warp' ? 'Reset Warp' : 'Reset Distort', (m) => ops.updateContent(m, c.id, (cc) => keyOps.setKeys(cc, this.kind, local, zero)));
  }

  private resize(n: number): void {
    const t = this.target();
    if (!t) return;
    const { c } = t;
    this.engine.run('Warp mesh size', (m) => ops.updateContent(m, c.id, (cc) => keyOps.setWarpSize(cc, n)));
  }
}
