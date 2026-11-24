import { describe, expect, it } from 'vitest';
import { PenArbiter, type ArbiterConfig, type ArbiterEvent } from '@src/paint/pen-arbiter';

function ev(pointerType: string, over: Partial<ArbiterEvent> = {}): ArbiterEvent {
  return { pointerId: 1, pointerType, clientX: 0, clientY: 0, button: 0, buttons: 0, timeStamp: 0, ...over };
}

function make(cfg: Partial<ArbiterConfig> = {}): PenArbiter {
  const full: ArbiterConfig = { palm: true, palmWidth: 40, ...cfg };
  return new PenArbiter(() => full);
}

describe('PenArbiter range tracking', () => {
  it('is out of range before any pen event', () => {
    const a = make();
    expect(a.inRange(0)).toBe(false);
    expect(a.penDown).toBe(false);
  });

  it('keeps a hovering pen in range for half a second', () => {
    const a = make();
    a.note(ev('pen', { timeStamp: 1000 }));
    expect(a.inRange(1499)).toBe(true);
    expect(a.inRange(1500)).toBe(false);
  });

  it('ignores mouse and touch events for range', () => {
    const a = make();
    a.note(ev('mouse', { timeStamp: 1000 }), 'down');
    a.note(ev('touch', { timeStamp: 1000 }), 'down');
    expect(a.inRange(1001)).toBe(false);
    expect(a.penDown).toBe(false);
  });

  it('stays in range for as long as the pen is down', () => {
    const a = make();
    a.note(ev('pen', { timeStamp: 1000 }), 'down');
    expect(a.penDown).toBe(true);
    expect(a.inRange(99999)).toBe(true);
    a.note(ev('pen', { timeStamp: 2000 }), 'up');
    expect(a.penDown).toBe(false);
    expect(a.inRange(2600)).toBe(false);
  });

  it('drops out of range at once when a hovering pen leaves', () => {
    const a = make();
    a.note(ev('pen', { timeStamp: 1000 }));
    a.leave({ pointerType: 'pen', pointerId: 1 });
    expect(a.inRange(1001)).toBe(false);
  });

  it('does not drop out of range when a pen that is down leaves', () => {
    const a = make();
    a.note(ev('pen', { timeStamp: 1000 }), 'down');
    a.leave({ pointerType: 'pen', pointerId: 1 });
    expect(a.inRange(1001)).toBe(true);
  });
});

describe('PenArbiter touch policy', () => {
  it('lets a finger paint when no pen is about', () => {
    expect(make().touch(ev('touch', { timeStamp: 50 }))).toBe('paint');
  });

  it('lets a wide touch paint when no pen was ever seen', () => {
    expect(make().touch(ev('touch', { width: 80, height: 80 }))).toBe('paint');
  });

  it('rejects a palm sized touch once a pen has been seen', () => {
    const a = make();
    a.note(ev('pen', { timeStamp: 0 }));
    expect(a.touch(ev('touch', { timeStamp: 90000, width: 10, height: 40 }))).toBe('reject');
    expect(a.touch(ev('touch', { timeStamp: 90000, width: 39, height: 10 }))).toBe('paint');
  });

  it('makes fingers navigate while the pen is in range', () => {
    const a = make();
    a.note(ev('pen', { timeStamp: 1000 }));
    expect(a.touch(ev('touch', { timeStamp: 1200, clientX: 300 }))).toBe('navigate');
    expect(a.touch(ev('touch', { timeStamp: 1600, clientX: 300 }))).toBe('paint');
  });

  it('rejects a finger resting next to a pen that is down', () => {
    const a = make();
    a.note(ev('pen', { timeStamp: 1000, clientX: 100, clientY: 100 }), 'down');
    expect(a.touch(ev('touch', { timeStamp: 1100, clientX: 110, clientY: 110 }))).toBe('reject');
    expect(a.touch(ev('touch', { timeStamp: 1100, clientX: 124, clientY: 100 }))).toBe('navigate');
    expect(a.touch(ev('touch', { timeStamp: 1100, clientX: 124, clientY: 100, width: 10 }))).toBe('reject');
  });

  it('follows the pen as it moves while down', () => {
    const a = make();
    a.note(ev('pen', { timeStamp: 1000, clientX: 100, clientY: 100 }), 'down');
    a.note(ev('pen', { timeStamp: 1010, clientX: 400, clientY: 100 }), 'move');
    expect(a.touch(ev('touch', { timeStamp: 1020, clientX: 105, clientY: 100 }))).toBe('navigate');
    expect(a.touch(ev('touch', { timeStamp: 1020, clientX: 405, clientY: 100 }))).toBe('reject');
  });

  it('lets everything paint when palm rejection is off', () => {
    const a = make({ palm: false });
    a.note(ev('pen', { timeStamp: 1000 }), 'down');
    expect(a.touch(ev('touch', { timeStamp: 1001, width: 200 }))).toBe('paint');
  });

  it('never restricts a mouse', () => {
    const a = make();
    a.note(ev('pen', { timeStamp: 1000 }), 'down');
    expect(a.touch(ev('mouse', { timeStamp: 1001 }))).toBe('paint');
  });

  it('remembers a rejected touch until it is released', () => {
    const a = make();
    a.note(ev('pen', { timeStamp: 0 }));
    expect(a.admit(ev('touch', { pointerId: 7, width: 60 }))).toBe('reject');
    expect(a.isDropped(7)).toBe(true);
    expect(a.admit(ev('touch', { pointerId: 8, timeStamp: 5000 }))).toBe('paint');
    expect(a.isDropped(8)).toBe(false);
    a.release(7);
    expect(a.isDropped(7)).toBe(false);
  });
});

describe('PenArbiter classify', () => {
  const a = make();

  it('gives no role to a pointer that is not a pen', () => {
    expect(a.classify({ pointerType: 'mouse', button: 2, buttons: 2 })).toBeNull();
  });

  it('gives no role to a plain pen tip', () => {
    expect(a.classify({ pointerType: 'pen', button: 0, buttons: 1 })).toBeNull();
  });

  it('reads the eraser end from button 5 or the 32 bit', () => {
    expect(a.classify({ pointerType: 'pen', button: 5, buttons: 0 })).toBe('eraser');
    expect(a.classify({ pointerType: 'pen', button: 0, buttons: 32 })).toBe('eraser');
  });

  it('reads the two barrel buttons', () => {
    expect(a.classify({ pointerType: 'pen', button: 2, buttons: 0 })).toBe('barrel1');
    expect(a.classify({ pointerType: 'pen', button: 0, buttons: 3 })).toBe('barrel1');
    expect(a.classify({ pointerType: 'pen', button: 1, buttons: 0 })).toBe('barrel2');
    expect(a.classify({ pointerType: 'pen', button: 0, buttons: 5 })).toBe('barrel2');
  });

  it('prefers the eraser over a barrel button held with it', () => {
    expect(a.classify({ pointerType: 'pen', button: 0, buttons: 34 })).toBe('eraser');
  });
});
