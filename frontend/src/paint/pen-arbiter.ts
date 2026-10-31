// Who gets to draw: pen over mouse over touch. While a pen is in range or down, fingers only pan and zoom, a big
// contact (a palm) is dropped, and the eraser end and barrel buttons say which job the pen has. Pure: it reads
// event fields and keeps a little state, nothing else.

export type BarrelAction = 'eyedropper' | 'menu' | 'undo' | 'pan' | 'cycle' | 'none';
export type PenRole = 'eraser' | 'barrel1' | 'barrel2' | null;
export type TouchPolicy = 'paint' | 'navigate' | 'reject';

export interface ArbiterConfig {
  palm: boolean;
  /** A touch this wide (CSS px) is a palm. */
  palmWidth: number;
}

export interface ArbiterEvent {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  button: number;
  buttons: number;
  timeStamp: number;
  width?: number;
  height?: number;
}

/** A pen counts as in range this long after its last event (hover events stop when it leaves). */
const RANGE_MS = 500;
/** A finger this close to a pen that is down is a resting hand. */
const NEAR_PX = 24;

export class PenArbiter {
  private lastPenAt = -1e9;
  private penEver = false;
  private readonly down = new Map<number, { x: number; y: number }>();
  private lastPen = { x: 0, y: 0 };
  private readonly dropped = new Set<number>();

  constructor(private readonly cfg: () => ArbiterConfig) {}

  /** Call for every pointer event on the canvas, before anything else reads it. */
  note(e: ArbiterEvent, type: 'down' | 'move' | 'up' = 'move'): void {
    if (e.pointerType !== 'pen') return;
    this.penEver = true;
    this.lastPenAt = e.timeStamp;
    this.lastPen = { x: e.clientX, y: e.clientY };
    if (type === 'down') this.down.set(e.pointerId, this.lastPen);
    else if (type === 'up') this.down.delete(e.pointerId);
    else if (this.down.has(e.pointerId)) this.down.set(e.pointerId, this.lastPen);
  }

  /** The pen left the surface's reach (pointerleave): it is no longer in range. */
  leave(e: Pick<ArbiterEvent, 'pointerType' | 'pointerId'>): void {
    if (e.pointerType === 'pen' && !this.down.has(e.pointerId)) this.lastPenAt = -1e9;
  }

  get penDown(): boolean { return this.down.size > 0; }

  inRange(now: number): boolean { return this.penDown || now - this.lastPenAt < RANGE_MS; }

  /** What a touch may do right now. */
  touch(e: ArbiterEvent): TouchPolicy {
    const c = this.cfg();
    if (!c.palm || e.pointerType !== 'touch') return 'paint';
    const w = Math.max(e.width || 0, e.height || 0);
    if (this.penEver && w >= c.palmWidth) return 'reject';
    if (!this.inRange(e.timeStamp)) return 'paint';
    if (this.penDown) {
      const d = Math.hypot(e.clientX - this.lastPen.x, e.clientY - this.lastPen.y);
      if (d < NEAR_PX + w) return 'reject';
    }
    return 'navigate';
  }

  /** Decide a touch once, at its pointerdown, and remember a rejected one until it lifts. */
  admit(e: ArbiterEvent): TouchPolicy {
    const p = this.touch(e);
    if (p === 'reject') this.dropped.add(e.pointerId);
    return p;
  }

  isDropped(id: number): boolean { return this.dropped.has(id); }

  /** A dropped touch lifted. */
  release(id: number): void { this.dropped.delete(id); }

  /** Eraser end, or which barrel button, a pen press carries. */
  classify(e: Pick<ArbiterEvent, 'pointerType' | 'button' | 'buttons'>): PenRole {
    if (e.pointerType !== 'pen') return null;
    if (e.button === 5 || (e.buttons & 32) !== 0) return 'eraser';
    if (e.button === 2 || (e.buttons & 2) !== 0) return 'barrel1';
    if (e.button === 1 || (e.buttons & 4) !== 0) return 'barrel2';
    return null;
  }
}
