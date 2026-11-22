// The desktop adapter: today's behaviour, unchanged. Files are downloads, the folder dialog and Pen Link are on.
import { createBridge } from './bridge';
import { anchorDownload, capabilities, clipboard, pickWithInput } from './common';
import type { Platform, PlatformInfo } from './types';

export function createDesktop(info: PlatformInfo): Platform {
  const files: Platform['files'] = {
    pick: pickWithInput,
    download: anchorDownload,
    async save(blob, name) { anchorDownload(blob, name); },
  };
  return {
    kind: 'desktop',
    info,
    bridge: createBridge(false),
    files,
    share: {
      native: false,
      async share(req) {
        if (req.file) { anchorDownload(req.file.blob, req.file.name); return true; }
        const text = [req.text, req.url].filter(Boolean).join(' ');
        return text ? clipboard.writeText(text) : false;
      },
    },
    clipboard,
    haptic: { fire() { /* a desktop has nothing to tap */ } },
    penExtras: { available: false, on() { return () => undefined; } },
    capabilities,
    features: { penLink: true, liveRecoverySocket: true, folderPicker: true, mp3Export: true, desktopMenus: true, soundConvert: true, pictureConvert: true },
    ready() { /* no shell to tell */ },
  };
}
