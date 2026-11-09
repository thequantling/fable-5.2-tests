// Scanned props (Poly Haven, CC0): the side table, a cutting board with buns, a brass lantern and
// two potted plants. Loading them also measures the real height of the table top.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TABLE, BOARD, LANTERN } from './layout.js';

const MODELS = ['table', 'board', 'buns', 'lantern', 'plant'];

export async function loadProps(renderer, scene, tier, tick = () => {}) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let loaded = 0;
  const [table, board, buns, lantern, plant] = await Promise.all(MODELS.map((m) =>
    loader.loadAsync(`./assets/models/${m}.glb`).then((g) => { tick(++loaded / MODELS.length); return g.scene; })));

  const aniso = Math.min(tier.low ? 2 : 8, renderer.capabilities.getMaxAnisotropy());
  const group = new THREE.Group();
  scene.add(group);
  function prep(root, parent = group) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const m = o.material;
      if (m.transmission) m.transmission = 0;                  // no refraction pass for a brass lantern
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m[k]) m[k].anisotropy = aniso;
    });
    parent.add(root);
    return root;
  }

  // --- table: stand it next to the kettle, then find out exactly how high its top is
  prep(table).position.set(TABLE.x, 0, TABLE.z);
  // under warm bulbs its orange varnish turns to neon: cool it a little and dull the shine
  table.traverse((o) => { if (o.isMesh) { o.material.color.setRGB(0.74, 0.8, 0.9); o.material.roughness *= 1.25; } });
  table.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), from = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
  let top = 0;
  for (const [dx, dz] of [[-0.3, 0.16], [-0.3, -0.16], [0, 0.01], [0.3, 0.1], [-0.43, 0.03], [0.21, -0.2]]) {
    ray.set(from.set(TABLE.x + dx, 3, TABLE.z + dz), down);
    const hit = ray.intersectObject(table, true)[0];
    if (hit) top = Math.max(top, hit.point.y);
  }
  if (top > 0.5) TABLE.top = top;

  // --- cutting board with three buns
  const boardTop = new THREE.Box3().setFromObject(board).max.y;
  prep(board).position.set(BOARD.x, TABLE.top, BOARD.z);
  board.rotation.y = BOARD.rot;
  const spots = [[-0.128, 0.03, 0.4], [0.006, -0.038, 2.1], [0.134, 0.028, 4.4]];
  buns.children.forEach((b, i) => { const s = spots[i % 3]; b.position.x = s[0]; b.position.z = s[1]; b.rotation.y = s[2]; });
  prep(buns, board).position.y = boardTop - 0.0012;
  buns.traverse((o) => { if (o.isMesh) o.material.color.setRGB(1.0, 0.8, 0.6); });     // golden rather than olive

  // --- lantern: clear glass instead of the scanned one, a flame and a small warm light inside
  prep(lantern).position.set(LANTERN.x, TABLE.top, LANTERN.z);
  lantern.rotation.y = 0.5;
  const glass = new THREE.MeshStandardMaterial({
    color: new THREE.Color(1.0, 0.93, 0.8), roughness: 0.05, metalness: 0, transparent: true, opacity: 0.2,
    depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 3,
  });
  let globe = null;
  lantern.traverse((o) => { if (o.isMesh && /glass/i.test(o.name + ' ' + o.material.name)) globe = o; });
  const wick = new THREE.Vector3(0, 0.094, 0);
  if (globe) {
    globe.material = glass; globe.castShadow = false; globe.renderOrder = 3;
    wick.copy(globe.position); wick.y -= 0.004;
  }
  const flame = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 4.8, 1.2) }));
  flame.position.copy(wick);
  const light = new THREE.PointLight(new THREE.Color(1.0, 0.6, 0.28), 0.2, 3.5, 2);
  light.position.copy(wick);
  lantern.add(flame, light);

  // --- two potted plants at the back of the deck
  const plants = [[-1.72, -1.42, 0.6, 1.0], [1.95, -1.5, 3.9, 1.18]].map(([x, z, rot, s], i) => {
    const p = prep(i ? plant.clone() : plant);
    p.position.set(x, 0, z); p.rotation.y = rot; p.scale.setScalar(s);
    return p;
  });

  const BASE = 0.2;
  return {
    group, table, board, buns, lantern, plants, light, flame, glass,
    update(dt, t) {
      const f = 0.92 + 0.07 * Math.sin(t * 9.1) * Math.sin(t * 3.7) + 0.035 * Math.sin(t * 23.0);
      light.intensity = BASE * f;
      flame.scale.set(0.0052, 0.013 * (0.85 + 0.2 * f), 0.0052);
    },
  };
}
