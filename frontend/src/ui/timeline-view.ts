// Per-movie Timeline view (zoom, scroll, track height), kept in the browser so a reopened movie looks as it was left.
export interface SavedView { ppf: number; start: number; row: number; fit: boolean }

const key = (id: string): string => `fm.tl.view.${id}`;

export function loadView(id: string): SavedView | null {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedView>;
    if (typeof v.ppf !== 'number' || typeof v.start !== 'number' || typeof v.row !== 'number') return null;
    return { ppf: v.ppf, start: v.start, row: v.row, fit: !!v.fit };
  } catch { return null; }
}

export function saveView(id: string, v: SavedView): void {
  try { localStorage.setItem(key(id), JSON.stringify(v)); } catch { /* not kept */ }
}
