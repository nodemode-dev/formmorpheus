import type { CastPrim, CastRig, CastSpec } from './spec';
import type { Metrics } from './metrics';
import { D, E, n, P, R, shade } from './prims';
import { headBuild, monsterFangs } from './head';

const INSIDE = '#5a1f24', TONGUE = '#e2707a', TEETH = '#ffffff';

/** The eight mouth shapes in VISEMES order (rest, MBP, AI, E, O, U, FV, L), in the mouth bone's space. */
export function visemes(spec: CastSpec, rig: CastRig): CastPrim[][] {
  const M = rig.M as Metrics, u = M.u, sk = spec.skin, hd = headBuild(spec, M);
  const rest = hd.mouth, ai = [...hd.mouth, ...hd.mouthO];
  if (spec.species === 'robot') {
    const g = spec.face.eyeColor, sw = n(3.2 * u);
    return [rest,
      [P(D`M${-11 * u} ${1 * u}L${11 * u} ${1 * u}`, null, { stroke: g, sw })],
      ai,
      [R(-11 * u, -1 * u, 22 * u, 5 * u, 2.5 * u, g)],
      [R(-6 * u, -4 * u, 12 * u, 11 * u, 5 * u, g)],
      [R(-4 * u, -2 * u, 8 * u, 7 * u, 3.5 * u, g)],
      [R(-9 * u, 0, 18 * u, 3.5 * u, 1.75 * u, g)],
      [R(-8 * u, -2.5 * u, 16 * u, 8 * u, 3 * u, g), R(-4 * u, -1.5 * u, 8 * u, 2.5 * u, 1.25 * u, '#18222e', { op: .6 })]];
  }
  if (spec.species === 'alien') {
    const ln = shade(sk, -.5), dk = shade(sk, -.6), sw = n(2.6 * u);
    return [rest,
      [P(D`M${-5 * u} 0Q0 ${1.5 * u} ${5 * u} 0`, null, { stroke: ln, sw })],
      ai,
      [E(0, 1 * u, 6 * u, 2.4 * u, dk)],
      [E(0, 1 * u, 3.6 * u, 4.8 * u, dk)],
      [E(0, 1 * u, 2.4 * u, 2.8 * u, dk)],
      [E(0, .5 * u, 5 * u, 1.8 * u, dk), P(D`M${-4.5 * u} ${1.8 * u}Q0 ${3.6 * u} ${4.5 * u} ${1.8 * u}`, null, { stroke: ln, sw })],
      [E(0, 1 * u, 4 * u, 3.6 * u, dk), E(0, -.2 * u, 2.2 * u, 1.2 * u, shade(sk, -.3))]];
  }
  if (spec.species === 'monster') {
    const ln = shade(sk, -.55), dk = shade(sk, -.65), sw = n(3.4 * u), fangs = monsterFangs(u);
    return [rest,
      [P(D`M${-15 * u} ${1 * u}Q0 ${4 * u} ${15 * u} ${1 * u}`, null, { stroke: ln, sw }), ...fangs],
      ai,
      [E(0, 2 * u, 13 * u, 4.5 * u, dk), ...fangs],
      [E(0, 3 * u, 6.5 * u, 8 * u, dk)],
      [E(0, 2.5 * u, 4.5 * u, 5 * u, dk)],
      [E(0, 2 * u, 11 * u, 3.5 * u, dk), P(D`M${-12 * u} ${4 * u}Q0 ${8 * u} ${12 * u} ${4 * u}`, null, { stroke: ln, sw }), ...fangs],
      [E(0, 3 * u, 9 * u, 6.5 * u, dk), E(0, 1 * u, 5 * u, 2.4 * u, TONGUE), ...fangs]];
  }
  const lip = spec.face.lip, sw = n(3 * u);
  return [rest,
    [P(D`M${-8 * u} 0Q0 ${3 * u} ${8 * u} 0`, null, { stroke: lip, sw })],
    ai,
    [E(0, 1.5 * u, 8.5 * u, 3.4 * u, INSIDE), E(0, 3.4 * u, 4.4 * u, 1.4 * u, TONGUE)],
    [E(0, 2.5 * u, 4.8 * u, 6 * u, INSIDE, { stroke: lip, sw }), E(0, 5.4 * u, 2.8 * u, 1.6 * u, TONGUE)],
    [E(0, 2 * u, 3.2 * u, 3.6 * u, INSIDE, { stroke: lip, sw })],
    [E(0, 1.2 * u, 7 * u, 2.6 * u, INSIDE), R(-5 * u, -1 * u, 10 * u, 2.6 * u, 1.2 * u, TEETH), P(D`M${-7.5 * u} ${3 * u}Q0 ${6 * u} ${7.5 * u} ${3 * u}`, null, { stroke: lip, sw })],
    [E(0, 2 * u, 6.2 * u, 5 * u, INSIDE), E(0, .8 * u, 3.6 * u, 1.8 * u, TONGUE)]];
}
