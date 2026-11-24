import { describe, expect, it } from 'vitest';
import {
  IDENT, allContents, anchorOf, apply, cameraLane, cameraMat, cameraMatrix, cameraPose, decompose, depthPose,
  findContent, hasWorldFx, invert, isIdentity, isScreen, levelFrameOf, memberMatrix, mul, ownMatrix, parentContent,
  parentProblem, parentWorld, postMatrix, topMatrix, viewMat, worldMatrix, type Mat,
} from '@src/engine/transform';
import { animate, type Animated } from '@src/engine/keys';
import { content, newMovie, track } from '@src/engine/model';
import type { Content, Key, KeyLane, Movie } from '@src/engine/types';

function movieOf(...tracks: Content[][]): Movie {
  const m = newMovie({ width: 1000, height: 500, fps: 24 });
  m.tracks = tracks.map((items, i) => track(`T${i}`, items));
  return m;
}

function anim(over: Partial<Animated> = {}): Animated {
  return { ...animate(content('solid', 0, 10), 0), ...over };
}

function moved(x: number, y: number, extra: Partial<Content> = {}): Content {
  const c = content('solid', 0, 100, extra);
  c.transform = { ...c.transform, x, y };
  return c;
}

const key = (frame: number, value: number): Key => ({ frame, value, ease: 'linear' });

function cameraKeys(channels: Record<string, Key[]>): KeyLane {
  return { kind: 'camera', expanded: false, channels, options: {} };
}

function near(m: Mat, n: Mat): void {
  for (let i = 0; i < 6; i++) expect(m[i]).toBeCloseTo(n[i], 6);
}

describe('matrix maths', () => {
  it('leaves a matrix unchanged when multiplied by the identity on either side', () => {
    const m: Mat = [2, 1, -1, 3, 5, 7];
    expect(mul(m, IDENT)).toEqual(m);
    expect(mul(IDENT, m)).toEqual(m);
  });

  it('applies the right hand matrix first', () => {
    const scale: Mat = [2, 0, 0, 2, 0, 0];
    const shift: Mat = [1, 0, 0, 1, 10, 0];
    expect(apply(mul(shift, scale), 1, 1)).toEqual([12, 2]);
    expect(apply(mul(scale, shift), 1, 1)).toEqual([22, 2]);
  });

  it('inverts a matrix so that a point comes back', () => {
    const m: Mat = [2, 1, -1, 3, 5, 7];
    const inv = invert(m);
    expect(inv).not.toBeNull();
    const [x, y] = apply(m, 4, -9);
    const back = apply(inv as Mat, x, y);
    expect(back[0]).toBeCloseTo(4, 9);
    expect(back[1]).toBeCloseTo(-9, 9);
    near(mul(m, inv as Mat), IDENT);
  });

  it('refuses to invert a flat or non finite matrix', () => {
    expect(invert([0, 0, 0, 0, 3, 4])).toBeNull();
    expect(invert([1, 2, 2, 4, 0, 0])).toBeNull();
    expect(invert([NaN, 0, 0, 1, 0, 0])).toBeNull();
  });

  it('tells the identity from a near identity', () => {
    expect(isIdentity([1, 0, 0, 1, 0, 0])).toBe(true);
    expect(isIdentity([1, 0, 0, 1, 0, 0.001])).toBe(false);
    expect(isIdentity([-1, 0, 0, 1, 0, 0])).toBe(false);
  });

  it('builds a view matrix that scales then offsets', () => {
    expect(apply(viewMat({ scale: 0.5, ox: 10, oy: 20 }), 100, 200)).toEqual([60, 120]);
  });
});

describe('a content own matrix', () => {
  const movie = movieOf();

  it('is a plain move when nothing else is set', () => {
    near(ownMatrix(anim({ x: 30, y: -40 }), movie), [1, 0, 0, 1, 30, -40]);
  });

  it('keeps the pivot in place while rotating and scaling', () => {
    const m = ownMatrix(anim({ rotation: 37, scaleX: 3, scaleY: 0.5, x: 12, y: 8 }), movie);
    const [x, y] = apply(m, 500, 250);
    expect(x).toBeCloseTo(512, 6);
    expect(y).toBeCloseTo(258, 6);
  });

  it('turns a quarter turn clockwise in screen space', () => {
    const [x, y] = apply(ownMatrix(anim({ rotation: 90 }), movie), 510, 250);
    expect(x).toBeCloseTo(500, 6);
    expect(y).toBeCloseTo(260, 6);
  });

  it('mirrors around the pivot when flipped', () => {
    const h = apply(ownMatrix(anim({ flipH: true }), movie), 510, 260);
    expect(h[0]).toBeCloseTo(490, 6);
    expect(h[1]).toBeCloseTo(260, 6);
    const v = apply(ownMatrix(anim({ flipV: true }), movie), 510, 260);
    expect(v[0]).toBeCloseTo(510, 6);
    expect(v[1]).toBeCloseTo(240, 6);
  });

  it('scales around an offset pivot', () => {
    const m = ownMatrix(anim({ px: 100, py: -50, scaleX: 2, scaleY: 2 }), movie);
    const fixed = apply(m, 600, 200);
    expect(fixed[0]).toBeCloseTo(600, 6);
    expect(fixed[1]).toBeCloseTo(200, 6);
    const other = apply(m, 610, 200);
    expect(other[0]).toBeCloseTo(620, 6);
  });

  it('reports the anchor as pivot plus move', () => {
    expect(anchorOf(anim({ x: 5, y: 6 }), movie)).toEqual([505, 256]);
    expect(anchorOf(anim({ x: 5, y: 6, px: 10, py: -10 }), movie)).toEqual([515, 246]);
  });
});

describe('decompose', () => {
  const movie = movieOf();

  it('gives back the values an own matrix was built from', () => {
    const a = anim({ x: 40, y: -25, scaleX: 1.5, scaleY: 0.75, rotation: 30, px: 20, py: 10 });
    const d = decompose(ownMatrix(a, movie), movie, 20, 10);
    expect(d.x).toBeCloseTo(40, 6);
    expect(d.y).toBeCloseTo(-25, 6);
    expect(d.scaleX).toBeCloseTo(1.5, 6);
    expect(d.scaleY).toBeCloseTo(0.75, 6);
    expect(d.rotation).toBeCloseTo(30, 6);
    expect(d.flipH).toBe(false);
  });

  it('reads a mirrored matrix as a horizontal flip that rebuilds the same matrix', () => {
    for (const a of [anim({ flipH: true, rotation: 20, scaleX: 2, x: 7 }), anim({ flipV: true, rotation: -75, scaleY: 3, y: 9 })]) {
      const m = ownMatrix(a, movie);
      const d = decompose(m, movie, 0, 0);
      expect(d.flipH).toBe(true);
      near(ownMatrix(anim({ x: d.x, y: d.y, scaleX: d.scaleX, scaleY: d.scaleY, rotation: d.rotation, flipH: d.flipH }), movie), m);
    }
  });
});

describe('the camera', () => {
  it('has no pose when the movie has no camera', () => {
    const movie = movieOf([moved(0, 0)]);
    expect(cameraLane(movie)).toBeNull();
    expect(cameraPose(movie, 0)).toBeNull();
    expect(cameraMatrix(movie, 0)).toBeNull();
    expect(hasWorldFx(movie)).toBe(false);
  });

  it('reads the keyed channels and rests the others', () => {
    const movie = movieOf();
    movie.camera = { keys: [cameraKeys({ panX: [key(0, 0), key(10, 100)], zoom: [key(0, 2)] })] };
    const p = cameraPose(movie, 5);
    expect(p).not.toBeNull();
    expect(p?.panX).toBeCloseTo(50, 6);
    expect(p?.panY).toBe(0);
    expect(p?.zoom).toBe(2);
    expect(p?.rotation).toBe(0);
    expect(hasWorldFx(movie)).toBe(true);
  });

  it('never lets the zoom reach zero or go negative', () => {
    const movie = movieOf();
    movie.camera = { keys: [cameraKeys({ zoom: [key(0, -3)] })] };
    expect(cameraPose(movie, 0)?.zoom).toBe(0.01);
  });

  it('treats a non finite key as the resting value', () => {
    const movie = movieOf();
    movie.camera = { keys: [cameraKeys({ panX: [key(0, NaN)], zoom: [key(0, Infinity)] })] };
    const p = cameraPose(movie, 0);
    expect(p?.panX).toBe(0);
    expect(p?.zoom).toBe(1);
  });

  it('brings the panned point to the frame centre', () => {
    const movie = movieOf();
    const m = cameraMat(movie, { panX: 120, panY: -30, zoom: 1, rotation: 0 });
    const [x, y] = apply(m, 620, 220);
    expect(x).toBeCloseTo(500, 6);
    expect(y).toBeCloseTo(250, 6);
  });

  it('zooms around the frame centre', () => {
    const movie = movieOf();
    const m = cameraMat(movie, { panX: 0, panY: 0, zoom: 2, rotation: 0 });
    expect(apply(m, 500, 250)).toEqual([500, 250]);
    expect(apply(m, 510, 245)).toEqual([520, 240]);
  });

  it('turns the world against the camera rotation', () => {
    const movie = movieOf();
    const [x, y] = apply(cameraMat(movie, { panX: 0, panY: 0, zoom: 1, rotation: 90 }), 510, 250);
    expect(x).toBeCloseTo(500, 6);
    expect(y).toBeCloseTo(240, 6);
  });

  it('scales pan and zoom by the parallax depth and keeps rotation', () => {
    const p = { panX: 100, panY: -40, zoom: 3, rotation: 15 };
    expect(depthPose(p, 0)).toEqual({ panX: 0, panY: -0, zoom: 1, rotation: 15 });
    expect(depthPose(p, 2)).toEqual({ panX: 200, panY: -80, zoom: 5, rotation: 15 });
    expect(depthPose({ ...p, zoom: 0.01 }, 5).zoom).toBe(0.01);
  });
});

describe('parent chains and world matrices', () => {
  it('uses only the own matrix for content the movie does not hold', () => {
    const movie = movieOf();
    const stray = moved(11, 22);
    near(worldMatrix(movie, stray, 0), [1, 0, 0, 1, 11, 22]);
    expect(parentWorld(movie, stray, 0)).toEqual(IDENT);
    expect(postMatrix(movie, stray, 0, false, 0)).toBeNull();
  });

  it('adds the parent move to the child', () => {
    const parent = moved(100, 50);
    const child = moved(10, 5, { parent: parent.id });
    const movie = movieOf([parent], [child]);
    expect(hasWorldFx(movie)).toBe(true);
    expect(parentContent(movie, child)).toBe(parent);
    near(worldMatrix(movie, child, 0), [1, 0, 0, 1, 110, 55]);
    near(parentWorld(movie, child, 0), [1, 0, 0, 1, 100, 50]);
    near(postMatrix(movie, child, 0, false, 0) as Mat, [1, 0, 0, 1, 100, 50]);
  });

  it('composes the parent matrix on the left of the child own matrix', () => {
    const parent = moved(0, 0);
    parent.transform = { ...parent.transform, scale: 2, rotation: 90 };
    const child = moved(10, 0, { parent: parent.id });
    const movie = movieOf([parent, child]);
    const expected = mul(ownMatrix(animate(parent, 0), movie), ownMatrix(animate(child, 0), movie));
    near(worldMatrix(movie, child, 0), expected);
    const [x, y] = apply(worldMatrix(movie, child, 0), 500, 250);
    expect(x).toBeCloseTo(500, 6);
    expect(y).toBeCloseTo(270, 6);
  });

  it('ignores a parent that is missing or is the content itself', () => {
    const lost = moved(3, 4, { parent: 'nowhere' });
    const own = moved(5, 6);
    own.parent = own.id;
    const movie = movieOf([lost, own]);
    expect(parentContent(movie, lost)).toBeNull();
    expect(parentContent(movie, own)).toBeNull();
    near(worldMatrix(movie, lost, 0), [1, 0, 0, 1, 3, 4]);
    near(worldMatrix(movie, own, 0), [1, 0, 0, 1, 5, 6]);
  });

  it('survives a loop of parents with finite numbers', () => {
    const a = moved(1, 0);
    const b = moved(0, 1, { parent: a.id });
    a.parent = b.id;
    const movie = movieOf([a, b]);
    const m = worldMatrix(movie, a, 0);
    expect(m.every((n) => Number.isFinite(n))).toBe(true);
    expect(parentProblem(movie, a.id, b.id)).not.toBeNull();
  });

  it('applies the camera unless the track is fixed to the screen', () => {
    const free = moved(0, 0);
    const pinned = moved(0, 0);
    const movie = movieOf([free], [pinned]);
    movie.tracks[1].screen = true;
    movie.camera = { keys: [cameraKeys({ panX: [key(0, 100)] })] };
    near(worldMatrix(movie, free, 0), [1, 0, 0, 1, -100, 0]);
    near(worldMatrix(movie, pinned, 0), IDENT);
    expect(isScreen(movie, free)).toBe(false);
    expect(isScreen(movie, pinned)).toBe(true);
    expect(postMatrix(movie, pinned, 0, false, 0)).toBeNull();
    near(postMatrix(movie, free, 0, false, 0) as Mat, [1, 0, 0, 1, -100, 0]);
  });

  it('moves a parallax track by its depth times the camera pan', () => {
    const still = moved(0, 0);
    const far = moved(0, 0);
    const movie = movieOf([still], [far]);
    movie.tracks[0].depth = 0;
    movie.tracks[1].depth = 2;
    movie.camera = { keys: [cameraKeys({ panX: [key(0, 100)] })] };
    near(worldMatrix(movie, still, 0), IDENT);
    near(worldMatrix(movie, far, 0), [1, 0, 0, 1, -200, 0]);
  });

  it('carries a group move down to its members and counts their frames from the group start', () => {
    const member = moved(10, 0);
    const group = content('group', 20, 50, { tracks: [track('inner', [member])] });
    group.transform = { ...group.transform, x: 200, y: 100 };
    const movie = movieOf([group]);
    movie.camera = { keys: [cameraKeys({ panY: [key(0, 0)] })] };
    near(worldMatrix(movie, member, 25), [1, 0, 0, 1, 210, 100]);
    expect(levelFrameOf(movie, member, 25)).toBe(5);
    expect(levelFrameOf(movie, group, 25)).toBe(25);
    expect(findContent(movie, member.id)).toBe(member);
    expect(findContent(movie, 'nope')).toBeNull();
    expect(allContents(movie)).toEqual([{ c: group, depth: 0 }, { c: member, depth: 1 }]);
  });

  it('skips the lookups for plain content at the top of a view', () => {
    const c = moved(10, 20);
    const movie = movieOf([c]);
    const view = { scale: 2, ox: 5, oy: 7 };
    near(topMatrix(movie, c, 0, animate(c, 0), view), [2, 0, 0, 2, 25, 47]);
    near(memberMatrix(movie, c, 0, animate(c, 0)), [1, 0, 0, 1, 10, 20]);
    expect(postMatrix(movie, c, 0, false, 0)).toBeNull();
  });

  it('puts the view after the parent chain at the top of a view', () => {
    const parent = moved(100, 0);
    const child = moved(10, 0, { parent: parent.id });
    const movie = movieOf([parent, child]);
    near(topMatrix(movie, child, 0, animate(child, 0), { scale: 2, ox: 0, oy: 0 }), [2, 0, 0, 2, 220, 0]);
  });

  it('follows same group parents for a member drawn inside its group', () => {
    const lead = moved(30, 0);
    const follower = moved(4, 0, { parent: lead.id });
    const group = content('group', 0, 50, { tracks: [track('inner', [lead, follower])] });
    group.transform = { ...group.transform, x: 500 };
    const movie = movieOf([group]);
    near(memberMatrix(movie, follower, 0, animate(follower, 0)), [1, 0, 0, 1, 34, 0]);
    near(postMatrix(movie, follower, 0, true, 0) as Mat, [1, 0, 0, 1, 30, 0]);
    expect(postMatrix(movie, lead, 0, true, 0)).toBeNull();
  });
});

describe('parent problems', () => {
  function scene(): { movie: Movie; top: Content; other: Content; group: Content; inA: Content; inB: Content } {
    const inA = moved(0, 0);
    const inB = moved(0, 0);
    const group = content('group', 0, 50, { tracks: [track('inner', [inA, inB])] });
    const top = moved(0, 0);
    const other = moved(0, 0);
    return { movie: movieOf([group], [top, other]), top, other, group, inA, inB };
  }

  it('allows a top level content to follow another and members of one group to follow each other', () => {
    const s = scene();
    expect(parentProblem(s.movie, s.top.id, s.other.id)).toBeNull();
    expect(parentProblem(s.movie, s.inA.id, s.inB.id)).toBeNull();
    expect(parentProblem(s.movie, s.top.id, s.inA.id)).toBeNull();
  });

  it('refuses a missing content, itself, its own inside, its own group and another level', () => {
    const s = scene();
    const problems = [
      parentProblem(s.movie, s.top.id, 'gone'),
      parentProblem(s.movie, s.top.id, s.top.id),
      parentProblem(s.movie, s.group.id, s.inA.id),
      parentProblem(s.movie, s.inA.id, s.group.id),
      parentProblem(s.movie, s.inA.id, s.top.id),
    ];
    for (const p of problems) expect(typeof p).toBe('string');
    expect(new Set(problems).size).toBe(problems.length);
  });

  it('refuses a link that would close a loop', () => {
    const a = moved(0, 0);
    const b = moved(0, 0, { parent: a.id });
    const c = moved(0, 0, { parent: b.id });
    const movie = movieOf([a, b, c]);
    expect(parentProblem(movie, a.id, c.id)).not.toBeNull();
    expect(parentProblem(movie, c.id, a.id)).toBeNull();
  });

  it('does not treat a member as the parent of the group that holds it', () => {
    const s = scene();
    s.group.parent = s.inA.id;
    const fresh = movieOf([s.group]);
    expect(parentContent(fresh, s.group)).toBeNull();
  });

  it('does not let a member follow content outside its group', () => {
    const s = scene();
    s.inA.parent = s.top.id;
    const fresh = movieOf([s.group], [s.top]);
    expect(parentContent(fresh, s.inA)).toBeNull();
  });
});
