import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { evalExpr, installNumberFields } from '@src/ui/number-fields';

describe('evalExpr', () => {
  it('adds and subtracts left to right', () => {
    expect(evalExpr('100+20')).toBe(120);
    expect(evalExpr('10-4-3')).toBe(3);
  });

  it('binds multiplication and division tighter than addition', () => {
    expect(evalExpr('2+3*4')).toBe(14);
    expect(evalExpr('20-12/4')).toBe(17);
  });

  it('honours parentheses', () => {
    expect(evalExpr('(2+3)*4')).toBe(20);
    expect(evalExpr('2*(3+(1+1))')).toBe(10);
  });

  it('reads a trailing percent as a share of the given base', () => {
    expect(evalExpr('50%')).toBe(50);
    expect(evalExpr('50%', 200)).toBe(100);
    expect(evalExpr('50%*2', 100)).toBe(100);
  });

  it('accepts unary signs, including repeated ones', () => {
    expect(evalExpr('-5+2')).toBe(-3);
    expect(evalExpr('--5')).toBe(5);
    expect(evalExpr('+7')).toBe(7);
    expect(evalExpr('3*-2')).toBe(-6);
  });

  it('treats a comma as a decimal point and ignores spaces', () => {
    expect(evalExpr('1,5*2')).toBe(3);
    expect(evalExpr(' 1 +  2 ')).toBe(3);
    expect(evalExpr('.5+.5')).toBe(1);
  });

  it('accepts x and the multiplication and division signs', () => {
    expect(evalExpr('3x4')).toBe(12);
    expect(evalExpr(`3${String.fromCharCode(0xd7)}4`)).toBe(12);
    expect(evalExpr(`8${String.fromCharCode(0xf7)}2`)).toBe(4);
  });

  it('returns null for text that is not arithmetic', () => {
    expect(evalExpr('')).toBeNull();
    expect(evalExpr('   ')).toBeNull();
    expect(evalExpr('abc')).toBeNull();
    expect(evalExpr('2+a')).toBeNull();
  });

  it('returns null for malformed expressions', () => {
    expect(evalExpr('2+')).toBeNull();
    expect(evalExpr('(2+3')).toBeNull();
    expect(evalExpr('2)')).toBeNull();
    expect(evalExpr('1..2')).toBeNull();
    expect(evalExpr('*3')).toBeNull();
  });

  it('refuses a result that is not finite', () => {
    expect(evalExpr('1/0')).toBeNull();
    expect(evalExpr('0/0')).toBeNull();
  });
});

const field = (attrs: Record<string, string>, wrapper?: string): HTMLInputElement => {
  const f = document.createElement('input');
  f.type = 'number';
  for (const [k, v] of Object.entries(attrs)) f.setAttribute(k, v);
  if (attrs.value !== undefined) f.value = attrs.value;
  if (wrapper) {
    const label = document.createElement('label');
    label.textContent = wrapper;
    label.appendChild(f);
    document.body.appendChild(label);
  } else {
    document.body.appendChild(f);
  }
  return f;
};

const focusIn = (f: HTMLInputElement): void => { f.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); };
const focusOut = (f: HTMLInputElement): void => { f.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); };
const key = (f: HTMLInputElement, k: string, shiftKey = false): void => {
  f.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
};
const changes = (f: HTMLInputElement): string[] => {
  const seen: string[] = [];
  f.addEventListener('change', () => seen.push(f.value));
  return seen;
};

describe('installNumberFields', () => {
  beforeAll(() => {
    installNumberFields();
    installNumberFields();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('turns a focused number box into a text box', () => {
    const f = field({ value: '5' });
    focusIn(f);
    expect(f.type).toBe('text');
    expect(f.hasAttribute('data-numtext')).toBe(true);
  });

  it('commits a typed expression when the field loses focus', () => {
    const f = field({ value: '5', min: '0', max: '10' });
    const seen = changes(f);
    focusIn(f);
    f.value = '2*(3+1)';
    focusOut(f);
    expect(f.type).toBe('number');
    expect(f.value).toBe('8');
    expect(seen).toEqual(['8']);
  });

  it('clamps a committed value to the field limits', () => {
    const f = field({ value: '5', min: '0', max: '10' });
    focusIn(f);
    f.value = '20*2';
    focusOut(f);
    expect(f.value).toBe('10');
  });

  it('restores the old value and stays quiet when the text is not a number', () => {
    const f = field({ value: '5', min: '0', max: '10' });
    const seen = changes(f);
    focusIn(f);
    f.value = 'abc';
    focusOut(f);
    expect(f.value).toBe('5');
    expect(seen).toEqual([]);
  });

  it('sends no change when the committed value equals the old one', () => {
    const f = field({ value: '4' });
    const seen = changes(f);
    focusIn(f);
    f.value = '2+2';
    focusOut(f);
    expect(f.value).toBe('4');
    expect(seen).toEqual([]);
  });

  it('reads a percent as a share of the value the field held', () => {
    const f = field({ value: '200' });
    focusIn(f);
    f.value = '50%';
    focusOut(f);
    expect(f.value).toBe('100');
  });

  it('reads a percent as a plain hundredth in a field labelled as a percentage', () => {
    const f = field({ value: '200' }, 'Opacity %');
    focusIn(f);
    f.value = '50%';
    focusOut(f);
    expect(f.value).toBe('50');
  });

  it('applies an expression on Enter and clamps it', () => {
    const f = field({ value: '5', min: '0', max: '10' });
    const seen = changes(f);
    focusIn(f);
    f.value = '3+4';
    key(f, 'Enter');
    expect(f.value).toBe('7');
    expect(seen[0]).toBe('7');
  });

  it('puts the original text back on Escape', () => {
    const f = field({ value: '5' });
    focusIn(f);
    f.value = '7+';
    key(f, 'Escape');
    expect(f.value).toBe('5');
  });

  it('steps with the arrow keys, snapping to the step and ten times with Shift', () => {
    const f = field({ value: '12', min: '0', max: '100', step: '5' });
    focusIn(f);
    key(f, 'ArrowUp');
    expect(f.value).toBe('15');
    key(f, 'ArrowUp', true);
    expect(f.value).toBe('65');
    key(f, 'ArrowDown');
    expect(f.value).toBe('60');
  });

  it('stops an arrow step at the limits', () => {
    const f = field({ value: '95', min: '0', max: '100', step: '5' });
    focusIn(f);
    key(f, 'ArrowUp', true);
    expect(f.value).toBe('100');
    key(f, 'ArrowDown', true);
    key(f, 'ArrowDown', true);
    key(f, 'ArrowDown', true);
    key(f, 'ArrowDown', true);
    key(f, 'ArrowDown', true);
    key(f, 'ArrowDown', true);
    key(f, 'ArrowDown', true);
    key(f, 'ArrowDown', true);
    key(f, 'ArrowDown', true);
    key(f, 'ArrowDown', true);
    key(f, 'ArrowDown', true);
    expect(f.value).toBe('0');
  });

  it('leaves a field marked plain alone', () => {
    const f = field({ value: '5', 'data-plain': '' });
    focusIn(f);
    expect(f.type).toBe('number');
  });
});
