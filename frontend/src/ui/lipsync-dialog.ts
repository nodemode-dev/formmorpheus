// "Lip-sync from Sound...": picks a sound block, a mouth Flipbook and a range, maps the eight shapes to frames of the
// Flipbook and writes the analysed shapes into it as holds (one undo step). Built once, then patched.
import type { Engine } from '../engine/engine';
import { applyLipsync, guessMapping, looksLikeMouth, mouthChartRow, NEW_ROW } from '../engine/lipsync-ops';
import { freeSpan, locate } from '../engine/model';
import type { Content, Movie } from '../engine/types';
import type { AudioEngine } from '../media/audio';
import { lipsync, mono, VISEMES, VISEME_NAMES, type Viseme } from '../media/lipsync';
import { el, q, setDisabled, setHidden, setText, setValue } from './dom';
import { Dialog } from './dialogs';
import { t } from './i18n';
import '../styles/lipsync.css';

const SHAPE_LABEL: Record<Viseme, string> = { rest: 'Rest', MBP: 'M B P (closed)', AI: 'A I (wide open)', E: 'E', O: 'O', U: 'U', FV: 'F V', L: 'L / th' };

/** Updates a select's options in place: existing options change text, extras go, missing ones are added. */
function fill(sel: HTMLSelectElement, items: Array<[string, string]>): void {
  const opts = Array.from(sel.options);
  items.forEach(([v, text], i) => {
    let o = opts[i];
    if (!o) { o = document.createElement('option'); sel.appendChild(o); }
    if (o.value !== v) o.value = v;
    if (o.textContent !== text) o.textContent = text;
  });
  for (let i = opts.length - 1; i >= items.length; i--) opts[i].remove();
}

const isSound = (c: Content, m: Movie): boolean => (c.kind === 'audio' || (c.kind === 'video' && !!c.asset && !!m.assets[c.asset]?.hasAudio)) && !!c.asset;

function allContent(m: Movie): Content[] {
  const out: Content[] = [];
  const walk = (tracks: Movie['tracks']): void => { for (const tr of tracks) for (const c of tr.content) { out.push(c); if (c.kind === 'group') walk(c.tracks); } };
  walk(m.tracks);
  return out;
}

export class LipsyncDialog extends Dialog {
  private readonly sound = el<HTMLSelectElement>('<select class="cv-input"></select>');
  private readonly book = el<HTMLSelectElement>('<select class="cv-input"></select>');
  private readonly rowSel = el<HTMLSelectElement>('<select class="cv-input"></select>');
  private readonly into = el<HTMLSelectElement>('<select class="cv-input"><option value="same"></option><option value="new"></option></select>');
  private readonly from = el<HTMLInputElement>('<input class="cv-input" type="number" min="1" step="1">');
  private readonly to = el<HTMLInputElement>('<input class="cv-input" type="number" min="1" step="1">');
  private readonly sens = el<HTMLInputElement>('<input type="range" min="0" max="100" step="1" value="50" aria-label="Sensitivity">');
  private readonly note = el<HTMLElement>('<p class="cv-note fm-ls-note"></p>');
  private readonly maps = new Map<Viseme, HTMLSelectElement>();
  private readonly go: HTMLButtonElement;
  private readonly chart: HTMLButtonElement;
  private busy = false;
  private mapKey = '';

  constructor(private readonly engine: Engine, private readonly audio: () => AudioEngine | null) {
    super('Lip-sync from Sound', 460);
    this.field('Sound', this.sound);
    this.field('Mouth flipbook', this.book);
    this.field('Mouth track', this.rowSel);
    this.field('Write into', this.into);
    const range = el<HTMLElement>('<div class="fm-ls-range"></div>');
    range.append(this.from, el<HTMLElement>('<span class="fm-ls-to"></span>'), this.to);
    setText(q(range, '.fm-ls-to'), t('to'));
    this.field('Frames', range);
    const sens = el<HTMLElement>('<div class="fm-ls-sens"></div>');
    sens.appendChild(this.sens);
    this.field('Sensitivity', sens);
    const grid = el<HTMLElement>('<div class="fm-ls-grid" role="group" aria-label="Shape frames"></div>');
    for (const v of VISEMES) {
      const lab = el<HTMLElement>('<span class="fm-ls-shape"></span>');
      setText(lab, SHAPE_LABEL[v]);
      const sel = el<HTMLSelectElement>('<select class="cv-input"></select>');
      sel.setAttribute('aria-label', SHAPE_LABEL[v]);
      this.maps.set(v, sel);
      grid.append(lab, sel);
    }
    this.body.append(el<HTMLElement>('<p class="cv-note-head"></p>'), grid, this.note);
    setText(q(this.body, '.cv-note-head'), t('Frame for each mouth shape'));
    this.chart = this.button('Create Mouth Chart', 'ghost', () => this.makeChart());
    this.chart.classList.add('cv-btn-apart');
    this.button('Cancel', 'ghost', () => this.close());
    this.go = this.button('Lip-sync', 'primary', () => void this.run());

    this.sound.addEventListener('change', () => this.pickSound());
    this.book.addEventListener('change', () => this.pickBook());
    this.rowSel.addEventListener('change', () => this.pickRow());
    for (const n of [this.from, this.to, this.sens, this.into]) n.addEventListener('input', () => this.refreshNote());
  }

  /** Opens for the selected content: a sound block is the source, a Flipbook the target. */
  show(): void {
    const m = this.engine.movie;
    if (!m) return;
    const sel = this.engine.selected[0];
    const all = allContent(m);
    const sounds = all.filter((c) => isSound(c, m)), books = all.filter((c) => c.kind === 'flipbook');
    fill(this.sound, sounds.map((c) => [c.id, c.name]));
    fill(this.book, books.map((c) => [c.id, c.name]));
    setText(this.into.options[0], t('The same track'));
    setText(this.into.options[1], t('A new track (keeps the chart)'));
    const wantSound = sel && isSound(sel, m) ? sel.id : sounds.find((s) => books.some((b) => this.overlap(s, b)))?.id ?? sounds[0]?.id ?? '';
    const wantBook = sel?.kind === 'flipbook' ? sel.id : books.find((b) => b.flip.some(looksLikeMouth))?.id ?? books[0]?.id ?? '';
    setValue(this.sound, wantSound);
    setValue(this.book, wantBook);
    this.mapKey = '';
    this.pickBook();
    this.pickSound();
    this.open(this.go);
  }

  private overlap(a: Content, b: Content): boolean {
    return a.start < b.start + b.duration && b.start < a.start + a.duration;
  }

  private cur(): { m: Movie; snd: Content | null; fb: Content | null } {
    const m = this.engine.movie as Movie;
    return { m, snd: locate(m, this.sound.value)?.content ?? null, fb: locate(m, this.book.value)?.content ?? null };
  }

  private pickBook(): void {
    const { fb } = this.cur();
    fill(this.rowSel, (fb?.flip ?? []).map((r, i) => [String(i), r.name]));
    const best = fb ? Math.max(0, fb.flip.findIndex(looksLikeMouth)) : 0;
    setValue(this.rowSel, String(best));
    this.pickRow();
    this.pickSound();
  }

  private pickRow(): void {
    const { fb } = this.cur();
    const row = fb?.flip[Number(this.rowSel.value)];
    const frames = row?.frames ?? [];
    const key = `${row?.id ?? ''}:${frames.map((f) => f.id + (f.name ?? '')).join(',')}`;
    if (key !== this.mapKey) {
      this.mapKey = key;
      const items = frames.map((f, i): [string, string] => [String(i), f.name ? `${i + 1} · ${f.name}` : String(i + 1)]);
      const guess = row ? guessMapping(row) : null;
      for (const v of VISEMES) {
        const s = this.maps.get(v) as HTMLSelectElement;
        fill(s, items);
        if (guess) s.value = String(guess[v]);
      }
    }
    setValue(this.into, row && row.frames.length <= VISEMES.length + 2 ? 'new' : 'same');
    this.refreshNote();
  }

  private pickSound(): void {
    const { snd, fb } = this.cur();
    if (snd) {
      const lo = fb ? Math.max(snd.start, fb.start) : snd.start;
      this.from.value = String(lo + 1);
      this.to.value = String(this.limit(snd, fb));
    }
    this.refreshNote();
  }

  /** Last frame (1-based, inclusive) the sound can fill: the sound's end, cut to the room the Flipbook has. */
  private limit(snd: Content, fb: Content | null): number {
    let stop = snd.start + snd.duration;
    if (fb) {
      const loc = locate(this.cur().m, fb.id);
      if (loc) stop = Math.min(stop, freeSpan(loc.track, fb.start, new Set([fb.id])).to);
    }
    return stop;
  }

  private range(): { from: number; count: number } {
    const a = Math.max(1, Math.round(this.from.valueAsNumber || 1)) - 1;
    const b = Math.round(this.to.valueAsNumber || 0);
    return { from: a, count: Math.max(0, b - a) };
  }

  private refreshNote(): void {
    const { snd, fb } = this.cur();
    const r = this.range();
    const ok = !!snd && !!fb && fb.flip.length > 0 && r.count > 0 && !this.busy;
    setDisabled(this.go, !ok);
    setHidden(this.rowSel.closest('label') as HTMLElement, false);
    if (!snd) setText(this.note, t('No sound block in this movie.'));
    else if (!fb) setText(this.note, t('No flipbook yet: Create Mouth Chart makes one to draw the eight shapes in.'));
    else setText(this.note, `${r.count} ${t('frames')}`);
  }

  private makeChart(): void {
    const id = this.engine.insert('flipbook', { name: 'Mouth Chart', flip: [mouthChartRow()], duration: VISEMES.length });
    if (!id) return;
    this.show2(id);
  }

  private show2(bookId: string): void {
    const m = this.engine.movie;
    if (!m) return;
    const books = allContent(m).filter((c) => c.kind === 'flipbook');
    fill(this.book, books.map((c) => [c.id, c.name]));
    setValue(this.book, bookId);
    this.book.value = bookId;
    this.mapKey = '';
    this.pickBook();
  }

  private async run(): Promise<void> {
    const { m, snd, fb } = this.cur();
    const eng = this.audio();
    if (!snd?.asset || !fb || !eng || this.busy) return;
    this.busy = true;
    setDisabled(this.go, true);
    setText(this.note, t('Listening to the sound...'));
    try {
      const buf = await eng.decode(snd.asset);
      if (!buf) { this.engine.notice(t('That sound could not be read.'), 'error'); return; }
      const r = this.range();
      const fps = m.fps;
      const from = Math.max(r.from, snd.start);
      const count = r.count - (from - r.from);
      const chans: Float32Array[] = [];
      for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
      const startSec = (from - snd.start + snd.offset) / fps;
      const shapes = lipsync(mono(chans), buf.sampleRate, startSec, count, fps, { sensitivity: this.sens.valueAsNumber / 100 });
      const map = {} as Record<Viseme, number>;
      for (const v of VISEMES) map[v] = Number((this.maps.get(v) as HTMLSelectElement).value) || 0;
      const row = Number(this.rowSel.value);
      const job = { content: fb.id, row: this.into.value === 'new' ? NEW_ROW : row, chartRow: this.into.value === 'new' ? row : -1, from, shapes, map };
      if (this.engine.run('Lip-sync from Sound', (mv) => ({ movie: applyLipsync(mv, job), select: [fb.id] }))) this.close();
    } finally {
      this.busy = false;
      this.refreshNote();
    }
  }
}

export { VISEME_NAMES };
