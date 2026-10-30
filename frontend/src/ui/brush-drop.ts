// A brush file dropped anywhere on the window (the Stage, the Timeline or the Draw & Paint canvas) is imported
// into the Imported set. It runs in the capture phase so the shell's own picture import never sees it.

import { importBrushFile } from '../io/brush-import';
import { brushStore } from './brush-store';
import { t, tn } from './i18n';
import { toast } from './toast';

const BRUSH_FILE = /\.(abr|brush|brushset|brushlib)$/i;
let wired = false;

function hasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
}

/** True when every dropped file is a brush file. Some browsers hide names while dragging, so `dragover` only checks for files. */
function allBrushFiles(files: File[]): boolean {
  return files.length > 0 && files.every((f) => BRUSH_FILE.test(f.name));
}

export async function importBrushFiles(files: File[]): Promise<void> {
  let added = 0, failed = 0, last = '';
  for (const f of files) {
    try {
      const r = await importBrushFile(f);
      if (r.sets && r.sets.length) { brushStore.addImportedLibrary(r.libName ?? f.name.replace(/\.[^.]+$/, ''), r.sets); added += r.brushes.length; }
      else if (r.brushes.length) { brushStore.addImported(r.brushes); added += r.brushes.length; } else failed++;
    } catch (e) { failed++; last = e instanceof Error ? e.message : ''; }
  }
  if (added) toast(tn(added, 'Imported {n} brush', 'Imported {n} brushes') + (failed ? `, ${tn(failed, '{n} skipped', '{n} skipped')}` : ''));
  else toast(last || t('No brushes found in that file'), 'error');
}

export function wireBrushDrop(): void {
  if (wired) return;
  wired = true;
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!allBrushFiles(files)) return;
    // the Brushes panel has its own drop route
    if (e.target instanceof Element && e.target.closest('.fm-bp')) return;
    // preventDefault marks it handled: the shell's drop handler resets its overlay and skips the picture import
    e.preventDefault();
    void importBrushFiles(files);
  }, true);
}
