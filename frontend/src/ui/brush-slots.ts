// The four remembered size and opacity values of a brush, shown as small markers on the sidebar sliders.
// Click a marker to recall its value; hold it (or Shift or Alt click) to store the current value there.
// Slots are kept per tool and per brush, starting from the brush's own presets.

import { setClass, setStyleVar, setTitle } from './dom';
import { t } from './i18n';

// v0.17.0: markers start empty and the person adds them; the key changed so the old pre-seeded values are not read back.
const KEY = 'formmorpheus.paint.slots2';
const HOLD_MS = 520;

export type SlotKind = 'size' | 'opacity';
type Slot = { size: number | null; opacity: number | null };

export interface SlotHost {
  /** `tool:brush`, the identity the slots belong to. */
  key(): string;
  /** The brush's own presets (the slots until the person stores one). */
  defaults(): Slot[];
  current(): { size: number; opacity: number };
  recall(kind: SlotKind, value: number): void;
  say(text: string): void;
}

function read(): Record<string, Slot[]> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function write(v: Record<string, Slot[]>): void {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* this session only */ }
}

export class BrushSlots {
  private saved: Record<string, Slot[]> = read();
  private readonly cursor = new Map<string, number>();
  private readonly markers: Record<SlotKind, HTMLButtonElement[]> = { size: [], opacity: [] };

  constructor(private readonly sliders: Record<SlotKind, HTMLElement>, private readonly host: SlotHost) {
    for (const kind of ['size', 'opacity'] as SlotKind[]) {
      for (let i = 0; i < 4; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'fm-paint-slot';
        b.dataset.i = String(i);
        b.tabIndex = -1;
        this.bind(b, kind, i);
        sliders[kind].appendChild(b);
        this.markers[kind].push(b);
      }
    }
  }

  /** The four slots for the current tool and brush. */
  slots(): Slot[] {
    const have = this.saved[this.host.key()];
    return Array.from({ length: 4 }, (_, i) => ({ size: have?.[i]?.size ?? null, opacity: have?.[i]?.opacity ?? null }));
  }

  store(kind: SlotKind, i: number): void {
    const key = this.host.key();
    const next = this.slots();
    const v = this.host.current()[kind];
    next[i] = { ...next[i], [kind]: v };
    this.saved[key] = next;
    write(this.saved);
    this.sync();
    this.host.say(t(kind === 'size' ? 'Size {p}% stored in slot {n}' : 'Opacity {p}% stored in slot {n}').replace('{p}', String(Math.round(v * 100))).replace('{n}', String(i + 1)));
  }

  /** The preview bubble's "+": stores the current value in the next marker, round and round (a marker that already holds it is kept). */
  storeNext(kind: SlotKind): void {
    const slots = this.slots();
    const cur = this.host.current()[kind];
    const same = slots.findIndex((s) => s[kind] !== null && Math.abs((s[kind] as number) - cur) < 0.012);
    if (same >= 0) { this.host.say(t('Already stored in slot {n}').replace('{n}', String(same + 1))); return; }
    const free = slots.findIndex((s) => s[kind] === null);
    if (free >= 0) { this.store(kind, free); return; }
    const key = `${this.host.key()}:${kind}`;
    const i = (this.cursor.get(key) ?? -1) + 1;
    this.cursor.set(key, i % 4);
    this.store(kind, i % 4);
  }

  /** The preview bubble's "-": puts the marker that holds the current value back to the brush's own preset. */
  clearAt(kind: SlotKind): void {
    const slots = this.slots();
    const cur = this.host.current()[kind];
    const at = slots.findIndex((s) => s[kind] !== null && Math.abs((s[kind] as number) - cur) < 0.012);
    if (at < 0) { this.host.say(t('No marker at this value')); return; }
    const next = slots.map((s) => ({ ...s }));
    next[at] = { ...next[at], [kind]: null };
    this.saved[this.host.key()] = next;
    write(this.saved);
    this.sync();
    this.host.say(t('Marker {n} reset').replace('{n}', String(at + 1)));
  }

  /** Jump to the next (dir 1) or previous (dir -1) remembered value, wrapping round the ends. */
  step(kind: SlotKind, dir: 1 | -1): void {
    const cur = this.host.current()[kind];
    const vals = [...new Set(this.slots().map((s) => s[kind]).filter((v): v is number => v !== null))].sort((a, b) => a - b);
    if (!vals.length) { this.host.say(t('No marker at this value')); return; }
    const pick = dir > 0 ? vals.find((v) => v > cur + 0.005) ?? vals[0] : [...vals].reverse().find((v) => v < cur - 0.005) ?? vals[vals.length - 1];
    this.host.recall(kind, pick);
    this.host.say(`${kind === 'size' ? t('Size') : t('Opacity')} ${Math.round(pick * 100)}%`);
  }

  /** Positions the markers and lights the one that matches the slider. Patches in place. */
  sync(): void {
    const slots = this.slots();
    const cur = this.host.current();
    for (const kind of ['size', 'opacity'] as SlotKind[]) {
      this.markers[kind].forEach((m, i) => {
        const v = slots[i][kind];
        setClass(m, 'is-empty', v === null);
        if (v === null) return;
        setStyleVar(m, '--m', String(Math.max(0, Math.min(1, v))));
        setClass(m, 'is-at', Math.abs(v - cur[kind]) < 0.012);
        setTitle(m, t(kind === 'size' ? 'Slot {n}: {p}%. Click to recall, hold to store the current size.' : 'Slot {n}: {p}%. Click to recall, hold to store the current opacity.').replace('{n}', String(i + 1)).replace('{p}', String(Math.round(v * 100))));
      });
    }
  }

  private bind(b: HTMLButtonElement, kind: SlotKind, i: number): void {
    let timer = 0;
    let held = false;
    let id = -1;
    const clear = (): void => { if (timer) { clearTimeout(timer); timer = 0; } };
    b.addEventListener('pointerdown', (e) => {
      // the slider under the marker must not take this press as a drag
      e.stopPropagation();
      e.preventDefault();
      id = e.pointerId;
      held = false;
      clear();
      timer = window.setTimeout(() => { timer = 0; held = true; this.store(kind, i); }, HOLD_MS);
    });
    b.addEventListener('pointerup', (e) => {
      if (e.pointerId !== id) return;
      e.stopPropagation();
      id = -1;
      clear();
      if (held) return;
      if (e.shiftKey || e.altKey) { this.store(kind, i); return; }
      const v = this.slots()[i][kind];
      if (v === null) return;
      this.host.recall(kind, v);
      this.host.say(`${kind === 'size' ? t('Size') : t('Opacity')} ${Math.round(v * 100)}%`);
    });
    b.addEventListener('pointercancel', () => { id = -1; clear(); });
    b.addEventListener('pointerleave', clear);
  }
}
