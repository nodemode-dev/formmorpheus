// Worker side of the Diagnostics probes: what a worker can do on this device (canvas, WebGL 2, bitmaps, codecs).
// Started as a module worker from the page's own address, so a refusal of module workers from the app scheme shows up too.
type Out = Record<string, unknown>;
const ctx = self as unknown as { postMessage(m: Out): void; onmessage: ((e: MessageEvent) => void) | null };

async function canvas2d(): Promise<Out> {
  const r: Out = { OffscreenCanvas: typeof OffscreenCanvas !== 'undefined' };
  if (!r.OffscreenCanvas) return r;
  try {
    const c = new OffscreenCanvas(64, 64);
    const g = c.getContext('2d');
    r.context2d = !!g;
    if (g) {
      g.fillStyle = '#f97316';
      g.fillRect(0, 0, 64, 64);
      r.pixel = Array.from(g.getImageData(1, 1, 1, 1).data);
      const blob = await c.convertToBlob({ type: 'image/png' });
      r.convertToBlob = blob.size > 0;
      r.convertToBlobWebp = (await c.convertToBlob({ type: 'image/webp', quality: 0.8 }).then((b) => b.type)).toString();
    }
  } catch (e) { r.error = String(e); }
  return r;
}

function webgl2(): Out {
  const r: Out = {};
  try {
    const c = new OffscreenCanvas(16, 16);
    const gl = c.getContext('webgl2') as WebGL2RenderingContext | null;
    r.webgl2 = !!gl;
    if (gl) {
      r.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      r.maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
      r.floatColorBuffer = !!gl.getExtension('EXT_color_buffer_float');
      r.halfFloatColorBuffer = !!gl.getExtension('EXT_color_buffer_half_float');
    }
  } catch (e) { r.error = String(e); }
  return r;
}

async function bitmaps(): Promise<Out> {
  const r: Out = { createImageBitmap: typeof createImageBitmap === 'function' };
  if (!r.createImageBitmap) return r;
  try {
    const c = new OffscreenCanvas(32, 32);
    c.getContext('2d')?.fillRect(0, 0, 32, 32);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const b = await createImageBitmap(blob, { resizeWidth: 16, resizeHeight: 16, resizeQuality: 'high', premultiplyAlpha: 'premultiply' });
    r.resized = [b.width, b.height];
    b.close();
  } catch (e) { r.error = String(e); }
  return r;
}

ctx.onmessage = async (): Promise<void> => {
  const started = performance.now();
  ctx.postMessage({
    ok: true,
    moduleWorker: true,
    userAgentInWorker: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    canvas: await canvas2d(),
    webgl: webgl2(),
    bitmap: await bitmaps(),
    videoEncoderInWorker: typeof VideoEncoder !== 'undefined',
    audioEncoderInWorker: typeof AudioEncoder !== 'undefined',
    ms: Math.round(performance.now() - started),
  });
};
