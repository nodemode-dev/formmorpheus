// Words that are painted on a canvas (the page translator cannot reach them): looked up through t() at draw time,
// and an epoch that moves with the language so anything that caches a drawn word can tell it is stale.

import { t, onLanguage } from './i18n';

let epoch = 0;
const hooks = new Set<() => void>();
onLanguage(() => { epoch++; for (const fn of hooks) fn(); });

/** Changes whenever the language does; include it in the key of any cache of drawn words. */
export const wordsEpoch = (): number => epoch;

/** Calls `redraw` after each language change; returns the way to stop. */
export function redrawOnLanguage(redraw: () => void): () => void {
  hooks.add(redraw);
  return () => { hooks.delete(redraw); };
}

/** A canvas word in the current language. */
export const word = (english: string): string => t(english);

const KIND_WORDS = new Set(['Drawing', 'Flipbook', 'Image', 'Video', 'Audio', 'Text', 'Group']);

/** A block's name: the default names (the kind) follow the language, a name the person typed stays as typed. */
export const contentName = (name: string): string => (KIND_WORDS.has(name) ? t(name) : name);

/** "{n}s" on the Timeline ruler: seconds, with the language's own unit. */
export const secondsLabel = (n: number): string => t('{n}s').replace('{n}', String(n));
