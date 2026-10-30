import type { Movie } from './types';

export interface Step {
  label: string;
  movie: Movie;
}

export interface RecoveryPoint {
  id: string;
  label: string;
  time: number;
  movie: Movie;
}

export const UNDO_DEPTHS = [10, 20, 50, 100, 250, 1000, 0] as const;
export const MAX_RECOVERY = 3;
export const RECOVERY_AFTER_UNDOS = 3;

export class History {
  past: Step[] = [];
  future: Step[] = [];
  recovery: RecoveryPoint[] = [];
  private merge: string | null = null;

  /** Share of the steps kept one by one; older steps beyond it are thinned so undo reaches further back (100: no thinning). */
  recentPercent = 100;

  constructor(public depth = 250) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string {
    return this.past.length ? this.past[this.past.length - 1].label : '';
  }

  get redoLabel(): string {
    return this.future.length ? this.future[this.future.length - 1].label : '';
  }

  record(before: Movie, label: string, merge: string | null): void {
    if (merge && merge === this.merge && this.past.length) return;
    if (this.future.length >= RECOVERY_AFTER_UNDOS) {
      const tip = this.future[0];
      this.recovery.unshift({ id: `r${Date.now().toString(36)}`, label: tip.label, time: Date.now(), movie: tip.movie });
      this.recovery.length = Math.min(this.recovery.length, MAX_RECOVERY);
    }
    this.future = [];
    this.past.push({ label, movie: before });
    this.merge = merge;
    this.trim();
  }

  endGesture(): void {
    this.merge = null;
  }

  undo(current: Movie): Step | null {
    const step = this.past.pop();
    if (!step) return null;
    this.future.push({ label: step.label, movie: current });
    this.merge = null;
    return step;
  }

  redo(current: Movie): Step | null {
    const step = this.future.pop();
    if (!step) return null;
    this.past.push({ label: step.label, movie: current });
    this.merge = null;
    return step;
  }

  setDepth(depth: number): void {
    this.depth = Math.max(0, Math.round(depth));
    this.trim();
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.merge = null;
  }

  removeRecovery(id: string): void {
    this.recovery = this.recovery.filter((r) => r.id !== id);
  }

  setRecentPercent(p: number): void {
    this.recentPercent = Math.max(10, Math.min(100, Math.round(p)));
    this.trim();
  }

  private trim(): void {
    if (this.depth <= 0 || this.past.length <= this.depth) return;
    const recent = Math.max(1, Math.round((this.depth * this.recentPercent) / 100));
    if (recent >= this.depth) { this.past.splice(0, this.past.length - this.depth); return; }
    // the newest `recent` steps stay as they are; from the older ones a step is dropped at a spread-out place each time
    // (golden-ratio stepping), so what survives is spaced out over the whole past instead of piled at one end
    while (this.past.length > this.depth) {
      const older = this.past.length - recent;
      this.thinned += 0.6180339887;
      this.past.splice(Math.floor((this.thinned % 1) * older), 1);
    }
  }

  private thinned = 0;
}

type Ref = { r: number };
type Node = ['a', unknown[]] | ['o', string[], unknown[]];

export interface PackedStates {
  nodes: Node[];
  roots: number[];
}

export function packStates(states: unknown[]): PackedStates {
  const ids = new Map<object, number>();
  const nodes: Node[] = [];
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    const seen = ids.get(value);
    if (seen !== undefined) return { r: seen } satisfies Ref;
    const index = nodes.length;
    ids.set(value, index);
    if (Array.isArray(value)) {
      const node: Node = ['a', []];
      nodes.push(node);
      node[1] = value.map(visit);
    } else {
      const keys = Object.keys(value as object);
      const node: Node = ['o', keys, []];
      nodes.push(node);
      node[2] = keys.map((k) => visit((value as Record<string, unknown>)[k]));
    }
    return { r: index } satisfies Ref;
  };
  const roots = states.map((s) => (visit(s) as Ref).r);
  return { nodes, roots };
}

export function unpackStates(packed: PackedStates): unknown[] {
  const built: unknown[] = new Array(packed.nodes.length);
  const resolve = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    return build((value as Ref).r);
  };
  const build = (index: number): unknown => {
    if (built[index] !== undefined) return built[index];
    const node = packed.nodes[index];
    if (!node) throw new Error('The saved history is damaged.');
    if (node[0] === 'a') {
      const out: unknown[] = [];
      built[index] = out;
      for (const v of node[1]) out.push(resolve(v));
      return out;
    }
    const out: Record<string, unknown> = {};
    built[index] = out;
    node[1].forEach((k, i) => { out[k] = resolve(node[2][i]); });
    return out;
  };
  return packed.roots.map(build);
}
