// GLSL twins of fx2-cpu.ts, written as registry shader steps: declarations, then `vec4 fx(ivec2 p)`.
// Surfaces are premultiplied; `uSrc` is the effect input. Integers travel as floats (uniforms are numbers).

const BILINEAR = `
vec4 bil(vec2 p) {
  ivec2 sz = textureSize(uSrc, 0);
  vec2 f = p - 0.5;
  vec2 f0 = floor(f);
  vec2 w = f - f0;
  ivec2 i0 = ivec2(f0);
  vec4 s = vec4(0.0);
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 q = i0 + ivec2(i, j);
      if (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) continue;
      s += texelFetch(uSrc, q, 0) * ((i == 1 ? w.x : 1.0 - w.x) * (j == 1 ? w.y : 1.0 - w.y));
    }
  }
  return s;
}`;

export const GLSL_DIRBLUR = `
uniform vec2 uVec;
uniform float uTaps;
uniform float uShift;
${BILINEAR}
vec4 fx(ivec2 p) {
  vec4 s = vec4(0.0);
  vec2 c = vec2(p) + 0.5;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uTaps) break;
    float t = (float(i) + 0.5) / uTaps - 0.5 + uShift;
    s += bil(c + uVec * t);
  }
  return s / uTaps;
}`;

export const GLSL_RADBLUR = `
uniform vec2 uC;
uniform float uAmount;
uniform float uZoom;
uniform float uTaps;
${BILINEAR}
vec4 fx(ivec2 p) {
  vec4 s = vec4(0.0);
  vec2 v = vec2(p) + 0.5 - uC;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uTaps) break;
    float t = (float(i) + 0.5) / uTaps - 0.5;
    vec2 q;
    if (uZoom > 0.5) q = uC + v * (1.0 + uAmount * t);
    else { float a = uAmount * t; float c = cos(a), sn = sin(a); q = uC + vec2(v.x * c - v.y * sn, v.x * sn + v.y * c); }
    s += bil(q);
  }
  return s / uTaps;
}`;

export const GLSL_CHROMA = `
uniform vec3 uKey;
uniform float uThr;
uniform float uSoft;
uniform float uSpill;
uniform float uChoke;
uniform float uView;
float cbf(vec3 c) { return -0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b; }
float crf(vec3 c) { return 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b; }
vec3 straight(vec4 p) { return p.a > 0.0 ? p.rgb / p.a : vec3(0.0); }
float matteAt(ivec2 q) {
  vec3 c = straight(texelFetch(uSrc, q, 0));
  float d = length(vec2(cbf(c) - cbf(uKey), crf(c) - crf(uKey)));
  return smoothstep(uThr, uThr + uSoft, d);
}
vec4 fx(ivec2 p) {
  ivec2 sz = textureSize(uSrc, 0);
  float rf = abs(uChoke);
  bool grow = uChoke < 0.0;
  float m = grow ? 0.0 : 1.0;
  for (int j = -8; j <= 8; j++) {
    if (abs(float(j)) > rf) continue;
    for (int i = -8; i <= 8; i++) {
      if (abs(float(i)) > rf) continue;
      float v = matteAt(clamp(p + ivec2(i, j), ivec2(0), sz - 1));
      m = grow ? max(m, v) : min(m, v);
    }
  }
  vec4 px = texelFetch(uSrc, p, 0);
  if (uView > 0.5) return vec4(vec3(m * px.a), 1.0);
  vec3 c = straight(px);
  if (uSpill > 0.0) {
    float kcb = cbf(uKey), kcr = crf(uKey);
    float kl = length(vec2(kcb, kcr)); if (kl == 0.0) kl = 1.0;
    vec2 ku = vec2(kcb, kcr) / kl;
    float y = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    float u = cbf(c), v = crf(c);
    float dt = u * ku.x + v * ku.y;
    if (dt > 0.0) {
      float s = dt * (uSpill + (1.0 - uSpill) * (1.0 - m));
      float u2 = u - ku.x * s, v2 = v - ku.y * s;
      c = clamp(vec3(y + 1.402 * v2, y - 0.344136 * u2 - 0.714136 * v2, y + 1.772 * u2), 0.0, 1.0);
    }
  }
  float a = px.a * m;
  return vec4(c * a, a);
}`;

export const GLSL_LUMA = `
uniform float uThr;
uniform float uSoft;
uniform float uInvert;
vec4 fx(ivec2 p) {
  vec4 px = texelFetch(uSrc, p, 0);
  vec3 c = px.a > 0.0 ? px.rgb / px.a : vec3(0.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float m = smoothstep(uThr - uSoft * 0.5, uThr + uSoft * 0.5, l);
  if (uInvert > 0.5) m = 1.0 - m;
  return px * m;
}`;
