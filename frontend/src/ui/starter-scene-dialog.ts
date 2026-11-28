// File, New from Starter Scene... and Add Starter Scene to This Movie...: the scenes in the starter manifest as cards
// with a small picture of each; choosing one makes a new movie from it, or adds it behind the open movie. Built once;
// the cards, title and primary button are patched in place.
import type { SceneEntry } from '../engine/starter-scene';
import { readSceneManifest, sceneFileUrl, withSvgImage } from '../io/starter-scenes';
import { Dialog } from './dialogs';
import { el, patchList, q, setClass, setDisabled, setHidden, setText } from './dom';
import { t } from './i18n';
import { tf } from './i18n-fill';
import { toast } from './toast';
import '../styles/starter-scenes.css';

const THUMB_W = 320, THUMB_H = 180;

const CARD = `<button class="fm-ss-card" type="button"><span class="fm-ss-thumb"><canvas width="${THUMB_W}" height="${THUMB_H}" aria-hidden="true"></canvas></span><span class="fm-ss-name"></span><span class="fm-ss-meta"></span></button>`;

export class StarterSceneDialog extends Dialog {
  private readonly grid = el<HTMLElement>('<div class="fm-ss-grid"></div>');
  private readonly empty = el<HTMLElement>('<p class="fm-ss-empty" hidden></p>');
  private scenes: SceneEntry[] | null = null;
  private loading: Promise<void> | null = null;
  private busy: string | null = null;
  private readonly drawn = new Set<string>();
  /** 'new' makes a new movie of the scene; 'add' lays it behind what the open movie holds (through `onAdd`). */
  private mode: 'new' | 'add' = 'new';
  private picked: string | null = null;
  private readonly go: HTMLButtonElement;
  /** Adds the scene to the open movie and says whether it did. */
  onAdd: ((entry: SceneEntry) => Promise<boolean>) | null = null;

  /** `make` opens the scene and says whether it did; when the person stays with the current movie the dialog stays open. */
  constructor(private readonly make: (entry: SceneEntry) => Promise<boolean>) {
    super('New from Starter Scene', 560);
    this.body.append(this.grid, this.empty);
    this.button('Cancel', 'ghost', () => this.close());
    this.go = this.button('Create', 'primary', () => {
      const entry = this.scenes?.find((s) => s.id === this.picked);
      if (entry) void this.choose(entry);
    });
    // a click picks a card and the primary button takes it; a double click takes it at once
    const at = (e: Event): SceneEntry | undefined => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('.fm-ss-card')?.dataset.key;
      return this.scenes?.find((s) => s.id === key);
    };
    this.grid.addEventListener('click', (e) => { const entry = at(e); if (entry && !this.busy) { this.picked = entry.id; this.paint(); } });
    this.grid.addEventListener('dblclick', (e) => { const entry = at(e); if (entry) void this.choose(entry); });
    void this.load();
  }

  /** Reads the manifest and builds the cards while the dialog is hidden; a read that failed is tried again on the next show. */
  private load(): Promise<void> {
    if (this.scenes?.length) return Promise.resolve();
    this.loading ??= readSceneManifest().then((list) => {
      this.loading = null;
      this.scenes = list;
      this.paint();
    });
    return this.loading;
  }

  /** Opens on the same list either to make a new movie or, with 'add', to add the scene to the open movie; the title and the primary button are patched for the mode. */
  async show(mode: 'new' | 'add' = 'new'): Promise<void> {
    this.mode = mode === 'add' && this.onAdd ? 'add' : 'new';
    // each opening starts with nothing picked, so Enter on the primary button never takes a card picked last time
    this.picked = null;
    this.setTitle(this.mode === 'add' ? 'Add Starter Scene' : 'New from Starter Scene');
    const label = this.mode === 'add' ? 'Add to Movie' : 'Create';
    if (this.go.dataset.en !== label) { setText(this.go, t(label)); this.go.dataset.en = label; this.go.dataset.shown = this.go.textContent ?? ''; }
    await this.load();
    this.paint();
    this.open();
  }

  private paint(): void {
    const list = this.scenes ?? [];
    patchList(this.grid, list, {
      key: (s) => s.id,
      create: (s) => { const n = el<HTMLElement>(CARD); this.update(n, s); return n; },
      update: (n, s) => this.update(n, s),
    });
    setText(this.empty, t('The starter scenes could not be read.'));
    setHidden(this.empty, !this.scenes || list.length > 0);
    for (const s of list) if (!this.drawn.has(s.id)) { this.drawn.add(s.id); void this.thumb(s); }
    if (this.picked && !list.some((s) => s.id === this.picked)) this.picked = null;
    setDisabled(this.go, this.busy !== null || this.picked === null);
  }

  private update(n: HTMLElement, s: SceneEntry): void {
    setText(q(n, '.fm-ss-name'), s.name);
    const props = s.layers.length - 1;
    setText(q(n, '.fm-ss-meta'), props === 1 ? t('1 prop') : tf('{n} props', { n: props }));
    if (n.getAttribute('aria-label') !== s.name) n.setAttribute('aria-label', s.name);
    setClass(n, 'is-busy', this.busy === s.id);
    setClass(n, 'is-picked', this.picked === s.id);
    const pressed = String(this.picked === s.id);
    if (n.getAttribute('aria-pressed') !== pressed) n.setAttribute('aria-pressed', pressed);
    setDisabled(n as HTMLButtonElement, this.busy !== null);
  }

  /** The scene drawn small off screen, every layer in its place (one that cannot be drawn is left out), then shown in one copy. */
  private async thumb(s: SceneEntry): Promise<void> {
    const off = new OffscreenCanvas(THUMB_W, THUMB_H);
    const ctx = off.getContext('2d');
    if (!ctx) return;
    const k = Math.min(THUMB_W / s.width, THUMB_H / s.height);
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, THUMB_W, THUMB_H);
    for (const l of s.layers) {
      try {
        const res = await fetch(sceneFileUrl(s, l.file));
        if (!res.ok) continue;
        await withSvgImage(await res.text(), (img) => {
          const w = img.naturalWidth * l.scale * k, h = img.naturalHeight * l.scale * k;
          ctx.drawImage(img, l.x * k - w / 2, l.y * k - h / 2, w, h);
        });
      } catch { /* left out */ }
    }
    this.grid.querySelector<HTMLElement>(`[data-key="${CSS.escape(s.id)}"]`)?.querySelector('canvas')?.getContext('2d')?.drawImage(off, 0, 0);
  }

  private async choose(entry: SceneEntry): Promise<void> {
    if (this.busy) return;
    this.busy = entry.id;
    this.paint();
    try {
      const done = this.mode === 'add' && this.onAdd ? await this.onAdd(entry) : await this.make(entry);
      if (done) this.close();
    } catch (e) {
      toast(e instanceof Error ? e.message : t(this.mode === 'add' ? 'The scene could not be added.' : 'The scene could not be opened.'), 'error');
    } finally {
      this.busy = null;
      this.paint();
    }
  }
}
