// "Preview sounds before import": off by default, so a sound goes straight onto the Timeline. The one rule is by duration
// (ui/import-preview.ts): a sound of a minute or more still asks first; turning this on asks for every sound.
const KEY = 'fm.previewSounds';
let on = false;
try { on = localStorage.getItem(KEY) === '1'; } catch { /* storage blocked: off */ }

export const previewSounds = {
  get on(): boolean { return on; },
  set(next: boolean): void {
    on = next;
    try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* not kept */ }
  },
};
