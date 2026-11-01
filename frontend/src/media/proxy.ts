// Proxies: a smaller H.264 copy of a large video, made by the engine's own ffmpeg. Only the preview plays it.
export async function makeProxy(blob: Blob, height = 540, signal?: AbortSignal): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`/api/proxy/make?height=${height}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'application/octet-stream' }, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error('The engine is not running, so a proxy cannot be made.');
  }
  if (!res.ok) {
    let msg = 'The proxy could not be made.';
    try { const j = await res.json(); if (typeof j.detail === 'string') msg = j.detail; } catch { /* keep the default */ }
    throw new Error(msg);
  }
  return res.blob();
}

/** Worth a proxy: wider than 1280 px on its long side. */
export function wantsProxy(a: { width?: number; height?: number }): boolean {
  return Math.max(a.width ?? 0, a.height ?? 0) > 1280;
}
