import { describe, expect, it } from 'vitest';
import { content as makeContent, newMovie } from '@src/engine/model';
import { SUBTITLE_DEFAULTS, readSubtitles, subtitleTrack, writeSubtitles } from '@src/engine/subtitles';
import type { Movie } from '@src/engine/types';
import { MAX_SUBTITLE_FILE_BYTES, VOICE_TRACK_NAME, addEmptyLine, lineAt, lineBlocks, placeVoice, sameSound, unheardReason } from '@src/ui/speech-logic';

const movie = (): Movie => newMovie({ name: 'Test', width: 1280, height: 720, fps: 24, seconds: 10 });
const withLine = (): Movie => writeSubtitles(movie(), [{ start: 1, end: 3, text: 'hello world' }], SUBTITLE_DEFAULTS);
const spans = (m: Movie): Array<[number, number, string]> => lineBlocks(m).map((c) => [c.start, c.duration, c.text?.text ?? '']);

describe('a line added at the playhead', () => {
  it('finds the line that covers a frame, its first frame included and its end not', () => {
    const m = withLine();
    const id = lineBlocks(m)[0].id;
    expect(lineAt(m, 23)).toBeNull();
    expect(lineAt(m, 24)?.id).toBe(id);
    expect(lineAt(m, 71)?.id).toBe(id);
    expect(lineAt(m, 72)).toBeNull();
    expect(lineAt(movie(), 0)).toBeNull();
  });

  it('does not erase a line that starts on that frame: it hands that line back', () => {
    const m = withLine();
    const r = addEmptyLine(m, 1, SUBTITLE_DEFAULTS);
    expect(r).toEqual({ movie: m, id: lineBlocks(m)[0].id, added: false });
    expect(spans(r.movie)).toEqual([[24, 48, 'hello world']]);
  });

  it('does not cut a line the playhead is inside', () => {
    const m = withLine();
    const r = addEmptyLine(m, 2, SUBTITLE_DEFAULTS);
    expect(r.added).toBe(false);
    expect(r.movie).toBe(m);
    expect(r.id).toBe(lineBlocks(m)[0].id);
  });

  it('adds beside a line when the playhead is clear of it', () => {
    const m = withLine();
    const before = addEmptyLine(m, 0, SUBTITLE_DEFAULTS);
    expect(before.added).toBe(true);
    // the new line stops where the next one starts
    expect(spans(before.movie)).toEqual([[0, 24, ''], [24, 48, 'hello world']]);
    const after = addEmptyLine(m, 3, SUBTITLE_DEFAULTS);
    expect(spans(after.movie)).toEqual([[24, 48, 'hello world'], [72, 48, '']]);
    expect(after.id).not.toBe(lineBlocks(m)[0].id);
  });
});

describe('a generated voice and a locked subtitles track', () => {
  const sound = { assetId: 'a1', mime: 'audio/wav', size: 1000, seconds: 2 };
  const lines = [{ start: 4, end: 6, text: 'Spoken.' }];
  const locked = (m: Movie): Movie => ({ ...m, tracks: m.tracks.map((t) => (t.subtitles ? { ...t, locked: true as const } : t)) });

  it('places the voice without its lines and says the track was locked', () => {
    const m = locked(withLine());
    const placed = placeVoice(m, sound, 96, lines, SUBTITLE_DEFAULTS);
    expect(placed.locked).toBe(true);
    expect(placed.movie.tracks.find((t) => t.name === VOICE_TRACK_NAME)?.content.map((c) => [c.kind, c.start, c.duration])).toEqual([['audio', 96, 48]]);
    expect(readSubtitles(placed.movie).lines.map((l) => l.text)).toEqual(['hello world']);
    expect(subtitleTrack(placed.movie)).toBe(subtitleTrack(m));
  });

  it('is not called locked when no lines were asked for, or when the track is open', () => {
    expect(placeVoice(locked(withLine()), sound, 96, [], SUBTITLE_DEFAULTS).locked).toBe(false);
    const open = placeVoice(withLine(), sound, 96, lines, SUBTITLE_DEFAULTS);
    expect(open.locked).toBe(false);
    expect(readSubtitles(open.movie).lines.map((l) => l.text)).toEqual(['hello world', 'Spoken.']);
  });
});

describe('the sound block speech to text hears', () => {
  const block = makeContent('audio', 24, 48, { asset: 'a1' });

  it('is the same sound while its start, length, offset and speed stand', () => {
    expect(sameSound(block, { ...block, name: 'Renamed', volume: 0.5 })).toBe(true);
    expect(sameSound({ ...block, speed: 1 }, block)).toBe(true);
  });

  it('is another sound once it is moved, trimmed, slipped, retimed or reversed', () => {
    expect(sameSound(block, { ...block, start: 25 })).toBe(false);
    expect(sameSound(block, { ...block, duration: 47 })).toBe(false);
    expect(sameSound(block, { ...block, offset: 3 })).toBe(false);
    expect(sameSound(block, { ...block, speed: 2 })).toBe(false);
    expect(sameSound(block, { ...block, reverse: true })).toBe(false);
    expect(sameSound(block, { ...block, asset: 'a2' })).toBe(false);
  });

  it('cannot be heard when it plays backward or is frozen', () => {
    expect(unheardReason(block)).toBeNull();
    expect(unheardReason({ ...block, speed: 2 })).toBeNull();
    expect(unheardReason({ ...block, reverse: true })).toBe('backward');
    expect(unheardReason({ ...block, speed: 0 })).toBe('frozen');
  });
});

describe('the largest subtitles file read', () => {
  it('is 5 MB', () => {
    expect(MAX_SUBTITLE_FILE_BYTES).toBe(5 * 1024 * 1024);
  });
});
