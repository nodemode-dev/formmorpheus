// The range of characters selected in a Text editor (the inline editor on the Stage or the card's box): what the Spans tab styles.
type Listener = () => void;

class TextSelection {
  id = '';
  from = 0;
  to = 0;
  private readonly subs = new Set<Listener>();

  set(id: string, from: number, to: number): void {
    const a = Math.min(from, to), b = Math.max(from, to);
    if (this.id === id && this.from === a && this.to === b) return;
    this.id = id;
    this.from = a;
    this.to = b;
    for (const f of this.subs) f();
  }

  on(fn: Listener): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }

  /** The selected range for `id`, or null when nothing is selected in it. */
  range(id: string): { from: number; to: number } | null {
    return this.id === id && this.to > this.from ? { from: this.from, to: this.to } : null;
  }
}

export const textSel = new TextSelection();
