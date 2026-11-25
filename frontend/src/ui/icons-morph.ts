import { ICONS } from './icons';
import { PERSON_D } from './character-glyph';

const S = (body: string, extra = ''): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>`;

const MORPH: Record<string, string> = {
  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>`,
  theater: S('<rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M8 20h8"/><path d="M10.5 9.2v4.6l4-2.3z" fill="currentColor"/>'),
  multiSelect: S('<path d="M7.5 5.5c4-2 11 0 11.5 4.5.4 3.6-4 6-8.5 6-4.4 0-7.6-2-7.5-4.8.1-2.1 1.8-3.8 4.5-5.7z" stroke-dasharray="2.4 2.4"/><path d="M9 16l-1.5 4.5"/>'),
  compose: S('<rect x="3.5" y="5" width="11" height="5" rx="1.6"/><rect x="9.5" y="14" width="11" height="5" rx="1.6"/><path d="M17.5 7.5h3M3.5 16.5h3"/>'),
  perform: S('<path d="M9 11.5V5.8a1.6 1.6 0 0 1 3.2 0v5.2"/><path d="M12.2 10.6V9.2a1.6 1.6 0 0 1 3.2 0v2"/><path d="M15.4 10.4a1.6 1.6 0 0 1 3.2 0v3.4c0 3.6-2.6 6.4-6.2 6.4h-.8c-2 0-3.3-.8-4.4-2.4l-2.4-3.6a1.5 1.5 0 0 1 2.4-1.8L9 14"/>'),
  keyframe: S('<path d="M12 3.5l5 8.5-5 8.5-5-8.5z"/><path d="M4 7l-2 5 2 5M20 7l2 5-2 5"/>'),
  flipbook: S('<rect x="4" y="6" width="12" height="14" rx="2"/><path d="M8 3.5h9.5A2.5 2.5 0 0 1 20 6v10.5"/><path d="M8 13h4"/>'),
  drawing: S('<path d="M15.5 4.5l4 4L9 19l-5 1 1-5z"/><path d="M13 7l4 4"/>'),
  text: S('<path d="M5 6.5V5h14v1.5"/><path d="M12 5v14M9 19h6"/>'),
  video: S('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/>'),
  audio: S('<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>'),
  group: S('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><rect x="7" y="7" width="6" height="5" rx="1"/><rect x="11" y="12.5" width="6" height="5" rx="1"/>'),
  track: S('<rect x="3" y="7" width="18" height="10" rx="2.5"/><path d="M7 7v10"/>'),
  character: S(`<path d="${PERSON_D}"/>`),
  cut: S('<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.3 15.7L18 4M15.7 15.7L6 4"/>'),
  copy: S('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
  paste: S('<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3.5h6V5"/><path d="M9 11h6M9 15h4"/>'),
  rename: S('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  highlight: S('<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>'),
  split: S('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M12 5v14"/>'),
  duplicateAfter: S('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M12 9v6M9 12h6"/>'),
  fillDuration: S('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M8 12h8M13 9l3 3-3 3"/>'),
  convert: S('<path d="M4 6v12"/><path d="M8 6v12"/><rect x="11" y="6" width="9" height="12" rx="2"/><path d="M14 10l3 2-3 2z" fill="currentColor"/>'),
  trash: S('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/>'),
  blendN: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 18V6h2.2l5.6 8.2V6H17v12h-2.2L9.2 9.8V18z"/></svg>`,
  record: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>`,
  clapper: S('<rect x="3.5" y="9" width="17" height="11" rx="2"/><path d="M3.5 9l1.6-4.6 15.4 2.4L20.5 9"/><path d="M8.8 4.9l-.9 4.1M14.1 5.7l-.9 3.3"/>'),
  stepBack: S('<path d="M15 6l-6 6 6 6"/>'),
  stepForward: S('<path d="M9 6l6 6-6 6"/>'),
  movieSettings: S('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  showAll: S('<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  hideAll: S('<path d="M4 4l16 16"/><path d="M9.6 6c.8-.3 1.6-.5 2.4-.5 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.7 3.6M6.5 7.7A16 16 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.4 0 2.6-.3 3.7-.8"/>'),
  removeGap: S('<path d="M4 6v12M20 6v12"/><path d="M8 12h8M10.5 9.5L8 12l2.5 2.5M13.5 9.5L16 12l-2.5 2.5"/>'),
  ungroup: S('<rect x="3.5" y="3.5" width="8" height="7" rx="1.5"/><rect x="12.5" y="13.5" width="8" height="7" rx="1.5"/><path d="M15 5h3.5A2 2 0 0 1 20.5 7v3M9 20.5H5.5a2 2 0 0 1-2-2V15" stroke-dasharray="2 2"/>'),
};

for (const [k, v] of Object.entries(MORPH)) ICONS[k] = v;

export const MORPH_ICONS = Object.keys(MORPH);
