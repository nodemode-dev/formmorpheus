// J, K and L shuttle: J runs backward, L forward (press again to double the speed up to 4x), K stops.
// The engine's own playback only runs forward at one speed, so the shuttle steps the Playhead by the clock itself.
import type { Engine } from '../engine/engine';
import type { Command } from '../ui/commands';
import { toast } from '../ui/toast';
import { tf } from '../ui/i18n-fill';

const MAX_RATE = 4;

export function shuttleCommands(engine: Engine): Command[] {
  const has = (): boolean => !!engine.movie;
  let rate = 0, raf = 0, last = 0, pos = 0, shown = -1;

  const halt = (): void => {
    rate = 0;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    shown = -1;
  };

  const tick = (now: number): void => {
    raf = 0;
    const m = engine.movie;
    // something else moved the Playhead (a scrub, a click): the shuttle lets go
    if (!m || !rate || engine.playing || (shown >= 0 && Math.abs(engine.frame - shown) > 1)) { halt(); return; }
    pos += rate * m.fps * ((now - last) / 1000);
    last = now;
    const f = Math.max(0, Math.min(m.duration - 1, Math.round(pos)));
    if (f !== engine.frame) { shown = f; engine.seek(f); }
    if ((rate > 0 && f >= m.duration - 1) || (rate < 0 && f <= 0)) { halt(); return; }
    raf = requestAnimationFrame(tick);
  };

  const go = (dir: 1 | -1): void => {
    const m = engine.movie;
    if (!m) return;
    engine.stop();
    rate = Math.sign(rate) === dir ? Math.min(MAX_RATE, Math.abs(rate) * 2) * dir : dir;
    pos = engine.frame;
    shown = engine.frame;
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(tick);
    toast(dir > 0 ? tf('Forward {n}x', { n: Math.abs(rate) }) : tf('Back {n}x', { n: Math.abs(rate) }), 'info', { ms: 900 });
  };

  engine.on('playing', (on) => { if (on) halt(); });

  // J, K and L are bare keys another command may also use (K adds a key, L opens the layers panel in Draw & Paint), so the shuttle
  // answers them only on the Timeline side: never in a text field, never with a modifier, never while Draw & Paint is open, and K only while shuttling.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || !engine.movie) return;
    const key = e.key.toLowerCase();
    if (key !== 'j' && key !== 'k' && key !== 'l') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.querySelector('.fm-paint:not([hidden])')) return;
    if (key === 'k') { if (!rate) return; halt(); }
    else go(key === 'l' ? 1 : -1);
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  return [
    { id: 'shuttle-back', label: 'Shuttle Back (J)', enabled: has, run: () => go(-1) },
    { id: 'shuttle-pause', label: 'Shuttle Stop (K)', enabled: () => has() && rate !== 0, run: halt },
    { id: 'shuttle-forward', label: 'Shuttle Forward (L)', enabled: has, run: () => go(1) },
  ];
}
