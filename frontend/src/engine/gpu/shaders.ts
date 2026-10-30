// GLSL ES 3.00 sources for the WebGL2 compositor. All surfaces hold premultiplied colour; row 0 is the top.

export const HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';

/** Quad over a pixel box of the target (uBox: x0 y0 x1 y1), y down; gl_FragCoord.y is the row + 0.5. */
export const VS_BOX = `${HEAD}
uniform vec4 uBox;
uniform vec2 uSize;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 p = mix(uBox.xy, uBox.zw, c);
  gl_Position = vec4(p / uSize * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Box vertex shader that also hands the fragment its position in the quad's local space (affine, so exact). */
export const VS_SRC = `${HEAD}
uniform vec4 uBox;
uniform vec2 uSize;
uniform vec4 uInv;      // inverse matrix a b c d
uniform vec2 uInvE;     // inverse e f
out vec2 vLocal;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 p = mix(uBox.xy, uBox.zw, c);
  vLocal = vec2(uInv.x * p.x + uInv.z * p.y + uInvE.x, uInv.y * p.x + uInv.w * p.y + uInvE.y);
  gl_Position = vec4(p / uSize * 2.0 - 1.0, 0.0, 1.0);
}`;

const SRC_SAMPLE = `
in vec2 vLocal;
uniform sampler2D uTex;
uniform vec4 uRect;     // local rect x y w h
uniform vec2 uEdge;     // local distance to screen pixels along x and y
uniform float uAlpha;
vec4 srcColor() {
  vec2 d0 = vLocal - uRect.xy;
  vec2 d1 = uRect.xy + uRect.zw - vLocal;
  vec2 d = min(d0, d1) * uEdge;
  float cov = clamp(min(d.x, d.y) + 0.5, 0.0, 1.0);
  return texture(uTex, d0 / uRect.zw) * (cov * uAlpha);
}`;

/** Normal and add blends use the fixed-function blender. */
export const FS_SRC_PLAIN = `${HEAD}
${SRC_SAMPLE}
out vec4 o;
void main() { o = srcColor(); }`;

export const FS_SRC_BLEND = `${HEAD}
${SRC_SAMPLE}
uniform sampler2D uBack;
uniform int uMode;
out vec4 o;

float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c) {
  float l = lum(c), n = min(min(c.r, c.g), c.b), x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }
float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 setSat(vec3 c, float s) {
  float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
  if (mx <= mn) return vec3(0.0);
  return (c - mn) * s / (mx - mn);
}
float dodge(float b, float s) { if (b <= 0.0) return 0.0; if (s >= 1.0) return 1.0; return min(1.0, b / (1.0 - s)); }
float burn(float b, float s) { if (b >= 1.0) return 1.0; if (s <= 0.0) return 0.0; return 1.0 - min(1.0, (1.0 - b) / s); }
float hard(float b, float s) { return s <= 0.5 ? b * 2.0 * s : b + (2.0 * s - 1.0) - b * (2.0 * s - 1.0); }
float soft(float b, float s) {
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}
vec3 blendFn(vec3 b, vec3 s) {
  switch (uMode) {
    case 1: return b * s;
    case 2: return b + s - b * s;
    case 3: return vec3(hard(s.r, b.r), hard(s.g, b.g), hard(s.b, b.b));
    case 4: return min(b, s);
    case 5: return max(b, s);
    case 6: return vec3(dodge(b.r, s.r), dodge(b.g, s.g), dodge(b.b, s.b));
    case 7: return vec3(burn(b.r, s.r), burn(b.g, s.g), burn(b.b, s.b));
    case 8: return vec3(hard(b.r, s.r), hard(b.g, s.g), hard(b.b, s.b));
    case 9: return vec3(soft(b.r, s.r), soft(b.g, s.g), soft(b.b, s.b));
    case 10: return abs(b - s);
    case 11: return b + s - 2.0 * b * s;
    case 12: return setLum(setSat(s, sat(b)), lum(b));
    case 13: return setLum(setSat(b, sat(s)), lum(b));
    case 14: return setLum(s, lum(b));
    case 15: return setLum(b, lum(s));
    case 17: return clamp(b + s - 1.0, 0.0, 1.0);
    case 18: return lum(s) < lum(b) ? s : b;
    case 19: return lum(s) < lum(b) ? b : s;
    case 20: return vec3(s.r <= 0.5 ? burn(b.r, 2.0 * s.r) : dodge(b.r, 2.0 * (s.r - 0.5)), s.g <= 0.5 ? burn(b.g, 2.0 * s.g) : dodge(b.g, 2.0 * (s.g - 0.5)), s.b <= 0.5 ? burn(b.b, 2.0 * s.b) : dodge(b.b, 2.0 * (s.b - 0.5)));
    case 21: return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);
    case 22: return vec3(s.r <= 0.5 ? min(b.r, 2.0 * s.r) : max(b.r, 2.0 * s.r - 1.0), s.g <= 0.5 ? min(b.g, 2.0 * s.g) : max(b.g, 2.0 * s.g - 1.0), s.b <= 0.5 ? min(b.b, 2.0 * s.b) : max(b.b, 2.0 * s.b - 1.0));
    case 23: return vec3(b.r + s.r >= 1.0 ? 1.0 : 0.0, b.g + s.g >= 1.0 ? 1.0 : 0.0, b.b + s.b >= 1.0 ? 1.0 : 0.0);
    case 24: return clamp(b - s, 0.0, 1.0);
    case 25: return vec3(s.r <= 0.0 ? (b.r <= 0.0 ? 0.0 : 1.0) : min(1.0, b.r / s.r), s.g <= 0.0 ? (b.g <= 0.0 ? 0.0 : 1.0) : min(1.0, b.g / s.g), s.b <= 0.0 ? (b.b <= 0.0 ? 0.0 : 1.0) : min(1.0, b.b / s.b));
  }
  return s;
}
void main() {
  vec4 sp = srcColor();
  vec4 bp = texelFetch(uBack, ivec2(gl_FragCoord.xy), 0);
  float sa = sp.a, ab = bp.a;
  if (sa <= 0.0) { o = bp; return; }
  vec3 cs = sp.rgb / sa;
  vec3 cb = ab > 0.0 ? bp.rgb / ab : vec3(0.0);
  vec3 co = (1.0 - ab) * sp.rgb + (1.0 - sa) * bp.rgb + sa * ab * clamp(blendFn(cb, cs), 0.0, 1.0);
  o = vec4(co, sa + ab - sa * ab);
}`;

/** Scales the target by a mask value read from another surface (blend ZERO, SRC_COLOR). */
export const FS_MASK = `${HEAD}
uniform sampler2D uMask;
uniform int uKind;      // 0 alpha, 1 luminance
uniform int uInvert;
out vec4 o;
void main() {
  vec4 m = texelFetch(uMask, ivec2(gl_FragCoord.xy), 0);
  float v = uKind == 1 ? dot(m.rgb, vec3(0.299, 0.587, 0.114)) : m.a;
  if (uInvert == 1) v = 1.0 - v;
  o = vec4(clamp(v, 0.0, 1.0));
}`;

/** Copies a surface to the default framebuffer, flipped to the canvas's bottom-up rows. */
export const FS_PRESENT = `${HEAD}
uniform sampler2D uTex;
uniform float uH;
out vec4 o;
void main() { o = texelFetch(uTex, ivec2(int(gl_FragCoord.x), int(uH) - 1 - int(gl_FragCoord.y)), 0); }`;

/** Plain copy of a surface (same size). */
export const FS_COPY = `${HEAD}
uniform sampler2D uTex;
out vec4 o;
void main() { o = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0); }`;

// ---------------------------------------------------------------- filters (full-target quads)

export const FS_HSB = `${HEAD}
uniform sampler2D uTex;
uniform mat3 uM;
uniform float uOff;
out vec4 o;
void main() {
  vec4 s = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0);
  if (s.a <= 0.0) { o = vec4(0.0); return; }
  vec3 c = uM * (s.rgb / s.a) + uOff;
  o = vec4(clamp(c, 0.0, 1.0) * s.a, s.a);
}`;

export const FS_GAUSS = `${HEAD}
uniform sampler2D uTex;
uniform ivec2 uDir;
uniform int uR;
uniform float uSigma;
uniform float uNorm;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 sz = textureSize(uTex, 0);
  vec4 sum = vec4(0.0);
  float k = -0.5 / (uSigma * uSigma);
  for (int i = -uR; i <= uR; i++) {
    ivec2 q = p + uDir * i;
    if (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) continue;
    sum += texelFetch(uTex, q, 0) * exp(float(i * i) * k);
  }
  o = sum * uNorm;
}`;

/** Box average of f x f source pixels per output pixel (zero beyond the edge), the CPU's downPremult. */
export const FS_DOWN = `${HEAD}
uniform sampler2D uTex;
uniform int uF;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * uF;
  ivec2 sz = textureSize(uTex, 0);
  vec4 sum = vec4(0.0);
  for (int j = 0; j < uF; j++) for (int i = 0; i < uF; i++) {
    ivec2 q = p + ivec2(i, j);
    if (q.x < sz.x && q.y < sz.y) sum += texelFetch(uTex, q, 0);
  }
  o = sum / float(uF * uF);
}`;

/** Bilinear enlargement with centres aligned; uFinish 1 turns the premult value into clamped straight colour. */
export const FS_UP = `${HEAD}
uniform sampler2D uTex;
uniform vec2 uInvSize;   // 1 / (f * small size)
uniform int uFinish;
out vec4 o;
void main() {
  vec4 s = texture(uTex, gl_FragCoord.xy * uInvSize);
  if (uFinish == 1) {
    if (s.a < 0.5 / 255.0) { o = vec4(0.0); return; }
    float a = clamp(s.a, 0.0, 1.0);
    o = vec4(clamp(s.rgb / s.a, 0.0, 1.0) * a, a);
    return;
  }
  o = s;
}`;

export const FS_SHARPEN = `${HEAD}
uniform sampler2D uTex;
uniform sampler2D uBlur;
uniform float uK;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uTex, p, 0);
  if (s.a <= 0.0) { o = vec4(0.0); return; }
  vec4 b = texelFetch(uBlur, p, 0);
  vec3 sc = s.rgb / s.a;
  vec3 bc = b.a > 0.5 / 255.0 ? clamp(b.rgb / b.a, 0.0, 1.0) : vec3(0.0);
  o = vec4(clamp(sc + (sc - bc) * uK, 0.0, 1.0) * s.a, s.a);
}`;

/** Highlight boost before the lens blur: premult colour scaled by 1 + boost * lum^pw (not clamped; float target). */
export const FS_BOOST = `${HEAD}
uniform sampler2D uTex;
uniform float uBoost;
uniform float uPow;
out vec4 o;
void main() {
  vec4 s = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0);
  if (s.a <= 0.0) { o = vec4(0.0); return; }
  vec3 c = s.rgb / s.a;
  float l = floor(dot(c, vec3(0.2126, 0.7152, 0.0722)) * 255.0) / 255.0;
  float k = 1.0 + uBoost * pow(l, uPow);
  o = vec4(s.rgb * k, s.a);
}`;

/** Zero-padded box of half-length uR along an integer direction. */
export const FS_BOX = `${HEAD}
uniform sampler2D uTex;
uniform ivec2 uDir;
uniform int uR;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 sz = textureSize(uTex, 0);
  vec4 sum = vec4(0.0);
  for (int i = -uR; i <= uR; i++) {
    ivec2 q = p + uDir * i;
    if (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) continue;
    sum += texelFetch(uTex, q, 0);
  }
  o = sum / float(2 * uR + 1);
}`;

// ---------------------------------------------------------------- noise (same maths as paint/filters.ts)

const NOISE_COMMON = `
uniform sampler2D uPerm;
const float GX[16] = float[16](1.,-1.,1.,-1.,1.,-1.,1.,-1.,0.,0.,0.,0.,1.,-1.,0.,0.);
const float GY[16] = float[16](1.,1.,-1.,-1.,0.,0.,0.,0.,1.,-1.,1.,-1.,1.,-1.,1.,-1.);
const float GZ[16] = float[16](0.,0.,0.,0.,1.,1.,-1.,-1.,1.,1.,-1.,-1.,0.,0.,-1.,1.);
int P(int i) { return int(texelFetch(uPerm, ivec2(i, 0), 0).r * 255.0 + 0.5); }
float grad(int h, float x, float y, float z) { int k = h & 15; return GX[k] * x + GY[k] * y + GZ[k] * z; }
float fade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float noise3(float x, float y, float z) {
  float fx = floor(x), fy = floor(y), fz = floor(z);
  int X = int(fx) & 255, Y = int(fy) & 255, Z = int(fz) & 255;
  x -= fx; y -= fy; z -= fz;
  float u = fade(x), v = fade(y), w = fade(z);
  int A = P(X) + Y, AA = P(A) + Z, AB = P(A + 1) + Z;
  int B = P(X + 1) + Y, BA = P(B) + Z, BB = P(B + 1) + Z;
  float x1 = x - 1.0, y1 = y - 1.0, z1 = z - 1.0;
  float l0 = grad(P(AA), x, y, z), l1 = grad(P(BA), x1, y, z);
  float l2 = grad(P(AB), x, y1, z), l3 = grad(P(BB), x1, y1, z);
  float l4 = grad(P(AA + 1), x, y, z1), l5 = grad(P(BA + 1), x1, y, z1);
  float l6 = grad(P(AB + 1), x, y1, z1), l7 = grad(P(BB + 1), x1, y1, z1);
  float a0 = l0 + u * (l1 - l0), a1 = l2 + u * (l3 - l2);
  float b0 = l4 + u * (l5 - l4), b1 = l6 + u * (l7 - l6);
  float c0 = a0 + v * (a1 - a0), c1 = b0 + v * (b1 - b0);
  return c0 + w * (c1 - c0);
}`;

/** One texel per grid point of the coarse field; channel c of the texel is the field of colour channel c. */
export const FS_NOISE_GRID = `${HEAD}
${NOISE_COMMON}
uniform float uInvScale;
uniform float uWarp;
uniform float uZ;
uniform vec2 uOffset;
uniform int uG;
uniform int uOct;
uniform int uStyle;
uniform float uNorm;
uniform int uChans;
out vec4 o;
float fbm(float x, float y, float z) {
  float sum = 0.0, amp = 1.0, fr = 1.0;
  for (int k = 0; k < 8; k++) {
    if (k >= uOct) break;
    float fk = float(k);
    float n = clamp(noise3(x * fr + fk * 31.7, y * fr + fk * 17.3, z * fr + fk * 7.9) * 1.6, -1.0, 1.0);
    if (uStyle == 0) sum += amp * n;
    else if (uStyle == 1) sum += amp * abs(n);
    else { float r = 1.0 - abs(n); sum += amp * r * r; }
    amp *= 0.5; fr *= 2.0;
  }
  sum *= uNorm;
  if (uStyle == 0) sum = sum * 0.5 + 0.5;
  return clamp(sum, 0.0, 1.0);
}
void main() {
  vec2 g = floor(gl_FragCoord.xy) * float(uG);
  vec4 r = vec4(0.0, 0.0, 0.0, 1.0);
  for (int c = 0; c < 3; c++) {
    if (c >= uChans) break;
    float fc = float(c);
    float cz = uZ + fc * 11.31;
    float cy = (g.y + uOffset.y) * uInvScale + fc * 29.1;
    float cx = (g.x + uOffset.x) * uInvScale + fc * 53.7;
    float px = cx, py = cy;
    if (uWarp > 0.0) {
      px += uWarp * noise3(cx * 0.5 + 100.0, cy * 0.5, cz);
      py += uWarp * noise3(cx * 0.5, cy * 0.5 + 100.0, cz);
    }
    r[c] = fbm(px, py, cz);
  }
  if (uChans == 1) r = vec4(r.r, r.r, r.r, 1.0);
  o = r;
}`;

export const FS_NOISE_APPLY = `${HEAD}
uniform sampler2D uTex;
uniform sampler2D uGrid;
uniform int uG;
uniform float uAmount;
uniform int uAdd;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uTex, p, 0);
  if (s.a <= 0.0) { o = vec4(0.0); return; }
  ivec2 gi = p / uG;
  vec2 f = vec2(p - gi * uG) / float(uG);
  ivec2 gs = textureSize(uGrid, 0) - 1;
  ivec2 g1 = min(gi + 1, gs);
  vec3 t00 = texelFetch(uGrid, gi, 0).rgb, t10 = texelFetch(uGrid, ivec2(g1.x, gi.y), 0).rgb;
  vec3 t01 = texelFetch(uGrid, ivec2(gi.x, g1.y), 0).rgb, t11 = texelFetch(uGrid, g1, 0).rgb;
  vec3 n = mix(mix(t00, t10, f.x), mix(t01, t11, f.x), f.y);
  vec3 c = s.rgb / s.a;
  vec3 r = uAdd == 1 ? c + (n - 0.5) * 2.0 * uAmount : c + (n - c) * uAmount;
  o = vec4(clamp(r, 0.0, 1.0) * s.a, s.a);
}`;

// ---------------------------------------------------------------- boil (same maths as paint/boil.ts)

export const FS_BOIL = `${HEAD}
uniform sampler2D uTex;
uniform float uAmount;
uniform float uSpacing;
uniform int uSeed;
out vec4 o;
float hv(int ix, int iy, int ch) {
  uint h = (uint(ix) * 0x27d4eb2du) ^ (uint(iy) * 0x165667b1u) ^ (uint(uSeed * 2 + ch + 1) * 0x9e3779b1u);
  h ^= h >> 15; h *= 0x85ebca6bu; h ^= h >> 13; h *= 0xc2b2ae35u; h ^= h >> 16;
  return float(h >> 8) / 16777216.0;
}
vec2 lat(int i, int j) { return (vec2(hv(i, j, 0), hv(i, j, 1)) * 2.0 - 1.0) * uAmount; }
vec4 fetch(ivec2 q, ivec2 sz) {
  if (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) return vec4(0.0);
  return texelFetch(uTex, q, 0);
}
void main() {
  vec2 p = floor(gl_FragCoord.xy);
  vec2 u = p / uSpacing;
  vec2 iu = floor(u);
  vec2 f = u - iu;
  f = f * f * (3.0 - 2.0 * f);
  int i = int(iu.x), j = int(iu.y);
  vec2 d = mix(mix(lat(i, j), lat(i + 1, j), f.x), mix(lat(i, j + 1), lat(i + 1, j + 1), f.x), f.y);
  vec2 s = p + d;
  vec2 is = floor(s);
  vec2 fr = s - is;
  ivec2 q = ivec2(is);
  ivec2 sz = textureSize(uTex, 0);
  o = mix(mix(fetch(q, sz), fetch(q + ivec2(1, 0), sz), fr.x), mix(fetch(q + ivec2(0, 1), sz), fetch(q + ivec2(1, 1), sz), fr.x), fr.y);
}`;
