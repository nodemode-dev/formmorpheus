// Words into the phoneme characters the speech model reads, by lookup in the pronunciation dictionaries and a few
// rules of our own for the words they lack. English only. Pure, no DOM.
import { normalizeText } from './numbers';

export interface PhonemeDict { gold: Record<string, unknown>; silver: Record<string, unknown> }

const PRIMARY = 'ˈ';
const SECONDARY = 'ˌ';
// the long dash the model pauses on, by its number: the text lint keeps the character itself out of this tree
const DASH = String.fromCharCode(0x2014);
const VOWELS = 'AIOQWYaeiouæɑɐɒɔəɚɛɜɪʊʌᵊᵻ';
const SIBILANT = 's z ʃ ʒ ʧ ʤ'.split(' ');
const VOICELESS = 'p t k f θ'.split(' ');
const VOICELESS_ED = ['p', 'k', 'f', 'θ', 's', 'ʃ', 'ʧ'];
// t, d and the flap that stands for either between vowels
const STOPS_ED = ['t', 'd', 'ɾ'];
// Titles whose period belongs to the word.
const TITLES = new Set(['mr', 'mrs', 'ms', 'dr']);
const MAX_INITIALISM = 5;
const MAX_DEPTH = 2;
const TOKEN = new RegExp(String.raw`([A-Za-z]+(?:['-][A-Za-z]+)*'?)|(${DASH}|–|-{2,}|(?<=\s)-(?=\s))|(…|[.,!?;:])`, 'g');

/** The pronunciation in one dictionary entry: a string, or the DEFAULT of a part-of-speech table, else its first value. */
function entry(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (!value || typeof value !== 'object') return null;
  const table = value as Record<string, unknown>;
  if (typeof table.DEFAULT === 'string' && table.DEFAULT) return table.DEFAULT;
  for (const v of Object.values(table)) if (typeof v === 'string' && v) return v;
  return null;
}

const own = (table: Record<string, unknown>, word: string): unknown => (Object.hasOwn(table, word) ? table[word] : undefined);

/** A word as the dictionaries have it: gold as written, gold lower-case, silver as written, silver lower-case. */
export function lookup(word: string, dict: PhonemeDict): string | null {
  const lower = word.toLowerCase();
  return entry(own(dict.gold, word)) ?? entry(own(dict.gold, lower)) ?? entry(own(dict.silver, word)) ?? entry(own(dict.silver, lower));
}

const lastSound = (phonemes: string): string => phonemes[phonemes.length - 1] ?? '';

/** The sound a plural or possessive adds after `stem`. */
export function pluralEnding(stem: string): string {
  const last = lastSound(stem);
  if (SIBILANT.includes(last)) return 'ᵻz';
  return VOICELESS.includes(last) ? 's' : 'z';
}

/** The sound -ed adds after `stem`. */
export function pastEnding(stem: string): string {
  const last = lastSound(stem);
  if (STOPS_ED.includes(last)) return 'ᵻd';
  return VOICELESS_ED.includes(last) ? 't' : 'd';
}

/** Several pronunciations said as one word: only the last keeps its main stress. */
function fuse(parts: string[]): string {
  return parts.map((p, i) => (i < parts.length - 1 ? p.replaceAll(PRIMARY, SECONDARY) : p)).join('');
}

/** A word said letter by letter from the dictionaries' entries for capital letters; letters they lack are left out. */
export function spell(word: string, dict: PhonemeDict): string {
  const letters = [...word.toUpperCase()].filter((c) => c >= 'A' && c <= 'Z');
  return fuse(letters.map((c) => lookup(c, dict)).filter((p): p is string => p !== null));
}

function first<T>(candidates: string[], tryOne: (stem: string) => T | null): T | null {
  for (const stem of candidates) {
    const got = stem ? tryOne(stem) : null;
    if (got !== null) return got;
  }
  return null;
}

/** word's, words, wordes, worded and wording, from the stem's pronunciation and the ending's sound. */
function suffixed(word: string, dict: PhonemeDict, depth: number): string | null {
  const lower = word.toLowerCase();
  const stemOf = (stem: string): string | null => (stem.length >= 2 ? known(stem, dict, depth + 1) : null);
  const withEnd = (stems: string[], end: (p: string) => string): string | null => first(stems, (s) => { const p = stemOf(s); return p === null ? null : p + end(p); });
  const cut = (n: number): string => word.slice(0, word.length - n);
  // jogged is jog, running is run
  const twin = (suffix: number): boolean => lower.length > suffix + 2 && lower[lower.length - suffix - 1] === lower[lower.length - suffix - 2];

  if (lower.endsWith("'s")) return withEnd([cut(2)], pluralEnding);
  if (lower.endsWith("s'")) return stemOf(cut(1));
  if (lower.endsWith('ies') && lower.length > 4) { const p = withEnd([`${cut(3)}y`], pluralEnding); if (p) return p; }
  // "canes" is cane and s before it is can and es
  if (lower.endsWith('es')) { const p = withEnd([cut(1), cut(2)], pluralEnding); if (p) return p; }
  else if (lower.endsWith('s') && !lower.endsWith('ss')) { const p = withEnd([cut(1)], pluralEnding); if (p) return p; }
  if (lower.endsWith('ied') && lower.length > 4) { const p = withEnd([`${cut(3)}y`], pastEnding); if (p) return p; }
  if (lower.endsWith('ed') && lower.length > 4) return withEnd([cut(1), cut(2), twin(2) ? cut(3) : ''], pastEnding);
  if (lower.endsWith('ing') && lower.length > 5) {
    const stem = cut(3);
    // one consonant after one vowel means a dropped e: hoping is hope, hopping is hop
    const droppedE = /[^aeiou][aeiou][^aeiouwxy]$/i.test(stem);
    const stems = droppedE ? [`${stem}e`, stem] : [stem, `${stem}e`, twin(3) ? cut(4) : ''];
    return withEnd(stems, () => 'ɪŋ');
  }
  return null;
}

/** FormMorpheus as Form and Morpheus. */
function camel(word: string, dict: PhonemeDict, depth: number): string | null {
  const parts = word.match(/[A-Z][a-z]+|[a-z]+|[A-Z]+(?![a-z])/g) ?? [];
  if (parts.length < 2 || parts.join('') !== word) return null;
  const said = parts.map((p) => known(p, dict, depth + 1));
  return said.every((p): p is string => p !== null) ? said.join(' ') : null;
}

/** keyframe as key and frame: two dictionary words written as one, the longest first word winning. */
function compound(word: string, dict: PhonemeDict): string | null {
  if (word.length < 6 || !/^[A-Za-z]+$/.test(word)) return null;
  for (let i = word.length - 3; i >= 3; i--) {
    const a = lookup(word.slice(0, i), dict);
    const b = a === null ? null : lookup(word.slice(i), dict);
    // a compound leans on its first word
    if (a !== null && b !== null) return a + b.replaceAll(PRIMARY, SECONDARY);
  }
  return null;
}

/** The pronunciation of a word the dictionaries have or our rules can build; null when it would have to be spelled. */
function known(word: string, dict: PhonemeDict, depth = 0): string | null {
  const direct = lookup(word, dict);
  if (direct !== null) return direct;
  // DNA, TV: capitals the dictionaries lack are said as letters, and that is the right reading, not a miss
  if (/^[A-Z]{2,}$/.test(word) && word.length <= MAX_INITIALISM) return spell(word, dict) || null;
  if (depth < MAX_DEPTH) {
    const built = suffixed(word, dict, depth);
    if (built !== null) return built;
  }
  if (word.includes('-')) return lookup(word.replaceAll('-', ''), dict);
  if (depth >= MAX_DEPTH) return null;
  return camel(word, dict, depth) ?? compound(word, dict);
}

interface Said { phonemes: string; unknown: string[] }

function sayWord(word: string, dict: PhonemeDict): Said {
  const got = known(word, dict);
  if (got !== null) return { phonemes: got, unknown: [] };
  if (word.includes('-')) {
    const parts = word.split('-').filter(Boolean).map((p) => sayWord(p, dict));
    return { phonemes: parts.map((p) => p.phonemes).filter(Boolean).join(' '), unknown: parts.flatMap((p) => p.unknown) };
  }
  return { phonemes: spell(word, dict), unknown: [word] };
}

interface Piece { kind: 'word' | 'mark'; text: string; phonemes: string }

const startsWithVowel = (phonemes: string): boolean => VOWELS.includes([...phonemes].find((c) => c !== PRIMARY && c !== SECONDARY) ?? ' ');

/** The weak forms of a, the and to, which the dictionaries list only in their strong form. */
function weak(piece: Piece, next: Piece | undefined, dict: PhonemeDict): string {
  const lower = piece.text.toLowerCase();
  if (lower !== 'a' && lower !== 'the' && lower !== 'to') return piece.phonemes;
  if (lookup(lower, dict) === null) return piece.phonemes;
  const vowel = next?.kind === 'word' && startsWithVowel(next.phonemes);
  if (lower === 'a') return 'ɐ';
  if (lower === 'the') return vowel ? 'ði' : 'ðə';
  if (next?.kind !== 'word') return piece.phonemes;
  return vowel ? 'tʊ' : 'tə';
}

/** True when the "etc." at `end` closes its sentence, so its period is also a full stop. */
const closes = (text: string, end: number): boolean => /^\s*($|["'(\[“‘]*[A-Z])/.test(text.slice(end));

/**
 * The phoneme string for `text`: words one space apart, with . , ! ? ; : and the dash kept on the word before them.
 * `unknown` lists the words no dictionary or rule could read, which are spelled letter by letter.
 */
export function toPhonemes(text: string, dict: PhonemeDict): { phonemes: string; unknown: string[] } {
  const plain = normalizeText(text.replace(/[‘’]/g, "'")).normalize('NFD').replace(/\p{M}/gu, '');
  const pieces: Piece[] = [];
  const unknown: string[] = [];
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(plain); m; m = TOKEN.exec(plain)) {
    if (m[1]) {
      let word = m[1].replace(/'$/, '');
      const dotted = plain[TOKEN.lastIndex] === '.';
      const lower = word.toLowerCase();
      if (dotted && (TITLES.has(lower) || (lower === 'etc' && !closes(plain, TOKEN.lastIndex + 1)))) {
        // the period is part of the abbreviation, so it is not a pause
        TOKEN.lastIndex += 1;
        if (lookup(`${word}.`, dict) !== null) word = `${word}.`;
      }
      const said = word.endsWith('.') ? { phonemes: lookup(word, dict) ?? '', unknown: [] } : sayWord(word, dict);
      for (const u of said.unknown) if (!unknown.includes(u)) unknown.push(u);
      if (said.phonemes) pieces.push({ kind: 'word', text: word, phonemes: said.phonemes });
    } else if (m[2]) pieces.push({ kind: 'mark', text: DASH, phonemes: DASH });
    else if (m[3]) pieces.push({ kind: 'mark', text: m[3], phonemes: m[3] === '…' ? '.' : m[3] });
  }
  let out = '';
  let marked = true;
  pieces.forEach((piece, i) => {
    if (piece.kind === 'word') {
      out += `${out ? ' ' : ''}${weak(piece, pieces[i + 1], dict)}`;
      marked = false;
    } else if (!marked) {
      // one mark a word: "?!" and "..." are a single pause
      out += piece.phonemes;
      marked = true;
    }
  });
  return { phonemes: out, unknown };
}
