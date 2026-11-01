// Stage and Timeline keyboard commands the first builds lacked: nudge, content and second steps, trims, track focus,
// rename, visibility, flips. Registered by app.ts; each one acts on the engine through ops, never the DOM.
import type { Engine } from '../engine/engine';
import { end, locate } from '../engine/model';
import * as ops from '../engine/ops';
import * as hideOps from '../engine/hide-ops';
import * as tops from '../engine/transform-ops';
import type { Content } from '../engine/types';
import type { Command } from '../ui/commands';
import { promptName } from '../ui/dialogs';
import { stepLaneFocus } from '../ui/lane-focus';

export interface CkHooks {
  engine: Engine;
  /** Move the selection on the Stage by movie pixels. */
  nudge: (dx: number, dy: number) => void;
  centerPlayhead: () => void;
  /** Open the content options menu for the selection, the Create menu, or the editor of a content. */
  openOptions: () => void;
  openCreate: () => void;
  edit: (c: Content) => void;
}

const DIRS: ReadonlyArray<readonly [string, string, number, number]> = [['left', 'Left', -1, 0], ['right', 'Right', 1, 0], ['up', 'Up', 0, -1], ['down', 'Down', 0, 1]];

export function ckCommands(h: CkHooks): Command[] {
  const { engine } = h;
  const has = (): boolean => !!engine.movie;
  const sel = (): boolean => engine.selection.content.length > 0;
  const over = (): Content[] => engine.selected.filter((c) => engine.isOver(c));
  /** The selected contents under the Playhead, or those on the selected track when none is selected. */
  const targets = (): Content[] => {
    const s = over();
    if (s.length) return s;
    const m = engine.movie;
    const t = m?.tracks.find((tr) => tr.id === engine.selection.track);
    const c = t?.content.find((x) => engine.isOver(x));
    return c ? [c] : [];
  };
  const starts = (): number[] => {
    const m = engine.movie;
    if (!m) return [];
    return Array.from(new Set(m.tracks.flatMap((t) => t.content.map((c) => c.start)))).sort((a, b) => a - b);
  };
  const trackIndex = (): number => {
    const m = engine.movie;
    if (!m) return -1;
    const id = engine.selection.track ?? (engine.selected[0] ? locate(m, engine.selected[0].id)?.track.id : undefined);
    return m.tracks.findIndex((t) => t.id === id);
  };
  const focusTrack = (to: (i: number, n: number) => number): void => {
    const m = engine.movie;
    if (!m || !m.tracks.length) return;
    const i = Math.max(0, Math.min(m.tracks.length - 1, to(trackIndex(), m.tracks.length)));
    const t = m.tracks[i];
    const c = t.content.find((x) => engine.isOver(x));
    engine.select(c ? [c.id] : [], t.id);
  };
  const seek = (f: number): void => { engine.stop(); engine.seek(f); };
  /** In Keyframe and Perform modes Up and Down walk the key lanes of the one selected block before they leave it. */
  const stepLanes = (dir: -1 | 1): boolean => {
    if (engine.mode === 'compose' || engine.selected.length !== 1) return false;
    return stepLaneFocus(engine.selected[0], dir);
  };

  const out: Command[] = [];
  for (const [id, label, dx, dy] of DIRS) {
    out.push(
      { id: `stage-nudge-${id}`, label: `Nudge ${label} 1 px`, keys: [`Alt+${label}`], enabled: () => has() && sel(), run: () => h.nudge(dx, dy) },
      { id: `stage-nudge-${id}-10`, label: `Nudge ${label} 10 px`, keys: [`Alt+Shift+${label}`], enabled: () => has() && sel(), run: () => h.nudge(dx * 10, dy * 10) },
      { id: `stage-nudge-${id}-100`, label: `Nudge ${label} 100 px`, keys: [`Alt+Shift+Mod+${label}`], enabled: () => has() && sel(), run: () => h.nudge(dx * 100, dy * 100) },
    );
  }
  const onSel = (label: string, fn: (m: NonNullable<Engine['movie']>, ids: string[]) => NonNullable<Engine['movie']>): (() => void) => () => {
    const ids = over().map((c) => c.id);
    if (ids.length) engine.run(label, (m) => fn(m, ids));
  };
  out.push(
    { id: 'stage-flip-h', label: 'Flip Horizontal', enabled: () => has() && sel(), run: onSel('Flip Horizontal', (m, ids) => tops.flip(m, ids, 'h')) },
    { id: 'stage-flip-v', label: 'Flip Vertical', enabled: () => has() && sel(), run: onSel('Flip Vertical', (m, ids) => tops.flip(m, ids, 'v')) },
    { id: 'stage-reset-transform', label: 'Reset Transform', enabled: () => has() && sel(), run: onSel('Reset Transform', (m, ids) => tops.resetTransform(m, ids)) },

    { id: 'next-content', label: 'Next Content Start', keys: ['Mod+Right'], enabled: has, run: () => { const n = starts().find((s) => s > engine.frame); if (n !== undefined) seek(n); } },
    { id: 'prev-content', label: 'Previous Content Start', keys: ['Mod+Left'], enabled: has, run: () => { const p = starts().filter((s) => s < engine.frame).pop(); if (p !== undefined) seek(p); } },
    { id: 'forward-second', label: 'Forward One Second', keys: ['Shift+Right'], enabled: has, run: () => engine.step(Math.round(engine.movie?.fps ?? 24)) },
    { id: 'back-second', label: 'Back One Second', keys: ['Shift+Left'], enabled: has, run: () => engine.step(-Math.round(engine.movie?.fps ?? 24)) },
    { id: 'center-playhead', label: 'Center View on Playhead', keys: ['Mod+L'], enabled: has, run: () => h.centerPlayhead() },

    { id: 'nudge-content-left', label: 'Nudge Content One Frame Earlier', keys: ['Shift+Mod+Left'], enabled: sel, run: () => { const ids = engine.selection.content.slice(); engine.run('Nudge Content', (m) => ops.moveContent(m, ids, -1, 0)); } },
    { id: 'nudge-content-right', label: 'Nudge Content One Frame Later', keys: ['Shift+Mod+Right'], enabled: sel, run: () => { const ids = engine.selection.content.slice(); engine.run('Nudge Content', (m) => ops.moveContent(m, ids, 1, 0)); } },
    { id: 'extend-content', label: 'Extend Content One Frame', keys: ['Mod+]'], enabled: () => has() && targets().length > 0, run: () => { const ids = targets().map((c) => c.id); engine.run('Extend Content', (m) => ids.reduce((a, id) => ops.trimContent(a, id, 'end', 1), m)); } },
    { id: 'contract-content', label: 'Contract Content One Frame', keys: ['Mod+['], enabled: () => has() && targets().length > 0, run: () => { const ids = targets().map((c) => c.id); engine.run('Contract Content', (m) => ids.reduce((a, id) => ops.trimContent(a, id, 'end', -1), m)); } },
    { id: 'shorten-to-first', label: 'Shorten to First Frame', keys: ['Alt+Mod+['], enabled: () => has() && targets().length > 0, run: () => { const t = targets().map((c) => [c.id, c.duration] as const); engine.run('Shorten to First Frame', (m) => t.reduce((a, [id, d]) => ops.trimContent(a, id, 'end', 1 - d), m)); } },
    {
      id: 'trim-start-to-playhead', label: 'Trim Start to Playhead', keys: ['Alt+Q'], enabled: () => has() && over().length > 0,
      run: () => { const f = engine.frame, t = over().filter((c) => f > c.start).map((c) => [c.id, f - c.start] as const); if (t.length) engine.run('Trim Start to Playhead', (m) => t.reduce((a, [id, d]) => ops.trimContent(a, id, 'start', d), m)); },
    },
    {
      id: 'trim-end-to-playhead', label: 'Trim End to Playhead', keys: ['Alt+W'], enabled: () => has() && over().length > 0,
      run: () => { const f = engine.frame, t = over().filter((c) => f > c.start && f < end(c)).map((c) => [c.id, f - end(c)] as const); if (t.length) engine.run('Trim End to Playhead', (m) => t.reduce((a, [id, d]) => ops.trimContent(a, id, 'end', d), m)); },
    },

    { id: 'track-above', label: 'Move to Track Above', keys: ['Up'], enabled: has, run: () => { if (!stepLanes(-1)) focusTrack((i) => i - 1); } },
    { id: 'track-below', label: 'Move to Track Below', keys: ['Down'], enabled: has, run: () => { if (!stepLanes(1)) focusTrack((i) => i + 1); } },
    { id: 'track-top', label: 'Move to Top Track', keys: ['Mod+Up'], enabled: has, run: () => focusTrack(() => 0) },
    { id: 'track-bottom', label: 'Move to Bottom Track', keys: ['Mod+Down'], enabled: has, run: () => focusTrack((_, n) => n - 1) },
    {
      id: 'rename-content', label: 'Rename Content...', keys: ['F2'], enabled: () => engine.selection.content.length === 1,
      run: () => { const c = engine.selected[0]; if (c) void promptName('Rename', c.name, 'Rename').then((v) => { if (v) engine.run('Rename', (m) => ops.patchContent(m, [c.id], { name: v })); }); },
    },
    {
      id: 'toggle-visibility', label: 'Hide or Show Content', keys: ['H'], enabled: () => has() && (sel() || trackIndex() >= 0),
      run: () => {
        // content first (the reference hides the selected content); an empty-lane selection hides the track
        if (sel()) {
          const ids = engine.selection.content.slice(), hide = !engine.selected.every((c) => c.hidden);
          engine.run(hide ? 'Hide Content' : 'Show Content', (mv) => ids.reduce((a, id) => hideOps.setContentHidden(a, id, hide), mv));
          return;
        }
        const m = engine.movie, t = m?.tracks[trackIndex()]; if (t) engine.run(t.hidden ? 'Show Track' : 'Hide Track', (mv) => ops.setTrackHidden(mv, t.id, !t.hidden)); },
    },
    { id: 'open-options', label: 'Content Options', keys: ['O'], enabled: () => has() && sel(), run: () => h.openOptions() },
    { id: 'open-create', label: 'Create Menu', keys: ['A'], enabled: has, run: () => h.openCreate() },
    { id: 'enter-content', label: 'Edit Content', keys: ['Enter'], enabled: () => engine.selection.content.length === 1, run: () => { const c = engine.selected[0]; if (c) h.edit(c); } },
  );
  return out;
}
