// Adapter parts that behave the same on the desktop and on iPad.
import type { CapabilitiesAdapter, ClipboardAdapter, PickOptions } from './types';

/** The browser's own file chooser, through a hidden input. On iPad this is the system sheet with Files and Photos. */
export function pickWithInput(opts: PickOptions = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    if (opts.accept) input.accept = opts.accept;
    input.multiple = opts.multiple === true;
    const done = (files: File[]): void => { input.remove(); resolve(files); };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

/** The same calls the interface made directly before the platform layer existed. */
export const clipboard: ClipboardAdapter = {
  async writeText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  },
  async readText() {
    try { return (await navigator.clipboard.readText()) ?? ''; } catch { return ''; }
  },
  async writeImage(png) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); return true; } catch { return false; }
  },
  async readImage() {
    try {
      if (!navigator.clipboard?.read) return null;
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((x) => x.startsWith('image/'));
        if (type) return await item.getType(type);
      }
    } catch { /* clipboard refused */ }
    return null;
  },
};

/** The engine's own report, asked through io/api (loaded when first needed, since io/api itself uses the platform). */
export const capabilities: CapabilitiesAdapter = {
  async engine() { return (await import('../io/api')).capabilities(); },
  async jobs() { return (await import('../export/engine-jobs')).jobCapabilities(); },
};

/** Saves a blob through an anchor with the download attribute: the desktop's way, and the fallback anywhere. */
export function anchorDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
