// The Bones card of the Action menu: Rig or Pose, the weights view, the skin mesh density, Delete bone, Reset pose
// and Done. The skeleton itself lives on the Stage (bones-view.ts); this card only chooses what a drag does.
import type { Engine } from '../engine/engine';
import * as keyOps from '../engine/key-ops';
import * as ops from '../engine/ops';
import { laneOf } from '../engine/keys';
import { MESH_DEFAULT, meshSize, setMesh } from '../engine/bones';
import type { Content, KeyLane } from '../engine/types';
import { el, setClass, setDisabled, setText } from './dom';
import { bonesMode, removeSelectedBone, type BonesTool } from './bones-view';

const HINT: Record<BonesTool, string> = {
  rig: 'Drag on the Stage to draw a bone from the last bone’s tip. Hold Alt to start a new chain. Click a bone to select it.',
  pose: 'Drag a bone on the Stage to turn it. Each drag writes a keyframe at the Playhead.',
};

const DENSITY: { label: string; px: number }[] = [
  { label: 'Fine', px: 12 },
  { label: 'Normal', px: MESH_DEFAULT },
  { label: 'Coarse', px: 48 },
];

export class BonesCard {
  readonly root = el('<div class="fm-bc"></div>');
  private readonly note = el('<p class="fm-bc-note"></p>');
  private readonly tools = new Map<BonesTool, HTMLButtonElement>();
  private readonly dens = new Map<number, HTMLButtonElement>();
  private readonly weights = el<HTMLButtonElement>('<button class="fm-bc-btn" type="button" aria-pressed="false"></button>');
  private readonly del = el<HTMLButtonElement>('<button class="fm-bc-btn" type="button"></button>');
  private readonly reset = el<HTMLButtonElement>('<button class="fm-bc-btn" type="button"></button>');

  constructor(private readonly engine: Engine, private readonly onDone: () => void) {
    const seg = el('<div class="fm-kc-seg" role="group" aria-label="Bones mode"></div>');
    for (const [tool, label] of [['rig', 'Rig'], ['pose', 'Pose']] as [BonesTool, string][]) {
      const b = el<HTMLButtonElement>('<button class="fm-kc-segbtn" type="button"></button>');
      setText(b, label);
      b.addEventListener('click', () => bonesMode.setTool(tool));
      this.tools.set(tool, b);
      seg.appendChild(b);
    }
    setText(this.weights, 'Show weights');
    this.weights.addEventListener('click', () => bonesMode.setWeights(!bonesMode.weights));

    const label = el('<div class="fm-bc-label"></div>');
    setText(label, 'Skin mesh');
    const dseg = el('<div class="fm-kc-seg" role="group" aria-label="Skin mesh"></div>');
    for (const d of DENSITY) {
      const b = el<HTMLButtonElement>('<button class="fm-kc-segbtn" type="button"></button>');
      setText(b, d.label);
      b.addEventListener('click', () => this.density(d.px));
      this.dens.set(d.px, b);
      dseg.appendChild(b);
    }

    setText(this.del, 'Delete bone');
    setText(this.reset, 'Reset pose');
    const done = el<HTMLButtonElement>('<button class="fm-bc-btn" type="button"></button>');
    setText(done, 'Done');
    this.del.addEventListener('click', () => removeSelectedBone(this.engine));
    this.reset.addEventListener('click', () => this.resetPose());
    done.addEventListener('click', () => { bonesMode.open(null); this.onDone(); });
    const row = el('<div class="fm-bc-actions"></div>');
    row.append(this.del, this.reset);
    const last = el('<div class="fm-bc-actions"></div>');
    last.append(this.weights, done);
    this.root.append(this.note, seg, label, dseg, row, last);
    bonesMode.onChange(() => this.paint());
    this.paint();
  }

  private target(): { c: Content; local: number } | null {
    const sel = this.engine.selected;
    const c = sel.length === 1 ? sel[0] : null;
    return c && this.engine.isOver(c) ? { c, local: this.engine.frame - c.start } : null;
  }

  /** Patch the card to the mode and the block's rig. */
  sync(c: Content, lane: KeyLane | null): void {
    const rig = c.rig;
    const cur = rig ? meshSize(rig) : MESH_DEFAULT;
    for (const [px, b] of this.dens) setClass(b, 'is-active', px === cur);
    for (const b of this.dens.values()) setDisabled(b, !rig);
    setDisabled(this.del, !bonesMode.selected || bonesMode.tool !== 'rig');
    setDisabled(this.reset, !lane);
    setDisabled(this.weights, !rig);
  }

  private paint(): void {
    setText(this.note, HINT[bonesMode.tool]);
    for (const [tool, b] of this.tools) setClass(b, 'is-active', tool === bonesMode.tool);
    setClass(this.weights, 'is-active', bonesMode.weights);
    this.weights.setAttribute('aria-pressed', String(bonesMode.weights));
    setDisabled(this.del, !bonesMode.selected || bonesMode.tool !== 'rig');
  }

  private density(px: number): void {
    const t = this.target();
    if (!t?.c.rig) return;
    const id = t.c.id;
    this.engine.run('Bones mesh', (m) => ops.updateContent(m, id, (c) => setMesh(c, px)));
  }

  /** Every bone back to rest at the Playhead, as a key. */
  private resetPose(): void {
    const t = this.target();
    const lane = t ? laneOf(t.c, 'bones') : null;
    if (!t || !lane || !t.c.rig) return;
    const zero: Record<string, number> = {};
    for (const b of t.c.rig.bones) zero[b.id] = 0;
    const { c, local } = t;
    this.engine.run('Reset Bones', (m) => ops.updateContent(m, c.id, (cc) => keyOps.setKeys(cc, 'bones', local, zero)));
  }
}
