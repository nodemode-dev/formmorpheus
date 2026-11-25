// File, New from Starter Scene...: the scenes in the starter manifest as cards with a small picture of each; choosing
// one makes a new movie from it. Built once; the cards are patched in place.
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

  /** `make` opens the scene and says whether it did; when the person stays with the current movie the dialog stays open. */
  constructor(private readonly make: (entry: SceneEntry) => Promise<boolean>) {
    super('New from Starter Scene', 560);
    this.body.append(this.grid, this.empty);
    this.button('Cancel', 'ghost', () => this.close());
    this.grid.addEventListener('click', (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('.fm-ss-card')?.dataset.key;
      const entry = this.scenes?.find((s) => s.id === key);
      if (entry) void this.choose(entry);
    });
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

  async show(): Promise<void> {
    await this.load();
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
  }

  private update(n: HTMLElement, s: SceneEntry): void {
    setText(q(n, '.fm-ss-name'), s.name);
    const props = s.layers.length - 1;
    setText(q(n, '.fm-ss-meta'), props === 1 ? t('1 prop') : tf('{n} props', { n: props }));
    if (n.getAttribute('aria-label') !== s.name) n.setAttribute('aria-label', s.name);
    setClass(n, 'is-busy', this.busy === s.id);
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
      if (await this.make(entry)) this.close();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('The scene could not be opened.'), 'error');
    } finally {
      this.busy = null;
      this.paint();
    }
  }
}
