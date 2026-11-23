import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/ui/i18n', () => ({ t: (s: string) => s }));

import { DialogHistory } from '@src/ui/dialog-history';

interface Rig {
  h: DialogHistory;
  scrim: HTMLDivElement;
  body: HTMLDivElement;
  foot: HTMLDivElement;
  num: HTMLInputElement;
  chk: HTMLInputElement;
  range: HTMLInputElement;
  cancel: HTMLButtonElement;
}

function rig(open = true): Rig {
  const scrim = document.createElement('div');
  const body = document.createElement('div');
  const foot = document.createElement('div');
  scrim.append(body, foot);
  document.body.append(scrim);
  const num = document.createElement('input');
  num.type = 'number';
  num.value = '10';
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '100';
  range.value = '50';
  body.append(num, chk, range);
  const cancel = document.createElement('button');
  cancel.dataset.en = 'Cancel';
  cancel.textContent = 'Cancel';
  foot.append(cancel);
  const h = new DialogHistory(scrim, body, foot, () => open);
  return { h, scrim, body, foot, num, chk, range, cancel };
}

async function started(open = true): Promise<Rig> {
  const r = rig(open);
  r.h.start();
  await Promise.resolve();
  return r;
}

function change(c: HTMLInputElement, v: string | boolean): void {
  if (typeof v === 'boolean') c.checked = v; else c.value = v;
  c.dispatchEvent(new Event('change', { bubbles: true }));
}

const key = (shift = false): KeyboardEvent => new KeyboardEvent('keydown', { key: 'z', shiftKey: shift, cancelable: true });

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('DialogHistory undo and redo', () => {
  it('undoes a settled change and redoes it', async () => {
    const { h, num } = await started();
    change(num, '25');
    h.undo(key());
    expect(num.value).toBe('10');
    h.undo(key(true));
    expect(num.value).toBe('25');
  });

  it('claims the key so the page does not undo as well', async () => {
    const { h, num } = await started();
    change(num, '25');
    const e = key();
    h.undo(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('tells the owner about the restored value through input and change events', async () => {
    const { h, num } = await started();
    change(num, '25');
    const seen: string[] = [];
    num.addEventListener('input', () => seen.push(`input ${num.value}`));
    num.addEventListener('change', () => seen.push(`change ${num.value}`));
    h.undo(key());
    expect(seen).toEqual(['input 10', 'change 10']);
  });

  it('undoes a checkbox to its earlier state', async () => {
    const { h, chk } = await started();
    change(chk, true);
    h.undo(key());
    expect(chk.checked).toBe(false);
    h.undo(key(true));
    expect(chk.checked).toBe(true);
  });

  it('counts a quick run of changes to one control as one step', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { h, num } = await started();
    change(num, '11');
    now.mockReturnValue(1200);
    change(num, '12');
    now.mockReturnValue(1400);
    change(num, '13');
    h.undo(key());
    expect(num.value).toBe('10');
  });

  it('keeps changes more than half a second apart as separate steps', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { h, num } = await started();
    change(num, '11');
    now.mockReturnValue(2000);
    change(num, '12');
    h.undo(key());
    expect(num.value).toBe('11');
    h.undo(key());
    expect(num.value).toBe('10');
  });

  it('undoes changes to different controls in reverse order', async () => {
    const { h, num, range } = await started();
    change(num, '20');
    change(range, '70');
    h.undo(key());
    expect(range.value).toBe('50');
    expect(num.value).toBe('20');
    h.undo(key());
    expect(num.value).toBe('10');
  });

  it('drops the redo steps once a new change is made', async () => {
    const { h, num, range } = await started();
    change(num, '20');
    h.undo(key());
    change(range, '60');
    h.undo(key(true));
    expect(num.value).toBe('10');
    expect(range.value).toBe('60');
  });

  it('changes nothing when there is nothing to undo', async () => {
    const { h, num, chk } = await started();
    h.undo(key());
    h.undo(key(true));
    expect(num.value).toBe('10');
    expect(chk.checked).toBe(false);
  });

  it('ignores a control outside the dialog body', async () => {
    const { h, foot, num } = await started();
    const stray = document.createElement('input');
    stray.type = 'number';
    stray.value = '1';
    foot.append(stray);
    stray.dispatchEvent(new Event('focusin', { bubbles: true }));
    change(stray, '2');
    h.undo(key());
    expect(stray.value).toBe('2');
    expect(num.value).toBe('10');
  });

  it('forgets the history when the dialog starts again', async () => {
    const { h, num } = await started();
    change(num, '25');
    h.start();
    await Promise.resolve();
    h.undo(key());
    expect(num.value).toBe('25');
  });

  it('undoes a field the owner changed in response, together with the field that caused it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { h, num, range } = await started();
    num.addEventListener('change', () => { range.value = String(Number(num.value) * 2); });
    change(num, '30');
    vi.runAllTimers();
    expect(range.value).toBe('60');
    h.undo(key());
    expect(num.value).toBe('10');
    expect(range.value).toBe('50');
  });
});

describe('DialogHistory reset with Alt', () => {
  it('puts every field back to its opening value on Alt and Cancel and stops the cancel', async () => {
    const { num, chk, range, cancel } = await started();
    change(num, '99');
    change(chk, true);
    change(range, '5');
    const closed = vi.fn();
    cancel.addEventListener('click', closed);
    cancel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }));
    expect(num.value).toBe('10');
    expect(chk.checked).toBe(false);
    expect(range.value).toBe('50');
    expect(closed).not.toHaveBeenCalled();
  });

  it('clears the undo history after a reset', async () => {
    const { h, num, cancel } = await started();
    change(num, '99');
    cancel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }));
    h.undo(key());
    h.undo(key(true));
    expect(num.value).toBe('10');
  });

  it('lets a plain Cancel click through without resetting', async () => {
    const { num, cancel } = await started();
    change(num, '99');
    const closed = vi.fn();
    cancel.addEventListener('click', closed);
    cancel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(num.value).toBe('99');
  });

  it('relabels Cancel while Alt is held and restores the label after', async () => {
    const { h, cancel } = await started();
    h.alt(true);
    expect(cancel.textContent).not.toBe('Cancel');
    expect(cancel.textContent).not.toBe('');
    h.alt(false);
    expect(cancel.textContent).toBe('Cancel');
    expect(cancel.dataset.cancelText).toBeUndefined();
  });

  it('keeps the first label when Alt repeats', async () => {
    const { h, cancel } = await started();
    h.alt(true);
    h.alt(true);
    h.alt(false);
    expect(cancel.textContent).toBe('Cancel');
  });

  it('does not relabel Cancel when the dialog closed before its values were kept', async () => {
    const { h, cancel } = await started(false);
    h.alt(true);
    expect(cancel.textContent).toBe('Cancel');
  });
});
