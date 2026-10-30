// The Warp and Distort cards of the Action menu: a hint, the mesh size (Warp), Reset and Done. The handles
// themselves live on the Stage (warp-view.ts); this card only chooses the mesh and resets the pose.
import type { Engine } from '../engine/engine';
import * as keyOps from '../engine/key-ops';
import * as ops from '../engine/ops';
import { evalLane, laneChannels, laneOf, warpSize } from '../engine/keys';
import { DISTORT_IDS, WARP_MAX, WARP_MIN, warpId } from '../engine/warp-draw';
import type { Content, KeyLane } from '../engine/types';
import { el, setClass, setText, setValue } from './dom';

const MAX_HANDLES = WARP_MAX * WARP_MAX;
const CORNERS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
import { warpMode, type WarpKind } from './warp-view';

const HINT: Record<WarpKind, string> = {
  warp: 'Drag a node on the Stage to bend the picture. Each drag writes a keyframe at the Playhead.',
  distort: 'Drag a corner on the Stage to skew the picture. Each drag writes a keyframe at the Playhead.',
};

export class WarpCard {
  readonly root = el('<div class="fm-wc"></div>');
  private readonly sizes = new Map<number, HTMLButtonElement>();
  private readonly pick = document.createElement('select');
  private readonly fx = document.createElement('input');
  private readonly fy = document.createElement('input');
  private bilinear!: HTMLButtonElement;
  private last: { c: Content; lane: KeyLane | null } | null = null;

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
    // numeric entry: pick a node (or corner), then type its offset from rest in px
    const nl = el('<div class="fm-wc-label"></div>');
    setText(nl, kind === 'warp' ? 'Node' : 'Corner');
    this.pick.className = 'fm-wc-pick';
    this.pick.setAttribute('aria-label', kind === 'warp' ? 'Node' : 'Corner');
    for (let i = 0; i < MAX_HANDLES; i++) this.pick.appendChild(document.createElement('option')).value = String(i);
    this.pick.addEventListener('change', () => warpMode.pick(Number(this.pick.value)));
    const fields = el('<div class="fm-wc-xy"><label><span>X</span></label><label><span>Y</span></label></div>');
    const labels = fields.querySelectorAll('label');
    for (const [i, inp] of [this.fx, this.fy].entries()) {
      inp.type = 'number';
      inp.step = '1';
      inp.className = 'fm-wc-num';
      inp.setAttribute('aria-label', i ? 'Y' : 'X');
      inp.addEventListener('change', () => this.enter());
      labels[i].appendChild(inp);
    }
    this.root.append(nl, this.pick, fields);
    warpMode.onChange(() => this.fill());
    const bil = el<HTMLButtonElement>('<button class="fm-wc-btn fm-wc-toggle" type="button" aria-pressed="false"></button>');
    setText(bil, 'Bilinear');
    bil.title = kind === 'warp' ? 'Straight blend between nodes instead of the smooth surface' : 'Straight blend of the corners instead of perspective';
    bil.addEventListener('click', () => this.toggleBilinear());
    this.bilinear = bil;
    this.root.appendChild(bil);
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

  sync(c: Content, lane: KeyLane | null): void {
    this.last = { c, lane };
    if (this.kind === 'warp') {
      const cur = warpSize(lane);
      for (const [n, b] of this.sizes) setClass(b, 'is-active', n === cur);
    }
    setClass(this.bilinear, 'is-active', lane?.options.bilinear === true);
    this.bilinear.setAttribute('aria-pressed', String(lane?.options.bilinear === true));
    this.fill();
  }

  private count(): number { return this.kind === 'distort' ? 4 : warpSize(this.last?.lane ?? null) ** 2; }

  private ids(i: number): [string, string] {
    if (this.kind === 'distort') return [DISTORT_IDS[i * 2], DISTORT_IDS[i * 2 + 1]];
    const n = warpSize(this.last?.lane ?? null);
    return [warpId(Math.floor(i / n), i % n, 'x'), warpId(Math.floor(i / n), i % n, 'y')];
  }

  /** Patches the picker and the two numbers to the handle in `warpMode.handle` at the Playhead. */
  private fill(): void {
    const l = this.last;
    if (!l) return;
    const total = this.count();
    const n = warpSize(l.lane);
    for (let i = 0; i < MAX_HANDLES; i++) {
      const o = this.pick.options[i];
      o.hidden = i >= total;
      o.disabled = i >= total;
      if (i < total) o.textContent = this.kind === 'distort' ? CORNERS[i] : `R${Math.floor(i / n) + 1} C${(i % n) + 1}`;
    }
    const h = Math.min(warpMode.handle, total - 1);
    setValue(this.pick, String(h));
    const vals = l.lane ? evalLane(l.c, l.lane, this.engine.frame - l.c.start) : {};
    const [ix, iy] = this.ids(h);
    setValue(this.fx, String(Math.round((vals[ix] ?? 0) * 10) / 10));
    setValue(this.fy, String(Math.round((vals[iy] ?? 0) * 10) / 10));
  }

  /** Typed offsets become a key at the Playhead for that node, like a drag does. */
  private enter(): void {
    const t = this.target();
    const lane = t ? laneOf(t.c, this.kind) : null;
    if (!t || !lane) return;
    const [ix, iy] = this.ids(Math.min(warpMode.handle, this.count() - 1));
    const x = Number(this.fx.value), y = Number(this.fy.value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const { c, local } = t;
    if (local < 0 || local >= c.duration) return;
    const vals = { ...evalLane(c, lane, local), [ix]: x, [iy]: y };
    this.engine.run(this.kind === 'warp' ? 'Warp Keyframe' : 'Distort Keyframe', (m) => ops.updateContent(m, c.id, (cc) => keyOps.setKeys(cc, this.kind, local, vals)));
  }

  private toggleBilinear(): void {
    const t = this.target();
    const lane = t ? laneOf(t.c, this.kind) : null;
    if (!t || !lane) return;
    const on = lane.options.bilinear !== true;
    this.engine.run('Bilinear', (m) => ops.updateContent(m, t.c.id, (cc) => keyOps.setLaneOption(cc, this.kind, 'bilinear', on)));
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
