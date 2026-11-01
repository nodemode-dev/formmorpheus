// A movie whose Text names a font that is not in the movie, the Fonts library, the app or this computer: a prompt offers
// Replace (pick another family) or Keep (the name stays, shown in a fallback face until the font is installed).
import type { Engine } from '../engine/engine';
import * as ops from '../engine/ops';
import type { Content, Movie } from '../engine/types';
import { BUNDLED_FONTS, GENERIC_FONTS, ensureTextFont, fontCatalog, loadTextFonts } from '../media/fonts';
import { libraryFamilies, libraryReady } from '../io/fonts-library';
import { Dialog } from './dialogs';
import { el, q, setText } from './dom';
import { t } from './i18n';

const KEEP = 'formmorpheus.fontkeep';

function used(m: Movie): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (f: string | undefined, id: string): void => { if (f) out.set(f, [...(out.get(f) ?? []), id]); };
  const walk = (tracks: Movie['tracks']): void => {
    for (const tr of tracks) for (const c of tr.content as Content[]) {
      if (c.kind === 'text' && c.text) { add(c.text.font, c.id); for (const r of c.text.runs ?? []) add(r.font, c.id); }
      if (c.kind === 'group') walk(c.tracks);
    }
  };
  walk(m.tracks);
  return out;
}

let probe: CanvasRenderingContext2D | null | undefined;
/** True when the system draws the family under its own name (it measures differently from every generic fallback). */
function installed(family: string): boolean {
  if (probe === undefined) probe = document.createElement('canvas').getContext('2d');
  const c = probe;
  if (!c) return true;
  const text = 'mmmmmmmmmmlliWWW@@ 0123 日本語العربية';
  const w = (f: string): number => { c.font = `72px ${f}`; return c.measureText(text).width; };
  return ['monospace', 'serif', 'sans-serif'].some((b) => w(`"${family}", ${b}`) !== w(b));
}

export function fontAvailable(m: Movie, family: string): boolean {
  if (BUNDLED_FONTS.includes(family) || GENERIC_FONTS.includes(family) || libraryFamilies().includes(family)) return true;
  if (Object.values(m.assets).some((a) => a.kind === 'font' && a.family === family)) return true;
  return installed(family);
}

class MissingDialog extends Dialog {
  private readonly lead = el<HTMLElement>('<p class="fm-fm-lead"></p>');
  private readonly pick = el<HTMLSelectElement>('<select class="cv-input" aria-label="Replacement font"></select>');
  private done: ((replace: string | null) => void) | null = null;

  constructor() {
    super('Font missing', 440);
    const row = el<HTMLElement>('<label class="cv-field"><span></span></label>');
    setText(q(row, 'span'), t('Replace with'));
    row.appendChild(this.pick);
    this.body.append(this.lead, row);
    this.button('Keep', 'ghost', () => this.finish(null));
    this.button('Replace', 'primary', () => this.finish(this.pick.value));
    this.onClose = () => { const d = this.done; this.done = null; d?.(null); };
  }

  private finish(v: string | null): void {
    const d = this.done;
    this.done = null;
    d?.(v);
    this.close();
  }

  ask(font: string, count: number, families: string[]): Promise<string | null> {
    setText(this.lead, t('The font "{font}" used by {n} Text is not in this movie or installed here. Replace it, or keep the name?').replace('{font}', font).replace('{n}', String(count)));
    if (this.pick.options.length !== families.length || Array.from(this.pick.options).some((o, i) => o.value !== families[i])) {
      this.pick.textContent = '';
      for (const f of families) { const o = document.createElement('option'); o.value = f; o.textContent = f; this.pick.appendChild(o); }
    }
    this.pick.value = 'Inter';
    return new Promise((resolve) => { this.done = resolve; this.open(this.pick); });
  }
}

let promptNow: (() => Promise<void>) | null = null;
export const askMissingFonts = (): Promise<void> => (promptNow ? promptNow() : Promise.resolve());

/** Families used by Text that overlaps frames [from, to) and cannot be found: they are drawn in a fallback face. */
export function substitutedFonts(m: Movie, from: number, to: number): string[] {
  const out = new Set<string>();
  const walk = (tracks: Movie['tracks']): void => {
    for (const tr of tracks) for (const c of tr.content as Content[]) {
      if (c.kind === 'group') { walk(c.tracks); continue; }
      if (c.kind !== 'text' || !c.text || c.start >= to || c.start + c.duration <= from) continue;
      for (const f of [c.text.font, ...(c.text.runs ?? []).map((r) => r.font)]) if (f && !fontAvailable(m, f)) out.add(f);
    }
  };
  walk(m.tracks);
  return Array.from(out);
}

/** Looks at each newly opened movie once and asks about every font it cannot find. */
export function watchMissingFonts(engine: Engine): void {
  let dialog: MissingDialog | null = null;
  let lastId = '';
  let timer = 0;
  const kept = (): string[] => { try { return JSON.parse(localStorage.getItem(KEEP) ?? '[]') as string[]; } catch { return []; } };
  const remember = (k: string): void => { try { localStorage.setItem(KEEP, JSON.stringify([...kept(), k].slice(-400))); } catch { /* not kept */ } };

  const check = async (id: string, force = false): Promise<void> => {
    // the Fonts library loads beside the movie: wait for it, so an installed font is not called missing
    for (let i = 0; i < 25 && !libraryReady(); i++) await new Promise((r) => window.setTimeout(r, 100));
    const m = engine.movie;
    if (!m || m.id !== id) return;
    for (const [font, ids] of used(m)) {
      const cur = engine.movie;
      if (!cur || cur.id !== id) return;
      const key = `${id}|${font}`;
      if (fontAvailable(cur, font) || (!force && kept().includes(key))) continue;
      dialog ??= new MissingDialog();
      const cat = fontCatalog(cur);
      const answer = await dialog.ask(font, new Set(ids).size, [...cat.bundled, ...cat.library, ...cat.movie]);
      if (answer === null) { remember(key); continue; }
      const targets = new Set(ids);
      await ensureTextFont({ font: answer, weight: 400, size: 32, text: 'Aa' });
      engine.run('Replace font', (mv) => {
        let next = mv;
        for (const cid of targets) {
          try {
            next = ops.updateContent(next, cid, (c) => c.text ? { ...c, text: { ...c.text, font: c.text.font === font ? answer : c.text.font, runs: c.text.runs?.map((r) => (r.font === font ? { ...r, font: answer } : r)) } } : c);
          } catch { /* a locked track keeps its font */ }
        }
        return { movie: next };
      });
      if (engine.movie) await loadTextFonts(engine.movie);
    }
  };

  // the Export window's note opens the same prompt, even for fonts the person chose to Keep
  promptNow = async () => { const m = engine.movie; if (m) await check(m.id, true); };
  engine.on('projects', () => {
    const m = engine.movie;
    if (!m) { lastId = ''; return; }
    if (m.id === lastId) return;
    lastId = m.id;
    window.clearTimeout(timer);
    const id = m.id;
    timer = window.setTimeout(() => { void check(id); }, 600);
  });
}
