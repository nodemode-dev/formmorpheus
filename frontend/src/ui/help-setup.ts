import type { Engine } from '../engine/engine';
import type { Commands } from './commands';
import { HelpCenter } from './help-center';
import { SITE_URL, openExternal } from './external-link';
import { TutorialCoach } from './tutorials';

export interface HelpSetupDeps {
  commands: Commands;
  engine: Engine;
  askToKeep: () => Promise<boolean>;
  closeHome: () => void;
}

/** Registers the Help Center commands (Help menu, the brand menu, the palette); the window is built on first use. */
export function setupHelpCenter(d: HelpSetupDeps): { coach: TutorialCoach } {
  const coach = new TutorialCoach({ engine: d.engine, askToKeep: d.askToKeep, closeHome: d.closeHome });
  let center: HelpCenter | null = null;
  const open = (tab?: 'start' | 'tutorials' | 'manual' | 'idea' | 'more'): void => {
    center ??= new HelpCenter(coach, (c) => { d.commands.run(c); });
    center.show(tab);
  };
  d.commands.add(
    { id: 'help-center', label: 'Help Center...', run: () => open() },
    { id: 'help-tutorials', label: 'Tutorials...', run: () => open('tutorials') },
    { id: 'help-idea', label: 'Send an Idea...', run: () => open('idea') },
    { id: 'help-web', label: 'FormMorpheus on the Web', run: () => openExternal(SITE_URL) },
  );
  return { coach };
}
