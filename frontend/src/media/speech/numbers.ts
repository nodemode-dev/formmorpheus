// Numbers, money, years and a few symbols written out as the words a person would say, so the pronunciation
// dictionaries can read them. English only. Pure, no DOM.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];
const IRREGULAR: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
const MONEY: Record<string, { one: string; many: string; part: string; parts: string }> = {
  $: { one: 'dollar', many: 'dollars', part: 'cent', parts: 'cents' },
  '£': { one: 'pound', many: 'pounds', part: 'penny', parts: 'pence' },
  '€': { one: 'euro', many: 'euros', part: 'cent', parts: 'cents' },
};
const SYMBOLS: Record<string, string> = { '&': 'and', '@': 'at', '+': 'plus', '=': 'equals', '%': 'percent' };
const SHORT: Record<string, string> = { 'e.g.': 'for example', 'i.e.': 'that is', 'prof.': 'Professor', 'vs.': 'versus', 'sr.': 'Senior', 'jr.': 'Junior' };

/** The largest whole number read as a cardinal; longer runs of digits are read digit by digit. */
export const MAX_CARDINAL = 999_999_999_999_999;
const MAX_CARDINAL_DIGITS = String(MAX_CARDINAL).length;

function belowThousand(n: number): string[] {
  const words: string[] = [];
  if (n >= 100) words.push(ONES[Math.floor(n / 100)], 'hundred');
  const rest = n % 100;
  if (rest >= 20) {
    words.push(TENS[Math.floor(rest / 10)]);
    if (rest % 10) words.push(ONES[rest % 10]);
  } else if (rest > 0 || n === 0) words.push(ONES[rest]);
  return words;
}

/** 1250 as "one thousand two hundred fifty". Whole numbers from 0 to MAX_CARDINAL; anything else is an empty string. */
export function cardinal(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > MAX_CARDINAL) return '';
  if (n === 0) return ONES[0];
  const groups: string[] = [];
  let rest = n;
  for (let scale = 0; rest > 0; scale++, rest = Math.floor(rest / 1000)) {
    const group = rest % 1000;
    if (group) groups.unshift([...belowThousand(group), SCALES[scale]].filter(Boolean).join(' '));
  }
  return groups.join(' ');
}

/** 22 as "twenty second". */
export function ordinal(n: number): string {
  const words = cardinal(n).split(' ');
  const last = words[words.length - 1];
  if (!last) return '';
  const said = IRREGULAR[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words.slice(0, -1), said].join(' ');
}

/** A run of digits read one by one: "007" as "zero zero seven". */
export function digits(run: string): string {
  return [...run].filter((c) => c >= '0' && c <= '9').map((c) => ONES[Number(c)]).join(' ');
}

/** True for a number a reader takes as a year when it stands alone with four digits. */
export function yearLike(n: number): boolean {
  return Number.isInteger(n) && n >= 1100 && n <= 2099;
}

/** 1999 as "nineteen ninety nine", 2005 as "two thousand five", 1905 as "nineteen oh five". */
export function year(n: number): string {
  if (!yearLike(n)) return cardinal(n);
  const high = Math.floor(n / 100);
  const low = n % 100;
  if (n >= 2000 && n <= 2009) return cardinal(n);
  if (low === 0) return `${cardinal(high)} hundred`;
  return `${cardinal(high)} ${low < 10 ? `oh ${ONES[low]}` : cardinal(low)}`;
}

/** The 1990s as "nineteen nineties". */
function decade(n: number): string {
  const words = year(n).split(' ');
  const last = words[words.length - 1];
  return [...words.slice(0, -1), last.endsWith('y') ? `${last.slice(0, -1)}ies` : `${last}s`].join(' ');
}

/** The whole part of a number as written, commas and all. */
function whole(run: string): string {
  const plain = run.replace(/,/g, '');
  if (plain.length > MAX_CARDINAL_DIGITS ||(plain.length > 1 && plain.startsWith('0'))) return digits(plain);
  return cardinal(Number(plain));
}

function decimal(run: string, fraction: string | undefined): string {
  return fraction ? `${whole(run)} point ${digits(fraction)}` : whole(run);
}

function money(sign: string, run: string, fraction: string | undefined, scale: string | undefined): string {
  const unit = MONEY[sign];
  const count = Number(run.replace(/,/g, ''));
  if (scale) return `${decimal(run, fraction)} ${scale.toLowerCase()} ${unit.many}`;
  if (fraction === undefined) return `${whole(run)} ${count === 1 ? unit.one : unit.many}`;
  if (fraction.length > 2) return `${decimal(run, fraction)} ${unit.many}`;
  const parts = Number(fraction.padEnd(2, '0'));
  const small = `${cardinal(parts)} ${parts === 1 ? unit.part : unit.parts}`;
  const big = `${whole(run)} ${count === 1 ? unit.one : unit.many}`;
  if (parts === 0) return big;
  return count === 0 ? small : `${big} and ${small}`;
}

function clock(hours: number, minutes: number): string {
  if (minutes === 0) return hours > 12 ? `${cardinal(hours)} hundred` : `${cardinal(hours)} o'clock`;
  return `${cardinal(hours)} ${minutes < 10 ? `oh ${ONES[minutes]}` : cardinal(minutes)}`;
}

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?!\d)|\d+`;
// One pass, most specific first, so nothing that was written out is read again.
const PATTERN = new RegExp([
  String.raw`(?<short>\b(?:e\.g\.|i\.e\.|(?:prof|vs|sr|jr)\.))`,
  String.raw`(?<sign>[$£€])\s?(?<mwhole>${NUM})(?:\.(?<mfrac>\d+))?(?:\s(?<mscale>hundred|thousand|million|billion|trillion)\b)?`,
  String.raw`(?<![\d:.,])(?<hh>[01]?\d|2[0-3]):(?<mm>[0-5]\d)(?![\d:])`,
  String.raw`(?<owhole>${NUM})(?:st|nd|rd|th)\b`,
  String.raw`(?<![\d.,])(?<dec>1[1-9]\d0|20\d0)s\b`,
  String.raw`(?<=^|[\s(])(?<minus>-)(?=[\d$])`,
  String.raw`(?<nwhole>${NUM})(?:\.(?<nfrac>\d+))?(?<pct>\s?%)?`,
  String.raw`(?<symbol>[&@+=%])`,
].join('|'), 'gi');

function say(g: Record<string, string | undefined>, match: string): string {
  if (g.short) return SHORT[g.short.toLowerCase()];
  if (g.sign && g.mwhole) return money(g.sign, g.mwhole, g.mfrac, g.mscale);
  if (g.hh && g.mm) return clock(Number(g.hh), Number(g.mm));
  if (g.owhole) return ordinal(Number(g.owhole.replace(/,/g, ''))) || digits(g.owhole);
  if (g.dec) return decade(Number(g.dec));
  if (g.minus) return 'minus';
  if (g.nwhole) {
    const n = Number(g.nwhole);
    const bare = g.nfrac === undefined && !g.pct && /^\d{4}$/.test(g.nwhole);
    const said = bare && yearLike(n) ? year(n) : decimal(g.nwhole, g.nfrac);
    return g.pct ? `${said} percent` : said;
  }
  return SYMBOLS[g.symbol ?? ''] ?? match;
}

/**
 * `text` with numbers, money, percentages, ordinals, clock times, obvious years, a few symbols and a few
 * abbreviations written as words. Everything else, punctuation included, is left as it was.
 */
export function normalizeText(text: string): string {
  const glued = /[A-Za-z0-9]/;
  return text.replace(PATTERN, (...args: unknown[]) => {
    const match = args[0] as string;
    const groups = args[args.length - 1] as Record<string, string | undefined>;
    const offset = args[args.length - 3] as number;
    const said = say(groups, match);
    // "3D" and "v2" keep their letters as a separate word
    const before = glued.test(text[offset - 1] ?? '') ? ' ' : '';
    const after = glued.test(text[offset + match.length] ?? '') ? ' ' : '';
    return `${before}${said}${after}`;
  });
}
