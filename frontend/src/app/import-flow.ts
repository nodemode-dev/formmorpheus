// Import flow: files from the Import command or a drop become assets and content in the movie as one undo step.
// A drop on the Timeline places the content at the pointer's track and time; a drop on the Stage lands at the
// Playhead on the top track. Several pictures arrive together, each on its own track at equal length; several videos
// follow each other in order. A sound picked with Import is previewed first.
import type { Engine } from '../engine/engine';
import * as ops from '../engine/ops';
import * as groupInner from '../engine/group-inner-ops';
import { groupCtx } from '../engine/group-ctx';
import type { Renderer } from '../engine/render';
import type { Content, Movie } from '../engine/types';
import { registerFonts } from '../media/fonts';
import { findSequence, importMedia, importSequence, type ImportResult } from '../media/import';
import { askSequence } from '../ui/sequence-dialog';
import { firstPictures } from '../media/plan';
import type { VideoPool } from '../media/video';
import { toast } from '../ui/toast';
import { t } from '../ui/i18n';
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
    if (opts.preview) {
      // every sound among the picked files is heard first; Cancel leaves that one out
      const kept: File[] = [];
      for (const f of list) if (!isSoundFile(f) || (await previewSound(f, previewSounds.on))) kept.push(f);
      list = kept;
    }
    if (!list.length) return;
    list = [...list];
    // several numbered pictures together: one Flipbook at a rate the person gives, or each on its own
    const seq = findSequence(list);
    let asOne: { files: File[]; fps: number } | null = null;
    if (seq) {
      const pick = await askSequence(seq.length, seq[0].name, m.fps);
      if (!pick) return;
      if (pick.as === 'flipbook') { asOne = { files: seq, fps: pick.fps }; list = list.filter((f) => !seq.includes(f)); }
    }
    const job = engine.startJob(asOne ? `Import ${asOne.files.length} numbered pictures` : list.length === 1 ? `Import ${list[0].name}` : `Import ${list.length} files`, 1000);
    const done: Done[] = [];
    try {
      let at = opts.drop?.where === 'timeline' ? opts.drop.frame ?? engine.frame : engine.frame;
      if (asOne) {
        try { done.push({ file: asOne.files[0], r: await importSequence(asOne.files, m, at, asOne.fps) }); } catch (e) {
          toast(e instanceof Error ? e.message : t('The pictures could not be imported.'), 'error');
        }
      }
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
    const hl = engine.selection.track;
    const roomOn = (mv: Movie, id: string, c: Content): boolean => {
      const t = mv.tracks.find((x) => x.id === id);
      return !!t && !t.locked && t.content.every((o) => o.start + o.duration <= c.start || c.start + c.duration <= o.start);
    };
    const gid = groupCtx.target();
    const grp = gid ? groupInner.findGroup(m.tracks, gid) : null;
    // a file that only fills the media bin (a project file) is an import, not an addition to the timeline
    const label = done.length === 1 && !done[0].r.contents.length ? `Import from ${done[0].file.name}` : done.length === 1 ? `Add ${done[0].file.name.replace(/\.[^.]+$/, '')}` : `Add ${done.length} files`;
    engine.run(label, (mv) => {
      let next: Movie = { ...mv, assets: { ...mv.assets, ...table } };
      const ids: string[] = [];
      for (const x of done) {
        x.r.contents.forEach((c, i) => {
          if (grp && !drop) {
            // an open group being worked in takes the file on its own tracks, in the group's frames
            const local = Math.max(grp.offset, c.start - grp.start + grp.offset);
            next = groupInner.placeInGroup(next, grp.id, { ...c, start: local }, 0);
          } else if (drop?.where === 'timeline') {
            // at the track under the pointer when it has room there, else a new track at that row
            const row = Math.min(drop.index ?? 0, next.tracks.length);
            next = ops.placeContent(next, next.tracks[row]?.id ?? null, c, row).movie;
          } else if (drop?.where === 'stage') {
            // at the Playhead on the top track when it has room, else a new top track
            next = ops.placeContent(next, next.tracks[0]?.id ?? null, c, 0).movie;
          } else if (hl && roomOn(next, hl, c)) {
            // the highlighted track has empty space at the Playhead: the file goes there
            next = ops.placeContent(next, hl, c, selected).movie;
          } else if (x.r.ownTrack[i]) {
            const added = ops.addTrack(next, Math.min(next.tracks.length, selected + 1), c.name);
            next = ops.placeContent(added.movie, added.track.id, c).movie;
          } else next = ops.placeContent(next, null, c, selected).movie;
          ids.push(c.id);
        });
      }
      if (grp) { groupCtx.picked = ids[ids.length - 1] ?? null; return { movie: next, select: [grp.id] }; }
      return { movie: next, select: ids };
    });
    const notes = done.map((x) => x.r.notice).filter((s): s is string => !!s);
    if (notes.length) toast(notes.join(' '));
  }

  return { importFiles };
}
