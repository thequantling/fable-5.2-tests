// Sparks: a few drifting up from the coals all the time, and a shower of them when the fire is
// stoked or fat flares up. Stateless — every spark's path is a function of time in the vertex
// shader — and drawn as short streaks along its motion, the way a camera shutter would catch it.
import * as THREE from 'three';
import { GRILL } from './grill.js';
import { rng } from './noise.js';

export function buildSparks(scene, renderer, camera, tier) {
  const AMBIENT = tier.low ? 14 : 26, BURST = tier.low ? 44 : 90, N = AMBIENT + BURST;
  const R = rng(4242), seed = new Float32Array(N * 4), kind = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    seed.set([R(), R(), R(), R()], i * 4);
    kind.set([R(), i < AMBIENT ? 0 : 1, R()], i * 3);        // y: 0 = ambient, 1 = burst
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));  // x: head..tail, y: side
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 3));
  geo.instanceCount = N;

  const uniforms = {
    uTime: { value: 0 }, uPx: { value: 800 }, uRes: { value: new THREE.Vector2(1600, 900) },
    uBurst: { value: new THREE.Vector4(0, 0, -100, 0) },      // x, z, start time, strength 0..1
  };
  const mat = new THREE.ShaderMaterial({
    // depth is written so the lens blur treats a spark at its own distance, not the lawn's behind it
    uniforms, transparent: true, depthWrite: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec4 aSeed; attribute vec3 aKind;
      uniform float uTime, uPx; uniform vec2 uRes; uniform vec4 uBurst;
      varying vec3 vCol; varying vec2 vQ;
      vec3 gP, gV; vec2 gFl;
      vec3 hash3(float n) { return fract(sin(vec3(n, n + 17.13, n + 41.7) * vec3(12.9898, 78.233, 37.719)) * 43758.5453); }
      vec3 path(float a) {
        vec3 p;
        if (aKind.y < 0.5) p = gP + gV * a + vec3(0.05, 0.12, 0.0) * a * a;                // lifted by the hot air
        else { float e = (1.0 - exp(-2.6 * a)) / 2.6; p = gP + gV * e + vec3(0.04, 0.22, 0.0) * a * a; }   // thrown, slowed by drag
        float w = a * gFl.x + gFl.y;
        p.xz += vec2(sin(w), cos(w * 1.31)) * (0.012 * min(a, 1.0));                        // flutter
        return p;
      }
      void main() {
        float age, life;
        if (aKind.y < 0.5) {
          // ambient: each spark lives a short while, then waits for its turn again somewhere else
          float P = 3.5 + 8.0 * aSeed.x, tt = uTime + aSeed.y * P, cyc = floor(tt / P);
          vec3 h = hash3(cyc * 7.31 + aSeed.w * 91.7);
          age = tt - cyc * P; life = 0.5 + 1.1 * aSeed.z;
          gP = vec3(-0.07 + (h.x - 0.5) * 0.24, ${(GRILL.coalY + 0.07).toFixed(3)}, (h.y - 0.5) * 0.28);
          gV = vec3((h.z - 0.5) * 0.22 + 0.05, 0.42 + 0.5 * h.x, (aSeed.x - 0.5) * 0.22);
        } else {
          age = uTime - uBurst.z - aSeed.y * 0.25; life = (0.3 + 1.5 * aSeed.z * aSeed.z) * step(aSeed.w, uBurst.w);
          float a = aKind.x * 6.2832, sp = 0.45 + 2.0 * aSeed.x * aSeed.x;
          vec2 dir = vec2(cos(a), sin(a)) * (0.2 + 0.8 * aKind.z);
          gP = vec3(uBurst.x + dir.x * 0.03, ${(GRILL.coalY + 0.08).toFixed(3)}, uBurst.y + dir.y * 0.03);
          gV = vec3(dir.x * 0.55, 1.0, dir.y * 0.55) * sp;
        }
        gFl = vec2(5.0 + aSeed.z * 7.0, aSeed.x * 40.0);
        float alive = step(0.0, age) * step(age, life);
        float heat = pow(1.0 - clamp(age / max(life, 1e-3), 0.0, 1.0), 1.5);
        mat4 vp = projectionMatrix * viewMatrix;
        vec4 c0 = vp * vec4(path(age), 1.0), c1 = vp * vec4(path(max(age - 0.03, 0.0)), 1.0);
        if (alive < 0.5 || c0.w < 0.06 || c1.w < 0.06) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec2 s0 = c0.xy / c0.w * uRes * 0.5, s1 = c1.xy / c1.w * uRes * 0.5, d = s1 - s0;
        float len = length(d);
        vec2 dir = len > 1e-3 ? d / len : vec2(0.0, 1.0);
        float nat = (0.0011 + 0.0016 * aSeed.z) * uPx / c0.w, wpx = max(nat, 1.35);     // true width in pixels, never thinner than a pixel
        vec2 s = mix(s0 - dir * wpx * 0.5, s1 + dir * wpx * 0.5, position.x) + vec2(-dir.y, dir.x) * (position.y * wpx * 0.5);
        float w = mix(c0.w, c1.w, position.x);
        gl_Position = vec4(s / (uRes * 0.5) * w, mix(c0.z / c0.w, c1.z / c1.w, position.x) * w, w);
        float bright = 0.25 + 1.6 * pow(fract(aSeed.w * 7.13), 2.0);
        vCol = mix(vec3(1.0, 0.16, 0.015), vec3(1.0, 0.5, 0.13), heat) * (heat * 30.0 * bright);
        vCol *= clamp(wpx * 1.8 / (len + wpx), 0.2, 1.0) * clamp(nat * nat / 1.8, 0.3, 1.0) * mix(1.0, 0.2, position.x);
        vQ = position.xy;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol; varying vec2 vQ;
      void main() {
        float k = 1.0 - abs(vQ.y);
        if (k < 0.3) discard;
        gl_FragColor = vec4(vCol * smoothstep(0.2, 0.75, k), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  scene.add(mesh);

  const size = new THREE.Vector2();
  return {
    points: mesh, uniforms,
    update(dt, t) {
      uniforms.uTime.value = t;
      renderer.getDrawingBufferSize(size);
      uniforms.uRes.value.copy(size);
      uniforms.uPx.value = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    },
    burst(x, z, strength = 1) { uniforms.uBurst.value.set(x, z, uniforms.uTime.value, Math.min(1, strength)); },
  };
}
