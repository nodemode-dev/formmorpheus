// Timeline drawing and hit testing for sound blocks: the fade wedges and their handles, and the gain the waveform
// is drawn with, so the picture shows the sound as it will be heard (level, level keys, fades).
import { animate } from '../engine/keys';
import type { Content } from '../engine/types';
import { fadeGain } from '../media/audio-edit';

/** Inset of a fade handle from the block's edge, so it never sits on the trim grip. */
export const HANDLE_INSET = 11;
const HANDLE_R = 4;

/** Level the waveform is scaled by at a local frame of a sound block (level lane included, fades applied). */
export function waveGain(item: Content, local: number): number {
  return Math.max(0, animate(item, Math.max(0, local)).volume) * fadeGain(item, local);
}

/**
 * Draws the fade wedges of a sound block and, when it is selected, the two handles that drag them.
 * `x0`, `y`, `w`, `h` are the block's box; `ppf` pixels per frame.
 */
export function drawSoundOverlay(c: CanvasRenderingContext2D, item: Content, x0: number, y: number, w: number, h: number, ppf: number, selected: boolean, wedge: string, handle: string): void {
  const fi = (item.fadeIn ?? 0) * ppf;
  const fo = (item.fadeOut ?? 0) * ppf;
  c.save();
  c.fillStyle = wedge;
  c.strokeStyle = handle;
  c.lineWidth = 1;
  if (fi > 0.5) {
    c.beginPath();
    c.moveTo(x0, y);
    c.lineTo(x0 + fi, y);
    c.lineTo(x0, y + h);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(x0, y + h);
    c.lineTo(x0 + fi, y);
    c.stroke();
  }
  if (fo > 0.5) {
    c.beginPath();
    c.moveTo(x0 + w, y);
    c.lineTo(x0 + w - fo, y);
    c.lineTo(x0 + w, y + h);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(x0 + w, y + h);
    c.lineTo(x0 + w - fo, y);
    c.stroke();
  }
  if (selected && w > 60) {
    c.fillStyle = handle;
    c.strokeStyle = 'rgba(0,0,0,.55)';
    for (const x of [x0 + HANDLE_INSET + fi, x0 + w - HANDLE_INSET - fo]) {
      c.beginPath();
      c.arc(x, y + h - 9, HANDLE_R, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }
  c.restore();
}

/** Which fade handle of a selected sound block is under the pointer: `px` from the block's left edge, `py` from its top. */
export function fadeHandleAt(item: Content, px: number, py: number, w: number, h: number, ppf: number, grip: number): 'in' | 'out' | null {
  if (item.kind !== 'audio' || w <= 60) return null;
  if (Math.abs(py - (h - 9)) > grip) return null;
  const inX = HANDLE_INSET + (item.fadeIn ?? 0) * ppf;
  const outX = w - HANDLE_INSET - (item.fadeOut ?? 0) * ppf;
  const di = Math.abs(px - inX), dout = Math.abs(px - outX);
  if (di <= grip && di <= dout) return 'in';
  if (dout <= grip) return 'out';
  return null;
}

/** Fade length in frames that puts the handle at pointer offset `px` from the block's left edge (or its right edge for 'out'). */
export function fadeFramesFor(which: 'in' | 'out', px: number, w: number, ppf: number): number {
  const d = which === 'in' ? px - HANDLE_INSET : w - HANDLE_INSET - px;
  return Math.max(0, Math.round(d / ppf));
}
