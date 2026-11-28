import { describe, expect, it } from 'vitest';
import { MAX_CARDINAL, cardinal, digits, normalizeText, ordinal, year, yearLike } from '@src/media/speech/numbers';

describe('cardinal', () => {
  it('says small numbers', () => {
    expect(cardinal(0)).toBe('zero');
    expect(cardinal(7)).toBe('seven');
    expect(cardinal(13)).toBe('thirteen');
    expect(cardinal(20)).toBe('twenty');
    expect(cardinal(21)).toBe('twenty one');
    expect(cardinal(99)).toBe('ninety nine');
  });

  it('says hundreds, thousands, millions and billions', () => {
    expect(cardinal(100)).toBe('one hundred');
    expect(cardinal(101)).toBe('one hundred one');
    expect(cardinal(1250)).toBe('one thousand two hundred fifty');
    expect(cardinal(10000)).toBe('ten thousand');
    expect(cardinal(1000000)).toBe('one million');
    expect(cardinal(2000003)).toBe('two million three');
    expect(cardinal(MAX_CARDINAL)).toBe('nine hundred ninety nine billion nine hundred ninety nine million nine hundred ninety nine thousand nine hundred ninety nine');
  });

  it('says nothing for a number it does not cover', () => {
    for (const n of [-1, 1.5, MAX_CARDINAL + 1, Number.NaN, Number.POSITIVE_INFINITY]) expect(cardinal(n)).toBe('');
  });
});

describe('ordinal', () => {
  it('says the irregular ones', () => {
    expect([1, 2, 3, 5, 8, 9, 12].map(ordinal)).toEqual(['first', 'second', 'third', 'fifth', 'eighth', 'ninth', 'twelfth']);
  });

  it('says the regular ones and the tens', () => {
    expect(ordinal(4)).toBe('fourth');
    expect(ordinal(11)).toBe('eleventh');
    expect(ordinal(20)).toBe('twentieth');
    expect(ordinal(22)).toBe('twenty second');
    expect(ordinal(100)).toBe('one hundredth');
    expect(ordinal(103)).toBe('one hundred third');
    expect(ordinal(1000)).toBe('one thousandth');
  });
});

describe('year', () => {
  it('reads a year in two halves', () => {
    expect(year(1999)).toBe('nineteen ninety nine');
    expect(year(2024)).toBe('twenty twenty four');
    expect(year(2010)).toBe('twenty ten');
    expect(year(1905)).toBe('nineteen oh five');
    expect(year(1900)).toBe('nineteen hundred');
  });

  it('reads 2000 to 2009 as two thousand', () => {
    expect(year(2000)).toBe('two thousand');
    expect(year(2005)).toBe('two thousand five');
  });

  it('knows what is not a year', () => {
    expect(yearLike(1099)).toBe(false);
    expect(yearLike(2100)).toBe(false);
    expect(yearLike(1100)).toBe(true);
    expect(year(2500)).toBe('two thousand five hundred');
  });
});

describe('digits', () => {
  it('reads one by one', () => {
    expect(digits('007')).toBe('zero zero seven');
    expect(digits('4-2')).toBe('four two');
  });
});

describe('normalizeText', () => {
  it('writes out cardinals, with or without commas', () => {
    expect(normalizeText('3 cats')).toBe('three cats');
    expect(normalizeText('Making 1,250 drawings')).toBe('Making one thousand two hundred fifty drawings');
    expect(normalizeText('1,000,000 frames')).toBe('one million frames');
    expect(normalizeText('999,999,999,999')).toBe(cardinal(MAX_CARDINAL));
  });

  it('reads a list of numbers as separate numbers', () => {
    expect(normalizeText('1, 2 and 3')).toBe('one, two and three');
    expect(normalizeText('1,2,3')).toBe('one,two,three');
  });

  it('writes out decimals digit by digit after the point', () => {
    expect(normalizeText('Pi is 3.14.')).toBe('Pi is three point one four.');
    expect(normalizeText('0.5')).toBe('zero point five');
    expect(normalizeText('1,250.05')).toBe('one thousand two hundred fifty point zero five');
  });

  it('reads a bare four digit number in range as a year', () => {
    expect(normalizeText('finished in 2024.')).toBe('finished in twenty twenty four.');
    expect(normalizeText('From 1999 to 2005')).toBe('From nineteen ninety nine to two thousand five');
  });

  it('reads the same digits as a cardinal when they are plainly not a year', () => {
    expect(normalizeText('$2024')).toBe('two thousand twenty four dollars');
    expect(normalizeText('2,024 frames')).toBe('two thousand twenty four frames');
    expect(normalizeText('2024.5')).toBe('two thousand twenty four point five');
    expect(normalizeText('2024%')).toBe('two thousand twenty four percent');
    expect(normalizeText('3000 frames')).toBe('three thousand frames');
  });

  it('reads decades', () => {
    expect(normalizeText('the 1990s')).toBe('the nineteen nineties');
    expect(normalizeText('the 1900s')).toBe('the nineteen hundreds');
  });

  it('writes out ordinals', () => {
    expect(normalizeText('the 1st and the 22nd')).toBe('the first and the twenty second');
    expect(normalizeText('103rd, 4th')).toBe('one hundred third, fourth');
  });

  it('writes out money', () => {
    expect(normalizeText('cost $99.50, about')).toBe('cost ninety nine dollars and fifty cents, about');
    expect(normalizeText('$5.50')).toBe('five dollars and fifty cents');
    expect(normalizeText('$1')).toBe('one dollar');
    expect(normalizeText('$5')).toBe('five dollars');
    expect(normalizeText('$5.00')).toBe('five dollars');
    expect(normalizeText('$1.01')).toBe('one dollar and one cent');
    expect(normalizeText('$0.05')).toBe('five cents');
    expect(normalizeText('$5.5')).toBe('five dollars and fifty cents');
    expect(normalizeText('$1,250')).toBe('one thousand two hundred fifty dollars');
    expect(normalizeText('$1.5 million')).toBe('one point five million dollars');
    expect(normalizeText('£2.50')).toBe('two pounds and fifty pence');
    expect(normalizeText('€3')).toBe('three euros');
  });

  it('writes out percentages', () => {
    expect(normalizeText('about 40% less')).toBe('about forty percent less');
    expect(normalizeText('3.5 %')).toBe('three point five percent');
    expect(normalizeText('a % sign')).toBe('a percent sign');
  });

  it('writes out the symbols it knows', () => {
    expect(normalizeText('Tom & Jerry')).toBe('Tom and Jerry');
    expect(normalizeText('me@home')).toBe('me at home');
    expect(normalizeText('2+2=4')).toBe('two plus two equals four');
  });

  it('keeps letters glued to a number as their own word', () => {
    expect(normalizeText('3D and v2')).toBe('three D and v two');
  });

  it('reads leading zeros and very long numbers digit by digit', () => {
    expect(normalizeText('agent 007')).toBe('agent zero zero seven');
    expect(normalizeText('1234567890123')).toBe('one two three four five six seven eight nine zero one two three');
  });

  it('reads clock times', () => {
    expect(normalizeText('at 3:30')).toBe('at three thirty');
    expect(normalizeText('at 9:05')).toBe('at nine oh five');
    expect(normalizeText("at 3:00")).toBe("at three o'clock");
  });

  it('reads a leading minus', () => {
    expect(normalizeText('-5 degrees')).toBe('minus five degrees');
    expect(normalizeText('re-5')).toBe('re-five');
  });

  it('writes out a few abbreviations', () => {
    expect(normalizeText('tools, e.g. brushes, i.e. round ones')).toBe('tools, for example brushes, that is round ones');
    expect(normalizeText('Prof. Lee vs. Dr. Kim')).toBe('Professor Lee versus Dr. Kim');
  });

  it('leaves plain text and its punctuation alone', () => {
    const text = "Yes: it's ready, isn't it? Re-usable!";
    expect(normalizeText(text)).toBe(text);
  });
});
