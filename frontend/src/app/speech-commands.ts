// The two commands that open the Generate voice and Subtitles cards. Their own module so the list the menus, the
// Create card and the palette share can be checked without starting the whole app.
import type { Command } from '../ui/commands';

export interface SpeechCommandHooks {
  hasMovie: () => boolean;
  /** The platform's engine serves the speech routes (platform.features.speech). */
  speech: boolean;
  generateVoice: () => void;
  subtitles: () => void;
}

export const SPEECH_COMMAND_IDS = ['generate-voice', 'subtitles'] as const;

/**
 * Without the speech routes (an iPad) Generate voice is not registered, so no menu, card or palette lists it: both
 * of its tabs need the engine. Subtitles stays, since typed lines, styling and subtitle files need no engine; its
 * card leaves out its From sound part there.
 */
export function speechCommands(hooks: SpeechCommandHooks): Command[] {
  return [
    ...(hooks.speech ? [{
      id: 'generate-voice', label: 'Generate voice...', icon: 'audio', enabled: hooks.hasMovie, run: () => hooks.generateVoice(),
      group: 'Sound', description: 'Opens the Generate voice card, where typed words are spoken by the built-in voice or a speech server on this computer and land as a sound block at the Playhead.',
      when: 'Use when the movie needs spoken words made from text.',
    } satisfies Command] : []),
    {
      id: 'subtitles', label: 'Subtitles...', icon: 'text', enabled: hooks.hasMovie, run: () => hooks.subtitles(),
      group: 'Sound', description: 'Opens the Subtitles card: show or hide the lines, restyle them, edit them, make them from a sound block, and import or export a subtitles file.',
      when: 'Use when the movie needs subtitle lines added, edited, styled, imported or exported.',
    },
  ];
}
