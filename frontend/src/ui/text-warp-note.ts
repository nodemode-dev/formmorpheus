// A text block that already has a Warp or Distort lane can crop when its words change length: say so once per block.
import type { Engine } from '../engine/engine';
import { t } from './i18n';
import { toast } from './toast';

export function installTextWarpNote(engine: Engine): void {
  const seen = new Map<string, string>();
  const told = new Set<string>();
  engine.on('movie', () => {
    const m = engine.movie;
    if (!m) { seen.clear(); return; }
    const alive = new Set<string>();
    for (const tr of m.tracks) {
      for (const c of tr.content) {
        if (c.kind !== 'text' || !c.text) continue;
        alive.add(c.id);
        const before = seen.get(c.id);
        seen.set(c.id, c.text.text);
        if (before === undefined || before === c.text.text || before.length === c.text.text.length || told.has(c.id)) continue;
        if (!c.keys.some((l) => l.kind === 'warp' || l.kind === 'distort')) continue;
        told.add(c.id);
        toast(t('The text changed length after it was keyed with Warp or Distort, so its edges may crop. Check the keys.'), 'info', { ms: 4200 });
      }
    }
    for (const id of [...seen.keys()]) if (!alive.has(id)) seen.delete(id);
  });
}
