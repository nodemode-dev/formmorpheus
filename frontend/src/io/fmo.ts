import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { packStates, unpackStates, type PackedStates, type RecoveryPoint, type Step } from '../engine/history';
import { normalizeMovie } from '../engine/normalize';
import { FORMAT_VERSION, type Movie } from '../engine/types';
import { VERSION } from '../version';

export interface MovieFile {
  movie: Movie;
  past: Step[];
  recovery: RecoveryPoint[];
  assets: Map<string, Blob>;
}

interface Manifest {
  app: 'formmorpheus';
  format: number;
  version: string;
  saved: number;
  history: boolean;
}

interface HistoryRecord {
  labels: string[];
  recovery: { id: string; label: string; time: number }[];
  states: PackedStates;
}

export const MIME = 'application/x-formmorpheus';

export async function packMovie(movie: Movie, past: Step[], recovery: RecoveryPoint[], assets: Map<string, Blob>, poster: Blob | null, withHistory = true, preview: Blob | null = null): Promise<Blob> {
  const files: Zippable = {};
  const manifest: Manifest = { app: 'formmorpheus', format: FORMAT_VERSION, version: VERSION, saved: Date.now(), history: withHistory };
  files['manifest.json'] = [strToU8(JSON.stringify(manifest)), { level: 6 }];
  files['movie.json'] = [strToU8(JSON.stringify(movie)), { level: 6 }];
  if (withHistory && (past.length || recovery.length)) {
    const states = packStates([...past.map((s) => s.movie), ...recovery.map((r) => r.movie)]);
    const record: HistoryRecord = { labels: past.map((s) => s.label), recovery: recovery.map((r) => ({ id: r.id, label: r.label, time: r.time })), states };
    files['history.json'] = [strToU8(JSON.stringify(record)), { level: 6 }];
  }
  const used = referencedAssets(movie, withHistory ? [...past.map((s) => s.movie), ...recovery.map((r) => r.movie)] : []);
  for (const id of used) {
    const blob = assets.get(id);
    if (blob) files[`assets/${id}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  if (poster) files['poster.png'] = [new Uint8Array(await poster.arrayBuffer()), { level: 0 }];
  if (preview) files['preview.png'] = [new Uint8Array(await preview.arrayBuffer()), { level: 0 }];
  const zipped = zipSync(files);
  return new Blob([zipped.buffer as ArrayBuffer], { type: MIME });
}

export async function unpackMovie(data: Blob): Promise<MovieFile> {
  const entries = unzipSync(new Uint8Array(await data.arrayBuffer()));
  const manifestRaw = entries['manifest.json'];
  if (!manifestRaw) throw new Error('This is not a formmorpheus movie.');
  const manifest = JSON.parse(strFromU8(manifestRaw)) as Partial<Manifest>;
  if (manifest.app !== 'formmorpheus') throw new Error('This is not a formmorpheus movie.');
  if (typeof manifest.format !== 'number' || manifest.format > FORMAT_VERSION) throw new Error('This movie was saved by a newer formmorpheus. Update to open it.');
  const movieRaw = entries['movie.json'];
  if (!movieRaw) throw new Error('The movie file is damaged.');
  // older files lack fields newer code reads: filled in memory, the file itself changes only when saved
  const movie = normalizeMovie(JSON.parse(strFromU8(movieRaw)));
  const assets = new Map<string, Blob>();
  for (const [path, bytes] of Object.entries(entries)) {
    if (!path.startsWith('assets/')) continue;
    const id = path.slice(7);
    const meta = movie.assets[id];
    assets.set(id, new Blob([bytes.buffer as ArrayBuffer], { type: meta?.mime ?? 'application/octet-stream' }));
  }
  let past: Step[] = [];
  let recovery: RecoveryPoint[] = [];
  const histRaw = entries['history.json'];
  if (histRaw) {
    try {
      const record = JSON.parse(strFromU8(histRaw)) as HistoryRecord;
      const states = (unpackStates(record.states) as unknown[]).map((s) => normalizeMovie(s));
      past = record.labels.map((label, i) => ({ label, movie: states[i] }));
      recovery = record.recovery.map((r, i) => ({ ...r, movie: states[record.labels.length + i] }));
    } catch {
      past = [];
      recovery = [];
    }
  }
  return { movie, past, recovery, assets };
}

function referencedAssets(movie: Movie, others: Movie[]): Set<string> {
  const ids = new Set<string>();
  for (const m of [movie, ...others]) for (const id of Object.keys(m.assets)) ids.add(id);
  return ids;
}
