import { describe, expect, it } from 'vitest';
import { newMovie } from '@src/engine/model';
import { SUBTITLE_DEFAULTS, readSubtitles, subtitleTrack } from '@src/engine/subtitles';
import {
  VOICE_TRACK_NAME, addEmptyLine, clampSpan, clearSpan, formatSeconds, linesForWholeSound, listenLanguages, monoSamples, parseSeconds, placeVoice,
  removeLine, sampleRange, sentenceShares, styleFromControls,
} from '@src/ui/speech-logic';

describe('timing for speech that comes back as one sound', () => {
  it('shares the length between sentences by their letters, with nothing left over', () => {
    const shares = sentenceShares('One two. Three four five six.', 6);
    expect(shares.map((s) => s.text)).toEqual(['One two.', 'Three four five six.']);
    expect(shares[0].seconds).toBeCloseTo((6 * 8) / 28, 6);
    expect(shares[0].seconds + shares[1].seconds).toBeCloseTo(6, 6);
  });

  it('gives lines that touch, start at the given second and end with the sound', () => {
    const lines = linesForWholeSound('One two. Three four five six.', 6, 10);
    expect(lines).toHaveLength(2);
    expect(lines[0].start).toBe(10);
    expect(lines[0].end).toBe(lines[1].start);
    expect(lines[1].end).toBeCloseTo(16, 3);
  });

  it('has no lines for text with no words or a sound with no length', () => {
    expect(sentenceShares('   ', 5)).toEqual([]);
    expect(linesForWholeSound('Hello.', Number.NaN, 0).every((l) => l.end === l.start)).toBe(true);
  });
});

describe('typed seconds', () => {
  it('reads plain seconds, a comma for the point, and minutes or hours before a colon', () => {
    expect(parseSeconds('12.5')).toBe(12.5);
    expect(parseSeconds(' 12,5 ')).toBe(12.5);
    expect(parseSeconds('3s')).toBe(3);
    expect(parseSeconds('1:02.5')).toBe(62.5);
    expect(parseSeconds('1:00:03')).toBe(3603);
  });

  it('refuses what is not a time', () => {
    for (const bad of ['', 'abc', '-1', '1:2:3:4', '1e3', '1.2.3']) expect(parseSeconds(bad)).toBeNull();
  });

  it('shows one decimal and reads its own output back', () => {
    expect(formatSeconds(2)).toBe('2.0');
    expect(formatSeconds(2.449)).toBe('2.4');
    expect(formatSeconds(-1)).toBe('0.0');
    expect(parseSeconds(formatSeconds(73.26))).toBe(73.3);
  });

  it('keeps a line between its neighbours and at least one frame long', () => {
    expect(clampSpan(1, 2, 24, 0, Number.POSITIVE_INFINITY)).toEqual({ start: 24, duration: 24 });
    expect(clampSpan(0.5, 9, 24, 24, 72)).toEqual({ start: 24, duration: 48 });
    expect(clampSpan(2, 1, 24, 0, 100)).toEqual({ start: 48, duration: 1 });
    expect(clampSpan(50, 60, 24, 24, 72)).toEqual({ start: 71, duration: 1 });
  });
});

describe('the samples a block plays', () => {
  it('starts at the block offset and runs for its duration', () => {
    expect(sampleRange(12, 48, 24, 48000, 480000)).toEqual({ from: 24000, to: 120000 });
  });

  it('stops at the end of the sound and never runs backward', () => {
    expect(sampleRange(0, 240, 24, 16000, 100000)).toEqual({ from: 0, to: 100000 });
    expect(sampleRange(2400, 24, 24, 16000, 100000)).toEqual({ from: 100000, to: 100000 });
  });

  it('covers more of the sound when the block plays it faster', () => {
    expect(sampleRange(0, 24, 24, 1000, 10000, 2)).toEqual({ from: 0, to: 2000 });
  });

  it('averages the channels inside the range', () => {
    const left = Float32Array.from([0, 1, 1, 0]), right = Float32Array.from([0, 0, 1, 1]);
    expect(Array.from(monoSamples([left, right], 1, 4))).toEqual([0.5, 1, 0.5]);
    expect(Array.from(monoSamples([left], 2, 4))).toEqual([1, 0]);
  });
});

describe('the style controls', () => {
  it('passes known choices through and lowers the color', () => {
    expect(styleFromControls({ font: 'Lora', size: 'large', position: 'top', color: '#FFCC00', band: false }))
      .toEqual({ font: 'Lora', size: 'large', position: 'top', color: '#ffcc00', band: false });
  });

  it('keeps the fallback for anything that is not a choice', () => {
    const got = styleFromControls({ font: ' ', size: 'huge', position: 'left', color: 'red', band: true });
    expect(got).toEqual({ ...SUBTITLE_DEFAULTS, band: true });
  });
});

describe('the languages offered for speech to text', () => {
  it('lists English first, two letters each, with no code twice', () => {
    const codes = listenLanguages().map(([code]) => code);
    expect(codes[0]).toBe('en');
    expect(codes.every((c) => /^[a-z]{2}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('no');
    expect(codes).not.toContain('nb');
  });
});

describe('a generated voice on the movie', () => {
  const movie = newMovie({ name: 'Test', width: 1280, height: 720, fps: 24, seconds: 2 });
  const sound = { assetId: 'a1', mime: 'audio/wav', size: 1000, seconds: 5 };

  it('lands as a sound block on a new Voice track, with its lines, and the movie grows to hold it', () => {
    const lines = [{ start: 1, end: 3, text: 'Hello.' }, { start: 3.3, end: 6, text: 'Again.' }];
    const { movie: next, blockId } = placeVoice(movie, sound, 24, lines, SUBTITLE_DEFAULTS);
    const track = next.tracks.find((t) => t.name === VOICE_TRACK_NAME);
    expect(track?.content.map((c) => [c.id, c.kind, c.start, c.duration, c.asset])).toEqual([[blockId, 'audio', 24, 120, 'a1']]);
    expect(next.assets.a1).toMatchObject({ kind: 'audio', mime: 'audio/wav', seconds: 5, frames: 120 });
    expect(next.duration).toBe(144);
    expect(readSubtitles(next).lines.map((l) => l.text)).toEqual(['Hello.', 'Again.']);
    expect(movie.tracks.some((t) => t.name === VOICE_TRACK_NAME)).toBe(false);
  });

  it('makes no subtitles track when no lines are asked for', () => {
    expect(subtitleTrack(placeVoice(movie, sound, 0, [], SUBTITLE_DEFAULTS).movie)).toBeNull();
  });

  it('clears only the lines that start under a sound, and the track with its last line', () => {
    const lines = [{ start: 0, end: 1, text: 'One.' }, { start: 1, end: 2, text: 'Two.' }, { start: 3, end: 4, text: 'Three.' }];
    const withLines = placeVoice(movie, sound, 0, lines, SUBTITLE_DEFAULTS).movie;
    const some = clearSpan(withLines, 0, 48);
    expect(some.removed).toBe(2);
    expect(readSubtitles(some.movie).lines.map((l) => l.text)).toEqual(['Three.']);
    expect(subtitleTrack(clearSpan(withLines, 0, 240).movie)).toBeNull();
    expect(clearSpan(withLines, 200, 240)).toEqual({ movie: withLines, removed: 0 });
  });

  it('adds an empty line of two seconds and takes the track away with its last line', () => {
    const { movie: withLine, id } = addEmptyLine(movie, 0.5, SUBTITLE_DEFAULTS);
    expect(id).not.toBeNull();
    expect(readSubtitles(withLine).lines).toEqual([{ start: 0.5, end: 2.5, text: '' }]);
    expect(subtitleTrack(removeLine(withLine, id as string))).toBeNull();
  });
});
