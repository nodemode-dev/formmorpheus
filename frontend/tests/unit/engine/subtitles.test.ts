import { describe, expect, it } from 'vitest';
import { content as makeContent, newMovie, track as makeTrack } from '@src/engine/model';
import { OpError } from '@src/engine/ops';
import {
  SENTENCE_GAP_SECONDS, SUBTITLE_DEFAULTS, addSubtitles, fromSrt, linesFromSentences, linesFromWords, readSubtitles, restyleSubtitles,
  showSubtitles, subtitleTrack, toSrt, writeSubtitles, type SubtitleLine, type SubtitleStyle,
} from '@src/engine/subtitles';
import type { Content, Movie, Track } from '@src/engine/types';

function movie(width = 1920, height = 1080, fps = 24): Movie {
  const m = newMovie({ width, height, fps, seconds: 60 });
  return { ...m, tracks: [makeTrack('Picture', [makeContent('drawing', 0, 100)]), makeTrack('Sound')] };
}

const style = (patch: Partial<SubtitleStyle> = {}): SubtitleStyle => ({ ...SUBTITLE_DEFAULTS, ...patch });
const line = (start: number, end: number, text: string): SubtitleLine => ({ start, end, text });
const subs = (m: Movie): Track => {
  const t = subtitleTrack(m);
  if (!t) throw new Error('no subtitles track');
  return t;
};
const spans = (m: Movie): Array<[number, number, string]> => subs(m).content.map((c) => [c.start, c.duration, c.text?.text ?? '']);
const frozen = <T>(x: T): T => {
  if (x && typeof x === 'object') { Object.values(x).forEach(frozen); Object.freeze(x); }
  return x;
};

describe('subtitle defaults', () => {
  it('use the default text font, medium, at the bottom, white on a band', () => {
    expect(SUBTITLE_DEFAULTS).toEqual({ font: 'Inter', size: 'medium', position: 'bottom', color: '#ffffff', band: true });
  });
});

describe('writeSubtitles', () => {
  it('rounds the start to the nearest frame at several frame rates', () => {
    const cases: Array<[number, number, number, number, number]> = [
      // fps, start s, end s, start frame, frames
      [24, 1.02, 2.0, 24, 24],
      [24, 1.03, 2.0, 25, 23],
      [25, 0.5, 1.5, 13, 25],
      [30, 0.99, 3.0, 30, 60],
      [12, 0.3, 0.7, 4, 4],
      [60, 0.008, 0.026, 0, 2],
      [23.976, 10, 12, 240, 48],
    ];
    for (const [fps, start, end, frame, frames] of cases) {
      const m = writeSubtitles(movie(1920, 1080, fps), [line(start, end, 'Hi')], style());
      expect(spans(m), `${fps} fps`).toEqual([[frame, frames, 'Hi']]);
    }
  });

  it('never makes a line shorter than one frame', () => {
    const m = writeSubtitles(movie(), [line(2, 2, 'Blink'), line(5, 4, 'Backwards')], style());
    expect(spans(m)).toEqual([[48, 1, 'Blink'], [120, 1, 'Backwards']]);
  });

  it('keeps lines that touch in seconds touching in frames', () => {
    const m = writeSubtitles(movie(1920, 1080, 24), [line(0, 1.03, 'One'), line(1.03, 2.05, 'Two')], style());
    expect(spans(m)).toEqual([[0, 25, 'One'], [25, 24, 'Two']]);
  });

  it('places the three positions 8% in from the edge at two movie sizes', () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920]] as const) {
      const y = (position: SubtitleStyle['position']): number => subs(writeSubtitles(movie(w, h), [line(0, 1, 'Hi')], style({ position }))).content[0].transform.y;
      // a text block is laid out around the centre, so its centre is at height / 2 + y
      expect(h / 2 + y('top')).toBeCloseTo(h * 0.08, 0);
      expect(y('middle')).toBe(0);
      expect(h / 2 + y('bottom')).toBeCloseTo(h * 0.92, 0);
      expect(y('top')).toBe(-y('bottom'));
    }
  });

  it('sizes the three sizes as a share of the height at two movie sizes', () => {
    const size = (h: number, s: SubtitleStyle['size']): number => subs(writeSubtitles(movie(1920, h), [line(0, 1, 'Hi')], style({ size: s }))).content[0].text?.size ?? 0;
    expect([size(1080, 'small'), size(1080, 'medium'), size(1080, 'large')]).toEqual([38, 49, 65]);
    expect([size(2000, 'small'), size(2000, 'medium'), size(2000, 'large')]).toEqual([70, 90, 120]);
    const wide = subs(writeSubtitles(movie(3840, 1080), [line(0, 1, 'Hi')], style())).content[0].text?.size;
    expect(wide).toBe(49);
  });

  it('makes each line a text block from the subtitle preset, in the font and color asked for', () => {
    const m = writeSubtitles(movie(), [line(0, 1, '  Hello   there ')], style({ font: 'Lora', color: '#ffee00' }));
    const c = subs(m).content[0];
    expect(c.kind).toBe('text');
    expect(c.name).toBe('Hello there');
    expect(c.text).toMatchObject({ preset: 'subtitle', text: 'Hello there', font: 'Lora', color: '#ffee00', align: 'center', weight: 500 });
    expect(c.text?.anim).toBeUndefined();
    expect(c.text?.boxW).toBe(1536);
  });

  it('draws the band as the preset box, and no box with the band off', () => {
    const on = subs(writeSubtitles(movie(), [line(0, 1, 'Hi')], style({ band: true }))).content[0].text;
    const off = subs(writeSubtitles(movie(), [line(0, 1, 'Hi')], style({ band: false }))).content[0].text;
    expect(on?.box).toEqual({ color: '#000000', padding: 11, radius: 4, opacity: 0.6, mode: 'line' });
    expect(off && 'box' in off).toBe(false);
  });

  it('makes the track on top of the others, fixed to the screen and named', () => {
    const before = movie();
    const m = writeSubtitles(before, [line(0, 1, 'Hi')], style());
    expect(m.tracks).toHaveLength(3);
    // index 0 is drawn last by the renderer, so it is on top
    expect(m.tracks[0]).toMatchObject({ name: 'Subtitles', subtitles: true, screen: true, hidden: false });
    expect(m.tracks.slice(1)).toEqual(before.tracks);
    expect(m.tracks[1]).toBe(before.tracks[0]);
  });

  it('replaces every line and keeps the same track where it was', () => {
    const first = writeSubtitles(movie(), [line(0, 1, 'One'), line(1, 2, 'Two')], style());
    const moved = { ...first, tracks: [first.tracks[1], first.tracks[0], first.tracks[2]] };
    const second = writeSubtitles(moved, [line(3, 4, 'Three')], style({ size: 'large' }));
    expect(second.tracks).toHaveLength(3);
    expect(second.tracks[1].id).toBe(first.tracks[0].id);
    expect(spans(second)).toEqual([[72, 24, 'Three']]);
    expect(readSubtitles(second).style.size).toBe('large');
  });

  it('sorts the lines and trims one that would overlap the next', () => {
    const m = writeSubtitles(movie(), [line(2, 5, 'Late'), line(0, 3, 'Early')], style());
    expect(spans(m)).toEqual([[0, 48, 'Early'], [48, 72, 'Late']]);
  });

  it('drops lines with no words or no time', () => {
    const m = writeSubtitles(movie(), [line(0, 1, '   '), line(Number.NaN, 2, 'Lost'), line(2, 3, 'Kept')], style());
    expect(spans(m)).toEqual([[48, 24, 'Kept']]);
  });

  it('removes the track when there are no lines, and leaves a movie without one alone', () => {
    const before = movie();
    const made = writeSubtitles(before, [line(0, 1, 'Hi')], style());
    const cleared = writeSubtitles(made, [], style());
    expect(subtitleTrack(cleared)).toBeNull();
    expect(cleared.tracks).toEqual(before.tracks);
    expect(writeSubtitles(before, [], style())).toBe(before);
  });

  it('keeps content on the track that is not a line', () => {
    const made = writeSubtitles(movie(), [line(0, 1, 'Hi')], style());
    const logo = makeContent('image', 200, 20, { name: 'Logo' });
    const withLogo = { ...made, tracks: made.tracks.map((t) => (t.subtitles ? { ...t, content: [...t.content, logo] } : t)) };
    const cleared = writeSubtitles(withLogo, [], style());
    expect(subs(cleared).content).toEqual([logo]);
  });

  it('refuses a locked subtitles track', () => {
    const made = writeSubtitles(movie(), [line(0, 1, 'Hi')], style());
    const locked = { ...made, tracks: made.tracks.map((t) => (t.subtitles ? { ...t, locked: true as const } : t)) };
    expect(() => writeSubtitles(locked, [line(1, 2, 'No')], style())).toThrow(OpError);
    expect(() => addSubtitles(locked, [line(1, 2, 'No')])).toThrow(OpError);
    expect(() => restyleSubtitles(locked, style())).toThrow(OpError);
  });

  it('changes nothing it was given', () => {
    const before = frozen(writeSubtitles(movie(), [line(0, 2, 'One'), line(4, 5, 'Two')], style()));
    const lines = frozen([line(1, 3, 'Mid')]);
    const st = frozen(style({ position: 'top', band: false }));
    const snapshot = JSON.stringify(before);
    writeSubtitles(before, lines, st);
    addSubtitles(before, lines);
    restyleSubtitles(before, st);
    showSubtitles(before, false);
    writeSubtitles(before, [], st);
    readSubtitles(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(lines).toEqual([line(1, 3, 'Mid')]);
  });
});

describe('addSubtitles', () => {
  it('makes the track in the default style when there is none', () => {
    const m = addSubtitles(movie(), [line(1, 2, 'Hi')]);
    expect(m.tracks[0]).toMatchObject({ subtitles: true, screen: true });
    expect(readSubtitles(m).style).toEqual(SUBTITLE_DEFAULTS);
  });

  it('merges new lines among the old ones, sorted, in the style already there', () => {
    const st = style({ font: 'Lora', size: 'large', position: 'top', color: '#00ff00', band: false });
    const first = writeSubtitles(movie(), [line(0, 1, 'One'), line(4, 5, 'Three')], st);
    const kept = subs(first).content.map((c) => c.id);
    const m = addSubtitles(first, [line(2, 3, 'Two')]);
    expect(spans(m)).toEqual([[0, 24, 'One'], [48, 24, 'Two'], [96, 24, 'Three']]);
    expect(subs(m).content[0].id).toBe(kept[0]);
    expect(subs(m).content[2].id).toBe(kept[1]);
    expect(subs(m).content[1].text).toMatchObject({ font: 'Lora', size: 65, color: '#00ff00' });
    expect(subs(m).content[1].text?.box).toBeUndefined();
    expect(subs(m).content[1].transform.y).toBe(subs(m).content[0].transform.y);
  });

  it('trims an earlier line that would run into the next one', () => {
    const first = writeSubtitles(movie(), [line(0, 4, 'Long')], style());
    const m = addSubtitles(first, [line(2, 3, 'Cut in')]);
    expect(spans(m)).toEqual([[0, 48, 'Long'], [48, 24, 'Cut in']]);
    const again = addSubtitles(m, [line(1, 10, 'Before'), line(2.5, 6, 'After')]);
    expect(spans(again)).toEqual([[0, 24, 'Long'], [24, 24, 'Before'], [48, 12, 'Cut in'], [60, 84, 'After']]);
    const items = subs(again).content;
    items.slice(1).forEach((c, i) => expect(items[i].start + items[i].duration).toBeLessThanOrEqual(c.start));
  });

  it('lets a new line take the place of one that starts on the same frame', () => {
    const first = writeSubtitles(movie(), [line(1, 2, 'Old')], style());
    expect(spans(addSubtitles(first, [line(1, 3, 'New')]))).toEqual([[24, 48, 'New']]);
  });

  it('returns the movie as it was when nothing is added', () => {
    const first = writeSubtitles(movie(), [line(1, 2, 'Hi')], style());
    expect(addSubtitles(first, [])).toBe(first);
    const plain = movie();
    expect(addSubtitles(plain, [line(0, 1, ' ')])).toBe(plain);
  });

  it('removes a subtitles track that ends up empty', () => {
    const made = writeSubtitles(movie(), [line(0, 1, 'Hi')], style());
    const emptied = { ...made, tracks: made.tracks.map((t) => (t.subtitles ? { ...t, content: [] } : t)) };
    expect(subtitleTrack(addSubtitles(emptied, []))).toBeNull();
  });
});

describe('readSubtitles', () => {
  it('gives the defaults, shown, and no lines for a movie without subtitles', () => {
    expect(readSubtitles(movie())).toEqual({ lines: [], style: SUBTITLE_DEFAULTS, shown: true });
  });

  it('reads back the lines in seconds and every style that can be written', () => {
    const lines = [line(0.5, 1.5, 'One'), line(2, 3.25, 'Two')];
    for (const size of ['small', 'medium', 'large'] as const) for (const position of ['top', 'middle', 'bottom'] as const) for (const band of [true, false]) {
      for (const [w, h] of [[1920, 1080], [720, 1280]] as const) {
        const st = style({ font: 'Sora', size, position, color: '#abcdef', band });
        const read = readSubtitles(writeSubtitles(movie(w, h, 24), lines, st));
        expect(read.style).toEqual(st);
        expect(read.lines).toEqual(lines);
      }
    }
  });

  it('reads text blocks edited or added by hand, in order, and skips what is not text', () => {
    const made = writeSubtitles(movie(), [line(1, 2, 'Made here')], style());
    const hand = makeContent('text', 0, 12, { text: { text: 'By hand\nsecond row', font: 'Caveat', size: 70, weight: 700, color: '#ff0000', align: 'left' }, transform: { x: 40, y: -430, scale: 1, rotation: 0, flipH: false, flipV: false } });
    const picture = makeContent('image', 100, 10);
    const edited = { ...made, tracks: made.tracks.map((t) => (t.subtitles ? { ...t, content: [...t.content.map((c): Content => ({ ...c, text: c.text ? { ...c.text, text: 'Edited' } : null })), hand, picture] } : t)) };
    const read = readSubtitles(edited);
    expect(read.lines).toEqual([line(0, 0.5, 'By hand\nsecond row'), line(1, 2, 'Edited')]);
    // nearest of the three sizes and positions to what the first block really has
    expect(read.style).toEqual({ font: 'Caveat', size: 'large', position: 'top', color: '#ff0000', band: false });
  });

  it('still adds to and restyles blocks made by hand', () => {
    const hand = makeContent('text', 0, 24, { text: { text: 'By hand', font: 'Caveat', size: 30, weight: 700, color: '#ff0000', align: 'left', runs: [{ from: 0, to: 2, italic: true }] } });
    const base = movie();
    const m: Movie = { ...base, tracks: [{ ...makeTrack('My captions', [hand]), subtitles: true }, ...base.tracks] };
    const added = addSubtitles(m, [line(2, 3, 'Added')]);
    expect(spans(added)).toEqual([[0, 24, 'By hand'], [48, 24, 'Added']]);
    expect(subs(added).name).toBe('My captions');
    const restyledMovie = restyleSubtitles(added, style({ font: 'Inter', size: 'small', position: 'bottom', color: '#ffffff', band: true }));
    const first = subs(restyledMovie).content[0];
    expect(first.id).toBe(hand.id);
    expect(first.text).toMatchObject({ text: 'By hand', font: 'Inter', size: 38, color: '#ffffff', weight: 700, align: 'left', runs: [{ from: 0, to: 2, italic: true }] });
    expect(first.text?.box).toMatchObject({ mode: 'line' });
    expect(first.transform.y).toBe(454);
  });
});

describe('restyleSubtitles and showSubtitles', () => {
  it('restyles every line and keeps their ids, times and words', () => {
    const first = writeSubtitles(movie(), [line(0, 1, 'One'), line(2, 3, 'Two')], style());
    const st = style({ font: 'Poppins', size: 'small', position: 'middle', color: '#112233', band: false });
    const m = restyleSubtitles(first, st);
    expect(readSubtitles(m).style).toEqual(st);
    expect(spans(m)).toEqual(spans(first));
    expect(subs(m).content.map((c) => c.id)).toEqual(subs(first).content.map((c) => c.id));
    expect(readSubtitles(restyleSubtitles(m, style())).style).toEqual(SUBTITLE_DEFAULTS);
  });

  it('does nothing without a subtitles track', () => {
    const m = movie();
    expect(restyleSubtitles(m, style())).toBe(m);
    expect(showSubtitles(m, false)).toBe(m);
  });

  it('hides and shows through the track', () => {
    const made = writeSubtitles(movie(), [line(0, 1, 'Hi')], style());
    const hidden = showSubtitles(made, false);
    expect(subs(hidden).hidden).toBe(true);
    expect(readSubtitles(hidden).shown).toBe(false);
    expect(readSubtitles(hidden).lines).toHaveLength(1);
    const shown = showSubtitles(hidden, true);
    expect(readSubtitles(shown).shown).toBe(true);
    expect(showSubtitles(shown, true)).toBe(shown);
    // a hidden track stays hidden when lines are added
    expect(readSubtitles(addSubtitles(hidden, [line(3, 4, 'More')])).shown).toBe(false);
  });
});

describe('linesFromSentences', () => {
  it('starts each sentence where the one before ended plus the gap', () => {
    expect(SENTENCE_GAP_SECONDS).toBe(0.3);
    const out = linesFromSentences([{ text: 'One.', seconds: 1 }, { text: 'Two.', seconds: 2 }, { text: 'Three.', seconds: 0.5 }], 10);
    expect(out).toEqual([line(10, 11, 'One.'), line(11.3, 13.3, 'Two.'), line(13.6, 14.1, 'Three.')]);
  });

  it('takes another gap when asked', () => {
    const out = linesFromSentences([{ text: 'One.', seconds: 1 }, { text: 'Two.', seconds: 1 }], 0, 0.5);
    expect(out.map((l) => l.start)).toEqual([0, 1.5]);
  });

  it('keeps time for a sentence with no words', () => {
    const out = linesFromSentences([{ text: ' ', seconds: 1 }, { text: 'After.', seconds: 1 }], 0);
    expect(out).toEqual([line(1.3, 2.3, 'After.')]);
  });

  it('leaves a sentence of 84 characters whole', () => {
    const text = `${'word '.repeat(16)}four`;
    expect(text).toHaveLength(84);
    expect(linesFromSentences([{ text, seconds: 4 }], 0)).toEqual([line(0, 4, text)]);
  });

  it('splits a longer sentence at word boundaries into lines of at most 42 characters that share its time by length', () => {
    const text = 'The quick brown fox jumps over the lazy dog and then keeps running through the forest until night falls.';
    const out = linesFromSentences([{ text, seconds: 6 }, { text: 'Next.', seconds: 1 }], 2);
    const parts = out.slice(0, -1);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((l) => l.text).join(' ')).toBe(text);
    for (const l of parts) expect(l.text.length).toBeLessThanOrEqual(42);
    expect(parts[0].start).toBe(2);
    expect(parts[parts.length - 1].end).toBe(8);
    parts.slice(1).forEach((l, i) => expect(l.start).toBe(parts[i].end));
    const chars = parts.reduce((n, l) => n + l.text.length, 0);
    for (const l of parts) expect(l.end - l.start).toBeCloseTo((6 * l.text.length) / chars, 2);
    expect(out[out.length - 1]).toEqual(line(8.3, 9.3, 'Next.'));
  });
});

describe('linesFromWords', () => {
  const words = (texts: string[], step = 0.3, from = 0): { text: string; start: number; end: number }[] =>
    texts.map((text, i) => ({ text, start: from + i * step, end: from + i * step + step * 0.8 }));

  it('breaks a line that would pass 42 characters', () => {
    const out = linesFromWords(words(['extraordinary', 'circumstances', 'surrounding', 'international', 'negotiations']));
    expect(out.map((l) => l.text)).toEqual(['extraordinary circumstances surrounding', 'international negotiations']);
    for (const l of out) expect(l.text.length).toBeLessThanOrEqual(42);
  });

  it('breaks a line after seven words', () => {
    const out = linesFromWords(words(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']));
    expect(out.map((l) => l.text)).toEqual(['a b c d e f g', 'h i']);
  });

  it('breaks a line after a gap over 0.7 s, and not at 0.7 s or under', () => {
    const out = linesFromWords([
      { text: 'one', start: 0, end: 0.4 }, { text: 'two', start: 1.1, end: 1.5 }, { text: 'three', start: 2.25, end: 2.6 },
    ]);
    expect(out).toEqual([line(0, 1.5, 'one two'), line(2.25, 2.6, 'three')]);
  });

  it('breaks a line after sentence-ending punctuation', () => {
    const out = linesFromWords(words(['Hello', 'there.', 'How', 'are', 'you?', '"Fine!"', 'she', 'said,', 'smiling']));
    expect(out.map((l) => l.text)).toEqual(['Hello there.', 'How are you?', '"Fine!"', 'she said, smiling']);
  });

  it('times a line from its first word to its last, moved by the offset', () => {
    const out = linesFromWords([{ text: ' one ', start: 0.5, end: 0.9 }, { text: '', start: 0.9, end: 1 }, { text: 'two', start: 1, end: 1.4 }], 10);
    expect(out).toEqual([line(10.5, 11.4, 'one two')]);
  });

  it('gives no lines for no words', () => {
    expect(linesFromWords([])).toEqual([]);
  });
});

describe('SubRip', () => {
  const lines = [line(0, 1.5, 'Hello there.'), line(2.25, 3661.007, 'A long one'), line(3662, 3663.999, 'Bye')];
  const srt = '1\n00:00:00,000 --> 00:00:01,500\nHello there.\n\n2\n00:00:02,250 --> 01:01:01,007\nA long one\n\n3\n01:01:02,000 --> 01:01:03,999\nBye\n';

  it('writes an index, the two times, the words and a blank line', () => {
    expect(toSrt(lines)).toBe(srt);
    expect(toSrt([])).toBe('');
  });

  it('rounds to the millisecond and skips lines without words', () => {
    expect(toSrt([line(0.0004, 59.9996, 'A'), line(1, 2, ' '), line(3, 4, 'B')])).toBe('1\n00:00:00,000 --> 00:01:00,000\nA\n\n2\n00:00:03,000 --> 00:00:04,000\nB\n');
  });

  it('reads back what it wrote', () => {
    expect(fromSrt(toSrt(lines))).toEqual(lines);
    expect(toSrt(fromSrt(srt))).toBe(srt);
  });

  it('survives a trip through the movie at a frame rate that holds the times', () => {
    const exact = [line(0, 1.5, 'Hello there.'), line(2.25, 4, 'Second')];
    const m = writeSubtitles(movie(1920, 1080, 24), fromSrt(toSrt(exact)), style());
    expect(toSrt(readSubtitles(m).lines)).toBe(toSrt(exact));
  });

  it('reads CRLF and bare CR line ends', () => {
    expect(fromSrt(srt.replace(/\n/g, '\r\n'))).toEqual(lines);
    expect(fromSrt(srt.replace(/\n/g, '\r'))).toEqual(lines);
  });

  it('reads past a byte order mark', () => {
    expect(fromSrt(`﻿${srt}`)).toEqual(lines);
  });

  it('reads a dot in place of the comma', () => {
    expect(fromSrt('1\n00:00:01.250 --> 00:00:02.500\nDots\n')).toEqual([line(1.25, 2.5, 'Dots')]);
  });

  it('reads cues with no index, and cues with no blank line between them', () => {
    expect(fromSrt('00:00:01,000 --> 00:00:02,000\nNo index\n\n00:00:03,000 --> 00:00:04,000\nNone here either\n')).toEqual([line(1, 2, 'No index'), line(3, 4, 'None here either')]);
    expect(fromSrt('1\n00:00:01,000 --> 00:00:02,000\nFirst\n2\n00:00:03,000 --> 00:00:04,000\nSecond\n')).toEqual([line(1, 2, 'First'), line(3, 4, 'Second')]);
  });

  it('joins the rows of a cue with a space', () => {
    expect(fromSrt('1\n00:00:01,000 --> 00:00:02,000\nFirst row\n  second row  \n')).toEqual([line(1, 2, 'First row second row')]);
  });

  it('strips simple tags', () => {
    expect(fromSrt('1\n00:00:01,000 --> 00:00:02,000\n<i>Slanted</i> and <b>bold</b> <font color="#ff0000">red</font>{\\an8}\n')).toEqual([line(1, 2, 'Slanted and bold red')]);
  });

  it('skips cues it cannot read and keeps the rest', () => {
    const text = [
      '1\nnot a time line\nLost words\n',
      '2\n00:00:01,000 --> 00:00:02,000\nGood\n',
      '3\n00:00:05,000 --> 00:00:04,000\nEnds before it starts\n',
      '4\n00:00:06,000 --> 00:00:07,000\n\n',
      '5\n00:00:08,000 -> 00:00:09,000\nBad arrow\n',
      '6\n00:00:10,000 --> 00:00:11,000 X1:10 X2:20\nWith a position\n',
    ].join('\n');
    expect(fromSrt(text)).toEqual([line(1, 2, 'Good'), line(10, 11, 'With a position')]);
    expect(fromSrt('')).toEqual([]);
    expect(fromSrt('just some words')).toEqual([]);
  });
});
