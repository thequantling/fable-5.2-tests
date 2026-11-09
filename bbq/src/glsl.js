// Shared shader snippets: the fire colour ramp, the heat distribution of the coal bed, and a
// material patch that lets any standard material pick up the orange glow of the coals near it.
import * as THREE from 'three';
import { GRILL } from './grill.js';

// t: 0 cold -> 1 white-hot. Returns HDR radiance (scene-linear).
export const FIRE_RAMP = /* glsl */`
vec3 fireRamp(float t) {
  t = clamp(t, 0.0, 1.3);
  vec3 c = vec3(1.0, 0.78 * pow(t, 1.75), 0.36 * pow(t, 5.0));
  return c * (pow(t, 3.2) * 14.0);
}`;

// Heat of the coal bed under a point (x, z): banked hot on the left, medium on the right.
export const HEAT_AT = /* glsl */`
float heatAt(vec2 p, float edge) {
  float r = length(p);
  float rim = 1.0 - smoothstep(0.17, edge, r);
  float bank = 0.4 + 0.6 * (1.0 - smoothstep(-0.11, 0.17, p.x));
  return rim * bank;
}`;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function heatAt(x, z, edge = 0.26) {
  return (1 - sstep(0.17, edge, Math.hypot(x, z))) * (0.4 + 0.6 * (1 - sstep(-0.11, 0.17, x)));
}

// The glowing bed approximated by seven point emitters (xyz, w = power): one in the middle and a
// ring of six, weighted by the heat under them. Cheap enough to evaluate per fragment, and it
// gives the right falloff and direction on everything near the fire: bowl walls, bars, food.
const GLOW_N = 7, GLOW_EPS = 0.003;
function glowAt(pts, P, N, wrap = 0) {
  let e = 0;
  for (const p of pts) {
    const lx = p.x - P.x, ly = p.y - P.y, lz = p.z - P.z, d2 = lx * lx + ly * ly + lz * lz + GLOW_EPS;
    e += p.w * Math.max(((N.x * lx + N.y * ly + N.z * lz) / Math.sqrt(d2) + wrap) / (1 + wrap), 0) / d2;
  }
  return e;
}
const glowPts = (() => {
  const pts = [], y = GRILL.coalY + 0.055;
  const add = (x, z) => pts.push(new THREE.Vector4(x, y, z, heatAt(x, z, 0.3)));
  add(-0.03, 0);
  for (let i = 0; i < GLOW_N - 1; i++) { const a = (i / (GLOW_N - 1)) * Math.PI * 2 + 0.5; add(Math.cos(a) * 0.125 - 0.01, Math.sin(a) * 0.125); }
  // normalise so the underside of something lying on the bars above the hot side receives 1
  const ref = glowAt(pts, new THREE.Vector3(-0.06, GRILL.grateY, 0), new THREE.Vector3(0, -1, 0));
  for (const p of pts) p.w /= ref;
  return pts;
})();

// Uniforms shared by everything the fire touches. `uCoal`: x = bed height, y = glow strength.
export const fireUniforms = {
  uCoal: { value: new THREE.Vector2(GRILL.coalY + 0.03, 1.0) },
  uCoalColor: { value: new THREE.Color(1.0, 0.27, 0.035) },
  uCoalPts: { value: glowPts },
  uTime: { value: 0 },
  uStoke: { value: 0 },
};

// JS twin of the shader function below (irradiance factor, before colour and strength).
export const coalGlowAt = (P, N, wrap = 0.15) => glowAt(glowPts, P, N, wrap);

export const COAL_GLOW = /* glsl */`
uniform vec4 uCoalPts[${GLOW_N}]; uniform vec2 uCoal; uniform vec3 uCoalColor; uniform float uStoke;
vec3 coalGlow(vec3 P, vec3 N, float wrap) {
  float e = 0.0;
  for (int i = 0; i < ${GLOW_N}; i++) {
    vec3 L = uCoalPts[i].xyz - P;
    float d2 = dot(L, L) + ${GLOW_EPS};
    e += uCoalPts[i].w * max((dot(N, L) * inversesqrt(d2) + wrap) / (1.0 + wrap), 0.0) / d2;
  }
  return uCoalColor * (e * uCoal.y * (1.0 + uStoke * 0.6));
}`;

export function bindCoalGlow(uniforms) {
  uniforms.uCoal = fireUniforms.uCoal; uniforms.uCoalColor = fireUniforms.uCoalColor;
  uniforms.uCoalPts = fireUniforms.uCoalPts; uniforms.uStoke = fireUniforms.uStoke;
}

// Adds the glow of the coal bed to a MeshStandard/Physical material as extra (unshadowed) light.
// opts.gain scales it; opts.wrap lets it reach a little around the terminator (soft, big source).
export function addCoalGlow(material, { gain = 1, wrap = 0.15 } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    bindCoalGlow(shader.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCoalW;')
      .replace('#include <project_vertex>', /* glsl */`#include <project_vertex>
        vec4 cgW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cgW = instanceMatrix * cgW;
        #endif
        vCoalW = (modelMatrix * cgW).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCoalW;\n${COAL_GLOW}`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        totalEmissiveRadiance += coalGlow(vCoalW, inverseTransformDirection(normal, viewMatrix), ${wrap.toFixed(3)})
          * ${gain.toFixed(3)} * mix(diffuseColor.rgb, vec3(0.5), metalnessFactor);`);
  };
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => `${prevKey}|coalglow-${gain}-${wrap}`;
  material.needsUpdate = true;
  return material;
}
