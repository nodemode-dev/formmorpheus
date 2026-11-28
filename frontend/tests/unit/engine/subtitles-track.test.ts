import { describe, expect, it } from 'vitest';
import { content as makeContent, newMovie, track as makeTrack } from '@src/engine/model';
import { SUBTITLE_DEFAULTS, addSubtitles, fromSrt, subtitleTrack, writeSubtitles } from '@src/engine/subtitles';
import type { Content, Movie } from '@src/engine/types';

function movie(): Movie {
  const m = newMovie({ width: 1920, height: 1080, fps: 24, seconds: 60 });
  return { ...m, tracks: [makeTrack('Sound')] };
}

/** A movie with one line from 1 s to 3 s and a picture a person dropped on the subtitles track. */
function withPicture(picture: Content): Movie {
  const m = writeSubtitles(movie(), [{ start: 1, end: 3, text: 'hello' }], SUBTITLE_DEFAULTS);
  const tr = subtitleTrack(m);
  if (!tr) throw new Error('no subtitles track');
  return { ...m, tracks: m.tracks.map((t) => (t.id === tr.id ? { ...t, content: [...t.content, picture] } : t)) };
}

const spans = (m: Movie): Array<[string, number, number, string]> => (subtitleTrack(m)?.content ?? []).map((c) => [c.kind, c.start, c.duration, c.text?.text ?? '']);

describe('other content on the subtitles track', () => {
  it('is not replaced by a written line that starts on its frame', () => {
    const pic = makeContent('drawing', 0, 240);
    const out = writeSubtitles(withPicture(pic), [{ start: 0, end: 2, text: 'new' }], SUBTITLE_DEFAULTS);
    expect(spans(out)).toEqual([['drawing', 0, 240, ''], ['text', 0, 48, 'new']]);
    expect(subtitleTrack(out)?.content.find((c) => c.id === pic.id)).toBe(pic);
  });

  it('is not cut by a merged line that starts inside it', () => {
    const pic = makeContent('drawing', 0, 240);
    const out = addSubtitles(withPicture(pic), [{ start: 5, end: 6, text: 'later' }]);
    expect(spans(out)).toEqual([['drawing', 0, 240, ''], ['text', 24, 48, 'hello'], ['text', 120, 24, 'later']]);
    expect(subtitleTrack(out)?.content.find((c) => c.id === pic.id)).toBe(pic);
  });

  it('does not cut a line that it overlaps', () => {
    // the picture starts inside the line: the line keeps its whole length
    const pic = makeContent('drawing', 48, 100);
    const out = addSubtitles(withPicture(pic), [{ start: 10, end: 11, text: 'far' }]);
    expect(spans(out)).toEqual([['text', 24, 48, 'hello'], ['drawing', 48, 100, ''], ['text', 240, 24, 'far']]);
  });

  it('stays when every line is replaced by none', () => {
    const pic = makeContent('drawing', 0, 240);
    const out = writeSubtitles(withPicture(pic), [], SUBTITLE_DEFAULTS);
    expect(spans(out)).toEqual([['drawing', 0, 240, '']]);
  });

  it('still lets a later line trim the line before it', () => {
    const out = addSubtitles(withPicture(makeContent('drawing', 0, 240)), [{ start: 2, end: 4, text: 'cut in' }]);
    expect(spans(out).filter(([kind]) => kind === 'text')).toEqual([['text', 24, 24, 'hello'], ['text', 48, 48, 'cut in']]);
  });
});

describe('tags in a subtitles file', () => {
  const cue = (words: string): string => `1\n00:00:01,000 --> 00:00:02,000\n${words}\n`;

  it('drops simple tags and keeps the words', () => {
    expect(fromSrt(cue('<i>Hello</i> {\\an8}there <font color="#fff">you</font>'))[0].text).toBe('Hello there you');
  });

  it('keeps a lone angle bracket that opens no tag', () => {
    expect(fromSrt(cue('1 < 2 and <b>3</b> > 2'))[0].text).toBe('1 < 2 and 3 > 2');
  });

  it('reads a hostile row of 200,000 characters well under a second', () => {
    for (const row of ['<'.repeat(200_000), '{\\'.repeat(100_000), `${'<'.repeat(199_999)}>`]) {
      const from = performance.now();
      const lines = fromSrt(cue(row));
      expect(performance.now() - from).toBeLessThan(250);
      expect(lines).toHaveLength(1);
    }
  });
});
