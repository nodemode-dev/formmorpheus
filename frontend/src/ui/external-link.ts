// Web addresses the Help Center points to, opened in the system browser (never inside the app window).

/** The app's page on the family site: the one web address Help opens. The handbook is the manual bundled in the app. */
export const SITE_URL = 'https://formai.studio/formmorpheus/';

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
