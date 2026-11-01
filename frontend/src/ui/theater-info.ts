// Theater: the Info panel of a movie (size, length, frame rate, tracks, file size, dates) and its tags.
// One small dialog built once; its rows are patched in place each time it opens.
import { unzipSync, strFromU8 } from 'fflate';
import { api } from '../io/api';
import { el, q, setHidden, setText } from './dom';
import { dateText, t, tn } from './i18n';
import { tf } from './i18n-fill';
import { promptName } from './dialogs';
import '../styles/theater-info.css';

const TEMPLATE = `<div class="fm-tinfo" role="dialog" aria-modal="true" hidden>
  <div class="fm-tinfo-card">
    <div class="fm-tinfo-head"><span class="fm-tinfo-title"></span><button class="fm-tinfo-x" type="button" aria-label="Close">x</button></div>
    <dl class="fm-tinfo-list"></dl>
    <div class="fm-tinfo-foot"><button class="fm-tinfo-btn" type="button" data-act="tags"></button></div>
  </div>
</div>`;

const bytes = (n: number): string => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (s: number | undefined): string => (s ? `${dateText(s * 1000)} ${new Date(s * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '-');

interface Brief { width: number; height: number; fps: number; duration: number; tracks: number; blocks: number }

/** Reads movie.json out of the .fmo and nothing else (the assets stay packed). */
async function brief(name: string): Promise<Brief | null> {
  try {
    const entries = unzipSync(new Uint8Array(await (await api.readMovie(name)).arrayBuffer()), { filter: (f) => f.name === 'movie.json' });
    const m = JSON.parse(strFromU8(entries['movie.json'])) as { width: number; height: number; fps: number; duration: number; tracks?: { content?: unknown[] }[] };
    const tracks = m.tracks ?? [];
    return { width: m.width, height: m.height, fps: m.fps, duration: m.duration, tracks: tracks.length, blocks: tracks.reduce((a, tr) => a + (tr.content?.length ?? 0), 0) };
  } catch { return null; }
}

const seconds = (b: Brief): string => {
  const s = b.duration / b.fps;
  const text = s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return `${text} · ${b.duration} ${t('frames')}`;
};

class InfoDialog {
  private readonly root = el(TEMPLATE);
  private readonly list = q(this.root, '.fm-tinfo-list');
  private rows = new Map<string, HTMLElement>();
  private name = '';
  private onTags: (() => void) | null = null;

  constructor() {
    (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
    this.root.addEventListener('click', (e) => { if (e.target === this.root || (e.target as HTMLElement).closest('.fm-tinfo-x')) this.hide(); });
    this.root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.hide(); } });
    q(this.root, '[data-act="tags"]').addEventListener('click', () => { void editTags(this.name).then((ok) => { if (ok) { this.onTags?.(); void this.fill(); } }); });
  }

  private row(key: string, label: string): HTMLElement {
    let v = this.rows.get(key);
    if (!v) {
      const d = document.createElement('dt'), dd = document.createElement('dd');
      this.list.append(d, dd);
      this.rows.set(key, dd);
      v = dd;
      (v as HTMLElement & { _dt?: HTMLElement })._dt = d;
    }
    setText((v as HTMLElement & { _dt?: HTMLElement })._dt as HTMLElement, label);
    return v;
  }

  show(name: string, onTags: () => void): void {
    this.name = name;
    this.onTags = onTags;
    setText(q(this.root, '.fm-tinfo-title'), name);
    setText(q(this.root, '[data-act="tags"]'), t('Edit tags...'));
    q(this.root, '.fm-tinfo-x').setAttribute('aria-label', t('Close'));
    setHidden(this.root, false);
    void this.fill();
    q<HTMLButtonElement>(this.root, '.fm-tinfo-x').focus();
  }

  hide(): void { setHidden(this.root, true); }

  private async fill(): Promise<void> {
    const name = this.name;
    const [lib, tags] = await Promise.all([api.library().catch(() => []), api.tags()]);
    if (name !== this.name) return;
    const it = lib.find((i) => i.name === name);
    setText(this.row('size', t('File size')), it ? bytes(it.size) : '-');
    setText(this.row('made', t('Created')), when(it?.created));
    setText(this.row('mod', t('Modified')), when(it?.modified));
    setText(this.row('tags', t('Tags')), (tags[name] ?? []).join(', ') || '-');
    setText(this.row('dim', t('Stage size')), '...');
    setText(this.row('len', t('Length')), '...');
    setText(this.row('fps', t('Frame rate')), '...');
    setText(this.row('trk', t('Tracks')), '...');
    const b = await brief(name);
    if (name !== this.name) return;
    setText(this.row('dim', t('Stage size')), b ? `${b.width} x ${b.height} px` : '-');
    setText(this.row('len', t('Length')), b ? seconds(b) : '-');
    setText(this.row('fps', t('Frame rate')), b ? tf('{n} frames per second', { n: b.fps }) : '-');
    setText(this.row('trk', t('Tracks')), b ? `${tn(b.tracks, '{n} track', '{n} tracks')} · ${tn(b.blocks, '{n} block', '{n} blocks')}` : '-');
  }
}

let dialog: InfoDialog | null = null;

export function showMovieInfo(name: string, onTags: () => void): void {
  dialog ??= new InfoDialog();
  dialog.show(name, onTags);
}

/** Asks for the tags of a movie (comma separated) and stores them in the engine. */
export async function editTags(name: string): Promise<boolean> {
  const now = (await api.tags())[name] ?? [];
  const got = await promptName(t('Tags, separated by commas (a single - clears them)'), now.join(', '), t('Save'));
  if (got === null) return false;
  await api.setTags(name, got === '-' ? [] : got.split(',').map((s) => s.trim()).filter(Boolean));
  return true;
}
