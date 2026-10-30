export interface FpsPreset {
  fps: number;
  label: string;
}

export const FPS_PRESETS: FpsPreset[] = [
  { fps: 12, label: 'Frame by frame' },
  { fps: 15, label: 'Anime' },
  { fps: 24, label: 'Cinema' },
  { fps: 30, label: 'Television' },
  { fps: 50, label: 'PAL' },
  { fps: 60, label: 'NTSC' },
  { fps: 120, label: 'Mobile' },
];

export const MIN_FPS = 1;
export const MAX_FPS = 120;

export function clampFps(fps: number): number {
  if (!Number.isFinite(fps)) return 24;
  return Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(fps * 1000) / 1000));
}

export function framesFor(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

export function secondsOf(frames: number, fps: number): number {
  return frames / fps;
}

const pad = (n: number, w = 2): string => String(Math.max(0, Math.floor(n))).padStart(w, '0');

export function timecode(frame: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps));
  const sign = frame < 0 ? '-' : '';
  const f = Math.abs(Math.round(frame));
  const frames = f % rate;
  const secs = Math.floor(f / rate);
  const h = Math.floor(secs / 3600);
  const body = `${pad((secs / 60) % 60)}:${pad(secs % 60)}:${pad(frames)}`;
  return `${sign}${h > 0 ? `${h}:` : ''}${body}`;
}

export function durationLabel(frames: number, fps: number): string {
  const total = frames / fps;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sec = Number.isInteger(s) ? String(s) : s.toFixed(1);
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function parseTime(text: string, fps: number): number | null {
  const s = text.trim();
  if (!s) return null;
  if (/^[+-]?\d+f?$/.test(s)) return Number(s.replace('f', ''));
  if (/^[+-]?\d*\.?\d+s$/.test(s)) return Math.round(parseFloat(s) * fps);
  const parts = s.split(/[:;]/).map((x) => Number(x));
  if (parts.some((x) => Number.isNaN(x))) return null;
  const rate = Math.round(fps);
  while (parts.length < 4) parts.unshift(0);
  const [h, m, sec, fr] = parts.slice(-4);
  return Math.round((h * 3600 + m * 60 + sec) * fps) + Math.round(fr * (fps / rate));
}
