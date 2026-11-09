// Hands on: drag the food around, tap it to flip or roll it, tap the coals to stoke them.
// Anything else the pointer does is left to the orbit controls.
import * as THREE from 'three';
import { GRILL } from './grill.js';
import { TABLE, GRATE_TOP, surfaceAt } from './layout.js';

const CARRY = 0.05;                         // how high above a surface something is carried
const REACH = { x0: -0.4, x1: 1.5, z0: -0.42, z1: 0.42 };
// the two places food can lie, as the pointer sees them (a little generous at the edges)
const SURFACES = [
  { y: () => GRATE_TOP, has: (x, z) => Math.hypot(x, z) < GRILL.grateR + 0.03, grate: true },
  { y: () => TABLE.top, has: (x, z) => Math.abs(x - TABLE.x) < TABLE.hx + 0.03 && Math.abs(z - TABLE.z) < TABLE.hz + 0.03 },
];

export function setupInteraction({ renderer, camera, controls, food, coals, fire, grill, onUse = () => {} }) {
  const dom = renderer.domElement, host = dom.parentElement;
  const tag = document.getElementById('tag'), tagText = tag && tag.querySelector('b'), tagMark = tag && tag.querySelector('.m u');
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), v = new THREE.Vector3();
  const blockers = [grill.bowl, grill.lid].filter(Boolean), targets = [...food.meshes, ...blockers];
  const others = new Map();                 // pointers that are orbiting (or about to tap the coals): id -> { x, y, t, moved }
  let held = null;                          // { id, it, x, y, x0, y0, drag, ox, oz }
  let mouse = null, hover = null, shown = null, showUntil = 0, passing = false;

  function aim(x, y) {
    const r = dom.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2);
    ray.setFromCamera(ndc, camera);
    return r;
  }
  function pick(x, y, blunt) {
    const r = aim(x, y), h = ray.intersectObjects(targets, true)[0];
    if (h && h.object.userData.item) return h.object.userData.item;
    if (!blunt) return null;
    let best = null, bd = 30;                                           // fingers are blunt: take what is nearest
    for (const it of food.items) {
      v.copy(it.mesh.position).project(camera);
      const d = Math.hypot((v.x * 0.5 + 0.5) * r.width + r.left - x, (0.5 - v.y * 0.5) * r.height + r.top - y);
      if (v.z < 1 && d < bd) { bd = d; best = it; }
    }
    if (!best) return null;
    v.copy(best.mesh.position).project(camera);                         // ...unless the kettle or its lid hides it
    ray.setFromCamera(ndc.set(v.x, v.y), camera);
    const c = ray.intersectObjects(targets, true)[0];
    return c && c.object.userData.item ? best : null;
  }
  // Where the pointer is pointing: the spot on the bars or on the table under it. Over the gap between
  // them (or out over the deck) it is the level of the table top, carried on.
  function point(x, y) {
    aim(x, y);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (d.y > -0.02) return null;                                       // looking along the surfaces, or up
    let best = null, bt = Infinity;
    for (const s of SURFACES) {
      const t = (s.y() - o.y) / d.y, px = o.x + d.x * t, pz = o.z + d.z * t;
      if (t > 0 && t < bt && s.has(px, pz)) { bt = t; best = s; hit.set(px, s.y(), pz); }
    }
    if (best && best.grate) { const r = Math.hypot(hit.x, hit.z), m = GRILL.grateR - 0.04; if (r > m) { hit.x *= m / r; hit.z *= m / r; } }
    if (best) return hit;
    const t = (TABLE.top - o.y) / d.y;
    return t > 0 ? hit.set(THREE.MathUtils.clamp(o.x + d.x * t, REACH.x0, REACH.x1), TABLE.top, THREE.MathUtils.clamp(o.z + d.z * t, REACH.z0, REACH.z1)) : null;
  }
  function onPlane(x, y, height) {                                      // where the pointer's ray crosses a horizontal plane
    aim(x, y);
    plane.constant = -height;
    return ray.ray.intersectPlane(plane, hit);
  }
  const show = (it, secs = 2.6) => { shown = it; showUntil = performance.now() + secs * 1000; };

  function down(e) {
    if (passing || e.target !== dom || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (held && (held.drag || e.pointerType !== 'touch')) { e.stopPropagation(); return; }   // one thing at a time
    if (held) {
      // A second finger before anything has moved is a pinch, not a grab: let go, and hand the first
      // finger to the camera as if it had been the camera's all along.
      const h = held;
      letGo();
      passing = true;
      try {
        dom.dispatchEvent(new PointerEvent('pointerdown', { pointerId: h.id, pointerType: 'touch', isPrimary: true, clientX: h.x, clientY: h.y, button: 0, buttons: 1, bubbles: true }));
      } catch (_) { /* that finger has already gone */ }
      passing = false;
      others.set(h.id, { x: h.x, y: h.y, t: 0, moved: true, solo: false });
      others.set(e.pointerId, { x: e.clientX, y: e.clientY, t: 0, moved: true, solo: false });
      return;
    }
    const it = others.size ? null : pick(e.clientX, e.clientY, e.pointerType !== 'mouse');
    if (!it) { others.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, solo: others.size === 0 }); return; }
    e.stopPropagation(); e.preventDefault();
    held = { id: e.pointerId, it, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, drag: false, ox: 0, oz: 0, slop: e.pointerType === 'mouse' ? 4 : 9 };
    controls.enabled = false;
    try { dom.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointers cannot be captured */ }
    show(it);
  }
  function move(e) {
    if (e.pointerType === 'mouse') mouse = { x: e.clientX, y: e.clientY, over: e.target === dom };
    const o = others.get(e.pointerId);
    if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 7) o.moved = true;
    if (!held || e.pointerId !== held.id) return;
    held.x = e.clientX; held.y = e.clientY;
    if (!held.drag && Math.hypot(held.x - held.x0, held.y - held.y0) > held.slop) {
      const it = held.it;
      food.grab(it);
      held.drag = true;
      const p = point(held.x0, held.y0);                                // keep hold of it where it was picked up
      if (p) { held.ox = THREE.MathUtils.clamp(it.x - p.x, -0.07, 0.07); held.oz = THREE.MathUtils.clamp(it.z - p.z, -0.07, 0.07); }
      dom.classList.add('grabbing');
      onUse('drag');
    }
  }
  function up(e) {
    const o = others.get(e.pointerId);
    if (o) {
      others.delete(e.pointerId);
      if (e.type === 'pointerup' && o.solo && !o.moved && performance.now() - o.t < 400 && e.target === dom) poke(e.clientX, e.clientY);
    }
    if (!held || e.pointerId !== held.id) return;
    const it = held.it;
    if (held.drag) food.release(it); else if (e.type === 'pointerup') { food.tap(it); onUse('tap'); }
    show(it);
    letGo();
  }
  function letGo() {
    try { dom.releasePointerCapture(held.id); } catch (_) { /* not captured */ }
    dom.classList.remove('grabbing');
    controls.enabled = true;
    held = null;
  }
  // a tap that missed the food: if it landed on the coals, stir them up
  function poke(x, y) {
    const p = onPlane(x, y, GRILL.coalY + 0.05);
    if (!p || Math.hypot(p.x, p.z) > GRILL.coalR + 0.02) return;
    const d = p.distanceTo(ray.ray.origin), b = ray.intersectObjects(blockers, true)[0];
    if (b && b.distance < d) return;
    coals.stoke(1);
    fire.flare(p.x, p.z, 0.9);
    onUse('stoke');
  }

  host.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  dom.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    get holding() { return held && held.drag ? held.it : null; },
    update(dt) {
      if (held && held.drag) {
        const it = held.it, p = point(held.x, held.y);
        if (p) {
          const k = 1 - Math.exp(-dt * 24);
          it.x += (p.x + held.ox - it.x) * k; it.z += (p.z + held.oz - it.z) * k;
        }
        const s = surfaceAt(it.x, it.z), k = 1 - Math.exp(-dt * 13);     // ride over whatever is underneath
        it.y += ((s ? s.y : TABLE.top) - it.y) * k; it.lift += (CARRY + (s ? 0 : 0.02) - it.lift) * k;
        const fade = 1 - Math.exp(-dt * 2.5);                            // let the grip drift to the middle of it
        held.ox -= held.ox * fade; held.oz -= held.oz * fade;
      }
      // what the mouse is over (once a frame, not once per event)
      if (!held && mouse) {
        const it = mouse.over && !others.size ? pick(mouse.x, mouse.y, false) : null;
        if (it !== hover) { hover = it; dom.classList.toggle('point', !!it); }
        if (it) show(it, 0.5);
        mouse = null;
      }
      if (!tag) return;
      const it = held ? held.it : shown && performance.now() < showUntil ? shown : null;
      tag.classList.toggle('on', !!it);
      if (it) {
        const r = dom.getBoundingClientRect(), l = food.label(it);
        v.copy(it.mesh.position); v.y += 0.05; v.project(camera);
        tag.style.left = `${((v.x * 0.5 + 0.5) * r.width).toFixed(1)}px`;
        tag.style.top = `${((0.5 - v.y * 0.5) * r.height).toFixed(1)}px`;
        if (tagText.textContent !== l.text) tagText.textContent = l.text;
        tagMark.style.left = `${(l.k * 100).toFixed(1)}%`;
      }
    },
  };
}
