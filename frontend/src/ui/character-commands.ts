// Commands for characters: Make Character on one selected Group (Action menu, Content menu, command palette).
import { makeCharacter } from '../engine/character-ops';
import type { Engine } from '../engine/engine';
import type { Content } from '../engine/types';
import type { Command } from './commands';
import { promptName } from './dialogs';
import { t } from './i18n';

/** The one selected Group, or null. */
export function selectedGroup(engine: Engine): Content | null {
  const sel = engine.selected;
  return sel.length === 1 && sel[0].kind === 'group' ? sel[0] : null;
}

/** The one selected character, or null. */
export function selectedCharacter(engine: Engine): Content | null {
  const g = selectedGroup(engine);
  return g?.character ? g : null;
}

export async function makeCharacterFlow(engine: Engine, id?: string): Promise<void> {
  const g = id ? engine.selected.find((c) => c.id === id) ?? null : selectedGroup(engine);
  if (!g || g.kind !== 'group') return;
  const name = await promptName(t('Make Character'), g.character?.name ?? g.name, t('Make'));
  if (!name) return;
  engine.run('Make Character', (m) => ({ movie: makeCharacter(m, g.id, name), select: [g.id] }));
}

export function characterCommands(engine: Engine): Command[] {
  return [
    {
      id: 'character.make', label: 'Make Character...', icon: 'character', mutates: true, enabled: () => !!selectedGroup(engine),
      group: 'Content', description: 'Makes the selected group a character: its inner contents become named parts, and a mouth chart Flipbook among them becomes its mouth.',
      when: 'Use when a group of body parts should be animated, saved and lip-synced as one character.',
      run: () => { void makeCharacterFlow(engine); },
    },
  ];
}
