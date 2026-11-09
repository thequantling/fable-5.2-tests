// Night environment: HDRI image-based lighting, the moon pulled out of the HDRI into a real
// shadow-casting light, and the panorama ground-projected onto a dome so the lawn has parallax.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export const LAWN_Y = -0.18;          // deck surface is y = 0, the lawn sits one step below
const CAPTURE_HEIGHT = 1.5;           // tripod height of the panorama
const MOON_AZIMUTH = -2.0;            // where we want the moon: atan2(z, x), i.e. behind-left of the grill
const MOON_CLAMP = 3.0;               // radiance ceiling left in the IBL once the moon is a light

// Sphere whose lower half is flattened into a ground disc (same warp as three's GroundedSkybox).
function domeGeometry(radius, height, res) {
  const g = new THREE.SphereGeometry(radius, res * 2, res);
  g.scale(1, 1, -1);
  const pos = g.getAttribute('position'), v = new THREE.Vector3(), y1 = -height * 1.5;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.y < 0) {
      v.multiplyScalar(v.y < y1 ? -height / v.y : 1 - (v.y * v.y) / (3 * y1 * y1));
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  g.computeBoundingSphere();
  return g;
}

export async function loadEnvironment(renderer, scene, tier) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const [hdr, bgTex] = await Promise.all([
    new HDRLoader().setDataType(THREE.FloatType).loadAsync('./assets/env/moonlit_golf_1k.hdr'),
    new THREE.TextureLoader().loadAsync(tier.texLow ? './assets/env/moonlit_golf_bg_2k.webp' : './assets/env/moonlit_golf_bg.webp'),
  ]);

  // --- find the moon, clamp it out of the IBL and spin the panorama so it sits where we want it
  const { data, width: W, height: H } = hdr.image;
  let best = -1, bx = 0, by = 0;
  for (let y = 0, o = 0; y < H; y++) for (let x = 0; x < W; x++, o += 4) {
    const l = data[o] * 0.2126 + data[o + 1] * 0.7152 + data[o + 2] * 0.0722;
    if (l > best) { best = l; bx = x; by = y; }
    const m = Math.max(data[o], data[o + 1], data[o + 2]);
    if (m > MOON_CLAMP) { const k = MOON_CLAMP / m; data[o] *= k; data[o + 1] *= k; data[o + 2] *= k; }
  }
  const srcAz = ((bx + 0.5) / W - 0.5) * Math.PI * 2;
  const shiftPx = ((Math.round(((MOON_AZIMUTH - srcAz) / (Math.PI * 2)) * W) % W) + W) % W;
  const row = new Float32Array(W * 4);
  for (let y = 0; y < H; y++) {
    const r = data.subarray(y * W * 4, (y + 1) * W * 4);
    row.set(r);
    for (let x = 0; x < W; x++) {
      const s = ((x - shiftPx + W) % W) * 4, d = x * 4;
      r[d] = row[s]; r[d + 1] = row[s + 1]; r[d + 2] = row[s + 2]; r[d + 3] = row[s + 3];
    }
  }
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  hdr.needsUpdate = true;

  const az = ((((bx + shiftPx) % W) + 0.5) / W - 0.5) * Math.PI * 2;
  const el = (0.5 - (by + 0.5) / H) * Math.PI;
  const moonDir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(hdr);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.42;
  hdr.dispose();

  // --- visible background: tone-mapped panorama, re-linearised, on the ground-projected dome
  bgTex.colorSpace = THREE.SRGBColorSpace;
  bgTex.wrapS = THREE.RepeatWrapping;
  bgTex.minFilter = THREE.LinearMipmapLinearFilter;
  bgTex.anisotropy = Math.min(8, maxAniso);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: bgTex }, uShift: { value: shiftPx / W }, uGain: { value: 0.2 }, uBoost: { value: 3 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform float uShift, uGain, uBoost;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(map, vec2(vUv.x - uShift, vUv.y)).rgb;
        float l = max(c.r, max(c.g, c.b));
        float hot = smoothstep(0.62, 1.0, l);            // clipped moon and distant lamps get their HDR back
        gl_FragColor = vec4(c * uGain * (1.0 + hot * hot * uBoost), 1.0);
      }`,
  });
  const sky = new THREE.Mesh(domeGeometry(70, CAPTURE_HEIGHT, tier.low ? 48 : 96), skyMat);
  sky.position.y = LAWN_Y + CAPTURE_HEIGHT;
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  sky.matrixAutoUpdate = false; sky.updateMatrix();
  scene.add(sky);

  // --- the moon as a light
  const moon = new THREE.DirectionalLight(new THREE.Color(0.70, 0.82, 1.0), 0.24);
  moon.position.copy(moonDir).multiplyScalar(9).add(new THREE.Vector3(0.3, 0, 0));
  moon.target.position.set(0.3, 0, 0);
  moon.castShadow = true;
  const s = moon.shadow, m = tier.low ? 1024 : 2048;
  s.mapSize.set(m, m);
  s.camera.left = -4.2; s.camera.right = 4.2; s.camera.top = 4.2; s.camera.bottom = -4.2;
  s.camera.near = 1; s.camera.far = 20;
  s.bias = -0.0003; s.normalBias = 0.02; s.radius = 2.2;
  scene.add(moon, moon.target);

  return { moon, moonDir, sky, skyMat, pmrem };
}

// One-off reflection probe at `position` so glossy objects mirror the deck, table and bulbs
// instead of only the distant panorama. `hide` objects are skipped while capturing.
export function bakeProbe(renderer, scene, pmrem, position, hide = [], size = 256) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(0.08, 200, rt);
  cam.position.copy(position);
  const was = hide.map((o) => o.visible);
  hide.forEach((o) => { o.visible = false; });
  cam.update(renderer, scene);
  hide.forEach((o, i) => { o.visible = was[i]; });
  const out = pmrem.fromCubemap(rt.texture).texture;
  rt.dispose();
  return out;
}
