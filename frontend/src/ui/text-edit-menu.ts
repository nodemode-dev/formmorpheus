// The small edit menu on Stage text: Cut, Copy, Paste, Select All and Edit Style.
import { Popover, popRow, popSep, type PopRow } from './popover';

/** The word touching a caret position as [from, to), or null on blank space. */
export function wordAround(text: string, at: number): [number, number] | null {
  const isWord = (ch: string): boolean => /[\p{L}\p{N}\p{M}_'-]/u.test(ch);
  let a = at, b = at;
  while (a > 0 && isWord(text[a - 1])) a--;
  while (b < text.length && isWord(text[b])) b++;
  return b > a ? [a, b] : null;
}

export class TextEditMenu {
  private readonly word: PopRow;
  private readonly pop = new Popover('fm-tem', 190);
  private readonly cut: PopRow;
  private readonly copy: PopRow;
  private readonly paste: PopRow;
  private ta: HTMLTextAreaElement | null = null;
  private styleAt: (() => void) | null = null;

  constructor() {
    this.cut = popRow(null, 'Cut');
    this.copy = popRow(null, 'Copy');
    this.paste = popRow(null, 'Paste');
    this.word = popRow(null, 'Select');
    const all = popRow(null, 'Select All');
    const style = popRow(null, 'Edit Style');
    this.pop.body.append(this.cut.el, this.copy.el, this.paste.el, popSep(), this.word.el, all.el, style.el);
    this.word.el.addEventListener('click', () => {
      const ta = this.ta, r = ta ? wordAround(ta.value, ta.selectionStart) : null;
      if (ta && r) ta.setSelectionRange(r[0], r[1]);
      this.done();
    });
    // pressing a row must not take focus (and so the caret) away from the text
    this.pop.el.addEventListener('pointerdown', (e) => e.preventDefault());
    this.cut.el.addEventListener('click', () => { this.take(true); this.done(); });
    this.copy.el.addEventListener('click', () => { this.take(false); this.done(); });
    this.paste.el.addEventListener('click', () => { void this.put(); });
    all.el.addEventListener('click', () => { this.ta?.select(); this.done(); });
    style.el.addEventListener('click', () => { const f = this.styleAt; this.pop.hide(); f?.(); });
  }

  open(ta: HTMLTextAreaElement, x: number, y: number, editStyle: () => void): void {
    this.ta = ta;
    this.styleAt = editStyle;
    const has = ta.selectionStart !== ta.selectionEnd;
    this.cut.setDisabled(!has);
    this.copy.setDisabled(!has);
    // Select takes the word at the caret (or at the start of what is selected)
    this.word.setDisabled(!wordAround(ta.value, ta.selectionStart));
    this.pop.showAt(x, y);
  }

  hide(): void { this.pop.hide(); }

  private selected(): string {
    const ta = this.ta;
    return ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : '';
  }

  private take(remove: boolean): void {
    const ta = this.ta;
    const s = this.selected();
    if (!ta || !s) return;
    void navigator.clipboard?.writeText(s).catch(() => { /* clipboard refused */ });
    if (remove) this.replace('');
  }

  private async put(): Promise<void> {
    let text = '';
    try { text = (await navigator.clipboard.readText()) ?? ''; } catch { /* clipboard refused */ }
    if (text) this.replace(text);
    this.done();
  }

  private replace(text: string): void {
    const ta = this.ta;
    if (!ta) return;
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private done(): void {
    this.pop.hide();
    this.ta?.focus({ preventScroll: true });
  }
}
