// A character's source link: while the window has focus, every 2 seconds, the stat of each linked SVG is asked for
// (one request in flight per file); a changed file is read again and laid over its characters as one undo step,
// "Update from Source". The character menu's Update from Source..., Unlink Source and Relink Source... live here too.
import type { Engine } from '../engine/engine';
import * as ops from '../engine/ops';
import type { Renderer } from '../engine/render';
import { linkedCharacters, mergeFromSource, setSourceLink } from '../engine/source-merge';
import { findContent } from '../engine/transform';
import type { SourceLink } from '../engine/types';
import { ApiError } from '../io/api';
import { canLinkPaths, canWatchSources, pickSvgPath, sourceApi } from '../io/source-api';
import { svgToCharacterGroup } from '../io/svg-import';
import { platform } from '../platform';
import { selectedCharacter } from '../ui/character-commands';
import type { Command } from '../ui/commands';
import { t } from '../ui/i18n';
import { tf } from '../ui/i18n-fill';
import { toast } from '../ui/toast';

const EVERY_MS = 2000;
const leaf = (path: string): string => path.split(/[\\/]/).pop() || path;

export interface SourceLinkDeps { engine: Engine; renderer: Renderer }

export function setupSourceLink({ engine, renderer }: SourceLinkDeps): { commands: Command[] } {
  /** Per character, the file hash already laid over it this session: an undone update is not put back by the next poll. */
  const seen = new Map<string, string>();
  const busy = new Set<string>();
  const told = new Set<string>();
  const refused = new Set<string>();
  let timer = 0;

  /** Reads `text` as a character and lays it over `ids` in one step; `link` undefined keeps each character's link as it is. */
  async function apply(ids: string[], text: string, file: string, link: SourceLink | null | undefined, label: string): Promise<boolean> {
    const m = engine.movie;
    if (!m) return false;
    let fresh;
    let assets;
    try {
      const r = await svgToCharacterGroup(text, file, { ...m, tracks: [], assets: {} }, 0);
      fresh = r.contents[0];
      assets = r.assets;
    } catch (e) {
      toast(e instanceof Error ? e.message : t('This SVG file could not be read.'), 'error');
      return false;
    }
    if (!fresh?.character) return false;
    const blobs = new Map<string, Blob>();
    for (const { asset, blob } of assets) { engine.assets.set(asset.id, blob); if (asset.kind === 'image' || asset.kind === 'pixels') blobs.set(asset.id, blob); }
    await renderer.preload(blobs);
    const table = Object.fromEntries(assets.map((a) => [a.asset.id, a.asset]));
    const added = new Set<string>(), missing = new Set<string>();
    const base = fresh;
    const ok = engine.run(label, (mv) => {
      let next = mv;
      ids.filter((id) => !!findContent(next, id)?.character).forEach((id, i) => {
        const r = mergeFromSource(next, id, i ? ops.cloneContent(base, base.start) : base, table);
        r.added.forEach((n) => added.add(n));
        r.missing.forEach((n) => missing.add(n));
        next = link === undefined ? r.movie : setSourceLink(r.movie, id, link);
      });
      return { movie: next };
    });
    if (!ok) return false;
    let note = tf('Updated from {file}.', { file });
    if (added.size) note += ` ${tf('New parts: {names}.', { names: [...added].join(', ') })}`;
    if (missing.size) note += ` ${tf('Not in the source file: {names}.', { names: [...missing].join(', ') })}`;
    toast(note);
    return true;
  }

  function failed(e: unknown): void {
    if (e instanceof ApiError && e.status === 404) toast(t('Source file not found'), 'error');
    else toast(e instanceof Error ? e.message : t('The source file could not be read.'), 'error');
  }

  /** Reads the file at `path` and lays it over `ids`, linking them to it. */
  async function fromPath(ids: string[], path: string, label: string): Promise<void> {
    try {
      const { text, link } = await sourceApi.read(path);
      if (await apply(ids, text, leaf(path), link, label)) for (const id of ids) seen.set(id, link.sha256);
      refused.delete(path);
      told.delete(path);
    } catch (e) { failed(e); }
  }

  async function check(path: string): Promise<void> {
    let now: SourceLink;
    try { now = await sourceApi.stat(path); } catch (e) {
      if (!(e instanceof ApiError) || e.status === 0) return;
      if (e.status === 404) { if (!told.has(path)) { told.add(path); toast(`${t('Source file not found')}: ${leaf(path)}`, 'error'); } return; }
      refused.add(path);
      toast(e.message, 'error');
      return;
    }
    told.delete(path);
    const m = engine.movie;
    if (!m) return;
    const stale = linkedCharacters(m).filter((l) => l.source.path === path && l.source.sha256 !== now.sha256 && seen.get(l.id) !== now.sha256).map((l) => l.id);
    if (!stale.length) return;
    let read;
    try { read = await sourceApi.read(path); } catch { return; }
    for (const id of stale) seen.set(id, read.link.sha256);
    await apply(stale, read.text, leaf(path), read.link, 'Update from Source');
  }

  function tick(): void {
    const m = engine.movie;
    if (!m) return;
    for (const path of new Set(linkedCharacters(m).map((l) => l.source.path))) {
      if (busy.has(path) || refused.has(path)) continue;
      busy.add(path);
      void check(path).finally(() => busy.delete(path));
    }
  }

  const start = (): void => { if (!timer) { timer = window.setInterval(tick, EVERY_MS); tick(); } };
  const stop = (): void => { window.clearInterval(timer); timer = 0; };
  if (canWatchSources()) {
    window.addEventListener('focus', start);
    window.addEventListener('blur', stop);
    if (document.hasFocus()) start();
  }

  async function update(): Promise<void> {
    const g = selectedCharacter(engine);
    if (!g?.character) return;
    if (canLinkPaths()) {
      const path = await pickSvgPath('Update from Source', g.character.source?.path);
      if (path) await fromPath([g.id], path, 'Update from Source');
      return;
    }
    const [file] = await platform.files.pick({ accept: '.svg,image/svg+xml' });
    if (file) await apply([g.id], await file.text(), file.name, undefined, 'Update from Source');
  }

  async function relink(): Promise<void> {
    const g = selectedCharacter(engine);
    if (!g?.character) return;
    const path = await pickSvgPath('Relink Source', g.character.source?.path);
    if (path) await fromPath([g.id], path, 'Relink Source');
  }

  const linked = (): boolean => !!selectedCharacter(engine)?.character?.source;
  const commands: Command[] = [
    {
      id: 'character.source-update', label: 'Update from Source...', icon: 'refresh', mutates: true, enabled: () => !!selectedCharacter(engine),
      group: 'Content', description: 'Reads the selected character again from an SVG file: parts take their new art by name and keep their animation; new parts are added, parts gone from the file stay.',
      when: 'Use after the character\'s SVG was changed in a vector app and the window has not picked the change up by itself.',
      run: () => { void update(); },
    },
    {
      id: 'character.source-unlink', label: 'Unlink Source', icon: 'unlink', mutates: true, enabled: () => canWatchSources() && linked(),
      group: 'Content', description: 'Stops the selected character following its SVG file.',
      run: () => {
        const g = selectedCharacter(engine);
        if (g) { seen.delete(g.id); engine.run('Unlink Source', (m) => setSourceLink(m, g.id, null)); }
      },
    },
    {
      id: 'character.source-relink', label: 'Relink Source...', icon: 'link', mutates: true, enabled: () => canLinkPaths() && !!selectedCharacter(engine),
      group: 'Content', description: 'Links the selected character to an SVG file on disk and reads it from that file; later saves of the file update the character.',
      run: () => { void relink(); },
    },
  ];
  return { commands };
}
