// Camera mode extras on the Stage: Shake (amount, speed, a new pattern) and Depth for the selected track
// (parallax: how far the camera's pan and zoom move that layer). Built once, patched on each change.
import type { Engine } from '../engine/engine';
import { setCameraFollow, setCameraShake, setTrackDepth } from '../engine/camera';
import { locate } from '../engine/model';
import { cameraMode } from './camera-view';
import { el, q, setDisabled, setHidden, setText } from './dom';
import { t as tt } from './i18n';
import '../styles/camera-panel.css';

export class CameraPanel {
  readonly root = el(`<div class="fm-camp" hidden>
    <div class="fm-camp-head"></div>
    <label class="fm-camp-row"><span class="fm-camp-l fm-camp-amt-l"></span><input class="fm-camp-amt" type="range" min="0" max="60" step="1"><span class="fm-camp-v fm-camp-amt-v"></span></label>
    <label class="fm-camp-row"><span class="fm-camp-l fm-camp-spd-l"></span><input class="fm-camp-spd" type="range" min="0.5" max="12" step="0.5"><span class="fm-camp-v fm-camp-spd-v"></span></label>
    <div class="fm-camp-row fm-camp-btns"><button class="fm-camp-seed" type="button"></button><button class="fm-camp-off" type="button"></button></div>
    <div class="fm-camp-sep"></div>
    <div class="fm-camp-head fm-camp-dh"></div>
    <label class="fm-camp-row"><span class="fm-camp-l fm-camp-dep-l"></span><input class="fm-camp-dep" type="range" min="0" max="3" step="0.05"><span class="fm-camp-v fm-camp-dep-v"></span></label>
    <div class="fm-camp-note"></div>
    <div class="fm-camp-sep"></div>
    <div class="fm-camp-head fm-camp-fh"></div>
    <div class="fm-camp-fname"></div>
    <label class="fm-camp-row"><span class="fm-camp-l fm-camp-fol-l"></span><input class="fm-camp-fol" type="range" min="0" max="1" step="0.05"><span class="fm-camp-v fm-camp-fol-v"></span></label>
    <div class="fm-camp-row fm-camp-btns"><button class="fm-camp-fpick" type="button"></button><button class="fm-camp-fstop" type="button"></button></div>
  </div>`);
  private readonly fol = q<HTMLInputElement>(this.root, '.fm-camp-fol');
  private readonly fpick = q<HTMLButtonElement>(this.root, '.fm-camp-fpick');
  private readonly fstop = q<HTMLButtonElement>(this.root, '.fm-camp-fstop');
  private readonly amt = q<HTMLInputElement>(this.root, '.fm-camp-amt');
  private readonly spd = q<HTMLInputElement>(this.root, '.fm-camp-spd');
  private readonly dep = q<HTMLInputElement>(this.root, '.fm-camp-dep');
  private readonly seed = q<HTMLButtonElement>(this.root, '.fm-camp-seed');
  private readonly off = q<HTMLButtonElement>(this.root, '.fm-camp-off');
  private tag = '';
  private labelled = false;

  constructor(host: HTMLElement, private readonly engine: Engine) {
    host.appendChild(this.root);
    const stop = (e: Event): void => e.stopPropagation();
    for (const ev of ['pointerdown', 'pointerup', 'dblclick']) this.root.addEventListener(ev, stop);
    const shake = (patch: { amp?: number; freq?: number; seed?: number }, tag: string): void => {
      const cur = this.engine.movie?.camera?.shake;
      const next = { amp: cur?.amp ?? 8, freq: cur?.freq ?? 4, seed: cur?.seed ?? 1, ...patch };
      this.engine.run('Camera Shake', (m) => setCameraShake(m, next.amp > 0 ? next : null), tag);
    };
    this.amt.addEventListener('pointerdown', () => { this.tag = `shake-${Date.now()}`; });
    this.amt.addEventListener('input', () => shake({ amp: this.amt.valueAsNumber }, this.tag || 'shake'));
    this.spd.addEventListener('pointerdown', () => { this.tag = `shake-${Date.now()}`; });
    this.spd.addEventListener('input', () => shake({ freq: this.spd.valueAsNumber }, this.tag || 'shake'));
    for (const r of [this.amt, this.spd, this.dep]) r.addEventListener('change', () => { this.engine.endGesture(); this.tag = ''; });
    this.seed.addEventListener('click', () => { shake({ seed: Math.floor(Math.random() * 9999) + 1 }, `shake-${Date.now()}`); this.engine.endGesture(); });
    this.off.addEventListener('click', () => { this.engine.run('Camera Shake Off', (m) => setCameraShake(m, null)); this.engine.endGesture(); });
    this.dep.addEventListener('pointerdown', () => { this.tag = `depth-${Date.now()}`; });
    this.dep.addEventListener('input', () => {
      const id = this.trackId();
      if (id) this.engine.run('Track Depth', (m) => setTrackDepth(m, id, this.dep.valueAsNumber), this.tag || 'depth');
    });
    // follow: the camera pans with the selected content; the slider is how much of its move
    this.fpick.addEventListener('click', () => {
      const c = this.engine.selected[0];
      if (!c) return;
      const amount = this.engine.movie?.camera?.follow?.amount ?? 1;
      this.engine.run('Camera Follow', (m) => setCameraFollow(m, { id: c.id, amount }));
      this.engine.endGesture();
    });
    this.fstop.addEventListener('click', () => { this.engine.run('Camera Follow Off', (m) => setCameraFollow(m, null)); this.engine.endGesture(); });
    this.fol.addEventListener('pointerdown', () => { this.tag = `follow-${Date.now()}`; });
    this.fol.addEventListener('input', () => {
      const f = this.engine.movie?.camera?.follow;
      if (f) this.engine.run('Camera Follow', (m) => setCameraFollow(m, { id: f.id, amount: this.fol.valueAsNumber }), this.tag || 'follow');
    });
    this.fol.addEventListener('change', () => { this.engine.endGesture(); this.tag = ''; });
    cameraMode.onChange(() => this.sync());
    for (const ev of ['movie', 'selection'] as const) engine.on(ev, () => this.sync());
  }

  private trackId(): string | null {
    const m = this.engine.movie, c = this.engine.selected[0];
    const at = m && c ? locate(m, c.id) : null;
    return at ? at.track.id : null;
  }

  private sync(): void {
    const on = cameraMode.on && !!this.engine.movie;
    setHidden(this.root, !on);
    // the shape tool strip rests while the card is open, so the two never overlap
    this.root.parentElement?.classList.toggle('is-camera-card', on);
    if (!on) return;
    if (!this.labelled) {
      this.labelled = true;
      setText(q(this.root, '.fm-camp-head'), tt('Camera shake'));
      setText(q(this.root, '.fm-camp-amt-l'), tt('Amount'));
      setText(q(this.root, '.fm-camp-spd-l'), tt('Speed'));
      setText(this.seed, tt('New pattern'));
      setText(this.off, tt('Shake off'));
      setText(q(this.root, '.fm-camp-dh'), tt('Parallax depth'));
      setText(q(this.root, '.fm-camp-dep-l'), tt('Depth'));
      setText(q(this.root, '.fm-camp-fh'), tt('Follow'));
      setText(q(this.root, '.fm-camp-fol-l'), tt('Amount'));
      setText(this.fpick, tt('Follow selection'));
      setText(this.fstop, tt('Stop following'));
      setText(q(this.root, '.fm-camp-note'), tt('Depth sets how far the camera moves the selected track: 0 stays still, 1 moves normally, above 1 moves farther (a near layer).'));
    }
    const m = this.engine.movie;
    const s = m?.camera?.shake;
    if (document.activeElement !== this.amt) this.amt.value = String(s?.amp ?? 0);
    if (document.activeElement !== this.spd) this.spd.value = String(s?.freq ?? 4);
    setText(q(this.root, '.fm-camp-amt-v'), `${Math.round(s?.amp ?? 0)} px`);
    setText(q(this.root, '.fm-camp-spd-v'), `${s?.freq ?? 4}/s`);
    setDisabled(this.seed, !s);
    setDisabled(this.off, !s);
    const id = this.trackId();
    const track = m && id ? m.tracks.find((t) => t.id === id) : undefined;
    setDisabled(this.dep, !track);
    const d = track?.depth ?? 1;
    if (document.activeElement !== this.dep) this.dep.value = String(d);
    setText(q(this.root, '.fm-camp-dep-v'), track ? `${Math.round(d * 100)}%` : '');
    const f = m?.camera?.follow;
    const target = f && m ? m.tracks.flatMap((t) => t.content).find((c) => c.id === f.id) : undefined;
    setText(q(this.root, '.fm-camp-fname'), target ? tt('Following {name}').replace('{name}', target.name) : tt('Following nothing'));
    setDisabled(this.fol, !f);
    setDisabled(this.fstop, !f);
    setDisabled(this.fpick, !this.engine.selected[0]);
    if (document.activeElement !== this.fol) this.fol.value = String(f?.amount ?? 1);
    setText(q(this.root, '.fm-camp-fol-v'), f ? `${Math.round(f.amount * 100)}%` : '');
  }
}
