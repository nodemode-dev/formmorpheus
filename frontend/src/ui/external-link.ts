// Web addresses the Help Center points to, opened in the system browser (never inside the app window).

const SITE = 'https://github.com/nodemode-ai/formmorpheus';

/** The handbook, the community and the tutorial videos. One place, so a project site can replace them later. */
export const HELP_LINKS = {
  handbook: `${SITE}/wiki`,
  community: `${SITE}/discussions`,
  tutorials: `${SITE}/wiki/Getting-Started`,
  education: `${SITE}/wiki/Home`,
  ideas: `${SITE}/issues`,
} as const;

export function openExternal(url: string): void {
  let ok = false;
  try { const u = new URL(url); ok = u.protocol === 'https:' && !u.username && !u.password && !!u.hostname; } catch { /* not a web address */ }
  if (!ok) return;
  if ('__TAURI_INTERNALS__' in window) {
    void import('@tauri-apps/api/core').then((m) => m.invoke('plugin:shell|open', { path: url })).catch(() => { window.open(url, '_blank', 'noopener'); });
    return;
  }
  window.open(url, '_blank', 'noopener');
}
