// A small numeric field that opens right at a key in an expanded lane row: tap the key, type the value, Enter keeps it.
// Built once, then patched in place; the card on the pill stays for the collapsed lanes.
import type { Engine } from '../engine/engine';
import { fitBase, isScaleChannel } from '../engine/fit-base';
import { channelSpec, laneOf, shownOf, storedOf } from '../engine/keys';
import * as keyOps from '../engine/key-ops';
import * as ops from '../engine/ops';
import type { KeyKind } from '../engine/types';
import { el, q, setHidden, setText } from './dom';
import { t as tt } from './i18n';
import '../styles/key-inline.css';

class KeyField {
  private readonly root = el('<div class="fm-keyfield" hidden><span class="fm-keyfield-l"></span><input class="fm-keyfield-i" type="text" inputmode="decimal" spellcheck="false"><span class="fm-keyfield-u"></span></div>');
  private readonly label = q(this.root, '.fm-keyfield-l');
  private readonly input = q<HTMLInputElement>(this.root, '.fm-keyfield-i');
  private readonly unit = q(this.root, '.fm-keyfield-u');
  private mounted = false;
  private commit: ((n: number) => void) | null = null;

  constructor() {
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.close(true); } else if (e.key === 'Escape') { e.preventDefault(); this.close(false); }
    });
    this.input.addEventListener('blur', () => this.close(true));
  }

  get isOpen(): boolean { return !this.root.hidden; }

  open(x: number, y: number, label: string, unit: string, text: string, commit: (n: number) => void): void {
    if (!this.mounted) { (document.getElementById('overlay-root') ?? document.body).appendChild(this.root); this.mounted = true; }
    this.commit = commit;
    setText(this.label, label);
    setText(this.unit, unit);
    this.input.value = text;
    setHidden(this.root, false);
    const w = this.root.getBoundingClientRect().width || 150;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
    this.root.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(8, y - 44))}px)`;
    this.input.focus();
    this.input.select();
  }

  private close(keep: boolean): void {
    if (this.root.hidden) return;
    const fn = this.commit;
    this.commit = null;
    setHidden(this.root, true);
    if (!keep || !fn) return;
    const n = parseFloat(this.input.value.replace(/[^0-9eE+.\-]/g, ''));
    if (Number.isFinite(n)) fn(n);
  }

  hide(): void { this.close(false); }
}

const field = new KeyField();

/** Open the numeric field for the key of `channel` at content-local `frame`; (x, y) is where the key sits on screen. */
export function openKeyField(engine: Engine, id: string, kind: KeyKind, channel: string, frame: number, x: number, y: number): boolean {
  const m = engine.movie;
  const c = engine.selected.find((it) => it.id === id);
  if (!m || !c) return false;
  const lane = laneOf(c, kind), ch = channelSpec(kind, channel);
  const key = lane?.channels[channel]?.find((k) => k.frame === frame);
  if (!lane || !ch || !key) return false;
  const base = isScaleChannel(channel) ? fitBase(m, c) : 1;
  const shown = Math.round(shownOf(ch, key.value, base) * 100) / 100;
  const u = ch.unit === 'deg' ? '°' : ch.unit === 'px' ? 'px' : ch.unit === '%' ? '%' : ch.unit === 'x' ? 'x' : '';
  field.open(x, y, tt(ch.label), u, String(shown), (n) => {
    const v = Math.min(ch.max, Math.max(ch.min, storedOf(ch, n, base)));
    if (v === key.value) return;
    engine.run('Edit Keyframe', (mv) => ops.updateContent(mv, id, (cc) => keyOps.setKeys(cc, kind, frame, { [channel]: v })));
  });
  return true;
}

export function hideKeyField(): void { field.hide(); }
