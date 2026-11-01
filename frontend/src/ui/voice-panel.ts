// The Record sound card: choose a microphone, watch the level, count in, and record a voice-over onto the Timeline
// while the movie plays. A take lands as a sound block at the start frame on its own sound track; takes pile up
// (the earlier ones muted) and Cancel throws the one being recorded away. Built once, then patched in place.
import type { Engine } from '../engine/engine';
import { content, locate, uid, end } from '../engine/model';
import * as ops from '../engine/ops';
import type { Asset, Movie } from '../engine/types';
import type { AudioEngine } from '../media/audio';
import { setMute } from '../media/audio-edit';
import { Recorder, cut, encodeWav, listInputs, micError, type InputDevice, type Take } from '../media/recorder';
import { el, patchList, q, setClass, setDisabled, setHidden, setStyleVar, setText } from './dom';
import { enhanceSelect } from './dropdown';
import { t } from './i18n';
import '../styles/voice.css';

type State = 'idle' | 'counting' | 'recording' | 'saving';

interface Opts { countIn: number; preRoll: number; stopAt: 'manual' | 'end' | 'frame'; stopFrame: number; monitor: boolean; replace: boolean; muteEarlier: boolean; device: string }
const DEFAULTS: Opts = { countIn: 3, preRoll: 0, stopAt: 'manual', stopFrame: 0, monitor: true, replace: false, muteEarlier: true, device: '' };
const STORE = 'formmorpheus.voice';

interface TakeRow { contentId: string; trackId: string; name: string; seconds: number }

const X = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function loadOpts(): Opts {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Opts>) }; } catch { return { ...DEFAULTS }; }
}

const clock = (s: number): string => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export class VoicePanel {
  private readonly root: HTMLElement;
  private readonly err: HTMLElement;
  private readonly errText: HTMLElement;
  private readonly dev: HTMLSelectElement;
  private readonly meter: HTMLElement;
  private readonly count: HTMLSelectElement;
  private readonly pre: HTMLSelectElement;
  private readonly stopAt: HTMLSelectElement;
  private readonly stopFrame: HTMLInputElement;
  private readonly monitor: HTMLInputElement;
  private readonly replace: HTMLInputElement;
  private readonly muteEarlier: HTMLInputElement;
  private readonly startLine: HTMLElement;
  private readonly big: HTMLElement;
  private readonly go: HTMLButtonElement;
  private readonly stop: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly takesEl: HTMLElement;
  private readonly rec = new Recorder();
  private opts = loadOpts();
  private state: State = 'idle';
  private takes: TakeRow[] = [];
  private raf = 0;
  private timer = 0;
  private offs: Array<() => void> = [];
  private startFrame = 0;
  private playStart = 0;
  private stopAtFrame = Number.POSITIVE_INFINITY;
  private wasScrub = true;
  private open = false;
  private punchTrack: string | null = null;

  constructor(private readonly engine: Engine, private readonly audio: () => AudioEngine) {
    const mk = (label: string, control: HTMLElement): HTMLElement => {
      const row = el<HTMLElement>('<div class="fm-vo-row"><span class="fm-vo-lab"></span></div>');
      setText(q(row, '.fm-vo-lab'), t(label));
      row.appendChild(control);
      return row;
    };
    const chk = (label: string): { row: HTMLElement; box: HTMLInputElement } => {
      const row = el<HTMLElement>('<label class="fm-vo-chk"><input type="checkbox"><span></span></label>');
      setText(q(row, 'span'), t(label));
      return { row, box: q<HTMLInputElement>(row, 'input') };
    };
    this.root = el<HTMLElement>(
      '<section class="fm-vo" role="dialog" hidden>' +
      '<div class="fm-vo-head"><span class="fm-vo-title"></span><button class="fm-vo-x" type="button"></button></div>' +
      '<div class="fm-vo-err" hidden><span class="fm-vo-errtext"></span><br><button class="cv-btn fm-vo-retry" type="button"></button></div>' +
      '<div class="fm-vo-body"></div></section>');
    this.root.setAttribute('aria-label', t('Record sound'));
    setText(q(this.root, '.fm-vo-title'), t('Record sound'));
    const closeBtn = q<HTMLButtonElement>(this.root, '.fm-vo-x');
    closeBtn.innerHTML = X;
    closeBtn.setAttribute('aria-label', t('Close'));
    closeBtn.addEventListener('click', () => this.close());
    this.err = q(this.root, '.fm-vo-err');
    this.errText = q(this.root, '.fm-vo-errtext');
    const retry = q<HTMLButtonElement>(this.root, '.fm-vo-retry');
    setText(retry, t('Try again'));
    retry.addEventListener('click', () => { void this.connect(this.dev.value); });

    this.dev = el<HTMLSelectElement>('<select class="cv-input" aria-label="Input"></select>');
    this.meter = el<HTMLElement>('<div class="fm-vo-meter" role="meter" aria-label="Input level" aria-valuemin="0" aria-valuemax="1"><div class="fm-vo-bar"></div></div>');
    this.count = el<HTMLSelectElement>('<select class="cv-input" aria-label="Count-in"></select>');
    for (const n of [0, 1, 2, 3, 4]) this.count.appendChild(new Option(n === 0 ? t('Off') : `${n} s`, String(n)));
    this.pre = el<HTMLSelectElement>('<select class="cv-input" aria-label="Pre-roll"></select>');
    for (const n of [0, 1, 2, 3, 5]) this.pre.appendChild(new Option(n === 0 ? t('Off') : `${n} s`, String(n)));
    this.stopAt = el<HTMLSelectElement>('<select class="cv-input" aria-label="Stop at"></select>');
    this.stopAt.append(new Option(t('Stop button'), 'manual'), new Option(t('End of movie'), 'end'), new Option(t('Frame'), 'frame'));
    this.stopFrame = el<HTMLInputElement>('<input class="cv-input" type="number" min="1" step="1" aria-label="Stop frame">');
    const stopRow = el<HTMLElement>('<div class="fm-vo-split"></div>');
    stopRow.append(this.stopAt, this.stopFrame);
    const m = chk('Play the movie’s sound while recording');
    const r = chk('Replace selected sound under the take');
    const e = chk('Mute earlier takes');
    this.monitor = m.box;
    this.replace = r.box;
    this.muteEarlier = e.box;
    this.startLine = el<HTMLElement>('<div class="fm-vo-start"></div>');
    this.big = el<HTMLElement>('<div class="fm-vo-count" aria-live="assertive" hidden></div>');
    this.go = el<HTMLButtonElement>('<button class="cv-btn fm-vo-go" type="button"><span class="fm-vo-dot"></span><span></span></button>');
    setText(q(this.go, 'span:last-child'), t('Record'));
    this.stop = el<HTMLButtonElement>('<button class="cv-btn fm-vo-go" type="button" hidden></button>');
    setText(this.stop, t('Stop'));
    this.cancel = el<HTMLButtonElement>('<button class="cv-btn" type="button" hidden></button>');
    setText(this.cancel, t('Cancel'));
    const actions = el<HTMLElement>('<div class="fm-vo-actions"></div>');
    actions.append(this.go, this.stop, this.cancel);
    this.status = el<HTMLElement>('<div class="fm-vo-status" aria-live="polite"></div>');
    this.takesEl = el<HTMLElement>('<div class="fm-vo-takes" aria-label="Takes"></div>');
    const note = el<HTMLElement>('<p class="fm-vo-note"></p>');
    setText(note, t('Use headphones when the movie’s sound plays, or the microphone hears it too. Takes are saved as WAV sound in the movie file.'));
    q(this.root, '.fm-vo-body').append(
      mk('Input', this.dev), this.meter, mk('Count-in', this.count), mk('Pre-roll', this.pre), mk('Stop at', stopRow),
      m.row, r.row, e.row, this.startLine, this.big, actions, this.status, this.takesEl, note,
    );
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
    enhanceSelect(this.dev);
    enhanceSelect(this.count);
    enhanceSelect(this.pre);
    enhanceSelect(this.stopAt);

    this.dev.addEventListener('change', () => { this.opts.device = this.dev.value; this.persist(); void this.connect(this.dev.value); });
    this.count.addEventListener('change', () => { this.opts.countIn = Number(this.count.value); this.persist(); });
    this.pre.addEventListener('change', () => { this.opts.preRoll = Number(this.pre.value); this.persist(); });
    this.stopAt.addEventListener('change', () => { this.opts.stopAt = this.stopAt.value as Opts['stopAt']; this.persist(); this.patch(); });
    this.stopFrame.addEventListener('change', () => { this.opts.stopFrame = Math.max(1, Math.round(Number(this.stopFrame.value) || 1)); this.persist(); });
    this.monitor.addEventListener('change', () => { this.opts.monitor = this.monitor.checked; this.persist(); });
    this.replace.addEventListener('change', () => { this.opts.replace = this.replace.checked; this.persist(); });
    this.muteEarlier.addEventListener('change', () => { this.opts.muteEarlier = this.muteEarlier.checked; this.persist(); });
    this.go.addEventListener('click', () => { void this.begin(); });
    this.stop.addEventListener('click', () => { void this.finish(true); });
    this.cancel.addEventListener('click', () => this.abort());
    window.addEventListener('keydown', (ev) => {
      if (!this.open || ev.key !== 'Escape' || this.state === 'idle') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.abort();
    }, true);
    this.engine.on('time', () => { if (this.open && this.state === 'idle') this.patch(); });
    this.engine.on('projects', () => { if (!this.engine.movie) this.close(); });
    this.patch();
  }

  get recording(): boolean { return this.state === 'counting' || this.state === 'recording'; }

  /** Shows the card and asks for the microphone. */
  show(): void {
    if (!this.engine.movie) return;
    this.open = true;
    setHidden(this.root, false);
    this.syncControls();
    this.patch();
    void this.connect(this.opts.device);
    this.loopMeter();
  }

  close(): void {
    if (this.recording) this.abort();
    this.open = false;
    setHidden(this.root, true);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.rec.close();
    this.takes = [];
    this.renderTakes();
  }

  private persist(): void {
    try { localStorage.setItem(STORE, JSON.stringify(this.opts)); } catch { /* kept for this session only */ }
  }

  private syncControls(): void {
    const o = this.opts;
    this.count.value = String(o.countIn);
    this.pre.value = String(o.preRoll);
    this.stopAt.value = o.stopAt;
    this.monitor.checked = o.monitor;
    this.replace.checked = o.replace;
    this.muteEarlier.checked = o.muteEarlier;
    const m = this.engine.movie;
    this.stopFrame.value = String(o.stopFrame > 0 ? o.stopFrame : Math.min(m?.duration ?? 1, this.engine.frame + Math.round((m?.fps ?? 24) * 5)));
  }

  private async connect(deviceId: string): Promise<void> {
    setHidden(this.err, true);
    try {
      await this.rec.openInput(deviceId);
    } catch (e) {
      const me = micError(e);
      setText(this.errText, me.message);
      setHidden(this.err, false);
      if (!this.dev.options.length) this.dev.appendChild(new Option(t('No microphone found'), ''));
      this.patch();
      return;
    }
    if (this.state === 'idle') setText(this.status, '');
    let list: InputDevice[] = [];
    try { list = await listInputs(); } catch { /* names stay generic */ }
    this.fillDevices(list);
    this.patch();
  }

  private fillDevices(list: InputDevice[]): void {
    const want = this.rec.deviceId || this.dev.value;
    const have = Array.from(this.dev.options).map((o) => o.value).join('|');
    const next = list.map((d) => d.id).join('|');
    if (have !== next) {
      this.dev.textContent = '';
      for (const d of list) this.dev.appendChild(new Option(d.label, d.id));
      if (!list.length) this.dev.appendChild(new Option(t('Default input'), ''));
    }
    if (want && Array.from(this.dev.options).some((o) => o.value === want)) this.dev.value = want;
  }

  private loopMeter(): void {
    cancelAnimationFrame(this.raf);
    const tick = (): void => {
      if (!this.open) return;
      const lv = this.rec.open ? this.rec.level() : { peak: 0, clip: false };
      setStyleVar(this.meter, '--lv', lv.peak.toFixed(3));
      setClass(this.meter, 'is-clip', lv.clip);
      if (this.state === 'recording') setText(this.status, `${t('Recording')} ${clock(this.rec.seconds)}`);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private patch(): void {
    const m = this.engine.movie;
    const idle = this.state === 'idle';
    const live = this.state === 'recording' || this.state === 'counting';
    setClass(this.root, 'is-recording', this.state === 'recording');
    setHidden(this.go, !idle);
    setHidden(this.stop, this.state !== 'recording');
    setHidden(this.cancel, !live);
    setDisabled(this.go, !m || !this.rec.open);
    for (const c of [this.dev, this.count, this.pre, this.stopAt, this.stopFrame, this.monitor, this.replace, this.muteEarlier]) setDisabled(c, !idle);
    setDisabled(this.stopFrame, !idle || this.stopAt.value !== 'frame');
    if (m && idle) {
      const s = this.engine.frame;
      setText(this.startLine, `${t('Starts at frame')} ${s} ·${clock(s / m.fps)}`);
      if (!this.rec.open && this.err.hidden) setText(this.status, t('Waiting for the microphone...'));
    }
  }

  // ---- a take ----

  private async begin(): Promise<void> {
    const m = this.engine.movie;
    if (!m || this.state !== 'idle' || !this.rec.open) return;
    const a = this.audio();
    this.engine.stop();
    this.startFrame = this.engine.frame;
    this.stopAtFrame = this.opts.stopAt === 'end' ? m.duration : this.opts.stopAt === 'frame' ? Math.min(m.duration, Math.max(this.startFrame + 1, Math.round(Number(this.stopFrame.value) || 0))) : Number.POSITIVE_INFINITY;
    const playFrom = Math.max(0, this.startFrame - Math.round(this.opts.preRoll * m.fps));
    this.wasScrub = a.scrubbing;
    a.setScrub(false);
    this.state = 'counting';
    this.punchTrack = null;
    this.engine.seek(playFrom);
    this.patch();
    const n = this.opts.countIn;
    for (let i = n; i > 0 && this.state === 'counting'; i--) {
      setText(this.big, String(i));
      setHidden(this.big, false);
      this.rec.beep(i === 1);
      await new Promise<void>((res) => { this.timer = window.setTimeout(res, 1000); });
    }
    setHidden(this.big, true);
    if (this.state !== 'counting') return;
    this.launch();
  }

  private launch(): void {
    const a = this.audio();
    this.state = 'recording';
    a.setMonitor(this.opts.monitor);
    this.rec.start();
    this.engine.play();
    this.playStart = this.engine.frame;
    this.offs = [
      this.engine.on('time', (f) => { if (this.state === 'recording' && f >= this.stopAtFrame) void this.finish(true); }),
      this.engine.on('wrap', () => { if (this.state === 'recording') void this.finish(true); }),
      this.engine.on('playing', (on) => { if (!on && this.state === 'recording') void this.finish(true); }),
    ];
    this.patch();
  }

  private release(): void {
    for (const off of this.offs) off();
    this.offs = [];
    window.clearTimeout(this.timer);
    const a = this.audio();
    a.setMonitor(true);
    a.setScrub(this.wasScrub);
    setHidden(this.big, true);
  }

  private abort(): void {
    if (this.state === 'idle') return;
    this.engine.stop();
    this.rec.cancel();
    this.release();
    this.state = 'idle';
    setText(this.status, t('Take discarded.'));
    this.patch();
  }

  private async finish(save: boolean): Promise<void> {
    const m = this.engine.movie;
    if (this.state !== 'recording' || !m) return;
    this.state = 'saving';
    this.engine.stop();
    const fps = m.fps;
    const lat = this.rec.latency() + 0.02;
    // the movie second the take starts at, as a second of the capture
    const from = (this.startFrame - this.playStart) / fps + lat;
    const heard = this.rec.seconds;
    const to = Number.isFinite(this.stopAtFrame) ? from + (this.stopAtFrame - this.startFrame) / fps : heard + lat;
    // the capture runs on a little so the voice that is still on its way through the input path is kept
    const wait = Math.max(0, Math.min(0.6, to - this.rec.seconds)) * 1000;
    if (wait > 0) await new Promise<void>((res) => { setTimeout(res, wait + 30); });
    const raw = this.rec.finish();
    this.engine.seek(this.startFrame);
    this.release();
    this.state = 'idle';
    if (!save || !raw) { this.patch(); return; }
    const take = cut(raw, Math.max(0, from), to);
    if (take.seconds < 0.05) { setText(this.status, t('Nothing was recorded.')); this.patch(); return; }
    this.place(m, take);
    this.patch();
  }

  private place(m: Movie, take: Take): void {
    const fps = m.fps;
    const frames = Math.max(1, Math.round(take.seconds * fps));
    const start = this.startFrame;
    const n = 1 + Math.max(0, ...Object.values(m.assets).filter((x) => x.recorded?.start === start).map((x) => x.recorded?.take ?? 0));
    const name = `Voice take ${n}`;
    const blob = encodeWav(take);
    const asset: Asset = { id: uid('a'), kind: 'audio', name, mime: 'audio/wav', width: 0, height: 0, frames, size: blob.size, seconds: take.seconds, recorded: { take: n, start } };
    const block = content('audio', start, frames, { name, asset: asset.id });
    this.engine.assets.set(asset.id, blob);
    const replaceIds = this.opts.replace ? this.engine.selected.filter((c) => c.kind === 'audio' && c.start < start + frames && end(c) > start).map((c) => c.id) : [];
    let trackId = '';
    const ok = this.engine.run(`Record ${name}`, (mv) => {
      let next: Movie = { ...mv, assets: { ...mv.assets, [asset.id]: asset } };
      let into: string | null = null;
      for (const id of replaceIds) {
        const at = locate(next, id);
        if (!at) continue;
        into = at.track.id;
        next = punch(next, id, start, start + frames);
      }
      if (into) {
        const r = ops.placeContent(next, into, block);
        next = r.movie;
        trackId = r.trackId;
      } else {
        const added = ops.addTrack(next, 0, name);
        next = ops.placeContent(added.movie, added.track.id, block).movie;
        trackId = added.track.id;
        if (this.opts.muteEarlier) {
          for (const tr of next.tracks) {
            if (tr.id === trackId || tr.mute) continue;
            if (tr.content.some((c) => c.asset && next.assets[c.asset]?.recorded?.start === start)) next = setMute(next, tr.id, true);
          }
        }
      }
      return { movie: next, select: [block.id] };
    });
    if (!ok) { this.engine.assets.delete(asset.id); return; }
    this.takes.push({ contentId: block.id, trackId, name, seconds: take.seconds });
    this.renderTakes();
    setText(this.status, `${name} ${t('recorded')} · ${clock(take.seconds)}`);
  }

  private renderTakes(): void {
    const mv = this.engine.movie;
    patchList(this.takesEl, this.takes, {
      key: (r) => r.contentId,
      create: (r) => {
        const row = el<HTMLElement>('<div class="fm-vo-take"><span class="fm-vo-tn"></span><button class="cv-btn fm-vo-use" type="button"></button><button class="cv-btn fm-vo-del" type="button"></button></div>');
        setText(q(row, '.fm-vo-use'), t('Use'));
        setText(q(row, '.fm-vo-del'), t('Delete'));
        q(row, '.fm-vo-use').addEventListener('click', () => this.useTake(r));
        q(row, '.fm-vo-del').addEventListener('click', () => this.deleteTake(r));
        setText(q(row, '.fm-vo-tn'), `${r.name} · ${clock(r.seconds)}`);
        setClass(row, 'is-live', !!mv?.tracks.find((x) => x.id === r.trackId && !x.mute));
        return row;
      },
      update: (node, r) => {
        setText(q(node, '.fm-vo-tn'), `${r.name} · ${clock(r.seconds)}`);
        const tr = mv?.tracks.find((x) => x.id === r.trackId);
        setClass(node, 'is-live', !!tr && !tr.mute);
      },
    });
  }

  /** Makes this take the one heard: its track plays, the other takes of the set are muted. */
  private useTake(r: TakeRow): void {
    this.engine.run('Use Take', (mv) => {
      let next = mv;
      for (const row of this.takes) if (mv.tracks.some((x) => x.id === row.trackId)) next = setMute(next, row.trackId, row.contentId !== r.contentId);
      return next;
    });
    this.renderTakes();
  }

  private deleteTake(r: TakeRow): void {
    this.engine.run('Delete Take', (mv) => {
      const at = locate(mv, r.contentId);
      if (!at) return mv;
      let next = ops.deleteContent(mv, [r.contentId]);
      if (at.track.content.length === 1) next = ops.deleteTrack(next, at.track.id);
      return next;
    });
    this.takes = this.takes.filter((x) => x !== r);
    this.renderTakes();
  }
}

/** Cuts the frames a..b out of a sound block (it may split in two); what lies outside stays on its track. */
function punch(m: Movie, id: string, a: number, b: number): Movie {
  let mv = m;
  let mid = id;
  const at = locate(mv, id);
  if (!at) return mv;
  if (a > at.content.start && a < end(at.content)) {
    const r = ops.splitContent(mv, id, a);
    mv = r.movie;
    mid = r.right;
  } else if (a >= end(at.content)) return mv;
  const piece = locate(mv, mid);
  if (!piece) return mv;
  if (b < end(piece.content)) mv = ops.splitContent(mv, mid, b).movie;
  return ops.deleteContent(mv, [mid]);
}
