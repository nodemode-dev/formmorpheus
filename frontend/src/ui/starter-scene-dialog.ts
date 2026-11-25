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

const CARD = `<button class="fm-ss-card" type="button" role="listitem"><span class="fm-ss-thumb"><canvas width="${THUMB_W}" height="${THUMB_H}" aria-hidden="true"></canvas></span><span class="fm-ss-name"></span><span class="fm-ss-meta"></span></button>`;

export class StarterSceneDialog extends Dialog {
  private readonly grid = el<HTMLElement>('<div class="fm-ss-grid" role="list"></div>');
  private readonly empty = el<HTMLElement>('<p class="fm-ss-empty" hidden></p>');
  private scenes: SceneEntry[] | null = null;
  private busy: string | null = null;
  private readonly drawn = new Set<string>();

  constructor(private readonly make: (entry: SceneEntry) => Promise<void>) {
    super('New from Starter Scene', 560);
    this.body.append(this.grid, this.empty);
    this.button('Cancel', 'ghost', () => this.close());
    this.grid.addEventListener('click', (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('.fm-ss-card')?.dataset.key;
      const entry = this.scenes?.find((s) => s.id === key);
      if (entry) void this.choose(entry);
    });
  }

  async show(): Promise<void> {
    this.open();
    if (!this.scenes) {
      this.scenes = await readSceneManifest();
      this.paint();
    } else this.paint();
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

  /** The scene drawn small, every layer in its place; a layer that cannot be drawn is left out. */
  private async thumb(s: SceneEntry): Promise<void> {
    const cv = this.grid.querySelector<HTMLElement>(`[data-key="${CSS.escape(s.id)}"]`)?.querySelector('canvas');
    const ctx = cv?.getContext('2d');
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
  }

  private async choose(entry: SceneEntry): Promise<void> {
    if (this.busy) return;
    this.busy = entry.id;
    this.paint();
    try {
      await this.make(entry);
      this.close();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('The scene could not be opened.'), 'error');
    } finally {
      this.busy = null;
      this.paint();
    }
  }
}
