import { describe, expect, it, vi } from 'vitest';
import { SPEECH_COMMAND_IDS, speechCommands } from '@src/app/speech-commands';
import { Commands } from '@src/ui/commands';

describe('speechCommands', () => {
  it('registers Generate voice and Subtitles under the ids the menus name', () => {
    const commands = new Commands();
    commands.add(...speechCommands({ hasMovie: () => true, generateVoice: () => undefined, subtitles: () => undefined }));
    expect(SPEECH_COMMAND_IDS.map((id) => commands.get(id)?.label)).toEqual(['Generate voice...', 'Subtitles...']);
  });

  it('opens the matching card, and only while a movie is open', () => {
    let open = false;
    const generateVoice = vi.fn(), subtitles = vi.fn();
    const commands = new Commands();
    commands.add(...speechCommands({ hasMovie: () => open, generateVoice, subtitles }));
    expect(commands.run('generate-voice')).toBe(false);
    expect(commands.run('subtitles')).toBe(false);
    open = true;
    expect(commands.run('generate-voice')).toBe(true);
    expect(commands.run('subtitles')).toBe(true);
    expect(generateVoice).toHaveBeenCalledTimes(1);
    expect(subtitles).toHaveBeenCalledTimes(1);
  });
});
