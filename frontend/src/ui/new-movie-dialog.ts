import type { Engine } from '../engine/engine';
import { FPS_PRESETS } from '../engine/time';
import { MOVIE_PRESETS } from '../engine/types';
import { Dialog } from './dialogs';
import { el, q, setClass, setText } from './dom';

const KEY = 'formmorpheus.newMovie';
const BOX = 44;
const CUSTOM = MOVIE_PRESETS.length;

interface Saved { card: number; start: 'empty' | 'flipbook' }

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
    const card = typeof raw.card === 'number' && raw.card >= 0 && raw.card <= CUSTOM ? raw.card : 0;
    return { card, start: raw.start === 'flipbook' ? 'flipbook' : 'empty' };
  } catch { return { card: 0, start: 'empty' }; }
}

function save(s: Saved): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { return; }
}

function outline(w: number, h: number): HTMLElement {
  const k = BOX / Math.max(w, h);
  return el<HTMLElement>(`<span class="fm-nm-box"><span class="fm-nm-outline" style="width:${Math.round(w * k)}px;height:${Math.round(h * k)}px"></span></span>`);
}

export class NewMovieDialog extends Dialog {
  private readonly cards: HTMLElement[] = [];
  private readonly sizes: HTMLSelectElement[] = [];
  private readonly width = el<HTMLInputElement>('<input class="cv-input" type="number" min="16" max="3840" value="1920" aria-label="Width">');
  private readonly height = el<HTMLInputElement>('<input class="cv-input" type="number" min="16" max="3840" value="1080" aria-label="Height">');
  private readonly fps = el<HTMLSelectElement>(`<select class="cv-input" aria-label="Frame rate">${FPS_PRESETS.map((p) => `<option value="${p.fps}">${p.fps} · ${p.label}</option>`).join('')}</select>`);
  private readonly seconds = el<HTMLInputElement>('<input class="cv-input" type="number" min="1" max="3600" step="1" value="10" aria-label="Duration in seconds">');
  private readonly starts: HTMLButtonElement[] = [];
  private state: Saved = load();

  constructor(private readonly engine: Engine) {
    super('New Movie', 560);
    const grid = el<HTMLElement>('<div class="fm-nm-grid"></div>');
    MOVIE_PRESETS.forEach((p, i) => {
      const card = el<HTMLElement>('<div class="fm-nm-card" role="button" tabindex="0"><span class="fm-nm-label"></span><span class="fm-nm-ratio"></span></div>');
      card.prepend(outline(p.aspect[0], p.aspect[1]));
      setText(q(card, '.fm-nm-label'), p.label);
      setText(q(card, '.fm-nm-ratio'), `${p.aspect[0]}:${p.aspect[1]}`);
      const sel = el<HTMLSelectElement>(`<select class="cv-input fm-nm-size" aria-label="${p.label} size">${p.sizes.map(([w, h], k) => `<option value="${k}">${w} x ${h}</option>`).join('')}</select>`);
      sel.value = '2';
      sel.addEventListener('change', () => this.pick(i));
      this.sizes.push(sel);
      card.appendChild(sel);
      this.wireCard(card, i);
      grid.appendChild(card);
    });
    const custom = el<HTMLElement>('<div class="fm-nm-card" role="button" tabindex="0"><span class="fm-nm-label">Custom</span><span class="fm-nm-ratio">Any size</span></div>');
    custom.prepend(outline(4, 3));
    const pair = el<HTMLElement>('<div class="fm-nm-pair"></div>');
    pair.append(this.width, el<HTMLElement>('<span class="fm-nm-x">x</span>'), this.height);
    custom.appendChild(pair);
    for (const n of [this.width, this.height]) n.addEventListener('focus', () => this.pick(CUSTOM));
    this.wireCard(custom, CUSTOM);
    grid.appendChild(custom);

    const seg = el<HTMLElement>('<div class="fm-nm-seg" role="group"></div>');
    (['empty', 'flipbook'] as const).forEach((id) => {
      const b = el<HTMLButtonElement>('<button class="fm-nm-segbtn" type="button"></button>');
      setText(b, id === 'empty' ? 'Empty' : 'Flipbook');
      b.addEventListener('click', () => this.setStart(id));
      this.starts.push(b);
      seg.appendChild(b);
    });

    const opts = el<HTMLElement>('<div class="fm-nm-opts"></div>');
    opts.append(this.optRow('Frame rate', this.fps), this.optRow('Duration (seconds)', this.seconds), this.optRow('Start as', seg));
    this.fps.value = '24';
    this.body.append(grid, opts);
    this.body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); this.create(); }
    });

    this.button('Cancel', 'ghost', () => this.close());
    this.button('Create', 'primary', () => this.create());
    this.remember([], {
      read: () => ({ card: String(this.state.card), start: this.state.start }),
      write: (v) => {
        const c = Number(v.card);
        if (Number.isInteger(c) && c >= 0 && c <= CUSTOM) this.state.card = c;
        if (v.start === 'flipbook' || v.start === 'empty') this.state.start = v.start;
        this.paint();
      },
      onChange: () => undefined,
    });
    this.paint();
  }

  show(flipbook?: boolean): void {
    this.open();
    if (flipbook !== undefined) this.setStart(flipbook ? 'flipbook' : 'empty');
  }

  private optRow(label: string, control: HTMLElement): HTMLElement {
    const row = el<HTMLElement>('<div class="fm-nm-field"><span></span></div>');
    setText(q(row, 'span'), label);
    row.appendChild(control);
    return row;
  }

  private wireCard(card: HTMLElement, i: number): void {
    card.addEventListener('click', () => this.pick(i));
    card.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); this.pick(i); }
    });
    this.cards.push(card);
  }

  private pick(i: number): void {
    if (this.state.card === i) return;
    this.state.card = i;
    this.paint();
    save(this.state);
  }

  private setStart(s: Saved['start']): void {
    this.state.start = s;
    this.paint();
    save(this.state);
  }

  private paint(): void {
    this.cards.forEach((c, i) => setClass(c, 'is-active', i === this.state.card));
    this.starts.forEach((b, i) => setClass(b, 'is-active', (i === 1) === (this.state.start === 'flipbook')));
  }

  private size(): [number, number] {
    const i = this.state.card;
    if (i === CUSTOM) return [this.width.valueAsNumber || 1920, this.height.valueAsNumber || 1080];
    return MOVIE_PRESETS[i].sizes[Number(this.sizes[i].value)] ?? [1920, 1080];
  }

  private create(): void {
    const [width, height] = this.size();
    const seconds = this.seconds.valueAsNumber;
    this.engine.create({
      name: 'Untitled Movie',
      width,
      height,
      fps: Number(this.fps.value) || 24,
      seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 10,
      flipbook: this.state.start === 'flipbook',
    });
    this.close();
  }
}
