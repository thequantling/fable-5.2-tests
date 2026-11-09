// The food: four burger patties and five sausages that start raw on the butcher paper and cook
// when they lie on the bars — fast over the banked coals on the left, gently on the right.
import * as THREE from 'three';
import { heatAt, fireUniforms } from './glsl.js';
import { rng } from './noise.js';
import { PATTY, pattyGeometry, sausageGeometry, foodMaterial } from './foodmat.js';
import { PAPER, GRATE_TOP, settle } from './layout.js';

const SIDE_TIME = { patty: 21, sausage: 14 };      // seconds over the hot coals to cook one side through
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), QX = new THREE.Quaternion();
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const DOWN = [0, 3, 2, 1];                          // which quarter of a sausage faces the bars after n quarter turns

export function buildFood(scene, noise3D, fire) {
  const items = [], R = rng(31), group = new THREE.Group();
  scene.add(group);

  function add(kind, x, z, yaw) {
    const patty = kind === 'patty', n = items.length;
    const geo = patty ? pattyGeometry(100 + n * 7) : sausageGeometry(200 + n * 7), bb = geo.boundingBox;
    const { mat, uniforms } = foodMaterial(kind, noise3D, R() * 10, fire.uniforms.uFlamePos);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    const it = {
      kind, patty, mesh, uniforms, id: n, x, z, y: PAPER.y, yaw, lift: 0,
      turn: 0, tilt: 0,                              // half turns (patty) / quarter turns (sausage) so far
      done: patty ? [0, 0] : [0, 0, 0, 0],           // patty: top face A, bottom face B; sausage: its four quarters
      sear: [0, 0, 0, 0], searYaw: [0, 0, 0, 0], slot: -1,
      on: 'table', held: false, anim: null, juice: 0, heat: 0,
      // how far below its centre it reaches, for each way up
      ext: patty ? [-bb.min.y, bb.max.y] : [-bb.min.y, bb.max.z, bb.max.y, -bb.min.z],
    };
    mesh.userData.item = it;
    group.add(mesh); items.push(it);
    return it;
  }
  for (let i = 0; i < 4; i++) add('patty', PAPER.x - 0.167 + (i % 2) * 0.113 + (R() - 0.5) * 0.008, PAPER.z + (i < 2 ? -0.058 : 0.058) + (R() - 0.5) * 0.008, R() * 6.28);
  for (let i = 0; i < 5; i++) add('sausage', PAPER.x + 0.048 + i * 0.037, PAPER.z + (R() - 0.5) * 0.03, Math.PI / 2 + (R() - 0.5) * 0.16);

  const shrink = (it) => sstep(0.15, 1.3, mean(it.done));
  const vScale = (it) => 1 + (it.patty ? 0.12 : 0.04) * shrink(it);
  const extent = (it, turn = it.turn) => it.ext[turn % it.ext.length] * vScale(it);
  const under = (it) => (it.patty ? (it.turn + 1) % 2 : DOWN[it.turn % 4]);      // index into done[] of the side on the bars
  function footprint(it) {
    if (it.patty) return [{ dx: 0, dz: 0, r: PATTY.r * (1 - 0.12 * shrink(it)) }];
    const c = Math.cos(it.yaw) * 0.046, s = -Math.sin(it.yaw) * 0.046;
    return [{ dx: -c, dz: -s, r: 0.0185 }, { dx: 0, dz: 0, r: 0.0185 }, { dx: c, dz: s, r: 0.0185 }];
  }

  // Find room for it near (x, z): settle on a surface, then shuffle clear of whatever lies there already.
  function place(it, x, z) {
    const discs = footprint(it);
    let s = settle(x, z, discs);
    for (let n = 0; s && n < 16; n++) {
      let px = 0, pz = 0, worst = 0;
      for (const o of items) {
        if (o === it || o.held || o.on !== s.on) continue;
        for (const a of discs) for (const b of footprint(o)) {
          const dx = s.x + a.dx - o.x - b.dx, dz = s.z + a.dz - o.z - b.dz, d = Math.hypot(dx, dz) || 1e-4, pen = a.r + b.r + 0.004 - d;
          if (pen > 0) { px += (dx / d) * pen; pz += (dz / d) * pen; worst = Math.max(worst, pen); }
        }
      }
      if (worst < 0.002) return s;                   // near enough: a couple of millimetres between neighbours
      s = settle(s.x + px, s.z + pz, discs, 0.3);
    }
    return null;
  }

  // It has just come to rest on the bars: decide which set of grill marks this contact burns in.
  function land(it, quiet) {
    const u = under(it);
    if (it.patty) {
      const a = u === 0 ? 0 : 2, off = (k) => { const d = Math.abs(it.yaw - it.searYaw[k]) % Math.PI; return Math.min(d, Math.PI - d); };
      if (it.sear[a] < 0.25 || (off(a) < 0.3 && it.sear[a] < 0.6)) it.slot = a;
      else if (off(a) >= 0.3 && (it.sear[a + 1] < 0.25 || off(a + 1) < 0.12)) it.slot = a + 1;      // second set, across the first
      else it.slot = -1;
    } else it.slot = it.sear[u] < 0.6 ? u : -1;
    if (it.slot >= 0) it.searYaw[it.slot] = it.yaw;
    if (!quiet && api.onLand) api.onLand(it, heatAt(it.x, it.z, 0.27));
  }

  function pose(it) {
    const k = shrink(it), v = vScale(it), m = it.mesh;
    if (it.patty) m.scale.set(1 - 0.12 * k, v, 1 - 0.12 * k); else m.scale.set(1 - 0.05 * k, v, v);
    const a = it.anim, e = a && a.type === 'turn' ? extent(it) + (extent(it, it.turn + 1) - extent(it)) * a.u : extent(it);
    m.position.set(it.x, it.y + e + it.lift, it.z);
    m.quaternion.setFromAxisAngle(AY, it.yaw).multiply(QX.setFromAxisAngle(AX, it.tilt));
    m.updateMatrixWorld();
  }

  function cook(it, dt, quiet) {
    let h = heatAt(it.x, it.z, 0.27) * (0.8 + 0.25 * fire.level) + fireUniforms.uStoke.value * 0.25;
    for (const f of fire.flares) { const dx = it.x - f.x, dz = it.z - f.z; h += f.e * 0.9 * Math.exp(-(dx * dx + dz * dz) * 120); }
    const rate = (h / SIDE_TIME[it.kind]) * dt, u = under(it);
    for (let i = 0; i < it.done.length; i++) it.done[i] += rate * (i === u ? 1 : it.patty ? 0.05 : 0.14);
    if (it.slot >= 0) {
      const e = it.mesh.matrixWorld.elements;
      it.uniforms.uRows.value[it.slot].set(e[2], e[6], e[10], e[14]);
      it.sear[it.slot] = Math.min(1, it.sear[it.slot] + rate * 2.2);
    }
    const m = mean(it.done), fat = sstep(0.1, 0.35, m) * (1 - sstep(1.2, 1.7, m));     // dripping while it renders
    if (!quiet && h > 0.5 && Math.random() < dt * 0.05 * h * fat) fire.flare(it.x + (Math.random() - 0.5) * 0.07, it.z + (Math.random() - 0.5) * 0.07, 0.5 + Math.random() * 0.6);
    it.heat = h;
    return h * (0.35 + 0.65 * fat) * (it.patty ? 1 : 0.6);
  }

  function step(dt, quiet) {
    let load = 0;
    const discs = [];
    for (const it of items) {
      const a = it.anim;
      if (a) {
        a.t = Math.min(1, a.t + dt / a.dur);
        const u = a.t, e = u * u * (3 - 2 * u);
        a.u = e;
        if (a.type === 'turn') {
          it.tilt = a.tilt0 + (a.tilt1 - a.tilt0) * e; it.yaw = a.yaw0 + (a.yaw1 - a.yaw0) * e; it.lift = a.hop * Math.sin(Math.PI * u);
        } else {
          it.x = a.x0 + (a.x1 - a.x0) * e; it.z = a.z0 + (a.z1 - a.z0) * e;
          const top = a.y0 + (a.y1 - a.y0) * (a.arc ? e : u * u) + a.arc * Math.sin(Math.PI * u);
          it.y = a.y1; it.lift = top - a.y1;
        }
        if (u >= 1) {
          it.anim = null; it.lift = 0;
          if (a.type === 'turn') { it.turn++; it.tilt = a.tilt1; }
          if (it.on === 'grate') land(it, quiet);
        }
      }
      const cooking = it.on === 'grate' && !it.held && !it.anim;
      if (cooking) { load += cook(it, dt, quiet); for (const d of footprint(it)) discs.push({ x: it.x + d.dx, z: it.z + d.dz, r: d.r }); }
      else it.heat = 0;
      const wet = cooking ? Math.min(1, it.heat * 1.1) : 0;
      it.juice += (wet - it.juice) * Math.min(1, dt * (wet > it.juice ? 0.9 : 0.12));        // it stays glossy for a while as it rests
      const u = it.uniforms;
      u.uJuice.value = it.juice; u.uDone.value.fromArray(it.patty ? [it.done[0], it.done[1], 0, 0] : it.done); u.uSear.value.fromArray(it.sear);
      pose(it);
    }
    fire.setFood(discs);
    api.sizzle = Math.min(1, load / 2.6);
    fire.smoke = 1.1 + 2.2 * Math.min(1, load / 3) + 1.6 * Math.min(1, items.filter((it) => it.heat > 0.3 && Math.max(...it.done) > 1.6).length / 2);
  }

  const api = {
    group, items, sizzle: 0, onLand: null,
    meshes: items.map((it) => it.mesh),
    grab(it) {
      it.from = { x: it.x, z: it.z, y: it.y, on: it.on };
      it.held = true; it.anim = null; it.slot = -1;
      if (it.tilt !== it.turn * (it.patty ? Math.PI : Math.PI / 2)) it.tilt = it.turn * (it.patty ? Math.PI : Math.PI / 2);   // caught mid-flip
    },
    // let go where it is: drop onto the nearest free spot, or carry it back where it came from -> true if it found a place
    release(it) {
      const s = place(it, it.x, it.z), to = s || it.from;
      it.held = false; it.on = to.on;
      it.anim = { type: 'move', t: 0, u: 0, dur: s ? 0.17 : 0.4, arc: s ? 0 : 0.07, x0: it.x, z0: it.z, y0: it.y + it.lift, x1: to.x, z1: to.z, y1: to.y };
      return !!s;
    },
    tap(it) {                                        // flip a burger, roll a sausage a quarter turn
      if (it.held || it.anim) return;
      const p = it.patty, q = p ? Math.PI : Math.PI / 2;
      it.slot = -1;
      it.anim = { type: 'turn', t: 0, u: 0, dur: p ? 0.46 : 0.3, hop: p ? 0.075 : 0.02, tilt0: it.tilt, tilt1: it.tilt + q, yaw0: it.yaw, yaw1: it.yaw + (R() - 0.5) * (p ? 1.7 : 0.14) };
    },
    label(it) {
      const m = mean(it.done), hi = Math.max(...it.done);
      const text = hi > 1.8 ? 'Burnt' : m < 0.12 ? 'Raw' : m < 0.42 ? (it.patty ? 'Rare' : 'Warming') : m < 0.78 ? (it.patty ? 'Medium' : 'Golden') : m < 1.25 ? 'Perfect' : m < 1.6 ? 'Well done' : 'Charred';
      return { text, k: Math.min(1, m / 2) };
    },
    // put one straight onto the bars (used for the opening arrangement)
    put(it, x, z, yaw = it.yaw) { Object.assign(it, { x, z, yaw, y: GRATE_TOP, on: 'grate', lift: 0, anim: null, held: false }); pose(it); land(it, true); },
    advance(sec) { for (let t = 0; t < sec; t += 0.1) step(0.1, true); },      // cook ahead without sound or flare-ups
    update(dt) { step(dt, false); },
  };
  step(0, true);
  return api;
}
