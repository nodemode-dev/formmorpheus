// The iPad adapter. Everything here runs only when the shell set window.__FM_PLATFORM__.kind to 'ipad'.
//
// Opening files: a WKWebView shows the system sheet (Photo Library, Take Photo, Choose Files) for a plain file input
// with no help from the shell, so opening keeps the input. The `pickFiles` message exists as an opt-in route
// (USE_NATIVE_PICKER) for the day the sheet is not enough.
// Saving: a blob has no URL the shell can reach, so it travels over the bridge in base64 chunks of 3 MB:
//   { id, name, mime, size, index, count, data }  for `saveFile` and for `share` with a file.
// The shell collects the chunks of one id and presents the export picker (saveFile) or the share sheet (share)
// when the last one (index === count - 1) has arrived.
import { createBridge } from './bridge';
import { anchorDownload, capabilities, clipboard, pickWithInput } from './common';
import type { BridgePayload, HapticKind, Platform, PlatformInfo, PickOptions } from './types';

const USE_NATIVE_PICKER = false;
const CHUNK = 3 * 1024 * 1024;
const PICK_WAIT_MS = 10 * 60 * 1000;

let serial = 0;
const uid = (): string => `m${Date.now().toString(36)}${(serial++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const turn = (): Promise<void> => new Promise((r) => window.setTimeout(r, 0));

export function createIpad(info: PlatformInfo): Platform {
  const bridge = createBridge(true);

  /** Sends a blob to the shell as numbered chunks of one message type. */
  async function sendBlob(type: 'saveFile' | 'share', blob: Blob, name: string, extra: BridgePayload = {}, id = uid()): Promise<boolean> {
    const count = Math.max(1, Math.ceil(blob.size / CHUNK));
    for (let index = 0; index < count; index++) {
      const bytes = new Uint8Array(await blob.slice(index * CHUNK, (index + 1) * CHUNK).arrayBuffer());
      const ok = bridge.post(type, { id, name, mime: blob.type || 'application/octet-stream', size: blob.size, index, count, data: toBase64(bytes), ...extra });
      if (!ok) return false;
      if (index % 4 === 3) await turn();
    }
    return true;
  }

  async function pickNative(opts: PickOptions): Promise<File[]> {
    const id = uid();
    if (!bridge.post('pickFiles', { id, accept: opts.accept ?? '', multiple: opts.multiple === true })) return pickWithInput(opts);
    const got = await bridge.once('pickedFiles', (p) => p.id === id, PICK_WAIT_MS);
    const list = Array.isArray(got?.files) ? (got?.files as Array<{ name?: unknown; type?: unknown; bytes?: unknown; path?: unknown }>) : [];
    const out: File[] = [];
    for (const f of list) {
      if (typeof f.name !== 'string') continue;
      const type = typeof f.type === 'string' ? f.type : '';
      if (typeof f.bytes === 'string') out.push(new File([fromBase64(f.bytes) as BlobPart], f.name, { type }));
      else if (typeof f.path === 'string') {
        // a big file stays on disk; the engine streams it back
        try {
          const res = await fetch(`/api/files/read?path=${encodeURIComponent(f.path)}`);
          if (res.ok) out.push(new File([await res.blob()], f.name, { type }));
        } catch { /* the file could not be read back */ }
      }
    }
    return out;
  }

  const save = async (blob: Blob, name: string): Promise<void> => {
    // without a shell (a plain browser tab on the iPad) the download stands
    if (!bridge.available) { anchorDownload(blob, name); return; }
    const id = uid();
    const done = bridge.once('fileSaved', (p) => p.id === id, PICK_WAIT_MS);
    if (!(await sendBlob('saveFile', blob, name, {}, id))) { anchorDownload(blob, name); return; }
    await done;
  };

  let lastTap = 0;
  const haptic = (kind: HapticKind): void => {
    const now = performance.now();
    if (now - lastTap < 30) return;
    lastTap = now;
    bridge.post('haptic', { kind });
  };

  return {
    kind: 'ipad',
    info,
    bridge,
    files: {
      pick: (opts = {}) => (USE_NATIVE_PICKER ? pickNative(opts) : pickWithInput(opts)),
      download(blob, name) { void save(blob, name); },
      save,
    },
    share: {
      native: true,
      async share(req) {
        if (req.file) return sendBlob('share', req.file.blob, req.file.name, { text: req.text ?? '', url: req.url ?? '' });
        return bridge.post('share', { text: req.text ?? '', url: req.url ?? '' });
      },
    },
    clipboard,
    haptic: { fire: haptic },
    penExtras: {
      available: true,
      on(kind, fn) { return bridge.on(kind, fn); },
    },
    capabilities,
    // no sockets through the scheme handler, no network server, no ffmpeg, no folder dialog (saving goes through the system picker)
    features: { penLink: false, liveRecoverySocket: false, folderPicker: false, mp3Export: false, desktopMenus: false },
    ready() { bridge.post('ready', { version: info.appVersion, build: info.build, width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }); },
  };
}
