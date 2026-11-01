// Commands for markers, Timeline snapping, sizing on the Stage and clip retime.
import type { Engine } from '../engine/engine';
import { autoOrient, cycleKeys, keyCount, thinKeys } from '../engine/key-fast-ops';
import * as ops from '../engine/ops';
import type { Content } from '../engine/types';
import { canSize, sizeContent, type SizeMode } from '../engine/fit-ops';
import { addMarker, markerAtFrame, stepMarker } from '../engine/marker-ops';
import { canRetime, srcFrame } from '../engine/retime';
import * as inner from '../engine/group-inner-ops';
import { defaultTransition, TRANSITION_KINDS } from '../engine/transitions';
import * as rt from '../engine/retime-ops';
import { setImportSize, importSize } from '../media/import-size';
import { detectOnsets } from '../media/beats';
import type { Command } from '../ui/commands';
import { timelineSnap } from '../ui/timeline-ed';
import { toast } from '../ui/toast';
import { tf } from '../ui/i18n-fill';

/** Detects the beats of the selected sound and puts a marker on each (one undo step; existing markers stay). */
async function beatMarkers(engine: Engine): Promise<void> {
  const c = engine.selected[0], m = engine.movie;
  const blob = c?.asset ? engine.assets.get(c.asset) : undefined;
  if (!c || !m || !blob) return;
  toast('Listening for beats...', 'info', { ms: 1500 });
  let buf: AudioBuffer;
  try { buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await blob.arrayBuffer()); } catch { toast('This sound could not be decoded to look for beats.', 'error'); return; }
  const speed = c.speed && c.speed > 0 ? c.speed : 1;
  const from = c.offset / m.fps, to = (c.offset + c.duration * speed) / m.fps;
  const times = detectOnsets(Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)), buf.sampleRate, from, to);
  const frames = [...new Set(times.map((s) => c.start + Math.round(((s - from) * m.fps) / speed)))].filter((f) => f >= c.start && f < c.start + c.duration);
  const fresh = frames.filter((f) => !markerAtFrame(m, f));
  if (!fresh.length) { toast('No beats were found in this sound.', 'info'); return; }
  engine.run('Add Markers on Beats', (mv) => fresh.reduce((acc, f) => (markerAtFrame(acc, f) ? acc : addMarker(acc, f, 'Beat').movie), mv));
  toast(tf('Added {n} markers on beats.', { n: fresh.length }), 'info');
}

export function edCommands(engine: Engine): Command[] {
  const has = (): boolean => !!engine.movie;
  const retimable = (): boolean => engine.selected.length === 1 && canRetime(engine.selected[0]);
  const size = (id: string, label: string, mode: SizeMode): Command => ({
    id, label, enabled: () => engine.selected.some(canSize),
    run: () => { const ids = engine.selection.content; engine.run('Size on Stage', (m) => sizeContent(m, ids, mode)); },
  });
  const pref = (id: string, label: string, mode: SizeMode): Command => ({
    id, label, checked: () => importSize() === mode, run: () => setImportSize(mode),
  });
  const jump = (dir: 1 | -1): void => {
    const m = engine.movie;
    if (!m) return;
    const f = stepMarker(m, engine.frame, dir);
    if (f === null) toast(dir === 1 ? 'No marker after the Playhead.' : 'No marker before the Playhead.', 'info', { ms: 1200 });
    else engine.seek(f);
  };
  return [
    {
      id: 'marker-add', label: 'Add Marker at Playhead', keys: ['M'], enabled: has,
      run: () => {
        const m = engine.movie;
        if (!m) return;
        if (markerAtFrame(m, engine.frame)) { toast('There is already a marker on this frame.', 'info', { ms: 1400 }); return; }
        const f = engine.frame;
        engine.run('Add Marker', (mv) => addMarker(mv, f).movie);
      },
    },
    { id: 'marker-next', label: 'Next Marker', keys: ['Alt+.'], enabled: has, run: () => jump(1) },
    { id: 'marker-prev', label: 'Previous Marker', keys: ['Alt+,'], enabled: has, run: () => jump(-1) },
    {
      id: 'beat-markers', label: 'Add Markers on Beats',
      enabled: () => engine.selected.length === 1 && (engine.selected[0].kind === 'audio' || engine.selected[0].kind === 'video') && !!engine.selected[0].asset,
      run: () => { void beatMarkers(engine); },
    },
    {
      id: 'marker-clear', label: 'Delete Markers', enabled: () => !!engine.movie?.markers?.length,
      run: () => engine.run('Delete Markers', (m) => { const n = { ...m }; delete n.markers; return n; }),
    },
    {
      id: 'timeline-snap', label: 'Snap Timeline', keys: ['Alt+S'], enabled: has,
      checked: () => timelineSnap.on, run: () => timelineSnap.set(!timelineSnap.on),
    },
    size('size-fit', 'Fit to Stage', 'fit'),
    size('size-fill', 'Fill Stage', 'fill'),
    size('size-original', 'Original Size', 'original'),
    pref('import-size-fit', 'Fit', 'fit'),
    pref('import-size-fill', 'Fill', 'fill'),
    pref('import-size-original', 'Original Size', 'original'),
    {
      id: 'freeze-frame', label: 'Freeze Frame at Playhead', enabled: () => retimable() && engine.selected[0].kind !== 'audio' && engine.isOver(engine.selected[0]),
      run: () => {
        const c = engine.selected[0];
        const fps = engine.movie?.fps ?? 24, f = engine.frame;
        engine.run('Freeze Frame', (m) => { const r = rt.freezeAt(m, c.id, f, Math.round(fps)); return { movie: r.movie, select: [r.freeze] }; });
      },
    },
    {
      id: 'reverse-clip', label: 'Reverse Clip', enabled: () => engine.selected.length > 0 && engine.selected.every(canRetime),
      checked: () => engine.selected.length > 0 && engine.selected.every((c) => !!c.reverse),
      run: () => {
        const ids = engine.selection.content, on = !engine.selected.every((c) => !!c.reverse);
        engine.run('Reverse Clip', (m) => ids.reduce((acc, id) => rt.setReverse(acc, id, on), m));
      },
    },
    {
      id: 'speed-reset', label: 'Reset Speed and Direction', enabled: () => engine.selected.some((c) => c.speed !== undefined || !!c.reverse),
      run: () => { const ids = engine.selection.content; engine.run('Reset Speed', (m) => ids.reduce((acc, id) => rt.resetRetime(acc, id), m)); },
    },
    // the key fast paths also live in the Keyframe menu and the palette, not only in a block's right-click menu
    keyTool('keys-loop', 'Loop Keys to End of Block', 'Loop Keys', (c) => cycleKeys(c, 'loop')),
    keyTool('keys-pingpong', 'Ping-pong Keys to End of Block', 'Ping-pong Keys', (c) => cycleKeys(c, 'pingpong')),
    keyTool('keys-cycle', 'Cycle Keys with Offset', 'Cycle Keys', (c) => cycleKeys(c, 'offset')),
    keyTool('keys-thin', 'Thin Keys', 'Thin Keys', (c) => thinKeys(c, 0.03)),
    keyTool('keys-orient', 'Turn Along Motion Path', 'Auto-orient', (c) => autoOrient(c)),
    // a transition between two touching blocks inside the selected group, at the cut nearest the Playhead
    ...TRANSITION_KINDS.map((k): Command => ({
      id: `group-transition-${k.id}`, label: `Group Transition: ${k.label}`, enabled: () => !!innerCut(),
      run: () => {
        const b = innerCut(), fps = engine.movie?.fps ?? 24;
        if (b) engine.run('Transition', (m) => inner.setInnerTransition(m, b.id, defaultTransition(k.id, fps)));
      },
    })),
    {
      id: 'group-transition-none', label: 'Group Transition: None', enabled: () => !!innerCut(true),
      run: () => { const b = innerCut(true); if (b) engine.run('Transition', (m) => inner.setInnerTransition(m, b.id, null)); },
    },
  ];
  /** The inner block that starts the cut nearest the Playhead in the one selected group (`having`: one with a transition). */
  function innerCut(having = false): Content | null {
    const g = engine.selected.length === 1 && engine.selected[0].kind === 'group' ? engine.selected[0] : null;
    if (!g || !engine.isOver(g)) return null;
    const local = srcFrame(g, engine.frame - g.start);
    const b = inner.cutNear(g, local);
    return b && (!having || b.transition) ? b : null;
  }
  function keyTool(id: string, label: string, undo: string, fn: (c: Content) => Content): Command {
    return {
      id, label, enabled: () => engine.selected.some((c) => keyCount(c) > 0),
      run: () => { const ids = engine.selection.content; engine.run(undo, (m) => ids.reduce((acc, cid) => ops.updateContent(acc, cid, fn), m)); },
    };
  }
}
