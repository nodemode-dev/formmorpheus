// The shapes every platform adapter shares. The desktop and iPad adapters implement the same Platform.
import type { Capabilities } from '../io/api';
import type { JobCapabilities } from '../export/engine-jobs';

export type PlatformKind = 'desktop' | 'ipad';

/** What the iPad shell puts in window.__FM_PLATFORM__ at document start. */
export interface PlatformInfo { kind: PlatformKind; appVersion: string; build: string; os: string }

export type BridgePayload = Record<string, unknown>;
export type BridgeHandler = (payload: BridgePayload) => void;

/** The page's side of the native bridge: messages to the shell and messages from it. */
export interface Bridge {
  /** True when a native shell is listening (window.webkit.messageHandlers.fm exists). */
  readonly available: boolean;
  /** Posts one message to the shell; false when nobody is listening. */
  post(type: string, payload?: BridgePayload): boolean;
  /** Listens for one message type from the shell; returns the way to stop. */
  on(type: string, fn: BridgeHandler): () => void;
  /** Waits for the next message of a type that passes `accept`; null after `ms`. */
  once(type: string, accept: (p: BridgePayload) => boolean, ms: number): Promise<BridgePayload | null>;
}

export interface PickedFile { name: string; type: string; bytes: Uint8Array }
export interface PickOptions { accept?: string; multiple?: boolean }

export interface FilesAdapter {
  /** Opens the system chooser and resolves with the chosen files (empty when cancelled). */
  pick(opts?: PickOptions): Promise<File[]>;
  /** Hands a finished file to the person: a download on the desktop, the export picker or share sheet on iPad. */
  download(blob: Blob, name: string): void;
  /** Same as download, resolving when the file has been handed over. */
  save(blob: Blob, name: string): Promise<void>;
}

export interface ShareRequest { text?: string; url?: string; file?: { blob: Blob; name: string } }
export interface ShareAdapter {
  /** True when sharing is more than a download here (the share sheet). */
  readonly native: boolean;
  share(req: ShareRequest): Promise<boolean>;
}

export interface ClipboardAdapter {
  writeText(text: string): Promise<boolean>;
  readText(): Promise<string>;
  writeImage(png: Blob): Promise<boolean>;
  readImage(): Promise<Blob | null>;
}

export type HapticKind = 'tap' | 'select' | 'snap' | 'success' | 'warning' | 'error';
export interface HapticAdapter { fire(kind: HapticKind): void }

export type PenExtraKind = 'squeeze' | 'doubleTap' | 'hoverPose';
export interface PenExtrasAdapter {
  /** True when the platform reports pen extras (squeeze, double tap, hover pose). */
  readonly available: boolean;
  on(kind: PenExtraKind, fn: BridgeHandler): () => void;
}

export interface CapabilitiesAdapter {
  /** What the engine reports about itself (null while it is not answering). */
  engine(): Promise<Capabilities | null>;
  /** What the engine's export jobs can do (ffmpeg and the targets it offers). */
  jobs(): Promise<JobCapabilities | null>;
}

/** Everything a platform may turn on or off. The desktop has all of them except none; iPad turns four off. */
export interface FeatureFlags {
  /** Draw from a tablet's browser over the local network (needs a socket server in the engine). */
  penLink: boolean;
  /** The crash-recovery socket that tells the engine this window is alive. */
  liveRecoverySocket: boolean;
  /** A folder dialog for "save to" (the desktop dialog or the browser's directory picker). */
  folderPicker: boolean;
  /** MP3 export (needs the engine's ffmpeg). */
  mp3Export: boolean;
  /** The in-window menu bar. */
  desktopMenus: boolean;
  /** The engine converts a sound the window cannot decode (desktop: ffmpeg; the iPad converts video only). */
  soundConvert: boolean;
  /** The engine converts a HEIC picture the window cannot decode. */
  pictureConvert: boolean;
}

export interface Platform {
  readonly kind: PlatformKind;
  readonly info: PlatformInfo;
  readonly bridge: Bridge;
  readonly files: FilesAdapter;
  readonly share: ShareAdapter;
  readonly clipboard: ClipboardAdapter;
  readonly haptic: HapticAdapter;
  readonly penExtras: PenExtrasAdapter;
  readonly capabilities: CapabilitiesAdapter;
  readonly features: FeatureFlags;
  /** Tells the shell the page has started (iPad); nothing on the desktop. */
  ready(): void;
}
