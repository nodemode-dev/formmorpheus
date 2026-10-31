// Adjustment mix: out = out * (1 - w) + filtered * w, in two blended passes (uPass 0 darkens the backdrop by w,
// uPass 1 adds the filtered colour times w). w is the weight picture's alpha (opacity and mask already folded in
// on the CPU, engine/shape-adjust.ts) or the plain uOp.
import { HEAD } from './shaders';

export const FS_ADJUST = `${HEAD}
uniform sampler2D uF;
uniform sampler2D uW;
uniform int uHasW;
uniform float uOp;
uniform int uPass;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float w = uHasW == 1 ? texelFetch(uW, p, 0).a : uOp;
  if (uPass == 0) o = vec4(0.0, 0.0, 0.0, w);
  else o = texelFetch(uF, p, 0) * w;
}`;
