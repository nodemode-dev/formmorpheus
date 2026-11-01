// Filled 24 px glyphs for the two top-bar tools whose shared icons are outlines, so the whole tool row reads as one
// filled set. Drawn in currentColor.

const wrap = (body: string): string => `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">${body}</svg>`;

export const PAINT_ICONS = {
  eyedropper: wrap('<path d="M20.7 5.6 18.4 3.3a1 1 0 0 0-1.4 0l-3.1 3.1-1.9-1.9-1.4 1.4 1.4 1.4L3 16.3V21h4.8l8.9-8.9 1.4 1.4 1.4-1.4-1.9-1.9 3.1-3.1a1 1 0 0 0 0-1.5zM6.9 19 5 17.1 13.1 9 15 10.9 6.9 19z"/>'),
  bucket: wrap('<path d="M16.6 8.9 7.6 0 6.2 1.4l2.4 2.4-5.2 5.2c-.6.6-.6 1.5 0 2.1l5.5 5.5c.3.3.7.4 1.1.4s.8-.1 1.1-.4l5.5-5.5c.6-.6.6-1.5 0-2.1zM5.2 10 10 5.2l4.8 4.8H5.2zM19 11.5s-2 2.2-2 3.5a2 2 0 0 0 4 0c0-1.3-2-3.5-2-3.5z"/><path d="M3 20h18v2.5H3z"/>'),
};
