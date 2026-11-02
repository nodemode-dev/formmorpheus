// The one place the interface asks what it is running on. Desktop is the app as it always was; iPad is the shell's WKWebView.
// Every iPad-only code path elsewhere is guarded by `platform.kind` or one of `platform.features`.
import { createDesktop } from './desktop';
import { createIpad } from './ipad';
import type { Platform, PlatformInfo } from './types';

export type * from './types';

function readInfo(): PlatformInfo {
  const raw = (window as unknown as { __FM_PLATFORM__?: Partial<PlatformInfo> }).__FM_PLATFORM__;
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  return { kind: raw?.kind === 'ipad' ? 'ipad' : 'desktop', appVersion: s(raw?.appVersion), build: s(raw?.build), os: s(raw?.os) };
}

const info = readInfo();
export const platform: Platform = info.kind === 'ipad' ? createIpad(info) : createDesktop(info);
// the iPad stylesheet (styles/ipad-window.css) keys on this class; set at once so the first paint already has the insets
if (platform.kind === 'ipad' && typeof document !== 'undefined') document.documentElement.classList.add('is-ipad');
