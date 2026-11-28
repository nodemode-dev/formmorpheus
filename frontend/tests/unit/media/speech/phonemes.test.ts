import { describe, expect, it } from 'vitest';
import { lookup, pastEnding, pluralEnding, spell, toPhonemes } from '@src/media/speech/phonemes';
import type { PhonemeDict } from '@src/media/speech/phonemes';
import { tokenIds } from '@src/media/speech/tokens';

// A hand-made dictionary in the real ones' conventions: capital letters keyed as capitals, titles with their period,
// part-of-speech tables with DEFAULT and null values.
const dict: PhonemeDict = {
  gold: {
    cat: 'kˈæt', dog: 'dˈɔɡ', bus: 'bˈʌs', walk: 'wˈɔk', jog: 'ʤˈɑɡ', want: 'wˈɑnt',
    make: 'mˈAk', hope: 'hˈOp', hop: 'hˈɑp', run: 'ɹˈʌn', key: 'kˈi', frame: 'fɹˈAm', try: 'tɹˈI',
    rerun: 'ɹˈiɹˌʌn', Lee: 'lˈi', end: 'ˈɛnd', is: 'ɪz', the: 'ði', a: 'A', to: 'tu', three: 'θɹˈi',
    'Dr.': 'dˈɑktəɹ', etc: 'ɛtsˈɛɾəɹə',
    use: { DEFAULT: 'jˈuz', NOUN: 'jˈus' }, lead: { DEFAULT: null, NOUN: 'lˈɛd', VERB: 'lˈid' }, gone: { DEFAULT: null, NOUN: null },
    Polish: 'pˈOlɪʃ', polish: 'pˈɑlɪʃ', rose: 'ɹˈOz',
    A: 'ˈA', D: 'dˈi', N: 'ˈɛn', T: 'tˈi', V: 'vˈi', X: 'ˈɛks', Z: 'zˈi',
  },
  silver: { bath: 'bˈæθ', judge: 'ʤˈʌʤ', Rose: 'ɹˈOzə', Paris: 'pˈɛɹəs', paris: 'pˈæɹɪs' },
};
const DASH = String.fromCharCode(0x2014);
const say = (text: string): string => toPhonemes(text, dict).phonemes;

describe('lookup', () => {
  it('prefers gold as written, then gold lower-case, then silver as written, then silver lower-case', () => {
    expect(lookup('Polish', dict)).toBe('pˈOlɪʃ');
    expect(lookup('POLISH', dict)).toBe('pˈɑlɪʃ');
    expect(lookup('Rose', dict)).toBe('ɹˈOz');
    expect(lookup('Paris', dict)).toBe('pˈɛɹəs');
    expect(lookup('PARIS', dict)).toBe('pˈæɹɪs');
    expect(lookup('nothing', dict)).toBeNull();
  });

  it('takes DEFAULT from a part-of-speech table, else the first value that is not null', () => {
    expect(lookup('use', dict)).toBe('jˈuz');
    expect(lookup('lead', dict)).toBe('lˈɛd');
    expect(lookup('gone', dict)).toBeNull();
  });

  it('is not fooled by names every object has', () => {
    for (const word of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(lookup(word, dict)).toBeNull();
  });
});

describe('endings', () => {
  it('adds s after a voiceless sound, z after a voiced one and a vowel before z after a sibilant', () => {
    for (const last of ['p', 't', 'k', 'f', 'θ']) expect(pluralEnding(`a${last}`)).toBe('s');
    for (const last of ['b', 'd', 'ɡ', 'v', 'n', 'l', 'i', 'ə']) expect(pluralEnding(`a${last}`)).toBe('z');
    for (const last of ['s', 'z', 'ʃ', 'ʒ', 'ʧ', 'ʤ']) expect(pluralEnding(`a${last}`)).toBe('ᵻz');
  });

  it('adds t after a voiceless sound, d after a voiced one and a vowel before d after t or d', () => {
    for (const last of ['p', 'k', 'f', 's', 'ʃ', 'ʧ', 'θ']) expect(pastEnding(`a${last}`)).toBe('t');
    for (const last of ['b', 'ɡ', 'v', 'z', 'n', 'i']) expect(pastEnding(`a${last}`)).toBe('d');
    for (const last of ['t', 'd']) expect(pastEnding(`a${last}`)).toBe('ᵻd');
  });
});

describe('toPhonemes: words the dictionaries have', () => {
  it('separates words with one space', () => {
    expect(say('cat   dog\tcat')).toBe('kˈæt dˈɔɡ kˈæt');
  });

  it('finds a capitalised word through its lower-case entry', () => {
    expect(say('Cat DOG')).toBe('kˈæt dˈɔɡ');
  });

  it('reads a title with its period as one word and no pause', () => {
    expect(say('Dr. Lee is Dr. Cat.')).toBe('dˈɑktəɹ lˈi ɪz dˈɑktəɹ kˈæt.');
  });

  it('keeps the period of etc. only when it also ends the sentence', () => {
    expect(say('cat, etc. is')).toBe('kˈæt, ɛtsˈɛɾəɹə ɪz');
    expect(say('cat, etc.')).toBe('kˈæt, ɛtsˈɛɾəɹə.');
  });

  it('reads numbers through their words', () => {
    expect(say('3 cats')).toBe('θɹˈi kˈæts');
  });
});

describe('toPhonemes: weak forms', () => {
  it('says the before a consonant and before a vowel differently', () => {
    expect(say('the cat')).toBe('ðə kˈæt');
    expect(say('The end')).toBe('ði ˈɛnd');
  });

  it('says the article a weakly', () => {
    expect(say('A cat')).toBe('ɐ kˈæt');
  });

  it('says to by what follows it', () => {
    expect(say('to walk')).toBe('tə wˈɔk');
    expect(say('to end')).toBe('tʊ ˈɛnd');
    expect(say('walk to.')).toBe('wˈɔk tu.');
  });

  it('leaves those words to the fallbacks when the dictionary lacks them', () => {
    const bare: PhonemeDict = { gold: { cat: 'kˈæt', T: 'tˈi' }, silver: {} };
    expect(toPhonemes('the cat', bare)).toEqual({ phonemes: 'tˈi kˈæt', unknown: ['the'] });
  });
});

describe('toPhonemes: words the dictionaries lack', () => {
  it('builds a possessive from its stem', () => {
    expect(say("Lee's")).toBe('lˈiz');
    expect(say("cat's")).toBe('kˈæts');
    expect(say("bus's")).toBe('bˈʌsᵻz');
    expect(say('Lee’s')).toBe('lˈiz');
    expect(say("dogs'")).toBe('dˈɔɡz');
  });

  it('builds a plural after each class of sound', () => {
    expect(say('cats')).toBe('kˈæts');
    expect(say('baths')).toBe('bˈæθs');
    expect(say('dogs')).toBe('dˈɔɡz');
    expect(say('keys')).toBe('kˈiz');
    expect(say('buses')).toBe('bˈʌsᵻz');
    expect(say('judges')).toBe('ʤˈʌʤᵻz');
    expect(say('tries')).toBe('tɹˈIz');
  });

  it('builds a past tense after each class of sound', () => {
    expect(say('walked')).toBe('wˈɔkt');
    expect(say('jogged')).toBe('ʤˈɑɡd');
    expect(say('wanted')).toBe('wˈɑntᵻd');
    expect(say('hoped')).toBe('hˈOpt');
    expect(say('tried')).toBe('tɹˈId');
  });

  it('builds an -ing form, restoring a dropped e and undoing a doubled letter', () => {
    expect(say('walking')).toBe('wˈɔkɪŋ');
    expect(say('making')).toBe('mˈAkɪŋ');
    expect(say('hoping')).toBe('hˈOpɪŋ');
    expect(say('hopping')).toBe('hˈɑpɪŋ');
    expect(say('running')).toBe('ɹˈʌnɪŋ');
  });

  it('stacks an ending on a built stem', () => {
    expect(say('makings')).toBe('mˈAkɪŋz');
  });

  it('reads a hyphenated word joined when the dictionary has it so, else part by part', () => {
    expect(say('re-run')).toBe('ɹˈiɹˌʌn');
    expect(say('cat-dog')).toBe('kˈæt dˈɔɡ');
    expect(say('cat-dogs')).toBe('kˈæt dˈɔɡz');
  });

  it('says a short all-capital word the dictionaries lack letter by letter, and does not call it unknown', () => {
    expect(toPhonemes('DNA', dict)).toEqual({ phonemes: 'dˌiˌɛnˈA', unknown: [] });
    expect(toPhonemes('TVs', dict)).toEqual({ phonemes: 'tˌivˈiz', unknown: [] });
  });

  it('reads an all-capital word the dictionaries have as that word', () => {
    expect(say('CAT')).toBe('kˈæt');
  });

  it('reads a word of joined capitalised words by its parts', () => {
    expect(toPhonemes('CatDog', dict)).toEqual({ phonemes: 'kˈæt dˈɔɡ', unknown: [] });
  });

  it('reads two dictionary words written as one, leaning on the first', () => {
    expect(toPhonemes('keyframe', dict)).toEqual({ phonemes: 'kˈifɹˌAm', unknown: [] });
    expect(say('keyframes')).toBe('kˈifɹˌAmz');
  });

  it('spells out a word nothing can read and reports it', () => {
    expect(toPhonemes('Zax', dict)).toEqual({ phonemes: 'zˌiˌAˈɛks', unknown: ['Zax'] });
  });

  it('reports an unknown word once, and only the unknown part of a hyphenated word', () => {
    expect(toPhonemes('Zax cat Zax', dict).unknown).toEqual(['Zax']);
    expect(toPhonemes('cat-zax', dict)).toEqual({ phonemes: 'kˈæt zˌiˌAˈɛks', unknown: ['zax'] });
  });

  it('spells with the letters it has and skips the rest', () => {
    expect(spell('tvq', dict)).toBe('tˌivˈi');
    expect(spell('', dict)).toBe('');
  });
});

describe('toPhonemes: punctuation', () => {
  it('attaches a mark to the word before it, with a space after', () => {
    expect(say('Cat, dog. Run! Cat? Dog; cat: dog')).toBe('kˈæt, dˈɔɡ. ɹˈʌn! kˈæt? dˈɔɡ; kˈæt: dˈɔɡ');
    expect(say('cat , dog')).toBe('kˈæt, dˈɔɡ');
  });

  it('keeps a dash between words, however it was typed', () => {
    const want = `kˈæt${DASH} dˈɔɡ`;
    for (const text of ['cat - dog', 'cat -- dog', `cat${DASH}dog`, 'cat – dog']) expect(say(text)).toBe(want);
  });

  it('drops every other character', () => {
    expect(say('cat (dog) * "cat" #~ [dog]')).toBe('kˈæt dˈɔɡ kˈæt dˈɔɡ');
  });

  it('keeps one mark a word and none before the first word', () => {
    expect(say('cat?! dog...')).toBe('kˈæt? dˈɔɡ.');
    expect(say('cat… dog')).toBe('kˈæt. dˈɔɡ');
    expect(say('... , cat')).toBe('kˈæt');
  });

  it('gives an empty string for text with no word', () => {
    expect(toPhonemes('', dict)).toEqual({ phonemes: '', unknown: [] });
    expect(toPhonemes(' ?! ', dict)).toEqual({ phonemes: '', unknown: [] });
  });

  it('reads an accented letter as its plain letter', () => {
    expect(say('cát')).toBe('kˈæt');
  });
});

describe('toPhonemes: the model can read all of it', () => {
  // the model's ids for the characters this dictionary and our rules use
  const vocab: Record<string, number> = {
    ';': 1, ':': 2, ',': 3, '.': 4, '!': 5, '?': 6, [DASH]: 9, ' ': 16, A: 24, I: 25, O: 31, b: 44, d: 46, f: 48, h: 50, i: 51, j: 52, k: 53, l: 54, m: 55,
    n: 56, p: 58, s: 61, t: 62, u: 63, v: 64, w: 65, z: 68, 'ɑ': 69, 'ɐ': 70, 'æ': 72, 'ɔ': 76, 'ð': 81, 'ʤ': 82, 'ə': 83,
    'ɛ': 86, 'ɡ': 92, 'ɪ': 102, 'ŋ': 112, 'θ': 119, 'ɹ': 123, 'ɾ': 125, 'ʃ': 131, 'ʊ': 135, 'ʌ': 138,
    'ˈ': 156, 'ˌ': 157, 'ᵻ': 177,
  };
  const text = "Dr. Lee's 3 cats walked to the end - hoping, making keyframes; DNA is re-run: Zax wanted a bus! Is Polish used? Judges jogged, etc.";

  it('emits only characters in the vocabulary', () => {
    const { phonemes } = toPhonemes(text, dict);
    expect(phonemes.length).toBeGreaterThan(60);
    expect([...phonemes].filter((c) => !Object.hasOwn(vocab, c))).toEqual([]);
  });

  it('so no character is lost on the way to token ids', () => {
    const { phonemes } = toPhonemes(text, dict);
    expect(tokenIds(phonemes, vocab)).toHaveLength([...phonemes].length + 2);
  });
});
