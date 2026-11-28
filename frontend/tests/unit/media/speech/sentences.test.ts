import { describe, expect, it } from 'vitest';
import { splitSentences } from '@src/media/speech/sentences';

describe('splitSentences', () => {
  it('ends a sentence at a period, a question mark and an exclamation mark, keeping the mark', () => {
    expect(splitSentences('Hello there. How are you? Fine!')).toEqual(['Hello there.', 'How are you?', 'Fine!']);
  });

  it('ends a sentence at a line break, with or without punctuation', () => {
    expect(splitSentences('One\nTwo\r\n\r\nThree.')).toEqual(['One', 'Two', 'Three.']);
  });

  it('does not split after a title', () => {
    expect(splitSentences('Dr. Lee met Mr. and Mrs. Smith. They left with Ms. Park.')).toEqual(['Dr. Lee met Mr. and Mrs. Smith.', 'They left with Ms. Park.']);
  });

  it('does not split inside e.g. and i.e.', () => {
    expect(splitSentences('Use a tool, e.g. a brush, i.e. the round one. Done.')).toEqual(['Use a tool, e.g. a brush, i.e. the round one.', 'Done.']);
  });

  it('splits after etc. only when a new sentence starts', () => {
    expect(splitSentences('Cats, dogs, etc. are here. Bye.')).toEqual(['Cats, dogs, etc. are here.', 'Bye.']);
    expect(splitSentences('We saw cats, dogs, etc. Then we left.')).toEqual(['We saw cats, dogs, etc.', 'Then we left.']);
    expect(splitSentences('We saw cats, etc.')).toEqual(['We saw cats, etc.']);
  });

  it('does not split inside a decimal or a price', () => {
    expect(splitSentences('Pi is 3.14 today. It cost $99.50, not $100. Next.')).toEqual(['Pi is 3.14 today.', 'It cost $99.50, not $100.', 'Next.']);
  });

  it('keeps a closing quote or bracket with its sentence', () => {
    expect(splitSentences('He said "Stop." Then he left (at last.) Good.')).toEqual(['He said "Stop."', 'Then he left (at last.)', 'Good.']);
  });

  it('treats a run of marks as one ending', () => {
    expect(splitSentences('Wait... what?! No.')).toEqual(['Wait...', 'what?!', 'No.']);
  });

  it('collapses spaces inside a sentence', () => {
    expect(splitSentences('  One   two.   Three  ')).toEqual(['One two.', 'Three']);
  });

  it('never returns an empty string', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n \r\n  ')).toEqual([]);
    for (const text of ['...', '. . .', '\n.\n', 'a.\n\n\nb', ' ! ']) {
      const out = splitSentences(text, 3);
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((s) => s.trim() !== '' && s === s.trim())).toBe(true);
    }
  });

  it('cuts a long sentence at the last comma before the limit, then at the last space', () => {
    expect(splitSentences('one two three, four five six seven eight nine ten eleven', 30))
      .toEqual(['one two three,', 'four five six seven eight nine', 'ten eleven']);
  });

  it('cuts at a semicolon or a colon as it does at a comma', () => {
    expect(splitSentences('alpha beta: gamma delta epsilon zeta', 20)[0]).toBe('alpha beta:');
    expect(splitSentences('alpha beta; gamma delta epsilon zeta', 20)[0]).toBe('alpha beta;');
  });

  it('does not cut at the comma inside a number', () => {
    const out = splitSentences('it cost 1,250 dollars and more words here', 14);
    expect(out[0]).toBe('it cost 1,250');
    expect(out.join(' ')).toBe('it cost 1,250 dollars and more words here');
    expect(out.every((s) => s.length <= 14)).toBe(true);
  });

  it('cuts a word with no space in it at the limit', () => {
    expect(splitSentences('a'.repeat(50), 20).map((s) => s.length)).toEqual([20, 20, 10]);
  });

  it('keeps every piece within 220 characters by default and loses no word', () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}${i % 9 === 8 ? ',' : ''}`);
    const out = splitSentences(words.join(' '));
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((s) => s.length <= 220)).toBe(true);
    expect(out.join(' ')).toBe(words.join(' '));
  });

  it('falls back to a sane limit when given a bad one', () => {
    expect(splitSentences('one two three', 0)).toEqual(expect.arrayContaining(['o']));
    expect(splitSentences('one two three', Number.NaN)).toEqual(['one two three']);
  });
});
