// The stage: timber deck, lawn, corner posts and the festoon string lights that key the scene.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAWN_Y } from './env.js';
import { rng, makeCanvas, normalCanvas, canvasTexture, smoothstep } from './noise.js';

export const DECK = { cx: 0.3, cz: 0, w: 5.4, d: 4.4, tile: 1.8 };
const WARM = new THREE.Color(1.0, 0.66, 0.36);

async function loadWood(tier, aniso) {
  const res = tier.texLow ? '1k' : '2k', L = new THREE.TextureLoader();
  const [map, nor, arm] = await Promise.all(['diff', 'nor', 'arm'].map((k) => L.loadAsync(`./assets/tex/deck_${k}_${res}.webp`)));
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, nor, arm]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; }
  return { map, nor, arm };
}

// A variant of the plank textures with its own UV transform (posts, fascia boards).
function woodMaterial(wood, { repeat = [1, 1], offset = [0, 0], rotation = 0, color = 0xffffff, rough = 1 } = {}) {
  const set = (t) => { const c = t.clone(); c.repeat.set(...repeat); c.offset.set(...offset); c.rotation = rotation; c.needsUpdate = true; return c; };
  const arm = set(wood.arm);
  return new THREE.MeshStandardMaterial({ map: set(wood.map), normalMap: set(wood.nor), roughnessMap: arm, aoMap: arm, roughness: rough, metalness: 0, color });
}

// Mown grass from standing height: a mat of short blades, each a stroke a few millimetres wide.
function lawnTextures(aniso) {
  const S = 512, R = rng(21), col = makeCanvas(S), hgt = makeCanvas(S), c = col.getContext('2d'), g = hgt.getContext('2d');
  c.fillStyle = 'rgb(34, 38, 16)'; c.fillRect(0, 0, S, S);                 // the thatch down between the blades
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  c.lineCap = g.lineCap = 'round';
  const wrap = (v) => (v < 12 ? [0, S] : v > S - 12 ? [0, -S] : [0]);      // blades that cross an edge come back in on the other side
  for (let i = 0; i < 34000; i++) {
    const x = R() * S, y = R() * S, a = R() * Math.PI * 2, len = 3 + R() * 5, bend = (R() - 0.5) * 0.5;
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len, v = 0.7 + R() * 0.75, dry = R() < 0.1 ? 1 : 0, k = (60 + R() * 195) | 0;
    c.strokeStyle = `rgb(${((84 + dry * 34) * v) | 0}, ${((90 + dry * 10) * v) | 0}, ${((36 + dry * 12) * v) | 0})`;
    g.strokeStyle = `rgb(${k}, ${k}, ${k})`;
    c.lineWidth = g.lineWidth = 1.1 + R() * 0.9;
    for (const ox of wrap(x)) for (const oy of wrap(y)) for (const t of [c, g]) {
      t.beginPath(); t.moveTo(x + ox - dx, y + oy - dy);
      t.quadraticCurveTo(x + ox - dy * bend, y + oy + dx * bend, x + ox + dx, y + oy + dy); t.stroke();
    }
  }
  const px = g.getImageData(0, 0, S, S).data, h = new Float32Array(S * S);
  for (let i = 0; i < h.length; i++) h[i] = px[i * 4] / 255;
  return { map: canvasTexture(col, { srgb: true, aniso }), normalMap: canvasTexture(normalCanvas(h, S, 2.4), { aniso }) };
}

// Sagging cable between two points.
function strandCurve(a, b, sag) {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

export async function buildDeck(renderer, scene, tier) {
  const aniso = Math.min(tier.texLow ? 4 : 16, renderer.capabilities.getMaxAnisotropy());
  const wood = await loadWood(tier, aniso);
  const group = new THREE.Group();
  const { cx, cz, w, d, tile } = DECK;

  // --- deck boards (planks run front to back)
  const top = new THREE.PlaneGeometry(w, d, 1, 1).rotateX(-Math.PI / 2).translate(cx, 0, cz);
  const p = top.getAttribute('position'), uv = top.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) / tile + 0.13, p.getX(i) / tile + 0.031);
  const deckMat = new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.nor, roughnessMap: wood.arm, aoMap: wood.arm, roughness: 0.92, metalness: 0, normalScale: new THREE.Vector2(1.15, 1.15) });
  const deck = new THREE.Mesh(top, deckMat);
  deck.receiveShadow = true;
  group.add(deck);

  // fascia boards + a dark core so nothing shows through from under the deck
  const fasciaMat = woodMaterial(wood, { repeat: [w / tile, 0.075], offset: [0.2, 0.39], color: 0x9a9088 });
  const H = -LAWN_Y, sides = [];
  for (const [sx, sz, len, rot] of [[0, 1, w, 0], [0, -1, w, Math.PI], [1, 0, d, Math.PI / 2], [-1, 0, d, -Math.PI / 2]]) {
    const g = new THREE.BoxGeometry(len + 0.04, H, 0.022).translate(0, -H / 2 - 0.001, 0.011).rotateY(rot);
    sides.push(g.translate(cx + sx * w / 2, 0, cz + sz * d / 2));
  }
  const fascia = new THREE.Mesh(mergeGeometries(sides), fasciaMat);
  fascia.castShadow = fascia.receiveShadow = true;
  const core = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, H - 0.01, d - 0.02).translate(cx, -H / 2 - 0.006, cz), new THREE.MeshBasicMaterial({ color: 0x020202 }));
  core.castShadow = true;
  group.add(fascia, core);

  // --- lawn: lit, shadow-receiving grass that dissolves into the photographed lawn further out
  const lt = lawnTextures(aniso);
  const ring = new THREE.RingGeometry(0.01, 19, 72, 14).rotateX(-Math.PI / 2);
  const rp = ring.getAttribute('position'), ruv = ring.getAttribute('uv'), rc = new Float32Array(rp.count * 4);
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), z = rp.getZ(i), r = Math.hypot(x, z);
    ruv.setXY(i, x / 1.3, z / 1.3);
    // broad lighter and darker patches come from the vertices, so the small tile never shows as a grid
    const tint = 0.84 + 0.3 * (0.5 + 0.5 * Math.sin(x * 0.83 + 1.7 * Math.sin(z * 0.61 + 0.4)) * Math.cos(z * 0.97 + 1.3 * Math.sin(x * 0.43)));
    rc.set([tint, tint, tint * 0.94, 1 - smoothstep(6.5, 17, r)], i * 4);
  }
  ring.setAttribute('color', new THREE.BufferAttribute(rc, 4));
  const lawnMat = new THREE.MeshStandardMaterial({ ...lt, roughness: 0.95, metalness: 0, vertexColors: true, transparent: true, depthWrite: false, normalScale: new THREE.Vector2(1.6, 1.6) });
  const lawn = new THREE.Mesh(ring, lawnMat);
  lawn.position.set(cx, LAWN_Y + 0.004, cz);
  lawn.receiveShadow = true; lawn.renderOrder = -5;
  group.add(lawn);

  // --- corner posts
  const postMat = woodMaterial(wood, { repeat: [2.55 / tile, 0.05], offset: [0.1, 0.47], color: 0xb0a69c });
  const PH = 2.55, inset = 0.09;
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => new THREE.Vector3(cx + sx * (w / 2 - inset), PH, cz + sz * (d / 2 - inset)));
  const postGeos = corners.map((c) => {
    const g = new THREE.BoxGeometry(0.09, PH, 0.09);
    const u = g.getAttribute('uv');   // run the grain up the post on every face
    for (let i = 0; i < u.count; i++) u.setXY(i, u.getY(i), u.getX(i));
    return g.translate(c.x, PH / 2, c.z);
  });
  const posts = new THREE.Mesh(mergeGeometries(postGeos), postMat);
  posts.castShadow = posts.receiveShadow = true;
  group.add(posts);

  // --- festoon lights
  const [BL, BR, FL, FR] = corners.map((c) => c.clone().setY(PH - 0.06));
  const strands = [[BL, BR, 0.3], [BL, FL, 0.26], [BR, FR, 0.26], [FL, BR, 0.42], [FL, FR, 0.3]];
  const cables = [], bulbs = [], rnd = rng(5);
  for (const [a, b, sag] of strands) {
    const curve = strandCurve(a, b, sag), len = curve.getLength(), n = Math.floor(len / 0.46);
    cables.push(new THREE.TubeGeometry(curve, 48, 0.0045, 5));
    for (let i = 0; i < n; i++) bulbs.push(curve.getPointAt((i + 0.5 + (rnd() - 0.5) * 0.15) / n));
  }
  const cable = new THREE.Mesh(mergeGeometries(cables), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.6 }));
  group.add(cable);

  const bulbMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1.0, 0.56, 0.2) }, uPower: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vN, vV;
      void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uPower; varying vec3 vN, vV;
      void main() {
        float f = max(dot(normalize(vN), normalize(vV)), 0.0);
        gl_FragColor = vec4(uColor * uPower * (5.0 + 85.0 * f * f * f * f), 1.0);   // hot filament core, softer glass
      }`,
  });
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.021, 14, 10), bulbMat, bulbs.length);
  const sockets = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.011, 0.013, 0.03, 8), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.5 }), bulbs.length);
  const m4 = new THREE.Matrix4();
  bulbs.forEach((b, i) => {
    bulbMesh.setMatrixAt(i, m4.makeTranslation(b.x, b.y - 0.052, b.z));
    sockets.setMatrixAt(i, m4.makeTranslation(b.x, b.y - 0.02, b.z));
  });
  bulbMesh.frustumCulled = sockets.frustumCulled = false;
  group.add(bulbMesh, sockets);

  // --- the light those bulbs give: one shadowed key over the cooking area plus soft fills
  // (a whole string of bulbs is a broad source: no distance falloff, or the table top would get
  // three times the light the boards do)
  const key = new THREE.SpotLight(WARM, 2.7, 9, 1.02, 0.95, 0);
  key.position.set(0.5, 2.2, 0.62);
  key.target.position.set(0.38, 0, -0.12);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(tier.low ? 1024 : 2048);
  key.shadow.camera.near = 0.6; key.shadow.camera.far = 6;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012; key.shadow.radius = 3.2;
  const fills = [[0.3, 2.2, -2.05, 4.5], [-2.25, 2.2, 0.1, 3.2], [2.85, 2.2, 0.1, 2.6]].slice(0, tier.low ? 1 : 3).map(([x, y, z, i]) => {
    const l = new THREE.PointLight(WARM, i, 8, 2); l.position.set(x, y, z); return l;
  });
  group.add(key, key.target, ...fills);

  scene.add(group);
  return { group, deck, deckMat, lawn, lawnMat, posts, key, fills, bulbMat, bulbs, wood, woodMaterial: (o) => woodMaterial(wood, o) };
}
