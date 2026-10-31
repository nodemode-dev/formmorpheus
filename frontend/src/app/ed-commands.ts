// Commands for markers, Timeline snapping, sizing on the Stage and clip retime.
import type { Engine } from '../engine/engine';
import { autoOrient, cycleKeys, keyCount, thinKeys } from '../engine/key-fast-ops';
import * as ops from '../engine/ops';
import type { Content } from '../engine/types';
import { canSize, sizeContent, type SizeMode } from '../engine/fit-ops';
import { addMarker, markerAtFrame, stepMarker } from '../engine/marker-ops';
import { canRetime } from '../engine/retime';
import * as rt from '../engine/retime-ops';
import { setImportSize, importSize } from '../media/import-size';
import type { Command } from '../ui/commands';
import { timelineSnap } from '../ui/timeline-ed';
import { toast } from '../ui/toast';

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
  ];
  function keyTool(id: string, label: string, undo: string, fn: (c: Content) => Content): Command {
    return {
      id, label, enabled: () => engine.selected.some((c) => keyCount(c) > 0),
      run: () => { const ids = engine.selection.content; engine.run(undo, (m) => ids.reduce((acc, cid) => ops.updateContent(acc, cid, fn), m)); },
    };
  }
}
