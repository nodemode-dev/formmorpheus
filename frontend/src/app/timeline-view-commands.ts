// Timeline view commands: zoom to selection and loop range, track headers, collapsed and expanded tracks, track lock.
import type { Engine } from '../engine/engine';
import { locate } from '../engine/model';
import { setTrackLocked } from '../engine/lock-ops';
import type { Command } from '../ui/commands';
import type { TimelineView } from '../ui/timeline';
import { rulerDrag, snapSeconds } from '../ui/timeline-nav';
import { previewSounds } from '../ui/preview-pref';

export function timelineViewCommands(engine: Engine, timeline: () => TimelineView | null): Command[] {
  const has = (): boolean => !!engine.movie;
  const trackIds = (): string[] => {
    const m = engine.movie;
    if (!m) return [];
    const ids = new Set<string>();
    for (const c of engine.selected) { const at = locate(m, c.id); if (at) ids.add(at.track.id); }
    if (!ids.size && engine.selection.track) ids.add(engine.selection.track);
    return [...ids];
  };
  return [
    { id: 'timeline-zoom-selection', label: 'Zoom Timeline to Selection', keys: ['Z'], enabled: () => engine.selected.length > 0, run: () => timeline()?.zoomToSelection() },
    { id: 'timeline-zoom-loop', label: 'Zoom Timeline to Loop Range', keys: ['Shift+Z'], enabled: () => !!engine.movie && engine.movie.loopFrom !== undefined, run: () => timeline()?.zoomToLoop() },
    { id: 'timeline-headers', label: 'Track Headers', enabled: has, checked: () => (timeline()?.headersMode() ?? 'off') !== 'off', run: () => timeline()?.cycleHeaders() },
    { id: 'timeline-ruler-drag', label: 'Ruler Drag Scales Time', checked: () => rulerDrag.mode === 'scale', run: () => rulerDrag.set(rulerDrag.mode === 'scale' ? 'scrub' : 'scale') },
    { id: 'snap-seconds', label: 'Snap to Seconds', checked: () => snapSeconds.on, run: () => snapSeconds.set(!snapSeconds.on) },
    { id: 'preview-sounds', label: 'Preview Sounds before Import', checked: () => previewSounds.on, run: () => previewSounds.set(!previewSounds.on) },
    { id: 'timeline-collapse', label: 'Collapse All Tracks', enabled: has, run: () => timeline()?.collapseTracks() },
    { id: 'timeline-expand', label: 'Expand All Tracks', enabled: has, run: () => timeline()?.expandTracks() },
    {
      id: 'track-lock', label: 'Lock or Unlock Track', enabled: () => trackIds().length > 0,
      run: () => {
        const ids = trackIds(), m = engine.movie;
        if (!m || !ids.length) return;
        const on = !ids.every((id) => m.tracks.find((t) => t.id === id)?.locked);
        engine.run(on ? 'Lock Track' : 'Unlock Track', (mv) => ids.reduce((acc, id) => setTrackLocked(acc, id, on), mv));
      },
    },
  ];
}
