// Commands and menu items for Shape, Solid and Adjustment content (Create menu, Content menu, command palette).
import type { Engine } from '../engine/engine';
import * as ops from '../engine/ops';
import { maskShape, shapeColorOver, shapeExtra, solidExtra } from '../engine/shape-ops';
import type { ShapeType } from '../engine/shape-types';
import type { Command } from './commands';
import type { ShapePanel } from './shape-panel';
import type { ShapeStage, ShapeTool } from './shape-stage';

const TYPES: Array<[ShapeType, string]> = [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['polygon', 'Polygon'], ['star', 'Star'], ['line', 'Line'], ['arrow', 'Arrow']];

/** The Create menu entries for the three new kinds: a Shape submenu, then Solid and Adjustment. */
export const SHAPE_CREATE_ITEMS: Array<string | { label: string; items: string[] }> = [
  { label: 'Shape', items: [...TYPES.map(([t]) => `add-shape-${t}`), '-', 'shape-tool', 'shape-pen'] },
  'add-solid',
  'add-adjust',
];

export function shapeCommands(engine: Engine, stage: () => ShapeStage | null, panel: ShapePanel, anchor: () => { x: number; y: number }): Command[] {
  const has = (): boolean => !!engine.movie;
  const isShape = (): boolean => engine.selected.some((c) => c.kind === 'shape' || c.kind === 'solid' || c.kind === 'adjust');
  const out: Command[] = [];
  for (const [t, label] of TYPES) {
    out.push({
      id: `add-shape-${t}`, label, icon: 'shape', enabled: has, mutates: true,
      group: 'Create', description: `Adds a ${label.toLowerCase()} shape at the Playhead.`,
      run: () => {
        const w = t === 'line' || t === 'arrow' ? 480 : t === 'rect' || t === 'ellipse' ? 400 : 320;
        const h = t === 'rect' || t === 'ellipse' ? 300 : t === 'arrow' ? 60 : 320;
        const id = engine.insert('shape', shapeExtra(t, w, h, 0, 0, 0, undefined, false, shapeColorOver(engine.movie, engine.frame)));
        if (id) engine.select([id]);
        return id;
      },
    });
  }
  const tool = (kind?: ShapeTool): void => { stage()?.toggleTool(kind); };
  out.push(
    { id: 'shape-tool', label: 'Shape tool', icon: 'shape', keys: ['U'], enabled: has, group: 'Create', description: 'Draws a shape by dragging on the Stage.', run: () => tool() },
    { id: 'shape-pen', label: 'Pen tool', icon: 'shPen', keys: ['P'], enabled: has, group: 'Create', description: 'Draws a curved path on the Stage: click for corners, drag for curves, click the first node to close.', run: () => tool('pen') },
    {
      id: 'add-solid', label: 'Solid', icon: 'solid', enabled: has, mutates: true, group: 'Create', description: 'Adds a color block that fills the movie.',
      run: () => { const id = engine.insert('solid', solidExtra()); if (id) engine.select([id]); return id; },
    },
    {
      id: 'add-adjust', label: 'Adjustment', icon: 'adjust', enabled: has, mutates: true, group: 'Create',
      description: 'Adds a block whose live filters apply to everything on the tracks below it.',
      run: () => {
        const id = engine.insert('adjust', { name: 'Adjustment' });
        if (id) engine.select([id]);
        return id;
      },
    },
    {
      id: 'shape-options', label: 'Shape options...', icon: 'shape', enabled: isShape, group: 'Content', description: 'Opens the Shape panel for the selected Shape, Solid or Adjustment.',
      run: () => { const p = anchor(); panel.open(p); },
    },
    {
      id: 'adjust-mask', label: 'Add mask to Adjustment', enabled: () => engine.selected.some((c) => c.kind === 'adjust' && !c.shape), mutates: true, group: 'Content',
      description: 'Limits the selected Adjustment to a soft-edged outline.',
      run: () => {
        const c = engine.selected.find((x) => x.kind === 'adjust');
        const m = engine.movie;
        if (c && m) engine.run('Adjustment mask', (mv) => ops.updateContent(mv, c.id, (x) => ({ ...x, shape: maskShape(mv) })));
      },
    },
  );
  return out;
}
