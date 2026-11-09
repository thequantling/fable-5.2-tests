// A 57 cm charcoal kettle: enamelled bowl and lid, aluminium legs, wheels, ash catcher,
// plated cooking grate and the charcoal grate underneath. Dimensions in metres.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fbm2, makeCanvas, paint, canvasTexture, rng } from './noise.js';

export const GRILL = {
  rimR: 0.285, rimY: 0.715, bowlR: 0.2964, bowlCy: 0.796,       // bowl = spherical cap
  grateY: 0.69, grateR: 0.268, rodR: 0.0022, rodGap: 0.0125,    // cooking grate (rods run along X)
  coalY: 0.575, coalR: 0.2,                                     // charcoal grate
};
const Y = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function tube(a, b, r, seg = 10) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
const polar = (r, deg, y) => V(r * Math.cos(deg * Math.PI / 180), y, r * Math.sin(deg * Math.PI / 180));
// Merge a list of geometries; rounded boxes are non-indexed, so un-index the rest when they are mixed in.
const merge = (geos) => mergeGeometries(geos.some((g) => !g.index) ? geos.map((g) => (g.index ? g.toNonIndexed() : g)) : geos);
const mesh = (geos, mat, cast = true, recv = true) => {
  const m = new THREE.Mesh(Array.isArray(geos) ? merge(geos) : geos, mat);
  m.castShadow = cast; m.receiveShadow = recv;
  return m;
};

function capProfile(R, cy, fromDeg, toDeg, n, sign = -1) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = THREE.MathUtils.degToRad(fromDeg + (toDeg - fromDeg) * (i / n));
    pts.push(new THREE.Vector2(Math.max(R * Math.sin(t), 0.0005), cy + sign * R * Math.cos(t)));
  }
  return pts;
}

function materials(aniso) {
  // smudged gloss for the enamel, soot + ash streaks for the inside of the bowl
  const S = 256, a = fbm2(S, 4, 5, 31), b = fbm2(S, 32, 3, 32, 0.6);
  const rough = canvasTexture(paint(makeCanvas(S), (x, y, i) => {
    const r = 0.12 + Math.pow(a[i], 2.2) * 0.34 + b[i] * 0.05;
    return [255, r * 255, 0];
  }), { aniso });
  const soot = canvasTexture(paint(makeCanvas(S), (x, y, i) => {
    const ash = Math.pow(a[i], 3) * 62 + b[i] * 10, v = 1 - y / S;       // paler ash low in the bowl
    const k = 36 + ash * (0.3 + v * 0.8);
    return [k * 1.06, k, k * 0.94];
  }), { srgb: true, aniso });
  const enamel = new THREE.MeshPhysicalMaterial({ color: 0x040404, roughness: 1, roughnessMap: rough, metalness: 0, specularIntensity: 0.16, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1 });
  return {
    enamel,
    soot: new THREE.MeshStandardMaterial({ map: soot, roughness: 0.82, metalness: 0, side: THREE.BackSide }),
    lidIn: new THREE.MeshStandardMaterial({ color: 0x0c0907, roughness: 0.42, metalness: 0, side: THREE.BackSide }),
    alu: new THREE.MeshStandardMaterial({ color: 0x8f97a1, roughness: 0.4, metalness: 1 }),
    grate: new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.4, metalness: 1 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8d8780, roughness: 0.36, metalness: 1 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.55, metalness: 1 }),
    nylon: new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.5, metalness: 0 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.78, metalness: 0 }),
    hub: new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.45, metalness: 0.2 }),
  };
}

export function buildGrill(renderer, scene) {
  const G = GRILL, M = materials(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  const group = new THREE.Group();
  const maxDeg = THREE.MathUtils.radToDeg(Math.asin(G.rimR / G.bowlR));

  // --- bowl: glossy outside, sooty inside, rolled rim
  const bowlGeo = new THREE.LatheGeometry(capProfile(G.bowlR, G.bowlCy, 0, maxDeg, 28), 72);
  const bowl = mesh(bowlGeo, M.enamel);
  const inner = mesh(bowlGeo.clone().translate(0, -G.bowlCy, 0).scale(0.991, 0.991, 0.991).translate(0, G.bowlCy, 0), M.soot, false, true);
  const rim = mesh(new THREE.TorusGeometry(G.rimR + 0.001, 0.0048, 10, 72).rotateX(Math.PI / 2).translate(0, G.rimY, 0), M.enamel);
  group.add(bowl, inner, rim);

  // --- legs (front leg + two wheeled back legs), axle, wheels, wire shelf
  const legs = [], steel = [], rubber = [], hubs = [], nylon = [], enamelBits = [];
  const legTop = (deg) => polar(0.17, deg, 0.553), ends = {};
  for (const deg of [90, 210, 330]) {
    const foot = polar(0.36, deg, deg === 90 ? 0.012 : 0.075);
    ends[deg] = foot;
    legs.push(tube(legTop(deg), foot, 0.0115, 12));
    enamelBits.push(tube(legTop(deg).lerp(foot, -0.04), legTop(deg).lerp(foot, 0.1), 0.0145, 12));
    if (deg === 90) rubber.push(tube(foot.clone().setY(0), foot.clone().lerp(legTop(deg), 0.06), 0.014, 12));
  }
  const axL = ends[210].clone(), axR = ends[330].clone();
  steel.push(tube(axL.clone().setX(axL.x - 0.06), axR.clone().setX(axR.x + 0.06), 0.004, 8));
  for (const [p, s] of [[axL, -1], [axR, 1]]) {
    const c = p.clone().setX(p.x + s * 0.04);
    rubber.push(new THREE.CylinderGeometry(0.075, 0.075, 0.034, 40).rotateZ(Math.PI / 2).translate(c.x, c.y, c.z));
    rubber.push(new THREE.TorusGeometry(0.073, 0.006, 8, 40).rotateY(Math.PI / 2).translate(c.x + s * 0.014, c.y, c.z), new THREE.TorusGeometry(0.073, 0.006, 8, 40).rotateY(Math.PI / 2).translate(c.x - s * 0.014, c.y, c.z));
    hubs.push(new THREE.CylinderGeometry(0.036, 0.04, 0.008, 28).rotateZ(-s * Math.PI / 2).translate(c.x + s * 0.019, c.y, c.z));
  }
  const shelfY = 0.2, sp = [90, 210, 330].map((deg) => legTop(deg).lerp(ends[deg], (0.553 - shelfY) / (0.553 - ends[deg].y)));
  for (let i = 0; i < 3; i++) steel.push(tube(sp[i], sp[(i + 1) % 3], 0.003, 6));
  for (let k = 1; k <= 5; k++) {
    const t = k / 6;
    steel.push(tube(sp[0].clone().lerp(sp[1], t), sp[0].clone().lerp(sp[2], t), 0.002, 6));
  }

  // --- ash catcher under the bowl
  const ashY = 0.39;
  const dish = new THREE.LatheGeometry([[0.004, 0], [0.07, 0.002], [0.108, 0.02], [0.112, 0.021]].map(([r, y]) => new THREE.Vector2(r, ashY + y)), 40);
  const ash = mesh(dish, new THREE.MeshStandardMaterial({ color: 0xb9bcbe, roughness: 0.38, metalness: 1, side: THREE.DoubleSide }));
  for (const deg of [30, 150, 270]) steel.push(tube(polar(0.105, deg, ashY + 0.018), polar(0.06, deg, 0.508), 0.0022, 6));
  enamelBits.push(new THREE.CylinderGeometry(0.03, 0.036, 0.02, 24).translate(0, 0.497, 0));
  steel.push(tube(V(0.02, 0.487, 0.02), V(0.12, 0.47, 0.12), 0.003, 6));
  nylon.push(new THREE.SphereGeometry(0.012, 12, 8).translate(0.125, 0.469, 0.125));

  // --- bowl handles front and back
  for (const s of [1, -1]) {
    nylon.push(new RoundedBoxGeometry(0.125, 0.02, 0.03, 3, 0.008).translate(0, 0.668, s * 0.345));
    for (const x of [-0.05, 0.05]) steel.push(tube(V(x, 0.668, s * 0.332), V(x * 1.25, 0.675, s * 0.275), 0.003, 6));
  }

  // --- cooking grate: ring, 43 rods along X, two cross bars and lift loops
  const grate = [new THREE.TorusGeometry(G.grateR + 0.002, 0.0032, 8, 96).rotateX(Math.PI / 2).translate(0, G.grateY - 0.001, 0)];
  const n = Math.floor(G.grateR / G.rodGap);
  for (let k = -n; k <= n; k++) {
    const z = k * G.rodGap, hx = Math.sqrt(G.grateR * G.grateR - z * z);
    grate.push(tube(V(-hx, G.grateY, z), V(hx, G.grateY, z), G.rodR, 7));
  }
  for (const x of [-0.115, 0.115]) {
    const hz = Math.sqrt(G.grateR * G.grateR - x * x);
    grate.push(tube(V(x, G.grateY - 0.0052, -hz), V(x, G.grateY - 0.0052, hz), 0.003, 7));
  }
  for (const s of [1, -1]) {
    const x = s * (G.grateR - 0.012);
    grate.push(tube(V(x, G.grateY, -0.04), V(x, G.grateY + 0.022, -0.04), 0.0026, 6), tube(V(x, G.grateY, 0.04), V(x, G.grateY + 0.022, 0.04), 0.0026, 6), tube(V(x, G.grateY + 0.022, -0.04), V(x, G.grateY + 0.022, 0.04), 0.0026, 6));
  }
  const grateMesh = mesh(grate, M.grate, false, true);

  // --- charcoal grate (heavier rods, mostly buried in coals)
  const cg = [new THREE.TorusGeometry(G.coalR, 0.004, 6, 48).rotateX(Math.PI / 2).translate(0, G.coalY, 0)];
  for (let k = -7; k <= 7; k++) {
    const z = k * 0.026, hx = Math.sqrt(G.coalR * G.coalR - z * z);
    cg.push(tube(V(-hx, G.coalY, z), V(hx, G.coalY, z), 0.0035, 6));
  }

  group.add(mesh(legs, M.alu), mesh(steel, M.steel), mesh(rubber, M.rubber), mesh(hubs, M.hub), mesh(nylon, M.nylon), mesh(enamelBits, M.enamel), ash, grateMesh, mesh(cg, M.darkSteel, false, false));

  // --- lid, hung on the left side of the bowl by its hook
  const lid = new THREE.Group(), LR = 0.3465, LA = 0.292, LH = 0.16, lcy = -(LR - LH);
  const lidDeg = THREE.MathUtils.radToDeg(Math.asin(LA / LR));
  const lidPts = [new THREE.Vector2(LA + 0.002, -0.02), new THREE.Vector2(LA + 0.002, -0.004), ...capProfile(LR, lcy, lidDeg, 0, 26, 1)];
  const lidGeo = new THREE.LatheGeometry(lidPts, 72);
  lid.add(mesh(lidGeo, M.enamel), mesh(lidGeo.clone().scale(0.992, 0.992, 0.992), M.lidIn, false, true));
  // handle with heat shield, damper vent
  const lh = [new RoundedBoxGeometry(0.13, 0.02, 0.028, 3, 0.008).translate(0, LH + 0.055, 0)];
  const lst = [];
  for (const x of [-0.052, 0.052]) lst.push(tube(V(x, LH - 0.012 - Math.abs(x) * 0.08, 0), V(x, LH + 0.05, 0), 0.0032, 6));
  lst.push(new THREE.CylinderGeometry(0.05, 0.05, 0.0015, 28).translate(0, LH + 0.022, 0));
  const vent = new THREE.CylinderGeometry(0.036, 0.036, 0.003, 28).translate(0.15, 0, 0);
  const vq = new THREE.Quaternion().setFromUnitVectors(Y, V(0.15, Math.sqrt(LR * LR - 0.15 * 0.15), 0).normalize());
  vent.translate(-0.15, 0, 0).applyQuaternion(vq).translate(0.15, lcy + Math.sqrt(LR * LR - 0.15 * 0.15) + 0.002, 0);
  lid.add(mesh(lh, M.nylon), mesh(lst, M.steel), mesh(vent, M.alu));
  lid.rotation.z = Math.PI / 2 - 0.05;
  lid.position.set(-(LA + 0.024), 0.462, 0);
  group.add(lid);

  scene.add(group);
  return { group, lid, bowl, grateMesh, materials: M, glossy: [M.enamel, M.alu, M.steel, M.hub, M.grate] };
}

// Small hash for scattering things over the coal grate (shared with coals.js).
export function diskPoints(count, radius, seed) {
  const rnd = rng(seed), pts = [];
  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt((i + 0.5) / count), a = i * 2.39996323 + rnd() * 0.5;
    pts.push([r * Math.cos(a) + (rnd() - 0.5) * 0.012, r * Math.sin(a) + (rnd() - 0.5) * 0.012]);
  }
  return pts;
}
