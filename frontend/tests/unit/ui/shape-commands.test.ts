import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/engine/shape-ops', () => ({
  shapeExtra: (...args: unknown[]) => ({ args }),
  shapeColorOver: () => '#123456',
  solidExtra: () => ({ solid: true }),
  maskShape: () => ({ mask: true }),
}));
vi.mock('@src/engine/ops', () => ({
  updateContent: (mv: { items: Record<string, unknown> }, id: string, fn: (x: Record<string, unknown>) => Record<string, unknown>) => ({ ...mv, items: { ...mv.items, [id]: fn({ id }) } }),
}));

import type { Engine } from '@src/engine/engine';
import type { ShapePanel } from '@src/ui/shape-panel';
import type { ShapeStage } from '@src/ui/shape-stage';
import { SHAPE_CREATE_ITEMS, shapeCommands } from '@src/ui/shape-commands';

interface FakeEngine {
  movie: unknown;
  frame: number;
  selected: Array<{ id: string; kind: string; shape?: unknown }>;
  insert: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
}

const setup = (over: Partial<FakeEngine> = {}) => {
  const engine: FakeEngine = { movie: { items: {} }, frame: 0, selected: [], insert: vi.fn(() => 'new1'), select: vi.fn(), run: vi.fn(), ...over };
  const toggleTool = vi.fn();
  const stage = { toggleTool } as unknown as ShapeStage;
  const open = vi.fn();
  const panel = { open } as unknown as ShapePanel;
  const cmds = shapeCommands(engine as unknown as Engine, () => stage, panel, () => ({ x: 7, y: 9 }));
  const get = (id: string) => {
    const c = cmds.find((x) => x.id === id);
    if (!c) throw new Error(`missing ${id}`);
    return c;
  };
  return { engine, toggleTool, open, cmds, get };
};

describe('shapeCommands', () => {
  it('has a command for every Create menu entry', () => {
    const { cmds } = setup();
    const ids = new Set(cmds.map((c) => c.id));
    const wanted = SHAPE_CREATE_ITEMS.flatMap((e) => (typeof e === 'string' ? [e] : e.items)).filter((x) => x !== '-');
    expect(wanted.length).toBeGreaterThan(0);
    for (const id of wanted) expect(ids.has(id)).toBe(true);
  });

  it('gives every command a unique id', () => {
    const { cmds } = setup();
    expect(new Set(cmds.map((c) => c.id)).size).toBe(cmds.length);
  });

  it('disables the create commands when no movie is open', () => {
    const { get } = setup({ movie: null });
    for (const id of ['add-shape-rect', 'add-shape-star', 'shape-tool', 'shape-pen', 'add-solid', 'add-adjust']) {
      expect(get(id).enabled?.()).toBe(false);
    }
  });

  it('adds a shape of the right type and size, then selects it', () => {
    const { engine, get } = setup();
    expect(get('add-shape-rect').run()).toBe('new1');
    const [kind, extra] = engine.insert.mock.calls[0] as [string, { args: unknown[] }];
    expect(kind).toBe('shape');
    expect(extra.args.slice(0, 3)).toEqual(['rect', 400, 300]);
    expect(extra.args[8]).toBe('#123456');
    expect(engine.select).toHaveBeenCalledWith(['new1']);
  });

  it('uses a wide flat box for an arrow and a square box for a star', () => {
    const { engine, get } = setup();
    get('add-shape-arrow').run();
    get('add-shape-star').run();
    get('add-shape-line').run();
    const sizes = engine.insert.mock.calls.map((c) => (c[1] as { args: unknown[] }).args.slice(0, 3));
    expect(sizes[0]).toEqual(['arrow', 480, 60]);
    expect(sizes[1]).toEqual(['star', 320, 320]);
    expect(sizes[2].slice(0, 2)).toEqual(['line', 480]);
  });

  it('does not select anything when the insert is refused', () => {
    const { engine, get } = setup({ insert: vi.fn(() => null) });
    get('add-shape-ellipse').run();
    get('add-solid').run();
    get('add-adjust').run();
    expect(engine.select).not.toHaveBeenCalled();
  });

  it('adds a solid and a named adjustment block', () => {
    const { engine, get } = setup();
    get('add-solid').run();
    get('add-adjust').run();
    expect(engine.insert.mock.calls[0]).toEqual(['solid', { solid: true }]);
    expect(engine.insert.mock.calls[1]).toEqual(['adjust', { name: 'Adjustment' }]);
  });

  it('toggles the shape tool and the pen tool on the stage', () => {
    const { toggleTool, get } = setup();
    get('shape-tool').run();
    get('shape-pen').run();
    expect(toggleTool.mock.calls).toEqual([[undefined], ['pen']]);
  });

  it('does nothing for the tools when there is no stage', () => {
    const engine = { movie: {}, frame: 0, selected: [], insert: vi.fn(), select: vi.fn(), run: vi.fn() };
    const cmds = shapeCommands(engine as unknown as Engine, () => null, { open: vi.fn() } as unknown as ShapePanel, () => ({ x: 0, y: 0 }));
    expect(() => cmds.find((c) => c.id === 'shape-pen')?.run()).not.toThrow();
  });

  it('enables shape options only for a selected shape, solid or adjustment', () => {
    expect(setup({ selected: [{ id: 'a', kind: 'video' }] }).get('shape-options').enabled?.()).toBe(false);
    for (const kind of ['shape', 'solid', 'adjust']) {
      expect(setup({ selected: [{ id: 'a', kind: 'video' }, { id: 'b', kind }] }).get('shape-options').enabled?.()).toBe(true);
    }
  });

  it('opens the shape panel at the anchor', () => {
    const { open, get } = setup({ selected: [{ id: 'a', kind: 'shape' }] });
    get('shape-options').run();
    expect(open).toHaveBeenCalledWith({ x: 7, y: 9 });
  });

  it('offers a mask only for an adjustment that has none yet', () => {
    expect(setup({ selected: [{ id: 'a', kind: 'adjust' }] }).get('adjust-mask').enabled?.()).toBe(true);
    expect(setup({ selected: [{ id: 'a', kind: 'adjust', shape: {} }] }).get('adjust-mask').enabled?.()).toBe(false);
    expect(setup({ selected: [{ id: 'a', kind: 'shape' }] }).get('adjust-mask').enabled?.()).toBe(false);
  });

  it('adds the mask to the selected adjustment as one undoable step', () => {
    const { engine, get } = setup({ selected: [{ id: 's', kind: 'shape' }, { id: 'adj', kind: 'adjust' }] });
    get('adjust-mask').run();
    expect(engine.run).toHaveBeenCalledTimes(1);
    const [name, fn] = engine.run.mock.calls[0] as [string, (mv: { items: Record<string, unknown> }) => { items: Record<string, unknown> }];
    expect(name).toBe('Adjustment mask');
    expect(fn({ items: {} }).items.adj).toEqual({ id: 'adj', shape: { mask: true } });
  });

  it('does not run the mask step without a movie', () => {
    const { engine, get } = setup({ movie: null, selected: [{ id: 'adj', kind: 'adjust' }] });
    get('adjust-mask').run();
    expect(engine.run).not.toHaveBeenCalled();
  });
});
