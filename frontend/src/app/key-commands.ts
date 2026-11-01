// Keyframe keyboard commands: next and previous key, add a key at the Playhead, delete the chosen keys, set the easing
// of the stretch the Playhead is in (E, then 1 to 4), reverse and expand the lanes, and Retake in Perform.
// Registered by app.ts; each acts on the engine through ops, never the DOM.
import type { Engine } from '../engine/engine';
import * as keyOps from '../engine/key-ops';
import * as selOps from '../engine/key-sel-ops';
import { evalLane, laneFrames } from '../engine/keys';
import * as ops from '../engine/ops';
import type { Content, Ease, KeyKind } from '../engine/types';
import { newKeyState } from '../ui/action-menu';
import type { Command } from '../ui/commands';
import { keyChosen } from '../ui/key-state';
import { perform } from '../ui/perform-ui';
import { t } from '../ui/i18n';
import { toast } from '../ui/toast';

const NUMBERED: ReadonlyArray<readonly [Ease, string]> = [['linear', 'Linear'], ['in', 'Ease in'], ['out', 'Ease out'], ['inout', 'Ease in & out']];

/** Delete the chosen keyframes; false when none is chosen (so the plain Delete falls through to deleting content). */
export function deleteChosenKeys(engine: Engine): boolean {
  if (!keyChosen.size || engine.mode === 'compose') return false;
  const ids = keyChosen.ids();
  engine.run('Delete Keyframes', (m) => ids.reduce((acc, id) => { try { return ops.updateContent(acc, id, (c) => selOps.deleteRefs(c, keyChosen.refs(id))); } catch { return acc; } }, m));
  keyChosen.clear();
  return true;
}

export function keyCommands(engine: Engine): Command[] {
  const has = (): boolean => !!engine.movie;
  /** The contents the key commands act on: the selected ones, else those under the Playhead. */
  const targets = (): Content[] => {
    const s = engine.selected;
    if (s.length) return s;
    const m = engine.movie;
    return m ? m.tracks.flatMap((t) => t.content).filter((c) => engine.isOver(c)) : [];
  };
  const keyed = (): boolean => targets().some((c) => c.keys.length > 0);
  const frames = (): number[] => {
    const set = new Set<number>();
    for (const c of targets()) for (const lane of c.keys) for (const f of laneFrames(lane)) set.add(c.start + f);
    return [...set].sort((a, b) => a - b);
  };
  const go = (to: number | undefined, edge: string): void => {
    if (to === undefined) { toast(t(edge), 'info', { ms: 1200 }); return; }
    engine.stop();
    engine.seek(to);
  };

  /** Easing of the stretch that starts at the last key at or before the Playhead, on every lane of the targets. */
  const setEase = (ease: Ease, name: string): void => {
    newKeyState().lastEase = ease;
    const picked = targets().filter((c) => engine.isOver(c) && c.keys.length);
    if (!picked.length) return;
    engine.run('Set Easing', (m) => picked.reduce((acc, c) => ops.updateContent(acc, c.id, (cc) => {
      const local = engine.frame - c.start;
      return cc.keys.reduce((out, lane) => {
        const prev = laneFrames(lane).filter((f) => f <= local).pop();
        return prev === undefined ? out : keyOps.setEase(out, lane.kind, prev, ease);
      }, cc);
    }), m));
    toast(t(name), 'info', { ms: 900 });
  };
  let chordTimer = 0;
  let chordOff: (() => void) | null = null;
  const disarm = (): void => { window.clearTimeout(chordTimer); chordOff?.(); chordOff = null; };
  const arm = (): void => {
    disarm();
    toast(t('1 Linear · 2 Ease in · 3 Ease out · 4 Ease in & out'), 'info', { ms: 2200 });
    const onKey = (e: KeyboardEvent): void => {
      const n = e.code.startsWith('Digit') ? Number(e.code.slice(5)) : NaN;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (n >= 1 && n <= 4) { e.preventDefault(); e.stopPropagation(); setEase(NUMBERED[n - 1][0], NUMBERED[n - 1][1]); }
      else if (e.key === 'Shift') return;
      disarm();
    };
    window.addEventListener('keydown', onKey, true);
    chordOff = () => window.removeEventListener('keydown', onKey, true);
    chordTimer = window.setTimeout(disarm, 2200);
  };

  return [
    // (Alt+Arrow nudges the selection on the Stage, so the key steps sit on K: Shift+K next, Alt+K previous)
    { id: 'key-next', label: 'Next Key', keys: ['Shift+K'], enabled: () => has() && keyed(), run: () => go(frames().find((f) => f > engine.frame), 'No later key') },
    { id: 'key-prev', label: 'Previous Key', keys: ['Alt+K'], enabled: () => has() && keyed(), run: () => go(frames().filter((f) => f < engine.frame).pop(), 'No earlier key') },
    {
      id: 'key-add', label: 'Add Key at Playhead', keys: ['K'], enabled: () => has() && engine.mode !== 'compose' && targets().some((c) => engine.isOver(c)),
      run: () => {
        const ease = newKeyState().lastEase;
        const picked = targets().filter((c) => engine.isOver(c));
        engine.run('Add Keyframe', (m) => picked.reduce((acc, c) => ops.updateContent(acc, c.id, (cc) => {
          const local = engine.frame - c.start;
          if (!cc.keys.length) return keyOps.addLane(cc, 'move', local, m.addKeyAtStart, ease);
          return cc.keys.reduce((out, lane) => (lane.kind === 'bones' || laneFrames(lane).includes(local) || !Object.keys(evalLane(cc, lane, local)).length ? out : keyOps.addLane(out, lane.kind, local, false, ease)), cc);
        }), m));
      },
    },
    { id: 'key-delete', label: 'Delete Chosen Keys', enabled: () => has() && keyChosen.size > 0, run: () => { deleteChosenKeys(engine); } },
    { id: 'key-ease', label: 'Set Easing (then 1 to 4)', keys: ['E'], enabled: () => has() && engine.mode !== 'compose' && keyed(), run: arm },
    ...NUMBERED.map(([ease, name], i): Command => ({ id: `key-ease-${i + 1}`, label: `Easing: ${name}`, enabled: () => has() && keyed(), run: () => setEase(ease, name) })),
    {
      id: 'key-reverse', label: 'Reverse Keyframes', enabled: () => has() && keyed(),
      run: () => {
        if (keyChosen.size) {
          const ids = keyChosen.ids();
          engine.run('Reverse Keyframes', (m) => ids.reduce((acc, id) => { try { return ops.updateContent(acc, id, (c) => selOps.reverseRefs(c, keyChosen.refs(id))); } catch { return acc; } }, m));
          return;
        }
        const picked = targets().filter((c) => c.keys.length);
        engine.run('Reverse Keyframes', (m) => picked.reduce((acc, c) => ops.updateContent(acc, c.id, (cc) => keyOps.reverseKeys(cc)), m));
      },
    },
    {
      id: 'key-expand', label: 'Expand or Collapse Lanes', enabled: () => has() && keyed(),
      run: () => {
        const picked = targets().filter((c) => c.keys.length);
        const open = picked.some((c) => c.keys.some((l) => !l.expanded));
        const kinds = (c: Content): KeyKind[] => c.keys.map((l) => l.kind);
        // view state only: not an undo step
        engine.view((m) => picked.reduce((acc, c) => ops.updateContent(acc, c.id, (cc) => kinds(cc).reduce((out, k) => keyOps.setExpanded(out, k, open), cc)), m));
      },
    },
    {
      id: 'perform-retake', label: 'Retake (Undo the Last Take)', keys: ['Shift+R'], enabled: () => has() && !!perform.lastTake && !perform.recording,
      run: () => { perform.retake(engine); },
    },
  ];
}
