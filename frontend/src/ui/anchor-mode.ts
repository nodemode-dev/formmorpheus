// Edit anchor: the box's ellipsis menu turns it on for one content. The pivot then shows its nine sectors (corners,
// side middles, centre) and snaps to them while it is dragged; Done, Escape or a new selection turns it off.
type Listener = () => void;

class AnchorMode {
  on = false;
  id: string | null = null;
  private readonly subs = new Set<Listener>();

  start(id: string): void { this.id = id; this.on = true; this.fire(); }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    this.id = null;
    this.fire();
  }

  onChange(fn: Listener): void { this.subs.add(fn); }

  private fire(): void { for (const fn of this.subs) fn(); }
}

export const anchorMode = new AnchorMode();
