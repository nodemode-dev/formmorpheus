// Dragging a key in time: it snaps to the Playhead and to the keys of other lanes (and other contents) within a few
// pixels, Alt turns the snapping off, and a small tooltip names the frame. Built once, patched while dragging.
import type { Engine } from '../engine/engine';
import { laneFrames } from '../engine/keys';
import type { Content, KeyKind } from '../engine/types';
import { el, setHidden, setText } from './dom';
import '../styles/stage-hud.css';

const SNAP_PX = 6;

export interface KeySnap { frame: number; to: 'playhead' | 'key' | null }

/** Where the Playhead stood when the key was picked up (the drag moves it along with the key, so it cannot be read later). */
export const keyHome = { frame: -1 };

/** The content-local frame a dragged key lands on: `raw` (already rounded) or the nearest Playhead or key frame within reach. */
export function snapKeyFrame(engine: Engine, c: Content, kind: KeyKind, raw: number, ppf: number, off: boolean): KeySnap {
  if (off) return { frame: raw, to: null };
  const tol = SNAP_PX / Math.max(ppf, 0.01);
  let best: KeySnap = { frame: raw, to: null }, bd = tol + 1e-6;
  const consider = (f: number, to: 'playhead' | 'key'): void => {
    const d = Math.abs(f - raw);
    if (d < bd && f >= 0 && f <= c.duration - 1) { bd = d; best = { frame: f, to }; }
  };
  if (keyHome.frame >= 0) consider(keyHome.frame - c.start, 'playhead');
  const m = engine.movie;
  if (!m) return best;
  for (const t of m.tracks) {
    for (const o of t.content) {
      for (const lane of o.keys ?? []) {
        // the dragged lane is skipped: its own keys are what the drag moves among
        if (o.id === c.id && lane.kind === kind) continue;
        for (const f of laneFrames(lane)) consider(o.start + f - c.start, 'key');
      }
    }
  }
  return best;
}

/** The frame tooltip by the pointer while a key is dragged. */
class KeyTip {
  private readonly root = el('<div class="fm-keytip" hidden></div>');
  private mounted = false;
  private last = '';

  show(x: number, y: number, text: string): void {
    if (!this.mounted) { (document.getElementById('overlay-root') ?? document.body).appendChild(this.root); this.mounted = true; }
    if (text !== this.last) { this.last = text; setText(this.root, text); }
    setHidden(this.root, false);
    this.root.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y - 34)}px)`;
  }

  hide(): void { setHidden(this.root, true); this.last = ''; }
}

export const keyTip = new KeyTip();
