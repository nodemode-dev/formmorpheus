// Explicit loop range: mark the in and out frames at the Playhead; playback then loops between them.
import type { Engine } from '../engine/engine';
import type { Movie } from '../engine/types';
import type { Command } from '../ui/commands';
import { toast } from '../ui/toast';

export function loopCommands(engine: Engine): Command[] {
  const has = (): boolean => !!engine.movie;
  const set = (label: string, fn: (m: Movie, f: number) => Movie) => (): void => {
    engine.run(label, (m) => fn(m, engine.frame));
    const m = engine.movie;
    if (m && m.loopFrom !== undefined && m.loopTo !== undefined) toast(`Loop ${m.loopFrom + 1} to ${m.loopTo + 1}`, 'info', { ms: 1200 });
  };
  return [
    {
      id: 'loop-in', label: 'Set Loop Start at Playhead', keys: ['Alt+I'], enabled: has,
      run: set('Set Loop Start', (m, f) => ({ ...m, loopFrom: f, loopTo: Math.max(f, m.loopTo ?? m.duration - 1) })),
    },
    {
      id: 'loop-out', label: 'Set Loop End at Playhead', keys: ['Alt+O'], enabled: has,
      run: set('Set Loop End', (m, f) => ({ ...m, loopFrom: Math.min(f, m.loopFrom ?? 0), loopTo: f })),
    },
    {
      id: 'loop-clear', label: 'Clear Loop Range', enabled: () => !!engine.movie && engine.movie.loopFrom !== undefined,
      run: () => engine.run('Clear Loop Range', (m) => { const n = { ...m }; delete n.loopFrom; delete n.loopTo; return n; }),
    },
  ];
}
