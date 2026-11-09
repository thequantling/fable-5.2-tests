// Midnight BBQ — entry point: renderer, quality tiers, camera, scene assembly and the frame loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadEnvironment, bakeProbe } from './env.js';
import { buildDeck } from './deck.js';
import { buildGrill } from './grill.js';
import { buildPost } from './post.js';
import { makeNoise3D } from './noise.js';
import { buildCoals } from './coals.js';
import { addCoalGlow, fireUniforms } from './glsl.js';
import { buildFire } from './fire.js';
import { buildSparks } from './sparks.js';
import { loadProps } from './props.js';
import { buildTableware } from './tableware.js';
import { buildUtensils } from './utensils.js';
import { buildFood } from './food.js';
import { setupInteraction } from './interaction.js';
import { buildAudio } from './audio.js';
import * as layout from './layout.js';

// The lights here have real size (a bed of coals, a flame behind glass): soften the inverse-square
// law up close so that food on the bars is not burnt out by a mathematical point.
THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin.replace(
  'max( pow( lightDistance, decayExponent ), 0.01 )', '( pow( lightDistance, decayExponent ) + 0.05 )');

const params = new URLSearchParams(location.search);
const SHOT = params.has('shot');                 // capture mode: no intro move, fixed resolution
const $ = (s) => document.querySelector(s);
const progress = (f, msg) => { $('#bar i').style.width = `${Math.round(f * 100)}%`; if (msg) $('#loadmsg').textContent = msg; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const TIERS = {
  high:   { name: 'high',   low: false, texLow: false, msaa: 4, ao: true,  aoHalf: false, dof: true,  fireSteps: 44, maxDpr: 2,    pointShadow: true },
  medium: { name: 'medium', low: false, texLow: true,  msaa: 0, ao: true,  aoHalf: true,  dof: false, fireSteps: 26, maxDpr: 1.6,  pointShadow: false },
  low:    { name: 'low',    low: true,  texLow: true,  msaa: 0, ao: false, aoHalf: true,  dof: false, fireSteps: 16, maxDpr: 1.15, pointShadow: false },
};
function pickTier(renderer) {
  const forced = params.get('q');
  if (TIERS[forced]) return TIERS[forced];
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) return TIERS.low;
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  if (!mobile) return TIERS.high;
  const strong = (navigator.hardwareConcurrency || 4) >= 6 && (navigator.deviceMemory || 4) >= 4;
  return strong ? TIERS.medium : TIERS.low;
}

const VIEWS = {
  hero:  { pos: [-0.60, 1.15, 1.26], tgt: [0.24, 0.72, 0.0], fov: 37, tall: { pos: [-1.22, 1.82, 0.98], tgt: [0.33, 0.70, 0.0] } },
  grate: { pos: [0.12, 1.36, 0.60], tgt: [0.0, 0.69, 0.0], fov: 38 },
  macro: { pos: [0.30, 0.90, 0.46], tgt: [0.0, 0.70, 0.0], fov: 34 },
  low:   { pos: [-0.85, 0.62, 1.25], tgt: [0.08, 0.76, 0.0], fov: 38 },
  wide:  { pos: [2.3, 1.55, 3.3], tgt: [0.45, 0.75, -0.1], fov: 40 },
};
const VIEW_ORDER = ['hero', 'grate', 'macro', 'low', 'wide'];

async function start() {
  const app = $('#app');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  } catch (e) { $('#fallback').style.display = 'grid'; $('#loader').classList.add('done'); return; }
  const tier = pickTier(renderer);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;          // tone mapping happens in the post chain
  renderer.toneMappingExposure = +(params.get('exp') || 2.3);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  let dpr = Math.min(+(params.get('dpr') || window.devicePixelRatio || 1), SHOT ? 4 : tier.maxDpr);
  renderer.setPixelRatio(dpr);
  renderer.setSize(app.clientWidth, app.clientHeight);
  app.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, app.clientWidth / app.clientHeight, 0.05, 300);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.085, rotateSpeed: 0.62, zoomSpeed: 0.8, panSpeed: 0.7, minDistance: 0.5, maxDistance: 6.5, minPolarAngle: 0.12, maxPolarAngle: 1.5 });
  const TGT_MIN = new THREE.Vector3(-1.3, 0.25, -1.3), TGT_MAX = new THREE.Vector3(1.9, 1.7, 1.3);

  // --- camera views
  let baseFov = 38, tween = null;
  const portraitK = () => THREE.MathUtils.clamp(1.25 / camera.aspect, 1, 1.8);
  function applyFov() {
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov) / 2) * portraitK()));
    camera.updateProjectionMatrix();
  }
  const isTall = () => camera.aspect < 0.9;          // a phone held upright
  function viewPose(v) {
    const u = isTall() && v.tall ? v.tall : v;       // some views have a framing of their own for that
    const tgt = new THREE.Vector3(...u.tgt), pos = new THREE.Vector3(...u.pos);
    if (isTall() && !v.tall) { tgt.x *= 0.35; pos.sub(tgt).multiplyScalar(1.22).add(tgt); }   // the rest: centre the kettle, step back
    return { pos, tgt, fov: v.fov };
  }
  let current = null, moved = false, wasTall = isTall();
  function setView(name, instant = false) {
    const v = typeof name === 'string' ? VIEWS[name] : name;
    if (!v) return;
    current = v; moved = false;
    const to = viewPose(v);
    if (instant) {
      camera.position.copy(to.pos); controls.target.copy(to.tgt); baseFov = to.fov; applyFov(); controls.update(); tween = null;
    } else {
      tween = { t: 0, dur: 1.5, p0: camera.position.clone(), t0: controls.target.clone(), f0: baseFov, ...to };
    }
  }
  let viewIndex = 0;
  setView(params.get('view') || 'hero', true);

  // --- world
  progress(0.08, 'Rolling out the night sky…');
  const noise3D = makeNoise3D(64);
  const env = await loadEnvironment(renderer, scene, tier);
  progress(0.38, 'Laying the deck…');
  const deck = await buildDeck(renderer, scene, tier);
  progress(0.6, 'Wheeling out the kettle…');
  const grill = buildGrill(renderer, scene);
  progress(0.66, 'Setting the table…');
  const props = await loadProps(renderer, scene, tier, (f) => progress(0.66 + 0.2 * f));
  const ware = buildTableware(scene, renderer, tier);
  const utensils = buildUtensils(scene);
  const systems = [props];
  const coals = buildCoals(scene, noise3D, tier);
  systems.push(coals);
  addCoalGlow(grill.materials.soot, { gain: 0.6, wrap: 0.1 });
  addCoalGlow(grill.materials.grate, { gain: 0.3, wrap: 0 });
  fireUniforms.uCoal.value.y = +(params.get('coal') || 2.6);

  const fire = buildFire(scene, camera, noise3D, tier, { key: deck.key });
  const food = buildFood(scene, noise3D, fire);
  systems.push(food, fire);                            // food first: it tells the fire what is cooking

  // a head start: one burger and two sausages are already on, turned once
  if (params.get('start') !== 'raw') {
    const it = food.items, roll = () => { food.tap(it[7]); food.tap(it[8]); };
    food.put(it[7], 0.075, -0.045, 1.46); food.put(it[8], 0.128, -0.02, 1.68);
    food.advance(13); roll(); food.advance(1);
    food.put(it[1], -0.1, 0.035, 0.4);
    food.advance(12); roll(); food.advance(2);
    food.tap(it[1]); food.advance(4);
  }
  const sparks = buildSparks(scene, renderer, camera, tier);
  systems.push(sparks);
  const audio = buildAudio({ fire, food });
  fire.onFlare = (x, z, s) => { sparks.burst(x, z, s); audio.flare(s); };
  food.onLand = (it, heat) => audio.land(heat);

  const post = buildPost(renderer, scene, camera, tier, fire.effects, { agx: params.get('tm') === 'agx' });
  if (post.dof) post.dof.target = controls.target;

  if (params.get('debug') === 'moon') {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 48, 32), new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.02 }));
    ball.position.set(-0.75, 1.0, 0.45);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
    dot.position.copy(env.moonDir).multiplyScalar(40);
    scene.add(ball, dot);
  }

  // local reflections for the glossy kettle
  progress(0.9, 'Lighting the coals…');
  await nextFrame();
  if (!tier.low) {
    const probe = bakeProbe(renderer, scene, env.pmrem, new THREE.Vector3(0, 0.74, 0), [grill.group, coals.group, food.group]);
    for (const m of grill.glossy) { m.envMap = probe; m.needsUpdate = true; }
  }

  // --- resize + adaptive resolution
  function resize() {
    const w = app.clientWidth, h = app.clientHeight;
    camera.aspect = w / h; applyFov();
    if (isTall() !== wasTall) { wasTall = isTall(); if (!moved && current) setView(current, true); }   // the phone was turned
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
    post.composer.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  resize();

  // --- UI
  if (params.get('ui') === '0') document.body.classList.add('noui');
  $('#b-view').addEventListener('click', () => { viewIndex = (viewIndex + 1) % VIEW_ORDER.length; setView(VIEW_ORDER[viewIndex]); });
  $('#b-help').addEventListener('click', () => $('#help').classList.add('on'));
  $('#help').addEventListener('click', () => $('#help').classList.remove('on'));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'v' || e.key === 'V') $('#b-view').click();
    if (e.key === 'h' || e.key === 'H') $('#help').classList.toggle('on');
    if (e.key === 'u' || e.key === 'U') document.body.classList.toggle('noui');
    if (e.key === 'm' || e.key === 'M') audio.toggle();
    if (e.key === 'Escape') $('#help').classList.remove('on');
  });
  canvas.addEventListener('pointerdown', () => { tween = null; canvas.classList.add('grabbing'); });
  controls.addEventListener('start', () => { moved = true; });
  for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, () => canvas.classList.remove('grabbing'));
  // hands on the food; the hint bows out once it has been understood
  let used = 0;
  const hideHint = () => $('#hint').classList.add('hide');
  const hands = setupInteraction({ renderer, camera, controls, food, coals, fire, grill, onUse(what) {
    if (what === 'stoke') audio.stoke(); else if (++used >= 2) hideHint();
  } });
  setTimeout(hideHint, 40000);

  // a lost graphics context (a backgrounded phone tab, a driver reset) takes every baked texture with it: start afresh
  const state = { time: 0, dt: 0, paused: false, timeScale: 1, frame: 0, lost: false };
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); state.lost = true;
    $('#loadmsg').textContent = 'The graphics context was lost — tap to reload'; $('#loader').classList.remove('done');
    $('#loader').addEventListener('click', () => location.reload(), { once: true });
  });
  canvas.addEventListener('webglcontextrestored', () => {
    let n = 0;
    try { n = +(sessionStorage.getItem('bbq-restores') || 0); sessionStorage.setItem('bbq-restores', String(n + 1)); } catch (_) { /* storage may be blocked */ }
    if (n < 3) location.reload();
  });

  // --- frame loop
  let last = performance.now(), slow = 0, fast = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (state.lost) return;
    const raw = Math.min((now - last) / 1000, 0.1); last = now;
    const dt = state.paused ? 0 : raw * state.timeScale;
    state.dt = dt; state.time += dt; state.frame++;

    if (tween) {
      tween.t = Math.min(1, tween.t + raw / tween.dur);
      const k = tween.t * tween.t * (3 - 2 * tween.t);
      camera.position.lerpVectors(tween.p0, tween.pos, k);
      controls.target.lerpVectors(tween.t0, tween.tgt, k);
      baseFov = tween.f0 + (tween.fov - tween.f0) * k; applyFov();
      if (tween.t >= 1) tween = null;
    }
    controls.target.clamp(TGT_MIN, TGT_MAX);
    controls.update();
    if (camera.position.y < 0.12) camera.position.y = 0.12;
    if (post.dof) {   // lens-like: shallow up close, deep when you step back
      const fd = camera.position.distanceTo(controls.target);
      post.dof.bokehScale = THREE.MathUtils.clamp(3.6 / fd, 0.7, 2.4);
      post.dof.cocMaterial.focusRange = 0.5 + fd * fd * 1.1;
    }

    hands.update(raw);
    for (const s of systems) s.update(dt, state.time, state);
    audio.update();
    post.composer.render(raw);

    // drop or raise resolution to hold a smooth frame rate
    if (!SHOT && state.frame > 90) {
      if (raw > 1 / 38) { slow += raw; fast = 0; } else if (raw < 1 / 55) { fast += raw; slow = 0; }
      if (slow > 1.2 && dpr > 0.7) { dpr = Math.max(0.7, dpr * 0.85); slow = 0; resize(); }
      if (fast > 6 && dpr < Math.min(window.devicePixelRatio || 1, tier.maxDpr)) { dpr = Math.min(Math.min(window.devicePixelRatio || 1, tier.maxDpr), dpr * 1.12); fast = 0; resize(); }
    }
  }

  // warm up shaders, then reveal
  post.composer.render(0);
  await nextFrame();
  progress(1, 'Ready');
  requestAnimationFrame(frame);
  setTimeout(() => $('#loader').classList.add('done'), SHOT ? 0 : 350);

  window.__bbq = { THREE, renderer, scene, camera, controls, post, env, deck, grill, coals, fire, sparks, props, ware, utensils, food, hands, audio, layout, fireUniforms, tier, state, systems, noise3D, setView, VIEWS, ready: true };
}

start().catch((e) => {
  console.error(String((e && e.stack) || e));
  $('#loadmsg').textContent = 'Something went wrong starting the grill: ' + (e && e.message ? e.message : e);
});
