// "Preview sounds before import": on by default, as the reference opens Preview Sound for every sound. Turned off, the
// duration rule of ui/import-preview.ts is what is left: only a sound of a minute or more still asks first.
const KEY = 'fm.previewSounds';
let on = true;
try { on = localStorage.getItem(KEY) !== '0'; } catch { /* storage blocked: stays on */ }

export const previewSounds = {
  get on(): boolean { return on; },
  set(next: boolean): void {
    on = next;
    try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* not kept */ }
  },
};
