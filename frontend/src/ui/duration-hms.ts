/** Typed durations in hours, minutes and seconds (the end bar's Enter duration). A bare number is seconds. */

/** Frames for "1h 2m 3s", "1:02:03", "2:03", "90" (seconds) or "10.5s"; null when it is not a duration. */
export function parseHms(text: string, fps: number): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  let sec: number | null = null;
  if (/^\d*\.?\d+$/.test(s)) sec = parseFloat(s);
  else if (/^(?:\d*\.?\d+\s*[hms]\s*)+$/.test(s)) {
    sec = 0;
    for (const m of s.matchAll(/(\d*\.?\d+)\s*([hms])/g)) sec += parseFloat(m[1]) * (m[2] === 'h' ? 3600 : m[2] === 'm' ? 60 : 1);
  } else if (/^\d+(?::\d+(?:\.\d+)?){1,2}$/.test(s)) {
    const p = s.split(':').map(Number);
    while (p.length < 3) p.unshift(0);
    sec = p[0] * 3600 + p[1] * 60 + p[2];
  }
  if (sec === null || !Number.isFinite(sec)) return null;
  return Math.max(1, Math.round(sec * fps));
}

/** h:mm:ss for a frame count (whole seconds, a fraction when the count is not on a second). */
export function formatHms(frames: number, fps: number): string {
  const total = frames / Math.max(1, fps);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60);
  const s = total - h * 3600 - m * 60;
  const sTxt = Number.isInteger(s) ? String(s).padStart(2, '0') : s.toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${sTxt}`;
}
