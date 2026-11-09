// Burger patties and sausages: hand-formed geometry and a material that goes from raw to seared
// to burnt. Doneness is tracked per face (patty) or per quarter-turn (sausage); grill marks are
// analytic — each remembers where the bars were when it lay on them, so they stay crisp up close.
import * as THREE from 'three';
import { rng } from './noise.js';
import { GRILL } from './grill.js';
import { addCoalGlow, fireUniforms } from './glsl.js';

export const PATTY = { r: 0.052, h: 0.0108 };       // h = half thickness
export const SAUSAGE = { len: 0.128, r: 0.0152 };

// Surface of revolution around Y with shared seam vertices. profile: [[y, radius], ...] bottom to top.
function revolve(profile, segs) {
  const rows = profile.length, pos = new Float32Array(rows * segs * 3), ring = new Float32Array(rows * segs * 2), idx = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < segs; j++) {
    const a = (j / segs) * Math.PI * 2, k = i * segs + j;
    pos.set([Math.cos(a) * profile[i][1], profile[i][0], Math.sin(a) * profile[i][1]], k * 3);
    ring.set([Math.cos(a), Math.sin(a)], k * 2);
  }
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * segs + j, b = i * segs + ((j + 1) % segs), c = a + segs, d = b + segs;
    idx.push(a, c, b, b, c, d);
  }
  return { pos, ring, idx, count: rows * segs };
}
function finish({ pos, ring, idx }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRing', new THREE.BufferAttribute(ring, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
const lumps = (rnd, n, kMin, kMax, amp) => Array.from({ length: n }, () => {
  const d = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(kMin + rnd() * (kMax - kMin));
  return { d, ph: rnd() * 6.28, a: amp * (0.6 + rnd() * 0.8) };
});

export function pattyGeometry(seed) {
  const { r: R, h } = PATTY, rnd = rng(seed), prof = [], flat = [0, 0.2, 0.4, 0.58, 0.74, 0.88];
  for (const f of flat) prof.push([-h, f * (R - h)]);
  for (let i = 0; i <= 9; i++) { const a = -Math.PI / 2 + (i / 9) * Math.PI; prof.push([Math.sin(a) * h, R - h + Math.cos(a) * h]); }
  for (const f of flat.slice().reverse()) prof.push([h, f * (R - h)]);
  const s = revolve(prof, 64), p = s.pos, ph = Array.from({ length: 6 }, () => rnd() * 6.28), waves = lumps(rnd, 9, 180, 620, 0.00042);
  for (let i = 0; i < s.count; i++) {
    let x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    const rr = Math.hypot(x, z), a = Math.atan2(z, x), e = Math.min(1, rr / R);
    // a hand-pressed outline: uneven lobes and a few small cracks at the edge
    const crack = Math.pow(Math.max(0, Math.sin(a * 6.5 + ph[4])), 14) * 0.05 + Math.pow(Math.max(0, Math.sin(a * 4.5 + ph[5])), 22) * 0.04;
    const k = 1 + e * e * (0.028 * Math.sin(3 * a + ph[0]) + 0.02 * Math.sin(5 * a + ph[1]) + 0.011 * Math.sin(9 * a + ph[2]) - crack);
    x *= k; z *= k;
    y = y * (1 + 0.09 * e * Math.sin(2 * a + ph[3])) + (y > 0 ? 0.0016 * (1 - e * e) : 0);
    let b = 0;
    for (const w of waves) b += w.a * Math.sin(x * w.d.x + y * w.d.y + z * w.d.z + w.ph);
    const nr = e * e, ny = Math.sign(y) * (1 - nr), nl = Math.hypot(nr, ny) || 1, rad = (nr / nl) * b / (rr || 1);   // push along the surface normal
    p.set([x + x * rad, y + (ny / nl) * b, z + z * rad], i * 3);
  }
  return finish(s);
}

export function sausageGeometry(seed) {
  const { len: L, r } = SAUSAGE, rnd = rng(seed), cap = r * 1.2, x0 = L / 2 - cap, half = [];
  for (let i = 0; i <= 7; i++) half.push([x0 * (i / 7), r]);
  for (let i = 1; i <= 7; i++) { const f = (i / 8) * Math.PI / 2; half.push([x0 + Math.sin(f) * cap, Math.max(r * Math.cos(f), 0.0036)]); }
  half.push([L / 2 + 0.0004, 0.0031], [L / 2 + 0.0034, 0.0036], [L / 2 + 0.0044, 0.0024], [L / 2 + 0.0047, 0]);   // the tied-off end
  const prof = half.slice(1).reverse().map(([y, rr]) => [-y, rr]).concat(half);
  const s = revolve(prof, 22), p = s.pos, ring = s.ring;
  const bend = (0.004 + rnd() * 0.004) * (rnd() < 0.5 ? -1 : 1), p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28;
  for (let i = 0; i < s.count; i++) {
    const ax = p[i * 3 + 1], c = ring[i * 2], sn = ring[i * 2 + 1];            // ax: along the sausage
    let rr = Math.hypot(p[i * 3], p[i * 3 + 2]);
    if (rr > 0.006) rr *= 1 + 0.03 * Math.sin(ax * 75 + p1) + 0.018 * Math.sin(ax * 170 + p2 + c * 2) + 0.012 * Math.sin(ax * 40 + sn * 3 + p3);
    // lay it along X: (radial cos, axis, radial sin) -> (axis, -cos, sin), then give it its curve
    p.set([ax, -c * rr, sn * rr + bend * (1 - (2 * ax / L) ** 2) - bend * 0.5], i * 3);
    ring.set([-c, sn], i * 2);                                                  // radial direction in object (y, z)
  }
  return finish(s);
}

const COMMON = /* glsl */`
  uniform highp sampler3D uNoise; uniform float uTime, uSeed, uJuice;
  uniform vec4 uDone, uSear, uRows[4]; uniform vec3 uFlamePos;
  varying vec3 vObj; varying vec3 vON; varying vec2 vRing;
  float fRough; vec3 fBump;
  // stripe where a bar touched: row = the z-row of the item's world matrix when it lay there
  float gmark(vec4 row, vec3 p) {
    float s = (dot(row.xyz, p) + row.w) / ${GRILL.rodGap};
    return 1.0 - smoothstep(0.0012, 0.0033, abs(fract(s + 0.5) - 0.5) * ${GRILL.rodGap});
  }`;

const PATTY_COLOR = /* glsl */`
  vec3 q = vObj * 9.0 + uSeed;
  vec4 n1 = texture(uNoise, q), n2 = texture(uNoise, q * 4.1 + 0.3), n3 = texture(uNoise, q * 11.0 + 0.7);
  float sideA = smoothstep(-0.004, 0.004, vObj.y), flatK = smoothstep(0.45, 0.8, abs(vON.y));
  float d = mix(uDone.y, uDone.x, sideA) * mix(0.7, 1.0, flatK);                 // the rim lags behind the faces
  d = max(d + (n1.r - 0.5) * 0.55 * smoothstep(0.0, 0.35, d) + (n2.g - 0.5) * 0.22 * smoothstep(0.0, 0.2, d), 0.0);
  vec4 sear = uSear * vec4(gmark(uRows[0], vObj), gmark(uRows[1], vObj), gmark(uRows[2], vObj), gmark(uRows[3], vObj));
  float mark = mix(max(sear.z, sear.w), max(sear.x, sear.y), sideA) * flatK * smoothstep(0.22, 0.5, n1.g + (n2.r - 0.5) * 0.6);
  float fleck = smoothstep(0.585, 0.655, n3.g * 0.65 + n2.g * 0.35) * (1.0 - smoothstep(0.2, 0.7, d));   // fat renders away
  vec3 c = mix(mix(vec3(0.25, 0.022, 0.028), vec3(0.37, 0.05, 0.055), n2.r), vec3(0.55, 0.36, 0.33), fleck * 0.8);
  c = mix(c, mix(vec3(0.17, 0.095, 0.062), vec3(0.24, 0.14, 0.092), n3.r), smoothstep(0.06, 0.3, d));
  c = mix(c, mix(vec3(0.075, 0.03, 0.012), vec3(0.16, 0.07, 0.027), n2.g), smoothstep(0.28, 0.75, d));
  c = mix(c, vec3(0.04, 0.022, 0.013), smoothstep(1.15, 1.6, d));
  c = mix(c, vec3(0.016, 0.014, 0.013) + 0.03 * n3.a * n3.a, smoothstep(1.5, 2.0, d));
  c = mix(c, vec3(0.03, 0.019, 0.013), mark * 0.92);
  float juicy = uJuice * smoothstep(0.1, 0.4, d) * (1.0 - smoothstep(1.2, 1.6, d));
  float bead = smoothstep(0.66, 0.76, texture(uNoise, q * 13.0 + vec3(0.0, uTime * 0.35, 0.0)).r) * juicy;
  fRough = mix(mix(0.4, 0.62, smoothstep(0.2, 1.0, d)), 0.9, smoothstep(1.3, 1.9, d));
  fRough = mix(mix(fRough, 0.34, juicy * 0.6), 0.07, bead);
  fRough = mix(fRough, 0.8, mark);
  fBump = (vec3(n2.r, n3.r, n2.g) - 0.5) * 1.5 + (vec3(n3.g, n3.b, n3.a) - 0.5) * 0.7;
  diffuseColor.rgb = c * (1.0 + bead * 0.25);`;

const SAUSAGE_COLOR = /* glsl */`
  vec3 q = vObj * 11.0 + uSeed;
  vec4 n1 = texture(uNoise, q), n2 = texture(uNoise, q * 3.7 + 0.3), n3 = texture(uNoise, q * 9.0 + 0.7);
  vec4 w = vec4(max(-vRing.x, 0.0), max(-vRing.y, 0.0), max(vRing.x, 0.0), max(vRing.y, 0.0)); w *= w;
  float d = dot(w, uDone);
  d = max(d + (n1.r - 0.5) * 0.5 * smoothstep(0.0, 0.3, d) + (n2.g - 0.5) * 0.25 * smoothstep(0.0, 0.2, d), 0.0);
  vec4 g = uSear * smoothstep(0.6, 0.93, w) * vec4(gmark(uRows[0], vObj), gmark(uRows[1], vObj), gmark(uRows[2], vObj), gmark(uRows[3], vObj));
  float mark = max(max(g.x, g.y), max(g.z, g.w)) * smoothstep(0.2, 0.45, n1.g + (n2.r - 0.5) * 0.4);
  float fleck = smoothstep(0.57, 0.66, n2.g * 0.5 + n3.g * 0.5), herb = smoothstep(0.7, 0.75, n3.r * 0.6 + n2.b * 0.4);
  vec3 c = mix(mix(vec3(0.46, 0.17, 0.14), vec3(0.57, 0.25, 0.2), n2.r), vec3(0.68, 0.47, 0.4), fleck * 0.55);
  c = mix(c, vec3(0.05, 0.07, 0.03), herb * 0.6);
  c = mix(c, mix(vec3(0.47, 0.25, 0.13), vec3(0.55, 0.31, 0.16), n3.r) * (1.0 - 0.5 * herb), smoothstep(0.05, 0.35, d));
  c = mix(c, mix(vec3(0.36, 0.13, 0.03), vec3(0.47, 0.2, 0.05), n2.g), smoothstep(0.3, 0.78, d));
  c = mix(c, mix(vec3(0.15, 0.05, 0.015), vec3(0.25, 0.095, 0.028), n2.r), smoothstep(0.75, 1.25, d));
  c = mix(c, vec3(0.05, 0.026, 0.014), smoothstep(0.62, 0.8, n2.a) * smoothstep(0.6, 1.1, d) * 0.8);   // blisters
  c = mix(c, vec3(0.016, 0.014, 0.013) + 0.03 * n3.a * n3.a, smoothstep(1.4, 1.95, d));
  c = mix(c, vec3(0.03, 0.018, 0.012), mark * 0.9);
  float juicy = uJuice * smoothstep(0.1, 0.4, d) * (1.0 - smoothstep(1.2, 1.6, d));
  float bead = smoothstep(0.7, 0.8, texture(uNoise, q * 12.0 + vec3(0.0, uTime * 0.35, 0.0)).r) * juicy;
  fRough = mix(mix(0.3, 0.42, smoothstep(0.2, 1.0, d)), 0.85, smoothstep(1.3, 1.9, d));
  fRough = mix(mix(fRough, 0.22, juicy * 0.6), 0.06, bead);
  fRough = mix(fRough, 0.7, mark);
  fBump = (vec3(n2.r, n3.r, n2.g) - 0.5) * 0.3 + (vec3(n3.g, n3.b, n3.a) - 0.5) * (0.12 + 0.5 * smoothstep(0.8, 1.6, d));
  diffuseColor.rgb = c;`;

// The light of the flames hangs above the bars so that it can light the kettle and the smoke, but
// what lies on the bars is lit from underneath: let only a flicker of it reach the food.
const POINT = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
const LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace(POINT,
  `${POINT}\n\t\tif ( distance( pointLight.position, ( viewMatrix * vec4( uFlamePos, 1.0 ) ).xyz ) < 0.01 ) directLight.color *= 0.28;`);

// One material per item (own uniforms); the compiled program is shared per kind.
export function foodMaterial(kind, noise3D, seed, flamePos) {
  const uniforms = {
    uNoise: { value: noise3D }, uTime: fireUniforms.uTime, uSeed: { value: seed }, uJuice: { value: 0 },
    uDone: { value: new THREE.Vector4() }, uSear: { value: new THREE.Vector4() },
    uRows: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 1, 0)) }, uFlamePos: flamePos,
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRing; varying vec3 vObj; varying vec3 vON; varying vec2 vRing;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vON = normal; vRing = aRing;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n{${kind === 'patty' ? PATTY_COLOR : SAUSAGE_COLOR}\n}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
      .replace('#include <lights_fragment_begin>', LIGHTS)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(fBump, 0.0)).xyz * 0.55);');
  };
  mat.customProgramCacheKey = () => `food-${kind}`;
  addCoalGlow(mat, { gain: 1.0, wrap: 0.35 });
  return { mat, uniforms };
}
