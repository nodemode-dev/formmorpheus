import { describe, expect, it } from 'vitest';
import {
  MESH_DEFAULT, MESH_MAX, MESH_MIN, addBone, boneLabel, boneMatrices, boneQuads, boneTip, bonesActive, buildSkin, deleteBone,
  meshSize, nextBoneId, posedBones, rotationToward, setMesh, skinOf, skinPoints, weightAt,
} from '@src/engine/bones';
import { content } from '@src/engine/model';
import type { Animated } from '@src/engine/keys';
import type { Bone, Content, Rig } from '@src/engine/types';

function bone(id: string, x: number, y: number, length: number, angle = 0, parent?: string): Bone {
  return { id, x, y, length, angle, ...(parent ? { parent } : {}) } as Bone;
}

function arm(): Rig {
  return { bones: [bone('b1', 0, 0, 10), bone('b2', 10, 0, 10, 0, 'b1')] };
}

function near(got: number[], want: number[]): void {
  expect(got).toHaveLength(want.length);
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 5));
}

describe('bone basics', () => {
  it('uses the default mesh size and clamps a stored one', () => {
    expect(meshSize({ bones: [] })).toBe(MESH_DEFAULT);
    expect(meshSize({ bones: [], mesh: 1 })).toBe(MESH_MIN);
    expect(meshSize({ bones: [], mesh: 5000 })).toBe(MESH_MAX);
    expect(meshSize({ bones: [], mesh: Number.NaN })).toBe(MESH_DEFAULT);
    expect(meshSize({ bones: [], mesh: 40 })).toBe(40);
  });

  it('finds the tip of a bone from its angle in degrees', () => {
    near(boneTip(bone('b1', 5, 5, 10, 0)), [15, 5]);
    near(boneTip(bone('b1', 5, 5, 10, 90)), [5, 15]);
    near(boneTip(bone('b1', 5, 5, 10, 180)), [-5, 5]);
    near(boneTip(bone('b1', 5, 5, 0, 45)), [5, 5]);
  });

  it('labels a numbered bone and passes other ids through', () => {
    expect(boneLabel('b3')).toBe('Bone 3');
    expect(boneLabel('spine')).toBe('spine');
    expect(boneLabel('b3x')).toBe('b3x');
  });

  it('gives the next free bone id after the highest number', () => {
    expect(nextBoneId(undefined)).toBe('b1');
    expect(nextBoneId({ bones: [] })).toBe('b1');
    expect(nextBoneId({ bones: [bone('b2', 0, 0, 1), bone('b7', 0, 0, 1), bone('tail', 0, 0, 1)] })).toBe('b8');
  });
});

describe('forward kinematics', () => {
  it('gives every bone the identity when nothing is turned', () => {
    const m = boneMatrices(arm(), null);
    near(Array.from(m), [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
  });

  it('turns a bone about its own head', () => {
    const rig: Rig = { bones: [bone('b1', 10, 20, 10)] };
    const [p] = posedBones(rig, { b1: 90 });
    near(p.head, [10, 20]);
    near(p.tip, [10, 30]);
    expect(p.angle).toBeCloseTo(90, 10);
  });

  it('carries a child along with its parent', () => {
    const p = posedBones(arm(), { b1: 90 });
    near(p[0].tip, [0, 10]);
    near(p[1].head, [0, 10]);
    near(p[1].tip, [0, 20]);
    expect(p[1].angle).toBeCloseTo(90, 10);
  });

  it('adds the rotation of a child on top of its parent', () => {
    const p = posedBones(arm(), { b1: 90, b2: 90 });
    near(p[1].head, [0, 10]);
    near(p[1].tip, [-10, 10]);
    expect(p[1].angle).toBeCloseTo(180, 10);
  });

  it('resolves a parent listed after its child', () => {
    const rig: Rig = { bones: [bone('b2', 10, 0, 10, 0, 'b1'), bone('b1', 0, 0, 10)] };
    const p = posedBones(rig, { b1: 90 });
    near(p[0].tip, [0, 20]);
  });

  it('treats a missing or self parent as a root', () => {
    const rig: Rig = { bones: [bone('b1', 0, 0, 10, 0, 'gone'), bone('b2', 5, 5, 10, 0, 'b2')] };
    const m = boneMatrices(rig, { b1: 0, b2: 0 });
    near(Array.from(m), [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
  });

  it('stays finite when two bones name each other as parent', () => {
    const rig: Rig = { bones: [bone('b1', 0, 0, 10, 0, 'b2'), bone('b2', 10, 0, 10, 0, 'b1')] };
    const m = boneMatrices(rig, { b1: 30, b2: 30 });
    expect(Array.from(m).every((v) => Number.isFinite(v))).toBe(true);
    expect(posedBones(rig, { b1: 30, b2: 30 }).every((p) => Number.isFinite(p.angle))).toBe(true);
  });

  it('finds the rotation that points a bone at a target angle', () => {
    const rig = arm();
    expect(rotationToward(rig, null, 'b1', 90)).toBeCloseTo(90, 10);
    expect(rotationToward(rig, { b1: 30 }, 'b2', 90)).toBeCloseTo(60, 10);
    expect(rotationToward(rig, { b1: 30, b2: 999 }, 'b2', 90)).toBeCloseTo(60, 10);
  });

  it('wraps the rotation into minus 180 to 180 degrees', () => {
    const rig = arm();
    expect(rotationToward(rig, null, 'b1', 270)).toBeCloseTo(-90, 10);
    expect(rotationToward(rig, null, 'b1', -270)).toBeCloseTo(90, 10);
    expect(rotationToward(rig, null, 'b1', 720)).toBeCloseTo(0, 10);
  });

  it('returns zero for a bone that is not in the rig', () => {
    expect(rotationToward(arm(), null, 'nope', 45)).toBe(0);
  });

  it('reaches the target once the found rotation is applied', () => {
    const rig = arm();
    const r = rotationToward(rig, { b1: 25 }, 'b2', 140);
    expect(posedBones(rig, { b1: 25, b2: r })[1].angle).toBeCloseTo(140, 10);
  });
});

describe('skin', () => {
  it('lays a grid of vertices over the rect at the mesh size', () => {
    const skin = buildSkin({ bones: [bone('b1', 0, 0, 10)] }, { x: 10, y: 20, w: 48, h: 24 });
    expect(skin.cols).toBe(2);
    expect(skin.rows).toBe(1);
    near(Array.from(skin.rx), [10, 34, 58, 10, 34, 58]);
    near(Array.from(skin.ry), [20, 20, 20, 44, 44, 44]);
  });

  it('keeps one cell for an empty rect', () => {
    const skin = buildSkin({ bones: [bone('b1', 0, 0, 10)] }, { x: 0, y: 0, w: 0, h: 0 });
    expect(skin.cols).toBe(1);
    expect(skin.rows).toBe(1);
    expect(skin.rx).toHaveLength(4);
  });

  it('coarsens the mesh of a huge picture', () => {
    const skin = buildSkin({ bones: [bone('b1', 0, 0, 10)], mesh: 8 }, { x: 0, y: 0, w: 4000, h: 4000 });
    expect(skin.cols * skin.rows).toBeLessThanOrEqual(6500);
    expect(skin.cols * skin.rows).toBeGreaterThan(3000);
  });

  it('gives every vertex weights that add up to one', () => {
    const skin = buildSkin({ bones: [bone('b1', 0, 50, 100), bone('b2', 100, 50, 100, 0, 'b1')] }, { x: 0, y: 0, w: 200, h: 100 });
    for (let v = 0; v < skin.rx.length; v++) {
      expect(skin.bw[v * 2] + skin.bw[v * 2 + 1]).toBeCloseTo(1, 5);
      expect(weightAt(skin, 0, v) + weightAt(skin, 1, v)).toBeCloseTo(1, 5);
    }
  });

  it('binds a vertex most strongly to the bone it lies on', () => {
    const skin = buildSkin({ bones: [bone('b1', 0, 48, 96), bone('b2', 96, 48, 96, 0, 'b1')], mesh: 24 }, { x: 0, y: 0, w: 192, h: 96 });
    const at = (i: number, j: number): number => j * (skin.cols + 1) + i;
    expect(weightAt(skin, 0, at(1, 2))).toBeGreaterThan(0.9);
    expect(weightAt(skin, 1, at(7, 2))).toBeGreaterThan(0.9);
    expect(weightAt(skin, 0, at(4, 2))).toBeCloseTo(0.5, 2);
  });

  it('gives the whole weight to the only bone, also far beyond its reach', () => {
    const skin = buildSkin({ bones: [bone('b1', 0, 0, 10)] }, { x: 0, y: 0, w: 480, h: 480 });
    for (let v = 0; v < skin.rx.length; v++) expect(weightAt(skin, 0, v)).toBeCloseTo(1, 6);
  });

  it('reuses the skin of the same rig and rect and rebuilds for another rect', () => {
    const rig: Rig = { bones: [bone('b1', 0, 0, 10)] };
    const a = skinOf(rig, { x: 0, y: 0, w: 48, h: 48 });
    expect(skinOf(rig, { x: 0, y: 0, w: 48, h: 48 })).toBe(a);
    expect(skinOf(rig, { x: 0, y: 0, w: 96, h: 48 })).not.toBe(a);
  });

  it('leaves the vertices at rest under identity matrices', () => {
    const rig = arm();
    const skin = buildSkin(rig, { x: 0, y: 0, w: 48, h: 24 });
    const pts = skinPoints(skin, boneMatrices(rig, null));
    for (let v = 0; v < skin.rx.length; v++) {
      expect(pts[v * 2]).toBeCloseTo(skin.rx[v], 4);
      expect(pts[v * 2 + 1]).toBeCloseTo(skin.ry[v], 4);
    }
  });

  it('turns every vertex of a one bone skin rigidly with the bone', () => {
    const rig: Rig = { bones: [bone('b1', 0, 0, 10)] };
    const skin = buildSkin(rig, { x: 0, y: 0, w: 48, h: 24 });
    const pts = skinPoints(skin, boneMatrices(rig, { b1: 90 }));
    for (let v = 0; v < skin.rx.length; v++) {
      expect(pts[v * 2]).toBeCloseTo(-skin.ry[v], 4);
      expect(pts[v * 2 + 1]).toBeCloseTo(skin.rx[v], 4);
    }
  });

  it('writes into a buffer that is large enough and returns it', () => {
    const rig = arm();
    const skin = buildSkin(rig, { x: 0, y: 0, w: 48, h: 24 });
    const big = new Float32Array(64);
    expect(skinPoints(skin, boneMatrices(rig, null), big)).toBe(big);
    expect(skinPoints(skin, boneMatrices(rig, null), new Float32Array(2))).toHaveLength(skin.rx.length * 2);
  });

  it('emits two triangles per cell with source and destination equal at rest', () => {
    const rig: Rig = { bones: [bone('b1', 0, 0, 10)] };
    const quads = boneQuads(rig, null, { x: 0, y: 0, w: 48, h: 24 }, 48, 24, null);
    expect(quads).toHaveLength(2 * 1 * 24);
    for (let t = 0; t < quads.length; t += 12) {
      for (let k = 0; k < 6; k++) expect(quads[t + 6 + k]).toBeCloseTo(quads[t + k], 4);
    }
    near(Array.from(quads.slice(0, 6)), [0, 0, 24, 0, 0, 24]);
    near(Array.from(quads.slice(12, 18)), [24, 0, 24, 24, 0, 24]);
  });
});

describe('rig edits', () => {
  const lane = (channels: Record<string, number[]>): Content['keys'] => [{ kind: 'bones', channels }] as unknown as Content['keys'];

  it('starts a rig with the first bone and appends later ones without touching the input', () => {
    const c = content('image', 0, 10);
    const one = addBone(c, bone('b1', 0, 0, 10));
    const two = addBone(one, bone('b2', 10, 0, 10, 0, 'b1'));
    expect(c.rig).toBeUndefined();
    expect(one.rig?.bones.map((b) => b.id)).toEqual(['b1']);
    expect(two.rig?.bones.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('removes a bone together with all of its descendants', () => {
    let c = content('image', 0, 10);
    for (const b of [bone('b1', 0, 0, 5), bone('b2', 5, 0, 5, 0, 'b1'), bone('b3', 10, 0, 5, 0, 'b2'), bone('b4', 0, 9, 5)]) c = addBone(c, b);
    expect(deleteBone(c, 'b2').rig?.bones.map((b) => b.id)).toEqual(['b1', 'b4']);
  });

  it('drops the keys of removed bones and keeps the others', () => {
    let c = content('image', 0, 10);
    for (const b of [bone('b1', 0, 0, 5), bone('b2', 5, 0, 5, 0, 'b1')]) c = addBone(c, b);
    c = { ...c, keys: lane({ b1: [1], b2: [2] }) };
    const next = deleteBone(c, 'b2');
    const lanes = next.keys as unknown as { kind: string; channels: Record<string, number[]> }[];
    expect(lanes).toHaveLength(1);
    expect(Object.keys(lanes[0].channels)).toEqual(['b1']);
  });

  it('removes the rig and the bones lane with the last bone', () => {
    let c = addBone(content('image', 0, 10), bone('b1', 0, 0, 5));
    c = { ...c, rig: { ...(c.rig as Rig), mesh: 30 }, keys: lane({ b1: [1] }) };
    const next = deleteBone(c, 'b1');
    expect('rig' in next).toBe(false);
    expect(next.keys).toEqual([]);
  });

  it('returns the same content when the bone is unknown', () => {
    const c = addBone(content('image', 0, 10), bone('b1', 0, 0, 5));
    expect(deleteBone(c, 'b9')).toBe(c);
    const plain = content('image', 0, 10);
    expect(deleteBone(plain, 'b1')).toBe(plain);
  });

  it('rounds and clamps a new mesh size', () => {
    const c = addBone(content('image', 0, 10), bone('b1', 0, 0, 5));
    expect(setMesh(c, 30.4).rig?.mesh).toBe(30);
    expect(setMesh(c, -5).rig?.mesh).toBe(MESH_MIN);
    expect(setMesh(c, 1e6).rig?.mesh).toBe(MESH_MAX);
  });

  it('returns the same content when the mesh size does not change or there is no rig', () => {
    const c = setMesh(addBone(content('image', 0, 10), bone('b1', 0, 0, 5)), 30);
    expect(setMesh(c, 30.2)).toBe(c);
    const plain = content('image', 0, 10);
    expect(setMesh(plain, 30)).toBe(plain);
  });

  it('is active only with a rig that has bones and a turned bone', () => {
    const rigged = addBone(content('image', 0, 10), bone('b1', 0, 0, 5));
    const turned = { bones: { b1: 10 } } as unknown as Animated;
    const still = {} as unknown as Animated;
    expect(bonesActive(rigged, turned)).toBe(true);
    expect(bonesActive(rigged, still)).toBe(false);
    expect(bonesActive(content('image', 0, 10), turned)).toBe(false);
    expect(bonesActive({ ...rigged, rig: { bones: [] } }, turned)).toBe(false);
  });
});
