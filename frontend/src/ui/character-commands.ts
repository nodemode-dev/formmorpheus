// Commands for characters: Make Character on one selected Group (Action menu, Content menu, command palette),
// Save to Characters, the Characters panel and the Character Builder.
import { makeCharacter } from '../engine/character-ops';
import type { Engine } from '../engine/engine';
import type { Content } from '../engine/types';
import type { CharacterBuilder } from './character-builder';
import type { CharactersPanel } from './characters-panel';
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

/** The one selected character that was built from a recipe, or null. */
export function selectedBuilt(engine: Engine): Content | null {
  const g = selectedCharacter(engine);
  return g?.character?.build ? g : null;
}

export function characterCommands(engine: Engine, panel: CharactersPanel, builder: () => CharacterBuilder): Command[] {
  return [
    {
      id: 'character.builder', label: 'Character Builder...', icon: 'character',
      group: 'Content', description: 'Opens the Character Builder: pick a preset, change the body, face, hair and outfit, then add the character to the movie or save it to Characters.',
      run: () => builder().open(),
    },
    {
      id: 'character.builder-edit', label: 'Edit in Character Builder...', icon: 'character', enabled: () => !!selectedBuilt(engine),
      group: 'Content', description: 'Opens the selected built character in the Character Builder; Apply rebuilds it and keeps its keyframes and actions.',
      run: () => { const g = selectedBuilt(engine); if (g) builder().edit(g.id); },
    },
    {
      id: 'characters-panel', label: 'Characters', icon: 'character', checked: () => panel.isOpen,
      group: 'View', description: 'Shows or hides the Characters panel: starter characters and the ones saved to the Characters library.',
      run: () => panel.toggle(),
    },
    {
      id: 'character.save', label: 'Save to Characters', icon: 'character', enabled: () => !!selectedCharacter(engine),
      group: 'Content', description: 'Saves the selected character to the Characters library, to add to any movie.',
      run: () => { const g = selectedCharacter(engine); if (g) void panel.save(g); },
    },
    {
      id: 'character.mouth', label: 'Use as Mouth Chart...', icon: 'character', mutates: true, enabled: () => !!selectedCharacter(engine),
      group: 'Content', description: 'Picks a mouth chart SVG (a group per mouth shape) and makes it the selected character\'s mouth, ready for Lip-sync from Sound.',
      run: () => { const g = selectedCharacter(engine); if (g) void panel.useMouthChart(g); },
    },
    {
      id: 'character.make', label: 'Make Character...', icon: 'character', mutates: true, enabled: () => !!selectedGroup(engine),
      group: 'Content', description: 'Makes the selected group a character: its inner contents become named parts, and a mouth chart Flipbook among them becomes its mouth.',
      when: 'Use when a group of body parts should be animated, saved and lip-synced as one character.',
      run: () => { void makeCharacterFlow(engine); },
    },
  ];
}
