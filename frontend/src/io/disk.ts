export const hasPanels = (): boolean => '__TAURI_INTERNALS__' in window;

export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

export const isDiskPath = (s: string): boolean => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(s);
