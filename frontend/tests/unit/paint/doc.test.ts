import { describe, expect, it, vi } from 'vitest';
import { PaintDoc } from '@src/paint/doc';

describe('PaintDoc layer stack', () => {
  it('starts blank with one visible layer that is active', () => {
    const doc = PaintDoc.blank(32, 24);
    expect(doc.layers.length).toBe(1);
    const l = doc.layers[0];
    expect(doc.active).toBe(l.id);
    expect(l.name).toBe('Layer 1');
    expect(l.visible).toBe(true);
    expect(l.opacity).toBe(1);
    expect(l.raster.width).toBe(32);
    expect(l.raster.height).toBe(24);
    expect(l.raster.data.length).toBe(32 * 24 * 4);
    expect(doc.history.top()).toBeNull();
  });

  it('adds a layer above the active one and makes it active', () => {
    const doc = PaintDoc.blank(8, 8);
    const first = doc.layers[0];
    const added = doc.addLayer();
    expect(doc.layers.map((l) => l.id)).toEqual([added.id, first.id]);
    expect(doc.active).toBe(added.id);
    expect(added.name).toBe('Layer 2');
    expect(added.id).not.toBe(first.id);
  });

  it('adds a layer above a named layer and keeps a given name', () => {
    const doc = PaintDoc.blank(8, 8);
    const first = doc.layers[0];
    const top = doc.addLayer();
    const mid = doc.addLayer(first.id, 'Ink');
    expect(doc.layers.map((l) => l.id)).toEqual([top.id, mid.id, first.id]);
    expect(mid.name).toBe('Ink');
  });

  it('skips a default name that is already taken', () => {
    const doc = PaintDoc.blank(8, 8);
    doc.addLayer(undefined, 'Layer 3');
    expect(doc.addLayer().name).toBe('Layer 4');
  });

  it('undoes and redoes adding a layer', () => {
    const doc = PaintDoc.blank(8, 8);
    const first = doc.layers[0];
    const added = doc.addLayer();
    expect(doc.history.undo()).toBe(true);
    expect(doc.layers.map((l) => l.id)).toEqual([first.id]);
    expect(doc.active).toBe(first.id);
    expect(doc.history.redo()).toBe(true);
    expect(doc.layers.map((l) => l.id)).toEqual([added.id, first.id]);
    expect(doc.active).toBe(added.id);
  });

  it('has nothing to undo on a fresh document', () => {
    const doc = PaintDoc.blank(8, 8);
    expect(doc.history.undo()).toBe(false);
    expect(doc.history.redo()).toBe(false);
  });

  it('ignores an unknown id when choosing the active layer', () => {
    const doc = PaintDoc.blank(8, 8);
    const seen = vi.fn();
    doc.onChange = seen;
    const before = doc.active;
    doc.setActive('nope');
    doc.setActive(before);
    expect(doc.active).toBe(before);
    expect(seen).not.toHaveBeenCalled();
  });

  it('announces a change of the active layer', () => {
    const doc = PaintDoc.blank(8, 8);
    const first = doc.layers[0];
    doc.addLayer();
    const seen = vi.fn();
    doc.onChange = seen;
    doc.setActive(first.id);
    expect(doc.active).toBe(first.id);
    expect(doc.activeLayer()).toBe(first);
    expect(seen).toHaveBeenCalledWith('active');
  });

  it('moves the active layer to a neighbour when the active one is deleted', () => {
    const doc = PaintDoc.blank(8, 8);
    const first = doc.layers[0];
    const added = doc.addLayer();
    doc.deleteLayer(added.id);
    expect(doc.layers.map((l) => l.id)).toEqual([first.id]);
    expect(doc.active).toBe(first.id);
    expect(doc.history.undo()).toBe(true);
    expect(doc.layers.length).toBe(2);
    expect(doc.active).toBe(added.id);
  });

  it('keeps the last layer when asked to delete it', () => {
    const doc = PaintDoc.blank(8, 8);
    const only = doc.layers[0];
    doc.deleteLayer(only.id);
    expect(doc.layers.map((l) => l.id)).toEqual([only.id]);
    expect(doc.history.top()).toBeNull();
  });

  it('does nothing when deleting an unknown layer', () => {
    const doc = PaintDoc.blank(8, 8);
    doc.addLayer();
    const top = doc.history.top();
    doc.deleteLayer('nope');
    expect(doc.layers.length).toBe(2);
    expect(doc.history.top()).toBe(top);
  });

  it('clamps opacity into 0 to 1', () => {
    const doc = PaintDoc.blank(8, 8);
    const id = doc.active;
    doc.setProps(id, { opacity: -2 });
    expect(doc.layer(id)?.opacity).toBe(0);
    doc.setProps(id, { opacity: 7 });
    expect(doc.layer(id)?.opacity).toBe(1);
  });

  it('records a rename and undoes it', () => {
    const doc = PaintDoc.blank(8, 8);
    const id = doc.active;
    doc.setProps(id, { name: 'Lines' });
    expect(doc.layer(id)?.name).toBe('Lines');
    expect(doc.history.top()?.label).toBe('Rename layer');
    doc.history.undo();
    expect(doc.layer(id)?.name).toBe('Layer 1');
  });

  it('records nothing when the properties do not change', () => {
    const doc = PaintDoc.blank(8, 8);
    const seen = vi.fn();
    doc.onChange = seen;
    doc.setProps(doc.active, { visible: true, opacity: 1 });
    doc.setProps('nope', { visible: false });
    expect(doc.history.top()).toBeNull();
    expect(seen).not.toHaveBeenCalled();
  });

  it('can merge down only onto a layer below', () => {
    const doc = PaintDoc.blank(8, 8);
    const first = doc.layers[0];
    const added = doc.addLayer();
    expect(doc.canMergeDown(added.id)).toBe(true);
    expect(doc.canMergeDown(first.id)).toBe(false);
    expect(doc.canMergeDown('nope')).toBe(false);
  });
});

describe('PaintDoc masks', () => {
  it('adds a reveal mask that is white, on, linked and takes the brush', () => {
    const doc = PaintDoc.blank(4, 4);
    const id = doc.active;
    doc.addMask(id);
    const m = doc.layer(id)?.mask;
    expect(m?.on).toBe(true);
    expect(m?.linked).toBe(true);
    expect(Array.from(m?.raster.data.slice(0, 4) ?? [])).toEqual([255, 255, 255, 255]);
    expect(doc.maskEditing()).toBe(true);
    const t = doc.paintTarget();
    expect(t?.id).toBe('mask:' + id);
    expect(t?.mask).toBe(true);
    expect(t?.raster).toBe(m?.raster);
  });

  it('adds a hide mask that is opaque black', () => {
    const doc = PaintDoc.blank(4, 4);
    doc.addMask(doc.active, 'hide');
    expect(Array.from(doc.activeLayer().mask?.raster.data.slice(0, 4) ?? [])).toEqual([0, 0, 0, 255]);
  });

  it('does not replace a mask that is already there', () => {
    const doc = PaintDoc.blank(4, 4);
    doc.addMask(doc.active);
    const raster = doc.activeLayer().mask?.raster;
    doc.addMask(doc.active, 'hide');
    expect(doc.activeLayer().mask?.raster).toBe(raster);
  });

  it('sees the mask as a layer through the mask id', () => {
    const doc = PaintDoc.blank(4, 4);
    const id = doc.active;
    expect(doc.layerById('mask:' + id)).toBeNull();
    doc.addMask(id);
    const seen = doc.layerById('mask:' + id);
    expect(seen?.id).toBe('mask:' + id);
    expect(seen?.raster).toBe(doc.layer(id)?.mask?.raster);
    expect(doc.layerById(id)).toBe(doc.layer(id));
  });

  it('paints on the pixels again once mask editing is turned off', () => {
    const doc = PaintDoc.blank(4, 4);
    const id = doc.active;
    doc.addMask(id);
    doc.setMaskEdit(false);
    expect(doc.maskEditing()).toBe(false);
    const t = doc.paintTarget();
    expect(t?.id).toBe(id);
    expect(t?.mask).toBe(false);
    expect(t?.raster).toBe(doc.layer(id)?.raster);
  });

  it('refuses mask editing on a layer without a mask', () => {
    const doc = PaintDoc.blank(4, 4);
    doc.setMaskEdit(true);
    expect(doc.maskEditing()).toBe(false);
  });

  it('disables and unlinks a mask with a labelled undo step each', () => {
    const doc = PaintDoc.blank(4, 4);
    const id = doc.active;
    doc.addMask(id);
    doc.setMask(id, { on: false });
    expect(doc.layer(id)?.mask?.on).toBe(false);
    expect(doc.history.top()?.label).toBe('Disable mask');
    doc.setMask(id, { linked: false });
    expect(doc.layer(id)?.mask?.linked).toBe(false);
    expect(doc.history.top()?.label).toBe('Link mask');
    const top = doc.history.top();
    doc.setMask(id, { on: false, linked: false });
    expect(doc.history.top()).toBe(top);
  });

  it('deletes a mask and brings it back on undo', () => {
    const doc = PaintDoc.blank(4, 4);
    const id = doc.active;
    doc.addMask(id);
    doc.deleteMask(id);
    expect(doc.layer(id)?.mask ?? null).toBeNull();
    expect(doc.maskEditing()).toBe(false);
    doc.history.undo();
    expect(doc.layer(id)?.mask?.on).toBe(true);
  });
});
