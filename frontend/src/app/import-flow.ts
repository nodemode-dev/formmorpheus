// Import flow: files from the Import command or a drop become assets and content in the movie as one undo step.
// A drop on the Timeline places the content at the pointer's track and time; a drop on the Stage lands at the
// Playhead on the top track. Several pictures arrive together, each on its own track at equal length; several videos
// follow each other in order. A sound picked with Import is previewed first.
import type { Engine } from '../engine/engine';
import * as ops from '../engine/ops';
import type { Renderer } from '../engine/render';
import type { Content, Movie } from '../engine/types';
import { registerFonts } from '../media/fonts';
import { importMedia, type ImportResult } from '../media/import';
import { firstPictures } from '../media/plan';
import type { VideoPool } from '../media/video';
import { toast } from '../ui/toast';
import { isSoundFile, previewSound } from '../ui/import-preview';
import { previewSounds } from '../ui/preview-pref';

export interface DropPoint {
  where: 'timeline' | 'stage';
  /** Timeline only: the frame and track row under the pointer. */
  frame?: number;
  index?: number;
}

export interface ImportOptions {
  drop?: DropPoint;
  /** Ask first for a lone sound (the Import command); a drop skips the preview. */
  preview?: boolean;
}

export interface ImportDeps {
  engine: Engine;
  renderer: Renderer;
  video: VideoPool;
  /** Opens a movie file given among the files. */
  openMovie(f: File): Promise<void>;
}

interface Done { file: File; r: ImportResult }

export function createImporter(d: ImportDeps): { importFiles(files: File[], opts?: ImportOptions): Promise<void> } {
  const { engine, renderer, video } = d;

  async function importFiles(files: File[], opts: ImportOptions = {}): Promise<void> {
    const m = engine.movie;
    if (!m) { toast('Open or create a movie first.'); return; }
    const movie = files.find((f) => /\.fmo$/i.test(f.name));
    if (movie) { await d.openMovie(movie); return; }
    let list = files;
    if (opts.preview && list.length === 1 && isSoundFile(list[0]) && !(await previewSound(list[0], previewSounds.on))) return;
    if (!list.length) return;
    list = [...list];
    const job = engine.startJob(list.length === 1 ? `Import ${list[0].name}` : `Import ${list.length} files`, 1000);
    const done: Done[] = [];
    try {
      let at = opts.drop?.where === 'timeline' ? opts.drop.frame ?? engine.frame : engine.frame;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        try {
          const r = await importMedia(f, m, at, (p, what) => { job.name = what; engine.stepJob(job, Math.round(((i + p) / list.length) * 1000)); });
          done.push({ file: f, r });
          // videos follow each other in order
          const last = r.contents[0];
          if (last && last.kind === 'video') at = last.start + last.duration;
        } catch (e) {
          toast(e instanceof Error ? e.message : `${f.name} could not be imported.`, 'error');
        }
        engine.stepJob(job, Math.round(((i + 1) / list.length) * 1000));
      }
      if (done.length) await place(m, done, opts);
    } finally {
      engine.endJob(job);
    }
  }

  async function place(m: Movie, done: Done[], opts: ImportOptions): Promise<void> {
    const blobs = new Map<string, Blob>();
    const assets = done.flatMap((x) => x.r.assets);
    for (const { asset, blob } of assets) { engine.assets.set(asset.id, blob); if (asset.kind === 'image' || asset.kind === 'pixels') blobs.set(asset.id, blob); }
    await renderer.preload(blobs);
    const all: Content[] = done.flatMap((x) => x.r.contents);
    // a video block and its box appear together with their first picture, never before it
    await firstPictures(video, m, all);
    const table = Object.fromEntries(assets.map((a) => [a.asset.id, a.asset]));
    if (assets.some((a) => a.asset.kind === 'font')) await registerFonts({ ...m, assets: { ...m.assets, ...table } }, (id) => engine.assets.get(id));

    // a formvis document that left from this Drawing: its layers are swapped in as one undo step
    const rep = done.find((x) => x.r.replaces);
    if (rep && done.length === 1) {
      const target = rep.r.replaces as string, layers = rep.r.contents[0].layers;
      engine.run('Update Drawing from formvis', (mv) => ({ movie: ops.updateContent({ ...mv, assets: { ...mv.assets, ...table } }, target, (c) => ({ ...c, layers })), select: [target] }));
      if (rep.r.notice) toast(rep.r.notice);
      return;
    }

    const drop = opts.drop;
    const selected = engine.selection.track ? Math.max(0, m.tracks.findIndex((tr) => tr.id === engine.selection.track)) : 0;
    const label = done.length === 1 ? `Add ${done[0].file.name.replace(/\.[^.]+$/, '')}` : `Add ${done.length} files`;
    engine.run(label, (mv) => {
      let next: Movie = { ...mv, assets: { ...mv.assets, ...table } };
      const ids: string[] = [];
      for (const x of done) {
        x.r.contents.forEach((c, i) => {
          if (drop?.where === 'timeline') {
            // at the track under the pointer when it has room there, else a new track at that row
            const row = Math.min(drop.index ?? 0, next.tracks.length);
            next = ops.placeContent(next, next.tracks[row]?.id ?? null, c, row).movie;
          } else if (drop?.where === 'stage') {
            // at the Playhead on the top track when it has room, else a new top track
            next = ops.placeContent(next, next.tracks[0]?.id ?? null, c, 0).movie;
          } else if (x.r.ownTrack[i]) {
            const added = ops.addTrack(next, Math.min(next.tracks.length, selected + 1), c.name);
            next = ops.placeContent(added.movie, added.track.id, c).movie;
          } else next = ops.placeContent(next, null, c, selected).movie;
          ids.push(c.id);
        });
      }
      return { movie: next, select: ids };
    });
    const notes = done.map((x) => x.r.notice).filter((s): s is string => !!s);
    if (notes.length) toast(notes.join(' '));
  }

  return { importFiles };
}
