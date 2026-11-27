import type { Engine } from '../engine/engine';
import type { Renderer } from '../engine/render';
import type { AudioEngine } from '../media/audio';
import type { ConsentChoice, ConsentRequest } from '../dock/adapter';
import type { ExportFormat, ExportOptions } from '../export/types';
import { startExportRouted } from '../export/route';
import { startEngineExport, type EngineTarget } from '../export/engine-jobs';
import { outsideAgents } from '../dock-adapter';
import { api, ApiError } from '../io/api';
import { charactersApi } from '../io/characters-api';
import type { SpeakRequest, VoiceEngine } from '../io/voice-api';
import { placeCharacter, unpackCharacter } from '../ui/characters-panel';
import { t } from '../ui/i18n';
import type { SpokenOnTimeline } from './voice-commands';

export interface BridgeDeps {
  engine: Engine;
  renderer: Renderer;
  audio: () => AudioEngine | null;
  open(name: string): Promise<void>;
  save(): Promise<boolean>;
  commitOpen(): Promise<void>;
  importFile(file: File, at: number | undefined, row: number | undefined): Promise<void>;
  exportBusy(): boolean;
  listed(): void;
  speak: (req: SpeakRequest, frame?: number) => Promise<SpokenOnTimeline | null>;
}

type Args = Record<string, unknown>;
type Result = { ok: true } & Record<string, unknown> | { ok: false; error: string };
interface Item { id: string; kind: string; request?: unknown; arguments?: Args; reason?: string }

const ENGINE: Partial<Record<ExportFormat, EngineTarget>> = { 'prores-mov': 'prores', 'prores4444-mov': 'prores4444', 'hevc-mp4': 'hevc', 'hevc-mov': 'hevc', 'h264-mov': 'h264', 'h264-mp4': 'h264' };
const VIDEO: ExportFormat[] = ['mp4', 'webm', 'mov', 'prores-mov', 'prores4444-mov', 'hevc-mp4', 'hevc-mov', 'h264-mov', 'h264-mp4'];
const QUALITY = ['low', 'medium', 'high', 'very-high'] as const;
const VOICES: VoiceEngine[] = ['builtin', 'local', 'online'];
const RETRY_MS = 3000;
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);
const whole = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const said = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : fallback);
const wait = (ms: number): Promise<void> => new Promise((r) => { window.setTimeout(r, ms); });

function consentOf(raw: unknown): ConsentRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id);
  if (!id) return null;
  const offers = (Array.isArray(r.offers) ? r.offers : []).filter((x): x is ConsentChoice => x === 'deny' || x === 'once' || x === 'always');
  return {
    id, agent: text(r.agent), what: text(r.what), offers: offers.length ? offers : ['deny'], always: r.always === 'agent' ? 'agent' : 'all', escape: 'deny',
    notes: (Array.isArray(r.notes) ? r.notes : []).filter((x): x is string => typeof x === 'string'),
    ...(typeof r.expires === 'number' ? { expires: r.expires } : {}),
  };
}

export function startAgentBridge(d: BridgeDeps): void {
  let working = false;
  const front = async (name: string): Promise<string | null> => {
    if (d.engine.libraryName !== name) {
      if (d.exportBusy()) return t('An export is running in FormMorpheus, so another movie cannot be opened yet. Try again when it has finished.');
      await d.open(name);
    }
    return d.engine.movie && d.engine.libraryName === name ? null : t('FormMorpheus could not open that movie.');
  };

  const exportMovie = async (a: Args): Promise<Result> => {
    const name = text(a.movie);
    const format = text(a.format) as ExportFormat;
    if (d.exportBusy()) return { ok: false, error: t('An export is already running in FormMorpheus. Try again when it has finished.') };
    const blocked = await front(name);
    if (blocked) return { ok: false, error: blocked };
    await d.commitOpen().catch(() => undefined);
    const movie = d.engine.movie;
    if (!movie) return { ok: false, error: t('FormMorpheus could not open that movie.') };
    const end = Math.max(1, movie.duration);
    const from = Math.min(end - 1, Math.max(0, whole(a.from) ?? 0));
    const to = Math.min(end, Math.max(from + 1, whole(a.to) ?? end));
    const quality = QUALITY.find((x) => x === a.quality) ?? 'high';
    const opts: ExportOptions = {
      format, width: even(whole(a.width) ?? movie.width), height: even(whole(a.height) ?? movie.height), from, to, pingpong: false,
      includeAudio: VIDEO.includes(format) && a.audio !== false, alpha: false, quality,
      gif: { colors: 256, dither: 'floyd-steinberg', palette: null, alphaThreshold: 128, loop: true, timing: 'exact', exactFrames: true },
    };
    const label = t('Export {name}').replace('{name}', movie.name);
    const shown = d.engine.startJob(label, 1);
    const deps = { movie, renderer: d.renderer, audio: d.audio() };
    const target = ENGINE[format];
    const job = target ? startEngineExport(deps, { ...opts, target }) : startExportRouted(deps, opts);
    const off = d.engine.on('progress', () => { if (shown.cancelled) job.cancel(); });
    job.onProgress((p) => { shown.total = Math.max(1, p.total); d.engine.stepJob(shown, p.done); });
    try {
      const res = await job.result;
      const warnings = [...res.warnings];
      let file = res.name;
      const stem = text(a.name);
      if (res.kept) {
        if (stem) warnings.push(t('This format is written by the engine under the movie\'s own name, so the name asked for was not used.'));
      } else {
        const dot = res.name.lastIndexOf('.');
        file = (await api.writeOutput(stem ? `${stem}${dot >= 0 ? res.name.slice(dot) : ''}` : res.name, res.blob)).name;
      }
      d.listed();
      return { ok: true, file, warnings };
    } catch (e) {
      return { ok: false, error: e instanceof DOMException && e.name === 'AbortError' ? t('The export was cancelled in FormMorpheus.') : said(e, t('The export failed.')) };
    } finally {
      off();
      d.engine.endJob(shown);
    }
  };

  const importFile = async (id: string, a: Args): Promise<Result> => {
    const name = text(a.movie);
    const blocked = await front(name);
    if (blocked) return { ok: false, error: blocked };
    const movie = d.engine.movie;
    if (!movie) return { ok: false, error: t('FormMorpheus could not open that movie.') };
    const r = await fetch(`/api/mcp/bridge/file/${encodeURIComponent(id)}`);
    if (!r.ok) return { ok: false, error: t('FormMorpheus could not read that file from the engine.') };
    const file = new File([await r.blob()], text(a.file) || 'file');
    const wanted = text(a.track);
    const row = wanted ? movie.tracks.findIndex((tr) => tr.name === wanted) : -1;
    if (wanted && row < 0) return { ok: false, error: t('This movie has no track with that name.') };
    const before = d.engine.revision;
    await d.importFile(file, whole(a.at), row < 0 ? undefined : row);
    if (d.engine.revision === before) return { ok: false, error: t('FormMorpheus could not import that file.') };
    const saved = await d.save();
    return { ok: true, content: file.name.replace(/\.[^.]+$/, ''), saved };
  };

  const addCharacter = async (a: Args): Promise<Result> => {
    const name = text(a.movie);
    if (name) {
      const blocked = await front(name);
      if (blocked) return { ok: false, error: blocked };
    }
    if (!d.engine.movie) return { ok: false, error: t('FormMorpheus could not open that movie.') };
    const src = await unpackCharacter(await charactersApi.read(text(a.character)));
    const at = whole(a.at);
    const id = await placeCharacter(d.engine, d.renderer, src, at === undefined ? 'playhead' : { frame: Math.max(0, at), index: 0 });
    if (!id) return { ok: false, error: t('The character could not be added.') };
    const saved = await d.save();
    return { ok: true, content: src.group.character?.name ?? src.group.name, movie: d.engine.libraryName ?? d.engine.movie?.name ?? '', saved };
  };

  const addVoice = async (a: Args): Promise<Result> => {
    const name = text(a.movie);
    if (name) {
      const blocked = await front(name);
      if (blocked) return { ok: false, error: blocked };
    }
    if (!d.engine.movie) return { ok: false, error: t('FormMorpheus could not open that movie.') };
    const speed = typeof a.speed === 'number' && Number.isFinite(a.speed) ? a.speed : undefined;
    const req: SpeakRequest = {
      engine: VOICES.find((x) => x === a.engine) ?? 'builtin', text: text(a.text),
      ...(text(a.voice) ? { voice: text(a.voice) } : {}), ...(text(a.language) ? { language: text(a.language) } : {}),
      ...(speed === undefined ? {} : { speed }), ...(text(a.model) ? { model: text(a.model) } : {}),
    };
    const at = whole(a.at);
    let done: SpokenOnTimeline | null;
    try {
      done = await d.speak(req, at === undefined ? undefined : Math.max(0, at));
    } catch (e) {
      // The engine's own sentence says why the voice could not speak; anything else goes to take's catch.
      if (e instanceof ApiError) return { ok: false, error: e.message };
      throw e;
    }
    if (!done) return { ok: false, error: t('The voice could not be added.') };
    const saved = await d.save();
    return { ok: true, content: done.name, seconds: done.seconds, movie: d.engine.libraryName ?? d.engine.movie?.name ?? '', saved };
  };

  const answer = (id: string, result: Result): Promise<unknown> => fetch('/api/mcp/bridge/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, result }) }).catch(() => undefined);

  const take = async (item: Item): Promise<void> => {
    if (item.kind === 'consent') {
      const request = consentOf(item.request);
      if (request) outsideAgents.show(request);
      return;
    }
    if (item.kind === 'consent_gone') { outsideAgents.gone(text(item.request)); return; }
    const a = item.arguments ?? {};
    let result: Result;
    if (working) result = { ok: false, error: t('FormMorpheus is still doing the last thing an agent asked for. Try again when it has finished.') };
    else {
      working = true;
      try {
        result = item.kind === 'export_movie' ? await exportMovie(a) : item.kind === 'import_file' ? await importFile(item.id, a) : item.kind === 'add_character' ? await addCharacter(a) : item.kind === 'add_voice' ? await addVoice(a) : { ok: false, error: t('This FormMorpheus window does not know that request.') };
      } catch (e) {
        result = { ok: false, error: said(e, t('FormMorpheus could not do that.')) };
      }
      working = false;
    }
    await answer(item.id, result);
  };

  const loop = async (): Promise<void> => {
    for (;;) {
      try {
        const r = await fetch('/api/mcp/bridge/next');
        if (r.status === 200) void take((await r.json()) as Item);
        else if (r.status !== 204) await wait(RETRY_MS);
      } catch {
        await wait(RETRY_MS);
      }
    }
  };
  void loop();
}
