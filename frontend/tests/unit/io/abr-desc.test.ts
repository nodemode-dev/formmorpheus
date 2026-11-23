import { describe, expect, it } from 'vitest';
import { boolOf, dynOf, isEnum, isNode, isUnit, numOf, readDescriptor, readPhry, textOf, type DescNode } from '@src/io/abr-desc';
import { Bytes, descriptorHead } from '../_support/F28';

describe('readDescriptor', () => {
  it('reads every scalar kind under its key', () => {
    const b = descriptorHead('null', 7)
      .key('Dmtr').ascii('UntF').ascii('#Pxl').f64(12.5)
      .key('Cnt ').ascii('long').i32(-7)
      .key('Hrdn').ascii('doub').f64(0.75)
      .key('Flip').ascii('bool').u8(1)
      .key('Nm  ').ascii('TEXT').text('Soft\u0000')
      .key('Md  ').ascii('enum').key('BlnM').key('Mltp')
      .key('Big ').ascii('comp').u32(0).u32(9);
    const { root, error } = readDescriptor(b.view(), 0);
    expect(error).toBeNull();
    expect(root.cls).toBe('null');
    expect(root.items.get('Dmtr')).toEqual({ u: '#Pxl', v: 12.5 });
    expect(root.items.get('Cnt ')).toBe(-7);
    expect(root.items.get('Hrdn')).toBe(0.75);
    expect(root.items.get('Flip')).toBe(true);
    expect(root.items.get('Nm  ')).toBe('Soft');
    expect(root.items.get('Md  ')).toEqual({ t: 'BlnM', e: 'Mltp' });
    expect(root.items.get('Big ')).toBe(9);
  });

  it('treats a key length of zero as a four character key', () => {
    const b = descriptorHead('null', 1).u32(0).ascii('Angl').ascii('long').i32(45);
    expect(readDescriptor(b.view(), 0).root.items.get('Angl')).toBe(45);
  });

  it('reads nested objects and lists', () => {
    const inner = descriptorHead('computedBrush', 1).key('Rndn').ascii('long').i32(80);
    const b = descriptorHead('null', 1).key('Brsh').ascii('VlLs').u32(2)
      .ascii('Objc').raw(inner.bytes())
      .ascii('long').i32(3);
    const { root, error } = readDescriptor(b.view(), 0);
    expect(error).toBeNull();
    const list = root.items.get('Brsh') as [DescNode, number];
    expect(list).toHaveLength(2);
    expect(list[0].cls).toBe('computedBrush');
    expect(list[0].items.get('Rndn')).toBe(80);
    expect(list[1]).toBe(3);
  });

  it('skips raw data and keeps reading what follows', () => {
    const b = descriptorHead('null', 2).key('Blob').ascii('tdta').u32(3).raw([9, 9, 9]).key('Next').ascii('long').i32(1);
    const { root, error } = readDescriptor(b.view(), 0);
    expect(error).toBeNull();
    expect(root.items.get('Blob')).toBeNull();
    expect(root.items.get('Next')).toBe(1);
  });

  it('reads a list of unit values sharing one unit', () => {
    const b = descriptorHead('null', 1).key('Vals').ascii('UnFl').ascii('#Prc').u32(2).f64(10).f64(20);
    expect(readDescriptor(b.view(), 0).root.items.get('Vals')).toEqual([{ u: '#Prc', v: 10 }, { u: '#Prc', v: 20 }]);
  });

  it('starts at the given offset and stops at the given end', () => {
    const d = descriptorHead('null', 1).key('Cnt ').ascii('long').i32(5);
    const b = new Bytes().u32(16).raw(d.bytes()).raw([1, 2, 3]);
    expect(readDescriptor(b.view(), 4, 4 + d.length).root.items.get('Cnt ')).toBe(5);
    expect(readDescriptor(b.view(), 4, 4 + d.length - 1).error).toBe('descriptor ran past its section');
  });

  it('stops at an unknown type and keeps what was read before it', () => {
    const b = descriptorHead('null', 3).key('Good').ascii('long').i32(4).key('Odd ').ascii('zzzz').u32(1).key('Late').ascii('long').i32(5);
    const { root, error } = readDescriptor(b.view(), 0);
    expect(error).toContain('zzzz');
    expect(root.items.get('Good')).toBe(4);
    expect(root.items.has('Late')).toBe(false);
  });

  it('reports a truncated value and keeps the partial tree', () => {
    const b = descriptorHead('null', 2).key('Good').ascii('long').i32(4).key('Cut ').ascii('doub').u32(1);
    const { root, error } = readDescriptor(b.view(), 0);
    expect(error).toBe('descriptor ran past its section');
    expect(root.items.get('Good')).toBe(4);
  });

  it('refuses a text length that runs past the data', () => {
    const b = descriptorHead('null', 1).key('Nm  ').ascii('TEXT').u32(0x7fffffff);
    expect(readDescriptor(b.view(), 0).error).toBe('descriptor ran past its section');
  });

  it('refuses a key longer than 256 bytes', () => {
    const b = descriptorHead('null', 1).u32(257).raw(new Uint8Array(300));
    expect(readDescriptor(b.view(), 0).error).toBe('bad key length');
  });

  it('refuses an item count larger than the data left', () => {
    const b = descriptorHead('null', 0xffffffff).raw([0, 0]);
    const { root, error } = readDescriptor(b.view(), 0);
    expect(error).toBe('bad item count');
    expect(root.items.size).toBe(0);
  });

  it('refuses a list count larger than the data left', () => {
    const b = descriptorHead('null', 1).key('List').ascii('VlLs').u32(0xfffffff0);
    const { root, error } = readDescriptor(b.view(), 0);
    expect(error).toBe('bad list length');
    expect(root.items.get('List')).toEqual([]);
  });

  it('refuses lists nested deeper than the limit', () => {
    const b = descriptorHead('null', 1).key('List').ascii('VlLs');
    for (let i = 0; i < 40; i++) b.u32(1).ascii('VlLs');
    b.u32(0).raw(new Uint8Array(64));
    expect(readDescriptor(b.view(), 0).error).toBe('descriptor too deep');
  });

  it('gives an empty root and an error for empty input', () => {
    const { root, error } = readDescriptor(new DataView(new ArrayBuffer(0)), 0);
    expect(error).not.toBeNull();
    expect(root.items.size).toBe(0);
  });
});

describe('descriptor getters', () => {
  it('reads numbers from plain numbers and unit values only', () => {
    expect(numOf(3)).toBe(3);
    expect(numOf({ u: '#Prc', v: 40 })).toBe(40);
    expect(numOf(Number.NaN)).toBeNull();
    expect(numOf({ u: '#Prc', v: Number.POSITIVE_INFINITY })).toBeNull();
    expect(numOf('3')).toBeNull();
    expect(numOf(undefined)).toBeNull();
  });

  it('reads text and booleans only from their own types', () => {
    expect(textOf('a')).toBe('a');
    expect(textOf(1)).toBeNull();
    expect(boolOf(false)).toBe(false);
    expect(boolOf(0)).toBeNull();
  });

  it('tells nodes, units and enums apart', () => {
    const node: DescNode = { cls: 'x', items: new Map() };
    expect(isNode(node)).toBe(true);
    expect(isNode({ u: 'a', v: 1 })).toBe(false);
    expect(isUnit({ u: 'a', v: 1 })).toBe(true);
    expect(isUnit(null)).toBe(false);
    expect(isEnum({ t: 'a', e: 'b' })).toBe(true);
    expect(isEnum(5)).toBe(false);
  });

  it('fills a dynamics group with defaults for missing fields', () => {
    const node: DescNode = { cls: 'brVr', items: new Map([['bVTy', 2], ['jitter', { u: '#Prc', v: 30 }]]) };
    expect(dynOf(node)).toEqual({ control: 2, steps: 25, jitter: 30, min: 0 });
    expect(dynOf(7)).toBeNull();
    expect(dynOf(undefined)).toBeNull();
  });
});

describe('readPhry', () => {
  const obj = (cls: string, name?: string): Bytes => {
    const b = new Bytes().ascii('Objc').text('').key(cls);
    return name === undefined ? b.u32(0) : b.u32(1).key('Nm  ').ascii('TEXT').text(name);
  };

  it('gives each preset the folders open around it', () => {
    const b = descriptorHead('null', 1).key('hierarchy').ascii('VlLs').u32(7)
      .raw(obj('preset').bytes())
      .raw(obj('Grup', 'Inks').bytes())
      .raw(obj('Grup', ' Dry ').bytes())
      .raw(obj('preset').bytes())
      .raw(obj('groupEnd').bytes())
      .raw(obj('preset').bytes())
      .raw(obj('groupEnd').bytes());
    const { paths, error } = readPhry(b.view(), 0, b.length);
    expect(error).toBeNull();
    expect(paths).toEqual([[], ['Inks', 'Dry'], ['Inks']]);
  });

  it('gives no paths when the list is missing', () => {
    const b = descriptorHead('null', 0);
    expect(readPhry(b.view(), 0, b.length).paths).toEqual([]);
  });
});
