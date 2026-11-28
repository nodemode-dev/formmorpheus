// The manual's pictures (docs/img/*.webp, bundled at build time) for the Help window. A picture's box has its size
// before the picture arrives, so the text under it never moves.
const urls = import.meta.glob('../../../docs/img/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const SIZE: Record<string, readonly [number, number]> = {
  'ai-voice-card': [1440, 900],
  'build-panel-camera': [1440, 708],
  'build-panel-characters': [1440, 708],
  'build-panel-depth': [1440, 708],
  'build-panel-effects': [1440, 708],
  'build-panel-props': [1440, 708],
  'build-panel-scenes': [1440, 708],
  'character-builder-views': [1440, 900],
  'character-views': [1040, 590],
  'demo-camera-push-in': [720, 405],
  'demo-snow': [720, 405],
  'demo-walk-in': [720, 405],
  'export-card': [1440, 900],
  'home-theater': [1440, 900],
  'save-as-scene': [1440, 900],
  'scene-strip': [1440, 900],
  'subtitles-card': [1440, 900],
  'timeline-top-row': [1440, 100],
  'walk-to-here': [1440, 900],
  'window-overview': [1440, 900],
};

const nameOf = (path: string): string => path.replace(/^.*\//, '').replace(/\.webp$/, '');
const byName = new Map<string, string>(Object.entries(urls).map(([path, url]) => [nameOf(path), url]));

/** A manual line that is one picture, `![what it shows](img/name.webp)`: its parts, or null for any other line. */
export function pictureLine(line: string): { alt: string; name: string } | null {
  const m = /^\s*!\[([^\]]*)\]\(img\/([^)\s]+)\.webp\)\s*$/.exec(line);
  return m ? { alt: m[1], name: m[2] } : null;
}

/** The picture as a figure with its sentence under it; null when the build holds no such picture. */
export function figure(name: string, alt: string): HTMLElement | null {
  const url = byName.get(name);
  if (!url) return null;
  const [w, h] = SIZE[name] ?? [1440, 900];
  const fig = document.createElement('figure');
  fig.className = 'fm-help-fig';
  const img = document.createElement('img');
  img.className = 'fm-help-img';
  img.width = w;
  img.height = h;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = alt;
  img.src = url;
  const cap = document.createElement('figcaption');
  cap.className = 'fm-help-cap';
  cap.textContent = alt;
  fig.append(img, cap);
  return fig;
}
