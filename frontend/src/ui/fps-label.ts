import { FPS_PRESETS, type FpsPreset } from '../engine/time';
import { onLanguage, t } from './i18n';

/** "24 · Cinema" with the preset name in the app language (PAL and NTSC have no table entry and stay as they are). */
export const fpsText = (p: FpsPreset): string => `${p.fps} · ${t(p.label)}`;

/** Keeps a frame-rate select's preset options in the app language; the page translator cannot read "24 · Cinema" as one phrase. */
export function followLanguage(sel: HTMLSelectElement): void {
  onLanguage(() => {
    for (const p of FPS_PRESETS) {
      const o = Array.from(sel.options).find((x) => x.value === String(p.fps));
      const next = fpsText(p);
      if (o && o.textContent !== next) o.textContent = next;
    }
  });
}
