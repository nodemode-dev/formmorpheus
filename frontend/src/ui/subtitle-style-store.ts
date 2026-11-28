// The subtitle style a person last chose, kept between sessions so the first lines of a new movie (typed, heard, or
// made with a generated voice) come in that look. A movie that already has lines keeps its own.
import { SUBTITLE_DEFAULTS, type SubtitleStyle } from '../engine/subtitles';
import { styleFromControls } from './speech-logic';

const STORE = 'formmorpheus.subtitles.style';

export function loadSubtitleStyle(): SubtitleStyle {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Record<keyof SubtitleStyle, unknown>>;
    return styleFromControls({
      font: typeof raw.font === 'string' ? raw.font : '',
      size: String(raw.size ?? ''),
      position: String(raw.position ?? ''),
      color: typeof raw.color === 'string' ? raw.color : '',
      band: typeof raw.band === 'boolean' ? raw.band : SUBTITLE_DEFAULTS.band,
    });
  } catch { return { ...SUBTITLE_DEFAULTS }; }
}

export function saveSubtitleStyle(style: SubtitleStyle): void {
  try { localStorage.setItem(STORE, JSON.stringify(style)); } catch { /* kept for this session only */ }
}
