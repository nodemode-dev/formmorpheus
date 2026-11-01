// Draw & Paint keys. The commands are registered with the app's command table, so they are
// remappable and show in the palette; inside Draw & Paint a key event resolves to one of them
// here. Combos that the Compose commands already hold (Cut, Copy, Duplicate, Merge, Delete)
// stay local defaults: the registry keeps them empty so it never steals a key.

import { comboOf, type Command, type Commands } from './commands';

export type PaintCmdId =
  | 'paint-tool-paint' | 'paint-tool-smudge' | 'paint-tool-erase' | 'paint-colour-panel' | 'paint-layers-panel'
  | 'paint-size-down' | 'paint-size-up' | 'paint-opacity-down' | 'paint-opacity-up'
  | 'paint-size-prev' | 'paint-size-next' | 'paint-opacity-prev' | 'paint-opacity-next'
  | 'paint-prev-colour' | 'paint-eyedropper' | 'paint-fill' | 'paint-play'
  | 'paint-cut' | 'paint-copy' | 'paint-paste' | 'paint-duplicate' | 'paint-cut-paste' | 'paint-clear'
  | 'paint-merge-down' | 'paint-last-tool';

interface Def { id: PaintCmdId; label: string; keys: string[]; local?: string[]; repeat?: boolean }

const DEFS: Def[] = [
  { id: 'paint-tool-paint', label: 'Paint: Paint Tool', keys: ['B'] },
  { id: 'paint-tool-smudge', label: 'Paint: Smudge Tool', keys: ['S'] },
  { id: 'paint-tool-erase', label: 'Paint: Erase Tool', keys: ['E'] },
  { id: 'paint-colour-panel', label: 'Paint: Open Color Panel', keys: ['C'] },
  { id: 'paint-layers-panel', label: 'Paint: Open Layers Panel', keys: ['L'] },
  { id: 'paint-size-down', label: 'Paint: Size Down 5%', keys: ['['], repeat: true },
  { id: 'paint-size-up', label: 'Paint: Size Up 5%', keys: [']'], repeat: true },
  { id: 'paint-opacity-down', label: 'Paint: Opacity Down 5%', keys: ['Shift+['], repeat: true },
  { id: 'paint-opacity-up', label: 'Paint: Opacity Up 5%', keys: ['Shift+]'], repeat: true },
  { id: 'paint-size-prev', label: 'Paint: Size to Previous Memory Point', keys: ['Alt+['] },
  { id: 'paint-size-next', label: 'Paint: Size to Next Memory Point', keys: ['Alt+]'] },
  { id: 'paint-opacity-prev', label: 'Paint: Opacity to Previous Memory Point', keys: ['Alt+Shift+['] },
  { id: 'paint-opacity-next', label: 'Paint: Opacity to Next Memory Point', keys: ['Alt+Shift+]'] },
  { id: 'paint-prev-colour', label: 'Paint: Previous Color', keys: ['X'] },
  { id: 'paint-eyedropper', label: 'Paint: Eyedropper', keys: ['I'] },
  { id: 'paint-fill', label: 'Paint: Fill Tool', keys: ['G'] },
  { id: 'paint-play', label: 'Paint: Play Flipbook', keys: ['P'] },
  { id: 'paint-last-tool', label: 'Paint: Back to Last Tool', keys: ['Q'] },
  { id: 'paint-cut', label: 'Paint: Cut', keys: [], local: ['Mod+X'] },
  { id: 'paint-copy', label: 'Paint: Copy', keys: [], local: ['Mod+C'] },
  { id: 'paint-paste', label: 'Paint: Paste', keys: [] },
  { id: 'paint-duplicate', label: 'Paint: Duplicate Layer or Selection', keys: [], local: ['Mod+J'] },
  { id: 'paint-cut-paste', label: 'Paint: Cut & Paste', keys: [], local: ['Shift+Mod+J'] },
  { id: 'paint-clear', label: 'Paint: Clear Selection or Layer', keys: [], local: ['Delete', 'Backspace'] },
  { id: 'paint-merge-down', label: 'Paint: Merge Layer Down', keys: [], local: ['Mod+E'] },
];

/** Keys that other modes also use (P pen tool, E easing): they only count inside Draw & Paint. */
const SCOPED = new Set<PaintCmdId>(['paint-play', 'paint-tool-erase']);
const LOCAL = new Map<string, Def>();
for (const d of DEFS) for (const k of d.local ?? []) LOCAL.set(k, d);

export interface PaintKeyHost {
  isOpen(): boolean;
  run(id: PaintCmdId): void;
}

/** The commands to register with the app's table. */
export function paintCommandDefs(host: PaintKeyHost): Command[] {
  return DEFS.map((d) => ({
    id: d.id,
    label: d.label,
    keys: [...d.keys],
    group: 'Draw & Paint',
    scope: SCOPED.has(d.id) ? 'paint' : undefined,
    enabled: () => host.isOpen(),
    run: () => host.run(d.id),
  }));
}

/** Which Draw & Paint command a key event stands for, honouring the person's own bindings. */
export function paintCommandFor(e: KeyboardEvent, commands: Commands | null): { id: PaintCmdId; repeat: boolean } | null {
  const combo = comboOf(e);
  const scoped = commands?.forScoped('paint', combo);
  if (scoped) return { id: scoped.id as PaintCmdId, repeat: DEFS.find((d) => d.id === scoped.id)?.repeat ?? false };
  const hit = commands?.forCombo(combo);
  if (hit && hit.id.startsWith('paint-')) return { id: hit.id as PaintCmdId, repeat: DEFS.find((d) => d.id === hit.id)?.repeat ?? false };
  const local = LOCAL.get(combo);
  if (local && !(commands?.get(local.id)?.keys?.length)) return { id: local.id, repeat: false };
  // defaults stand when no command table was handed over
  if (!commands) {
    const d = DEFS.find((x) => x.keys.includes(combo));
    if (d) return { id: d.id, repeat: !!d.repeat };
  }
  return null;
}
