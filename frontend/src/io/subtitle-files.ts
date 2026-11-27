// Subtitle files: SRT and WebVTT read and written as lines of text in seconds.
// No DOM. Every scan below is a single pass over its input (no backtracking
// patterns), so a hostile file cannot make the parse slow.
import type { TimedLine } from '../engine/subtitles';

const SKIP_BLOCKS = ['WEBVTT', 'NOTE', 'STYLE', 'REGION'];

function isDigits(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

// hh:mm:ss,mmm  hh:mm:ss.mmm  mm:ss.mmm, 1 to 3 fraction digits; null when not a time.
function stampSeconds(stamp: string): number | null {
  const parts = stamp.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const last = parts[parts.length - 1]!;
  let sep = last.indexOf('.');
  if (sep < 0) sep = last.indexOf(',');
  if (sep < 0) return null;
  const secs = last.slice(0, sep);
  const frac = last.slice(sep + 1);
  const head = parts.slice(0, -1);
  if (!isDigits(secs) || secs.length > 2 || !isDigits(frac) || frac.length > 3) return null;
  for (const h of head) if (!isDigits(h) || h.length > 6) return null;
  const nums = head.map(Number);
  const hours = nums.length === 2 ? nums[0]! : 0;
  const minutes = nums.length === 2 ? nums[1]! : nums[0]!;
  // Whole milliseconds first, so 1.235 does not come out as 1.2349999999999999.
  const value = (((hours * 3600 + minutes * 60 + Number(secs)) * 1000) + Number(frac.padEnd(3, '0'))) / 1000;
  return Number.isFinite(value) ? value : null;
}

// Drops <...> tags and {\...} overrides. A lone "<" or "{" with no closer stays as text.
function stripMarkup(line: string): string {
  const lastGt = line.lastIndexOf('>');
  const lastBrace = line.lastIndexOf('}');
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === '<' && i < lastGt) {
      const next = line[i + 1];
      if (next !== undefined && (next === '/' || /[A-Za-z]/.test(next))) {
        i = line.indexOf('>', i) + 1;
        continue;
      }
    } else if (ch === '{' && line[i + 1] === '\\' && i < lastBrace) {
      i = line.indexOf('}', i) + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|nbsp);/g, (_m, name: string) => ENTITIES[name] ?? '');
}

function cleanText(lines: string[]): string {
  const kept: string[] = [];
  for (const raw of lines) {
    const t = decodeEntities(stripMarkup(raw)).trim();
    if (t) kept.push(t);
  }
  return kept.join('\n');
}

export function parseSubtitles(text: string): TimedLine[] {
  try {
    const body = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const out: TimedLine[] = [];
    let block: string[] = [];
    const flush = (): void => {
      const lines = block;
      block = [];
      if (lines.length === 0) return;
      const first = lines[0]!.trimStart();
      if (SKIP_BLOCKS.some((w) => first.startsWith(w))) return;
      let at = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes('-->')) {
          at = i;
          break;
        }
      }
      if (at < 0) return;
      const timing = lines[at]!;
      const arrow = timing.indexOf('-->');
      const start = stampSeconds(timing.slice(0, arrow).trim());
      // Cue settings follow the end time after whitespace; they are ignored.
      const endWord = timing.slice(arrow + 3).trim().split(/\s/, 1)[0] ?? '';
      const end = stampSeconds(endWord);
      if (start === null || end === null || !(end > start)) return;
      const content = cleanText(lines.slice(at + 1));
      if (content) out.push({ start, end, text: content });
    };
    for (const line of body.split('\n')) {
      if (line.trim() === '') flush();
      else block.push(line);
    }
    flush();
    // Stable sort keeps file order for equal starts.
    return out.sort((a, b) => a.start - b.start);
  } catch {
    return [];
  }
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function stamp(seconds: number, sep: string): string {
  const ms = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(ms % 1000, 3)}`;
}

export function writeSubtitles(lines: TimedLine[], format: 'srt' | 'vtt'): string {
  const sep = format === 'srt' ? ',' : '.';
  const ordered = [...lines].sort((a, b) => a.start - b.start);
  const blocks: string[] = [];
  for (const line of ordered) {
    // A blank line would end the cue early, and "-->" would read as a second timing line.
    const text = String(line.text)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/-->/g, '->').trim())
      .filter((l) => l !== '')
      .join('\n');
    if (!text) continue;
    const times = `${stamp(line.start, sep)} --> ${stamp(line.end, sep)}`;
    blocks.push(format === 'srt' ? `${blocks.length + 1}\n${times}\n${text}` : `${times}\n${text}`);
  }
  const joined = blocks.join('\n\n');
  if (format === 'vtt') return blocks.length ? `WEBVTT\n\n${joined}\n` : 'WEBVTT\n';
  return blocks.length ? `${joined}\n` : '';
}
