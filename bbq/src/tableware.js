// What the food lies on: a sheet of butcher paper for the raw meat and an enamel tray for serving.
import * as THREE from 'three';
import { TABLE, PAPER, TRAY } from './layout.js';
import { fbm2, makeCanvas, paint, normalCanvas, canvasTexture, smoothstep } from './noise.js';

function buildPaper(aniso) {
  const S = 512, W = PAPER.hx * 2, D = PAPER.hz * 2;
  const n1 = fbm2(S, 4, 5, 71), n2 = fbm2(S, 32, 3, 72), n3 = fbm2(S, 8, 4, 73);
  // grease has soaked in where the meat has been lying
  const patties = [[-0.167, -0.058], [-0.054, -0.058], [-0.167, 0.058], [-0.054, 0.058]];
  const grease = new Float32Array(S * S), height = new Float32Array(S * S);
  for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
    const lx = (x / S - 0.5) * W, lz = (y / S - 0.5) * D, wob = (n3[i] - 0.5) * 0.04;
    let g = 0;
    for (const [px, pz] of patties) g = Math.max(g, 1 - smoothstep(0.046, 0.068, Math.hypot(lx - px, lz - pz) + wob));
    const bx = Math.max(Math.abs(lx - 0.122) - 0.086, 0), bz = Math.max(Math.abs(lz) - 0.06, 0);
    g = Math.max(g, 1 - smoothstep(0.0, 0.022, Math.hypot(bx, bz) + wob));
    grease[i] = g * (0.7 + 0.3 * n1[i]);
    height[i] = n1[i] * 0.55 + (1 - Math.abs(2 * n3[i] - 1)) * 0.3 + n2[i] * 0.06;          // soft crumples and fibres
  }
  const map = paint(makeCanvas(S), (x, y, i) => {
    const g = grease[i], k = (0.92 + 0.16 * (n2[i] - 0.5) + 0.1 * (n1[i] - 0.5)) * (1 - 0.2 * g);
    return [220 * k, (171 - 12 * g) * k, (137 - 22 * g) * k];
  });
  const rough = paint(makeCanvas(S), (x, y, i) => { const r = (0.88 - 0.42 * grease[i]) * 255; return [r, r, r]; });

  const geo = new THREE.PlaneGeometry(W, D, 60, 40).rotateX(-Math.PI / 2), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / W + 0.5, v = p.getZ(i) / D + 0.5;                                // v = 1 at the front edge
    const e = Math.min(Math.min(u, 1 - u) * W, Math.min(v, 1 - v) * D);                    // metres from the nearest edge
    const corner = 0.0065 * smoothstep(0.5, 1, u) * smoothstep(0.45, 1, v) + 0.004 * smoothstep(0.55, 1, 1 - u) * smoothstep(0.55, 1, 1 - v);
    const curl = (1 - smoothstep(0, 0.055, e)) ** 2 * (0.001 + corner);
    const wave = 0.00045 * (0.5 + 0.5 * Math.sin(u * 9 + v * 4) * Math.sin(v * 7 - u * 3)) * smoothstep(0, 0.03, e);
    p.setY(i, 0.0003 + wave + curl);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: canvasTexture(map, { srgb: true, aniso, wrap: false }), roughnessMap: canvasTexture(rough, { aniso, wrap: false }),
    normalMap: canvasTexture(normalCanvas(height, S, 7), { aniso, wrap: false }), normalScale: new THREE.Vector2(0.55, 0.55),
    metalness: 0, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(PAPER.x, TABLE.top, PAPER.z);
  mesh.rotation.y = 0.028;
  mesh.receiveShadow = true;
  return mesh;
}

function buildTray() {
  // a ring of points around the rounded rectangle: [corner centre x, z, outward direction x, z]
  const rc = 0.048, cx = TRAY.hx - rc, cz = TRAY.hz - rc, NA = 10, ring = [];
  const SX = [1, -1, -1, 1], SZ = [1, 1, -1, -1];
  for (let c = 0; c < 4; c++) {
    const a0 = c * Math.PI / 2, n = c % 2 ? 8 : 14, d = (c + 1) % 4, a1 = a0 + Math.PI / 2;
    for (let k = 0; k <= NA; k++) { const a = a0 + (k / NA) * Math.PI / 2; ring.push([SX[c] * cx, SZ[c] * cz, Math.cos(a), Math.sin(a)]); }
    for (let k = 1; k < n; k++) ring.push([(SX[c] + (SX[d] - SX[c]) * k / n) * cx, (SZ[c] + (SZ[d] - SZ[c]) * k / n) * cz, Math.cos(a1), Math.sin(a1)]);
  }
  // cross-section from the outside in: [inset from the outer edge, height, 1 = blue rim]
  const rim = TRAY.rim, fl = TRAY.floor, wl = TRAY.wall;
  const prof = [
    [0.019, 0, 0], [0.009, rim * 0.6, 0], [0.0018, rim - 0.0048, 0], [0.0012, rim - 0.004, 1],
    [-0.0004, rim - 0.0026, 1], [0.0002, rim - 0.0008, 1], [0.0018, rim, 1], [0.0036, rim - 0.0006, 1], [0.004, rim - 0.0009, 0],
    [0.0065, rim - 0.0024, 0], [wl - 0.0075, fl + 0.0042, 0], [wl - 0.0035, fl + 0.0011, 0], [wl, fl, 0],
  ];
  const N = ring.length, pos = [], col = [], idx = [];
  const WHITE = [0.7, 0.69, 0.65], BLUE = [0.03, 0.075, 0.33], CHIP = [0.025, 0.025, 0.03];
  const chips = new Set([7, 8, 61, 62, 63, 104]);                    // a few knocks on the rim, down to the steel
  prof.forEach(([d, y, blue], j) => ring.forEach(([bx, bz, dx, dz], i) => {
    pos.push(bx + dx * (rc - d), y, bz + dz * (rc - d));
    col.push(...(blue && j >= 5 && j <= 7 && chips.has(i) ? CHIP : blue ? BLUE : WHITE));
  }));
  for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < N; i++) {
    const a = j * N + i, b = j * N + (i + 1) % N, c = (j + 1) * N + (i + 1) % N, d = (j + 1) * N + i;
    idx.push(a, d, b, b, d, c);
  }
  const centre = pos.length / 3, last = (prof.length - 1) * N;
  pos.push(0, fl, 0); col.push(...WHITE);
  for (let i = 0; i < N; i++) idx.push(centre, last + (i + 1) % N, last + i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.34, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.07 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(TRAY.x, TABLE.top, TRAY.z);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

export function buildTableware(scene, renderer, tier) {
  const aniso = Math.min(tier.low ? 2 : 8, renderer.capabilities.getMaxAnisotropy());
  const paper = buildPaper(aniso), tray = buildTray();
  scene.add(paper, tray);
  return { paper, tray };
}
