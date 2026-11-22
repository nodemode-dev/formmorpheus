import { t } from '../ui/i18n';

/** What the interface cannot start without. Checked before the app is loaded, so a web component that lacks one gets a
 *  plain message instead of a half-built window. Each entry is a whole English sentence, translated at show time. */
const CHECKS: ReadonlyArray<readonly [() => boolean, string]> = [
  [() => {
    try {
      return typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(1, 1).getContext('2d');
    } catch { return false; }
  }, 'This system\'s web component cannot draw on offscreen surfaces.'],
  [() => typeof createImageBitmap === 'function', 'This system\'s web component cannot decode pictures in the background.'],
  [() => typeof Worker !== 'undefined', 'This system\'s web component cannot run background workers.'],
  [() => typeof AudioContext !== 'undefined', 'This system\'s web component has no sound engine.'],
  [() => {
    try {
      return typeof CSS !== 'undefined' && CSS.supports('selector(:has(*))') && CSS.supports('color', 'color-mix(in srgb, red 50%, blue)');
    } catch { return false; }
  }, 'This system\'s web component is too old to draw the interface styles.'],
];

/** The sentences for every missing piece; empty when the web component has everything. */
export function missingCapabilities(): string[] {
  const out: string[] = [];
  for (const [ok, sentence] of CHECKS) {
    let good = false;
    try { good = ok(); } catch { good = false; }
    if (!good) out.push(sentence);
  }
  return out;
}

/** Shows the one message, built once. Colors and type come from the tokens. */
export const KEY_TAKEN = 'This engine already gave its window key to another window or tab. Close that one, or start the engine again, then reload this page.';

export function showUnsupported(missing: string[], title = 'formmorpheus cannot start on this system.', system = true): void {
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'position:fixed;inset:0;z-index:var(--z-overlay);display:flex;align-items:center;justify-content:center;padding:var(--space-8);box-sizing:border-box;background:var(--bg-primary);color:var(--text-primary);font-family:var(--font-ui);text-align:center;';
  const inner = document.createElement('div');
  inner.style.cssText = 'max-width:520px;display:flex;flex-direction:column;gap:var(--space-3);line-height:1.5;';
  const head = document.createElement('div');
  head.style.cssText = 'font-size:18px;font-weight:600;';
  head.textContent = t(title);
  const lines = document.createElement('div');
  lines.style.cssText = 'color:var(--text-secondary);font-size:14px;';
  lines.textContent = missing.map((s) => t(s)).join(' ');
  const need = document.createElement('div');
  need.style.cssText = 'color:var(--text-secondary);font-size:14px;';
  need.textContent = t('formmorpheus needs macOS 13 or later with its built-in browser engine, Windows 10 or 11 with the system web runtime installed, or Linux with a system web component from version 2.46 on.');
  inner.append(head, lines);
  if (system) inner.append(need);
  box.append(inner);
  document.body.append(box);
}
