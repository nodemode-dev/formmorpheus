// A translated sentence with its {name} placeholders filled in one pass, so a value that itself holds braces is never
// read as another placeholder. The sentence is looked up whole; values are inserted after, never joined before.

import { t } from './i18n';

export type FillVars = Record<string, string | number>;

/** `t(english)` with each `{name}` replaced by `vars.name`. A placeholder with no value stays as written. */
export function tf(english: string, vars: FillVars = {}): string {
  return t(english).replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}
