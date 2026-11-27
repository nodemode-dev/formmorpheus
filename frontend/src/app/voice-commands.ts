// Speaking text onto the Timeline: the engine speaks, the sound comes in through the same import as any sound file,
// and the new sound remembers its words and voice (Asset.spoken) so subtitles can follow it.
import type { Engine } from '../engine/engine';
import { addCues, cuesForSound } from '../engine/subtitles';
import type { Movie, Track } from '../engine/types';
import { voiceApi, type SpeakRequest, type Spoken } from '../io/voice-api';

export interface SpokenOnTimeline { name: string; seconds: number; assetId: string; spoken: Spoken }
export type PlaceSound = (file: File, frame: number) => Promise<void>;

const EXT: Record<string, string> = { 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/aac': 'aac' };

/** The id of the first block that plays the asset, groups included. */
function blockOf(tracks: Track[], assetId: string): string | null {
  for (const t of tracks) for (const c of t.content) {
    if (c.asset === assetId) return c.id;
    const inner = c.kind === 'group' ? blockOf(c.tracks, assetId) : null;
    if (inner) return inner;
  }
  return null;
}

/** A file name from the first words spoken: letters, digits and spaces only, at most 40 characters. */
export function spokenName(text: string): string {
  const words = text.replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (words.length <= 40) return words || 'Voice';
  const cut = words.slice(0, 40);
  // end on a whole word when one ends in the last stretch
  const space = cut.lastIndexOf(' ');
  return (space > 20 ? cut.slice(0, space) : cut).trim();
}

/** Speaks `req.text` and places the sound at `frame` (default the playhead). Null when no movie is open or the
 *  import did not add a sound; throws what the engine said when the voice could not speak. */
export async function speakToTimeline(engine: Engine, place: PlaceSound, req: SpeakRequest, frame?: number, signal?: AbortSignal): Promise<SpokenOnTimeline | null> {
  if (!engine.movie) return null;
  const spoken = await voiceApi.speak(req, signal);
  try {
    const blob = await voiceApi.audio(spoken.id);
    const m = engine.movie;
    if (!m) return null;
    const had = new Set(Object.keys(m.assets));
    const name = spokenName(spoken.text);
    const at = Math.max(0, Math.round(frame ?? engine.frame));
    await place(new File([blob], `${name}.${EXT[spoken.mime] ?? 'wav'}`, { type: spoken.mime }), at);
    const now = engine.movie;
    const added = now ? Object.values(now.assets).find((a) => a.kind === 'audio' && !had.has(a.id)) : undefined;
    if (!added) return null;
    const note = { text: spoken.text, engine: spoken.engine, voice: spoken.voice, cues: spoken.cues };
    engine.run('AI Voice', (mv: Movie) => {
      const a = mv.assets[added.id];
      if (!a) return mv;
      const noted: Movie = { ...mv, assets: { ...mv.assets, [a.id]: { ...a, spoken: note } } };
      // an AI voice adds its own subtitles: the block that plays the new sound gives the frames
      const block = blockOf(noted.tracks, a.id);
      return block ? addCues(noted, cuesForSound(noted, block), block) : noted;
    });
    return { name, seconds: added.seconds ?? spoken.seconds ?? 0, assetId: added.id, spoken };
  } finally {
    void voiceApi.drop(spoken.id);
  }
}
