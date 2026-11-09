// The charcoal bed: ~130 fractured lumps banked to the left, glowing through their cracks and
// undersides, ash-white on top, breathing slowly as air moves through the pile.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRILL, diskPoints } from './grill.js';
import { rng } from './noise.js';
import { FIRE_RAMP, HEAT_AT, heatAt, fireUniforms } from './glsl.js';

// One lump: a noisy sphere with random flat fracture faces cut into it.
function lumpGeometry(detail, seed) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const R = rng(seed), unit = () => new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).normalize();
  const planes = Array.from({ length: 10 }, () => ({ n: unit(), d: 0.58 + R() * 0.3 }));
  const waves = Array.from({ length: 4 }, () => ({ k: unit().multiplyScalar(1.4 + R() * 2.6), ph: R() * 6.28, a: 0.05 + R() * 0.08 }));
  const pos = g.getAttribute('position'), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let s = 1;
    for (const w of waves) s += w.a * Math.sin(v.dot(w.k) + w.ph);
    v.multiplyScalar(s);
    for (const p of planes) { const t = v.dot(p.n) - p.d; if (t > 0) v.addScaledVector(p.n, -t); }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildCoals(scene, noise3D, tier) {
  const G = GRILL, R = rng(77), group = new THREE.Group();
  const lumps = [];
  const layer = (pts, cx, y, lv) => {
    for (const [px, pz] of pts) {
      const x = px + cx, z = pz;
      if (Math.hypot(x, z) > G.coalR - 0.012) continue;
      let heat = heatAt(x, z, 0.3) * (0.82 + R() * 0.3) + lv * 0.05;
      if (x > 0.02 && R() < 0.16) heat *= 0.25;                    // a few lumps on the cool side have not caught yet
      lumps.push({ x, y: y + (R() - 0.5) * 0.008, z, heat: Math.min(1, heat), s: 0.021 + R() * 0.008 });
    }
  };
  layer(diskPoints(66, 0.176, 3), 0, G.coalY + 0.019, 0);
  layer(diskPoints(44, 0.122, 4), -0.048, G.coalY + 0.045, 1);
  layer(diskPoints(20, 0.078, 5), -0.078, G.coalY + 0.069, 2);

  const geo = lumpGeometry(tier.low ? 2 : 3, 9);
  const n = lumps.length, heat = new Float32Array(n), seed = new Float32Array(n);
  const mesh = new THREE.InstancedMesh(geo, null, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  lumps.forEach((l, i) => {
    e.set(R() * 6.28, R() * 6.28, R() * 6.28); q.setFromEuler(e);
    sc.set(l.s * (0.9 + R() * 0.35), l.s * (0.62 + R() * 0.22), l.s * (0.85 + R() * 0.35));
    mesh.setMatrixAt(i, m4.compose(p.set(l.x, l.y, l.z), q, sc));
    heat[i] = l.heat; seed[i] = R();
  });
  geo.setAttribute('aHeat', new THREE.InstancedBufferAttribute(heat, 1));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));

  const uniforms = {
    uNoise: { value: noise3D }, uTime: fireUniforms.uTime, uStoke: fireUniforms.uStoke,
    uPileY: { value: new THREE.Vector2(G.coalY + 0.004, G.coalY + 0.088) }, uGlow: { value: 1.0 },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        attribute float aHeat; attribute float aSeed;
        varying vec3 vObj; varying vec3 vWorld; varying vec3 vWN; varying float vHeat; varying float vSeed;`)
      .replace('#include <project_vertex>', /* glsl */`#include <project_vertex>
        vObj = position; vHeat = aHeat; vSeed = aSeed;
        vWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        uniform highp sampler3D uNoise; uniform float uTime, uStoke, uGlow; uniform vec2 uPileY;
        varying vec3 vObj; varying vec3 vWorld; varying vec3 vWN; varying float vHeat; varying float vSeed;
        float coalT; float coalAsh; vec3 coalBump;
        ${FIRE_RAMP}`)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        {
          vec3 q = vObj * 0.5 + vSeed * 7.31;
          vec4 n1 = texture(uNoise, q * 0.55);
          vec4 n2 = texture(uNoise, q * 1.7 + 0.37);
          vec4 n3 = texture(uNoise, q * 4.3 + 0.11);
          float up = vWN.y;
          float deep = 1.0 - smoothstep(uPileY.x, uPileY.y, vWorld.y);
          float down = 0.5 - 0.5 * up;
          float crack = (smoothstep(0.8, 0.97, n2.b) * 0.7 + smoothstep(0.84, 0.98, n3.a) * 0.35) * (1.0 - 0.65 * max(up, 0.0));
          float lit = smoothstep(0.1, 0.42, vHeat);
          coalAsh = smoothstep(0.42, 0.72, n1.g * 0.8 + n3.g * 0.2 + up * 0.2) * lit;
          float breathe = texture(uNoise, vWorld * 2.1 + vec3(uTime * 0.021, uTime * 0.055, uTime * 0.033)).r - 0.5;
          float gust = texture(uNoise, vec3(vWorld.xz * 0.9, uTime * 0.11)).g - 0.5;
          coalT = vHeat * (0.22 + 0.3 * deep + 0.36 * down) + breathe * 0.3 * lit + gust * 0.1 * lit + uStoke * 0.22 * lit;
          coalT += crack * 0.3 * lit - coalAsh * 0.16 * (1.0 - crack);
          coalBump = vec3(n3.g, n2.g, n3.r) - 0.5;
          vec3 ashCol = mix(vec3(0.15, 0.135, 0.12), vec3(0.34, 0.31, 0.275), n3.g);
          diffuseColor.rgb = mix(vec3(0.012 + n3.r * 0.022), ashCol, coalAsh * (0.55 + 0.45 * n2.g));
        }`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(coalBump, 0.0)).xyz * 0.85);`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        totalEmissiveRadiance = fireRamp(coalT) * uGlow + diffuseColor.rgb * vec3(1.0, 0.4, 0.09) * (0.25 * smoothstep(0.1, 0.42, vHeat));`)
      // the pile sits deep in the bowl under the grate bars: most of the lamp light never reaches it
      .replace('#include <lights_fragment_end>', /* glsl */`#include <lights_fragment_end>
        reflectedLight.directDiffuse *= 0.4; reflectedLight.directSpecular *= 0.4;`);
  };
  mesh.material = mat;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);

  // ember bed under the lumps so the gaps between them glow instead of going black
  const bed = new THREE.Mesh(
    new THREE.CircleGeometry(G.coalR - 0.004, 48).rotateX(-Math.PI / 2).translate(0, G.coalY + 0.011, 0),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */`varying vec3 vW; void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform highp sampler3D uNoise; uniform float uTime, uStoke, uGlow; varying vec3 vW;
        ${FIRE_RAMP}
        ${HEAT_AT}
        void main() {
          vec4 n = texture(uNoise, vec3(vW.xz * 9.0, uTime * 0.045));
          vec4 m = texture(uNoise, vec3(vW.xz * 31.0, 0.3));
          float t = heatAt(vW.xz, 0.3) * 0.64 + (n.r - 0.5) * 0.46 + (m.g - 0.5) * 0.3;
          t = min(t, 0.8) * (1.0 - 0.45 * smoothstep(0.13, 0.196, length(vW.xz))) + uStoke * 0.2;
          gl_FragColor = vec4(fireRamp(t) * uGlow * 0.85 + vec3(0.004), 1.0);
        }`,
    }),
  );
  group.add(bed);
  scene.add(group);

  return {
    group, mesh, bed, uniforms, lumps,
    update(dt, t) { fireUniforms.uTime.value = t; fireUniforms.uStoke.value = Math.max(0, fireUniforms.uStoke.value - dt * 0.9); },
    stoke(k = 1) { fireUniforms.uStoke.value = Math.min(1.4, fireUniforms.uStoke.value + k); },
  };
}
