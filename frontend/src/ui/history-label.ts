import { t } from './i18n';

// History labels are made in code as "<verb> <name>" ("Add photo", "Clear Position"). A whole label has an entry of its
// own only when it is fixed text; for the composed ones the verb part is translated through a pattern key and the name
// goes in as typed (kind names are labels of the app, so those are translated too).
const PATTERNS: Array<{ re: RegExp; key: string; kind: boolean }> = [
  { re: /^Add (\d+) files$/, key: 'Add {n} files', kind: false },
  { re: /^Add (.+) keyframe$/, key: 'Add {name} keyframe', kind: true },
  { re: /^Clear (.+)$/, key: 'Clear {name}', kind: true },
  { re: /^Delete (.+)$/, key: 'Delete {name}', kind: true },
  { re: /^(.+) performance$/, key: '{name} performance', kind: true },
  { re: /^(.+) keyframe$/, key: '{name} keyframe', kind: true },
  { re: /^(.+) option$/, key: '{name} option', kind: true },
  { re: /^Add (.+)$/, key: 'Add {name}', kind: false },
];

/** An undo or redo history label in the current language. */
export function historyLabel(label: string): string {
  if (!label) return label;
  const whole = t(label);
  if (whole !== label) return whole;
  for (const p of PATTERNS) {
    const m = p.re.exec(label);
    if (!m) continue;
    const form = t(p.key);
    if (form === p.key) return label;
    const arg = p.key.includes('{n}') ? m[1] : p.kind ? t(m[1]) : m[1];
    return form.replace('{n}', arg).replace('{name}', arg);
  }
  return label;
}
