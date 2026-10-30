export interface ShellJob { id: number; name: string; done: number; total: number; cancelled?: boolean }

export type ShellEvent = 'projects' | 'progress';

export interface ShellModel {
  readonly projects: readonly unknown[];
  readonly jobs: readonly ShellJob[];
  on(ev: ShellEvent, fn: () => void): () => void;
  cancelJob(id: number): boolean;
  newDocument(w: number, h: number, name: string, fps: number, flipbook: boolean): void;
}
