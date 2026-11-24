import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '@src/engine/events';

interface Events { ping: number; name: string }

describe('Emitter', () => {
  it('delivers a value to every listener of that key only', () => {
    const e = new Emitter<Events>();
    const a = vi.fn(), b = vi.fn(), other = vi.fn();
    e.on('ping', a);
    e.on('ping', b);
    e.on('name', other);
    e.emit('ping', 7);
    expect(a).toHaveBeenCalledWith(7);
    expect(b).toHaveBeenCalledWith(7);
    expect(other).not.toHaveBeenCalled();
  });

  it('stops delivering after the returned function is called', () => {
    const e = new Emitter<Events>();
    const a = vi.fn();
    const off = e.on('ping', a);
    e.emit('ping', 1);
    off();
    e.emit('ping', 2);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('registers the same listener once', () => {
    const e = new Emitter<Events>();
    const a = vi.fn();
    e.on('ping', a);
    e.on('ping', a);
    e.emit('ping', 1);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('keeps going after a listener throws and logs the failure', () => {
    const e = new Emitter<Events>();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    e.on('ping', () => { throw new Error('bad listener'); });
    e.on('ping', after);
    expect(() => e.emit('ping', 3)).not.toThrow();
    expect(after).toHaveBeenCalledWith(3);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('still calls a listener that is removed during the same emit', () => {
    const e = new Emitter<Events>();
    const second = vi.fn();
    let off = (): void => undefined;
    e.on('ping', () => off());
    off = e.on('ping', second);
    e.emit('ping', 1);
    e.emit('ping', 2);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does nothing when nobody listens', () => {
    const e = new Emitter<Events>();
    expect(() => e.emit('name', 'x')).not.toThrow();
  });
});
