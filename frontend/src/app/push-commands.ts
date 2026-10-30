// Push and pull commands: move content one frame and carry what it touches; extend or contract while pushing or
// pulling the content after it. Registered by app.ts beside the other Timeline commands.
import type { Engine } from '../engine/engine';
import * as ops from '../engine/ops';
import { keepInside, pushContent } from '../engine/push-ops';
import { flipOrder } from '../engine/flip-order';
import type { Content } from '../engine/types';
import type { Command } from '../ui/commands';

export function pushCommands(engine: Engine): Command[] {
  const has = (): boolean => !!engine.movie;
  const sel = (): boolean => engine.selection.content.length > 0;
  const targets = (): Content[] => {
    const s = engine.selected.filter((c) => engine.isOver(c));
    return s.length ? s : engine.selected.slice(0, 1);
  };
  const push = (d: number) => (): void => {
    const ids = engine.selection.content.slice();
    engine.run('Push Content', (m) => pushContent(m, ids, d));
  };
  const ripple = (d: number, label: string) => (): void => {
    const ids = targets().map((c) => c.id);
    engine.run(label, (m) => {
      const out = ids.reduce((a, id) => ops.trimContent(a, id, 'end', d, true), m);
      return d > 0 ? keepInside(out) : out;
    });
  };
  return [
    {
      id: 'flip-order', label: 'Flip Content Order',
      enabled: () => has() && engine.selection.content.length > 1,
      run: () => { const ids = engine.selection.content.slice(); engine.run('Flip Content Order', (m) => flipOrder(m, ids)); },
    },
    { id: 'push-content-left', label: 'Push Content One Frame Earlier', keys: ['Shift+Mod+,'], enabled: () => has() && sel(), run: push(-1) },
    { id: 'push-content-right', label: 'Push Content One Frame Later', keys: ['Shift+Mod+.'], enabled: () => has() && sel(), run: push(1) },
    { id: 'extend-push', label: 'Extend Content and Push the Rest', keys: ['Shift+Mod+]'], enabled: () => has() && sel(), run: ripple(1, 'Extend and Push') },
    { id: 'contract-pull', label: 'Contract Content and Pull the Rest', keys: ['Shift+Mod+['], enabled: () => has() && sel(), run: ripple(-1, 'Contract and Pull') },
  ];
}
