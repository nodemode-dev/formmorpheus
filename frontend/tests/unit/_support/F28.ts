export class Bytes {
  private out: number[] = [];
  get length(): number { return this.out.length; }
  u8(n: number): this { this.out.push(n & 255); return this; }
  u16(n: number): this { this.out.push((n >>> 8) & 255, n & 255); return this; }
  u32(n: number): this { this.out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); return this; }
  i32(n: number): this { return this.u32(n >>> 0); }
  f64(x: number): this { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x); this.out.push(...b); return this; }
  ascii(s: string): this { for (let i = 0; i < s.length; i++) this.out.push(s.charCodeAt(i)); return this; }
  utf16(s: string): this { for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i)); return this; }
  raw(b: ArrayLike<number>): this { for (let i = 0; i < b.length; i++) this.out.push(b[i] & 255); return this; }
  text(s: string): this { return this.u32(s.length).utf16(s); }
  key(s: string): this { return this.u32(s.length).ascii(s); }
  bytes(): Uint8Array { return Uint8Array.from(this.out); }
  view(): DataView { const b = this.bytes(); return new DataView(b.buffer); }
}

export function descriptorHead(cls: string, count: number): Bytes {
  return new Bytes().text('').key(cls).u32(count);
}

export interface ChannelSpec { depth: number; w: number; h: number; comp: number; data: ArrayLike<number> }

export function patternRecord(opts: { mode: number; name: string; id: string; w: number; h: number; channels: ChannelSpec[]; declared?: number }): Uint8Array {
  const body = new Bytes().u32(1).u32(opts.mode).u32(0).text(opts.name).u8(opts.id.length).ascii(opts.id);
  const chans = new Bytes();
  for (const c of opts.channels) {
    const one = new Bytes().u32(c.depth).i32(0).i32(0).i32(c.h).i32(c.w).u16(c.depth).u8(c.comp).raw(c.data);
    chans.u32(1).u32(one.length).raw(one.bytes());
  }
  const vma = new Bytes().i32(0).i32(0).i32(opts.h).i32(opts.w).u32(opts.declared ?? opts.channels.length).raw(chans.bytes());
  body.u32(3).u32(vma.length).raw(vma.bytes());
  const rec = new Bytes().u32(body.length).raw(body.bytes());
  while (rec.length % 4) rec.u8(0);
  return rec.bytes();
}
