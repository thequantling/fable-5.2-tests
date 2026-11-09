// Flames, smoke and heat haze, ray-marched through the depth buffer as one post-processing effect,
// plus the flickering light the fire throws on everything around it.
//
// A 64x64 "heat map" (updated on the CPU every frame) says how tall the flames are over each bit
// of the coal bed, and where food is lying on the bars (flames stop underneath it and curl round).
import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { GRILL } from './grill.js';
import { heatAt, fireUniforms } from './glsl.js';

const MAP = 64, SPAN = 0.6;                 // heat map: MAP x MAP texels over a SPAN-metre square
const BASE_Y = 0.6;                         // flames start down between the coals
const f3 = (v) => v.toFixed(4);

const shader = (tier) => /* glsl */`
uniform highp sampler3D uNoise;
uniform sampler2D uHeatMap;
uniform vec3 uCamPos; uniform vec3 uFwd; uniform vec3 uRight; uniform vec3 uUp;
uniform vec3 uKeyPos; uniform vec3 uKeyDir; uniform vec3 uKeyCol; uniform vec2 uKeyCone;
uniform vec3 uAmbient; uniform vec3 uFlamePos; uniform vec3 uFlameLight;
uniform float uTime; uniform float uTop; uniform float uGain; uniform float uSmoke; uniform float uHaze; uniform float uJitter;
uniform vec3 uFlameMax; uniform float uDown; uniform float uVeil;

vec3 rayDir(vec2 uv, out float rl) {
  vec3 d = uFwd + (uv.x * 2.0 - 1.0) * uRight + (uv.y * 2.0 - 1.0) * uUp;
  rl = length(d);
  return d / rl;
}

// ray against an upright cylinder (centre c, radius R) cut off at heights y0..y1 -> (enter, exit)
vec2 column(vec3 ro, vec3 rd, vec2 c, float R, float y0, float y1) {
  vec2 o = ro.xz - c;
  float a = dot(rd.xz, rd.xz) + 1e-6, b = dot(o, rd.xz), h = b * b - a * (dot(o, o) - R * R);
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  float iy = 1.0 / (abs(rd.y) > 1e-5 ? rd.y : 1e-5);
  float ta = (y0 - ro.y) * iy, tb = (y1 - ro.y) * iy;
  return vec2(max(max((-b - h) / a, min(ta, tb)), 0.0), min((-b + h) / a, max(ta, tb)));
}

vec3 flameColor(float T) {
  vec3 c = mix(vec3(1.0, 0.15, 0.018), vec3(1.0, 0.4, 0.055), smoothstep(0.0, 0.45, T));
  c = mix(c, vec3(1.0, 0.6, 0.16), smoothstep(0.4, 1.0, T));
  return c * (0.45 + 4.2 * T * T);
}

vec3 flames(vec3 ro, vec3 rd, float tMax, float jit) {
  vec3 acc = vec3(0.0);
  vec2 t = column(ro, rd, vec2(0.0), ${f3(GRILL.rimR - 0.014)}, ${f3(BASE_Y)}, uTop);
  t.y = min(t.y, tMax);
  if (t.y <= t.x) return acc;
  float dt = (t.y - t.x) / ${tier.fireSteps}.0;
  for (int i = 0; i < ${tier.fireSteps}; i++) {
    vec3 p = ro + rd * (t.x + (float(i) + jit) * dt);
    vec2 hm = textureLod(uHeatMap, p.xz * ${f3(1 / SPAN)} + 0.5, 0.0).rg;
    float I = hm.r * 2.0 * (1.0 - hm.g * smoothstep(${f3(GRILL.grateY - 0.014)}, ${f3(GRILL.grateY + 0.004)}, p.y));
    if (I < 0.04) continue;
    float h = (p.y - ${f3(BASE_Y)}) / (0.07 + 0.24 * I);
    if (h > 1.6) continue;
    // rising, vertically stretched noise; the tips sway more than the roots
    vec3 q = vec3(p.x * 5.0, p.y * 1.8 - uTime * 1.3, p.z * 5.0);
    vec3 w = textureLod(uNoise, q * 0.31 + vec3(0.17, -uTime * 0.23, 0.61), 0.0).rgb - 0.5;
    q.xz += w.rg * (0.3 + 1.0 * h); q.y += w.b * 0.3;
    vec4 n = textureLod(uNoise, q, 0.0);
    float d = n.r * 0.62 + n.g * 0.38 - mix(0.43, 0.79, h) + (I - 0.5) * 0.05;   // tongues thin out with height
    if (d <= 0.0) continue;
    // hottest deep inside a tongue; it cools to orange and red towards its skin and its tip
    float T = clamp(d * 7.5, 0.0, 1.0) * (1.0 - 0.42 * min(h, 1.0));
    vec3 c = flameColor(T) + vec3(0.04, 0.13, 0.55) * (1.0 - smoothstep(0.0, 0.26, h));
    acc += c * (smoothstep(0.0, 0.05, d) * (0.2 + 0.8 * smoothstep(0.0, 0.4, h)) * dt);   // roots are nearly transparent
  }
  // however deep the fire is along the ray it stays the colour of fire: it never piles up to white
  // (and looking down the length of the flames, straight into the kettle, they must not hide the coals)
  return uFlameMax * (1.0 - exp(-acc * (uGain * 24.0 * mix(uDown, 1.0, 1.0 - rd.y * rd.y)) / uFlameMax));
}

// thin smoke: rgb = light scattered towards the eye, a = how much of the background still shows
vec4 smoke(vec3 ro, vec3 rd, float tMax, float jit) {
  vec4 acc = vec4(0.0, 0.0, 0.0, 1.0);
  vec2 t = column(ro, rd, vec2(0.1, 0.0), 0.62, ${f3(GRILL.grateY + 0.004)}, 2.35);
  t.y = min(t.y, tMax);
  if (t.y <= t.x) return acc;
  // spend the steps where this ray can actually meet the plume, which is narrow low down
  float ya = ro.y + rd.y * t.x, yb = ro.y + rd.y * t.y;
  float h0 = max((min(ya, yb) - ${f3(GRILL.grateY)}) / 1.65, 0.0), h1 = (max(ya, yb) - ${f3(GRILL.grateY)}) / 1.65;
  vec2 t2 = column(ro, rd, vec2(-0.02 + 0.15 * (h0 * h0 + h1 * h1), 0.0), 0.22 + 0.15 * (h1 * h1 - h0 * h0) + 0.7 * h1, 0.0, 3.0);
  t.x = max(t.x, t2.x); t.y = min(t.y, t2.y);
  if (t.y <= t.x) return acc;
  float dt = (t.y - t.x) / ${tier.smokeSteps}.0;
  for (int i = 0; i < ${tier.smokeSteps}; i++) {
    vec3 p = ro + rd * (t.x + (float(i) + jit) * dt);
    float hh = (p.y - ${f3(GRILL.grateY)}) / 1.65;
    vec3 q = vec3(p.x * 1.9, p.y * 1.45 - uTime * 0.58, p.z * 1.9);
    vec3 w = textureLod(uNoise, q * 0.36 + vec3(0.0, -uTime * 0.05, 0.3), 0.0).rgb - 0.5;
    // the plume leans downwind, meanders, and is pushed about by the air as it rises: no straight edges
    vec2 c = vec2(-0.02 + hh * hh * 0.3 + 0.07 * hh * sin(p.y * 2.3 - uTime * 0.5), 0.07 * hh * sin(p.y * 3.1 - uTime * 0.7 + 1.3));
    float rad = 0.14 + 0.3 * hh;
    vec2 e = (p.xz - c + w.rg * (0.06 + 0.4 * hh)) / rad;
    float env = exp(-dot(e, e) * 2.2);
    if (env < 0.02) continue;
    q += w * (0.16 + 0.5 * min(hh, 0.5));                                   // smooth off the bars, curling higher up
    vec4 n = textureLod(uNoise, q, 0.0);
    float body = smoothstep(0.42, 0.85, n.r * 0.6 + n.g * 0.4);          // separate drifting puffs, clear air between them
    float d = body * (0.4 + 0.6 * n.b * n.b * n.a) * env * smoothstep(0.0, 0.06, hh) * exp(-hh * 3.2) * 2.8;
    if (d < 0.002) continue;
    float a = 1.0 - exp(-d * dt * uSmoke);
    vec3 toKey = uKeyPos - p, toFire = uFlamePos - p;
    float dk = dot(toKey, toKey), ck = dot(toKey, rd) * inversesqrt(dk);
    float ph = 0.8 / pow(1.2 - 0.9 * ck, 1.5);                               // smoke scatters forwards: it glows against the light
    vec3 L = uAmbient
      + uKeyCol * (smoothstep(uKeyCone.x, uKeyCone.y, dot(-toKey, uKeyDir) * inversesqrt(dk)) * 0.1 * ph)
      + uFlameLight / ((dot(toFire, toFire) + 0.08) * 12.57);
    acc.rgb += acc.a * a * L;
    acc.a *= 1.0 - a;
  }
  return acc;
}
${tier.low ? '' : /* glsl */`
// heat haze: the hot air above the grill bends whatever is seen through it
void mainUv(inout vec2 uv) {
  float rl; vec3 rd = rayDir(uv, rl);
  vec2 t = column(uCamPos, rd, vec2(0.0), 0.3, ${f3(GRILL.grateY + 0.02)}, 1.9);
  float far = -getViewZ(readDepth(uv)) * rl, len = min(t.y, far) - t.x;
  if (len > 0.0) {
    vec3 p = uCamPos + rd * (t.x + len * 0.5);
    vec2 n = textureLod(uNoise, vec3(p.x * 4.0, p.y * 2.6 - uTime * 1.6, p.z * 4.0), 0.0).rg - 0.5;
    // whatever stands in the hot air itself (the food, the bars) stays sharp: only what is beyond it shimmers
    vec3 e = uCamPos + rd * far;
    float beyond = dot(e.xz, e.xz) < 0.09 ? smoothstep(0.02, 0.3, e.y - ${f3(GRILL.grateY)}) : 1.0;
    uv += n * (uHaze * beyond * min(len, 0.45) * (1.0 - smoothstep(0.95, 1.9, p.y)) / rl);
  }
}`}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float rl; vec3 rd = rayDir(vUv, rl);
  float tMax = -getViewZ(readDepth(vUv)) * rl;
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uJitter);
  vec4 s = smoke(uCamPos, rd, tMax, jit);
  vec3 f = flames(uCamPos, rd, tMax, jit);
  // a thick flame is sooty enough to hide most of what is behind it, so fire over glowing coals stays fire-coloured
  outputColor = vec4((inputColor.rgb * s.a + s.rgb) * (1.0 - uVeil * f.r / uFlameMax.r) + f, inputColor.a);
}`;

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildFire(scene, camera, noise3D, tier, { key } = {}) {
  tier.smokeSteps = tier.smokeSteps || Math.max(8, Math.round(tier.fireSteps * 0.63));
  const data = new Uint8Array(MAP * MAP * 4);
  const heatMap = new THREE.DataTexture(data, MAP, MAP, THREE.RGBAFormat);
  heatMap.minFilter = heatMap.magFilter = THREE.LinearFilter;
  const base = new Float32Array(MAP * MAP);
  const coord = (i) => ((i + 0.5) / MAP - 0.5) * SPAN;
  let hot = 0;
  for (let j = 0; j < MAP; j++) for (let i = 0; i < MAP; i++) { const b = heatAt(coord(i), coord(j), 0.235); base[j * MAP + i] = b; hot += b > 0.01 ? 1 : 0; }

  const V = () => ({ value: new THREE.Vector3() });
  const U = {
    uNoise: { value: noise3D }, uHeatMap: { value: heatMap },
    uCamPos: V(), uFwd: V(), uRight: V(), uUp: V(), uKeyPos: V(), uKeyDir: V(), uKeyCol: V(), uKeyCone: { value: new THREE.Vector2(0.5, 1) },
    uAmbient: { value: new THREE.Vector3(0.010, 0.014, 0.023) }, uFlamePos: V(), uFlameLight: V(),
    uTime: { value: 0 }, uTop: { value: 0.9 }, uGain: { value: 0.45 }, uSmoke: { value: 1.5 }, uHaze: { value: tier.low ? 0 : 0.02 }, uJitter: { value: 0 },
    uFlameMax: { value: new THREE.Vector3(1.0, 0.27, 0.024) }, uDown: { value: 0.5 }, uVeil: { value: 0.75 },
  };
  const effect = new Effect('FireEffect', shader(tier), {
    blendFunction: BlendFunction.NORMAL, attributes: EffectAttribute.DEPTH, uniforms: new Map(Object.entries(U)),
  });

  // the light of the flames: shadow-casting on capable machines, short-range (so it cannot light
  // the deck through the bowl) everywhere else
  const light = new THREE.PointLight(new THREE.Color(1.0, 0.42, 0.11), 1, tier.pointShadow ? 5 : 0.86, 2);
  light.position.set(-0.045, 0.84, 0);
  if (tier.pointShadow) {
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.camera.near = 0.03; light.shadow.camera.far = 5;
    light.shadow.bias = -0.004; light.shadow.normalBias = 0.012; light.shadow.radius = 3;
  }
  scene.add(light);

  const flares = [];
  let discs = [], frame = 0;
  const tmp = new THREE.Vector3();
  const api = {
    effects: [effect], effect, light, heatMap, uniforms: U, flares,
    level: 0.85,              // how lively the fire is overall
    smoke: 1.5,               // smoke density (rises while fat is dripping)
    lightGain: 0.55,
    power: 0,                 // 0..~2, how much flame there is right now (drives the light and the sound)
    onFlare: null,
    setFood(list) { discs = list; },
    flare(x, z, s = 1) {
      flares.push({ x, z, s, age: 0, dur: 0.9 + Math.random() * 0.8, e: 0 });
      if (flares.length > 6) flares.shift();
      if (api.onFlare) api.onFlare(x, z, s);
    },
    update(dt, t) {
      const stoke = fireUniforms.uStoke.value;
      for (let k = flares.length - 1; k >= 0; k--) {
        const f = flares[k]; f.age += dt;
        if (f.age > f.dur) { flares.splice(k, 1); continue; }
        f.e = f.s * Math.min(1, f.age / 0.1) * Math.pow(1 - f.age / f.dur, 1.4) * (0.82 + 0.18 * Math.sin(f.age * 33));
      }
      // flame height field: slow wandering patches on the hot side, plus stoking and flare-ups
      let top = 0, sum = 0, o = 0;
      for (let j = 0; j < MAP; j++) {
        const z = coord(j);
        for (let i = 0; i < MAP; i++, o += 4) {
          const x = coord(i), b = base[j * MAP + i];
          let I = 0;
          if (b > 0.01) {
            const p = Math.sin(x * 31 + t * 0.83 + 1.9 * Math.sin(z * 23 - t * 0.57)) * Math.sin(z * 37 - t * 1.07 + 1.6 * Math.sin(x * 19 + t * 0.41));
            I = b * ((0.03 + 0.95 * sstep(0.34, 0.84, 0.5 + 0.5 * p + 0.2 * Math.sin(t * 0.37 + x * 9))) * api.level + stoke * 0.9);
            for (const f of flares) { const dx = x - f.x, dz = z - f.z; I += f.e * 1.5 * Math.exp(-(dx * dx + dz * dz) * 230) * Math.min(1, b * 4); }
            sum += I; if (I > top) top = I;
          }
          data[o] = Math.min(255, I * 127.5); data[o + 1] = 0;
        }
      }
      for (const d of discs) {                      // food on the bars blocks the flames under it
        const r = d.r + 0.014, i0 = Math.max(0, Math.floor(((d.x - r) / SPAN + 0.5) * MAP)), i1 = Math.min(MAP - 1, Math.ceil(((d.x + r) / SPAN + 0.5) * MAP));
        const j0 = Math.max(0, Math.floor(((d.z - r) / SPAN + 0.5) * MAP)), j1 = Math.min(MAP - 1, Math.ceil(((d.z + r) / SPAN + 0.5) * MAP));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const v = 255 * (1 - sstep(d.r - 0.008, r, Math.hypot(coord(i) - d.x, coord(j) - d.z))), k = (j * MAP + i) * 4 + 1;
          if (v > data[k]) data[k] = v;
        }
      }
      heatMap.needsUpdate = true;
      const mean = sum / hot;
      api.power = mean * 2.2 + flares.reduce((a, f) => a + f.e, 0) * 0.9;

      const flick = 0.84 + 0.1 * Math.sin(t * 11.3) + 0.07 * Math.sin(t * 23.7 + 1.3) + 0.06 * Math.sin(t * 5.3 + 0.4);
      light.intensity = (0.3 + api.power) * flick * api.lightGain;
      light.position.set(-0.045 + 0.012 * Math.sin(t * 7.1), 0.84 + 0.015 * Math.sin(t * 9.7 + 1), 0.012 * Math.sin(t * 5.9 + 2));

      camera.updateMatrixWorld();
      const th = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      U.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
      camera.getWorldDirection(U.uFwd.value);
      U.uRight.value.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(th * camera.aspect);
      U.uUp.value.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(th);
      if (key) {
        key.getWorldPosition(U.uKeyPos.value);
        U.uKeyDir.value.copy(key.target.getWorldPosition(tmp)).sub(U.uKeyPos.value).normalize();
        U.uKeyCol.value.set(key.color.r, key.color.g, key.color.b).multiplyScalar(key.intensity);
        U.uKeyCone.value.set(Math.cos(key.angle), Math.cos(key.angle * (1 - key.penumbra)));
      }
      U.uFlamePos.value.copy(light.position);
      U.uFlameLight.value.set(light.color.r, light.color.g, light.color.b).multiplyScalar(light.intensity);
      U.uTime.value = t;
      U.uTop.value = Math.min(1.35, BASE_Y + (0.07 + 0.24 * top) * 1.6);
      U.uSmoke.value += (api.smoke - U.uSmoke.value) * Math.min(1, dt * 1.5);
      U.uJitter.value = (++frame * 0.61803398875) % 1;
    },
  };
  return api;
}
