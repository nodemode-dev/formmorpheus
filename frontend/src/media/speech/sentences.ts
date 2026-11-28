// Text into sentences for the built-in voice: the speech model takes a bounded number of phonemes a call, and one
// sentence a call is also what lets progress, cancel and subtitle lines work sentence by sentence. Pure, no DOM.

const DEFAULT_MAX = 220;
// A period after one of these is part of the word, not the end of a sentence.
const NO_SPLIT = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'e.g', 'i.e']);
const END = /[.!?…]+["')\]”’]*(?=\s|$)/g;
const LEADING = /^["'(\[“‘]+/;

/** True when the punctuation found at `at` ends a sentence, false when it closes an abbreviation. */
function ends(line: string, from: number, at: number, mark: string, after: string): boolean {
  if (!mark.startsWith('.') || mark.startsWith('..')) return true;
  const word = (/(\S+)$/.exec(line.slice(from, at))?.[1] ?? '').replace(LEADING, '').toLowerCase();
  if (NO_SPLIT.has(word)) return false;
  // "etc." closes a sentence only when a new one visibly starts after it
  if (word === 'etc') return after.trim() === '' || /^\s+["'(\[“‘]*[A-Z]/.test(after);
  return true;
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let from = 0;
  END.lastIndex = 0;
  for (let m = END.exec(line); m; m = END.exec(line)) {
    const stop = m.index + m[0].length;
    if (!ends(line, from, m.index, m[0], line.slice(stop))) continue;
    out.push(line.slice(from, stop));
    from = stop;
  }
  out.push(line.slice(from));
  return out;
}

/** Cuts a sentence that is over `max` at the last comma, semicolon or colon before the limit, else at the last space. */
function splitLong(sentence: string, max: number): string[] {
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    let cut = -1;
    for (let i = max - 1; i > 0; i--) {
      // a comma inside a number (1,250) is not a place to breathe
      if (',;:'.includes(rest[i]) && /\s/.test(rest[i + 1] ?? '')) { cut = i + 1; break; }
    }
    if (cut < 0) {
      const space = rest.lastIndexOf(' ', max);
      cut = space > 0 ? space : max;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  out.push(rest);
  return out;
}

/**
 * The sentences of `text`, each with its closing punctuation. A sentence ends at . ! ? and at a line break, not at
 * the period of a common abbreviation or inside a decimal. None is longer than `maxChars` and none is empty.
 */
export function splitSentences(text: string, maxChars: number = DEFAULT_MAX): string[] {
  const max = Math.max(1, Math.floor(Number.isFinite(maxChars) ? maxChars : DEFAULT_MAX));
  return text
    .split(/[\r\n]+/)
    .flatMap(splitLine)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s !== '')
    .flatMap((s) => splitLong(s, max))
    .filter((s) => s !== '');
}
