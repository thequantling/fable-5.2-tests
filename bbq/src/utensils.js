// Set dressing made by hand: an open bottle of beer and a pair of stainless tongs.
import * as THREE from 'three';
import { TABLE, BOTTLE, TONGS } from './layout.js';
import { makeCanvas, canvasTexture } from './noise.js';

function buildBottle() {
  const g = new THREE.Group();
  // outline of a longneck, bottom to top: [radius, height]
  const prof = [[0, 0.004], [0.02, 0.0018], [0.0285, 0], [0.0305, 0.004], [0.0305, 0.118], [0.0298, 0.128], [0.0272, 0.142],
    [0.0218, 0.156], [0.0168, 0.168], [0.014, 0.18], [0.0129, 0.2], [0.0127, 0.217], [0.0139, 0.2195], [0.0139, 0.227], [0.0129, 0.2283], [0.0104, 0.2283], [0.0098, 0.222]];
  const glass = new THREE.Mesh(
    new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 40),
    new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.05, 0.016, 0.002), roughness: 0.05, metalness: 0, transparent: true, opacity: 0.84,
      clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.8, side: THREE.DoubleSide }));
  glass.castShadow = true; glass.renderOrder = 2;
  // what is left of the beer, seen through the glass
  const beer = new THREE.Mesh(
    new THREE.LatheGeometry([[0, 0.006], [0.0282, 0.006], [0.0282, 0.092], [0, 0.092]].map(([r, y]) => new THREE.Vector2(r, y)), 28),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0.075, 0.026, 0.003), roughness: 0.25, emissive: new THREE.Color(0.012, 0.004, 0.0004) }));

  // a paper label: no brand, just a border and a hop-coloured crest
  const c = makeCanvas(512, 256), x = c.getContext('2d');
  x.fillStyle = '#e7dcc0'; x.fillRect(0, 0, 512, 256);
  x.fillStyle = '#7a2218'; x.fillRect(0, 14, 512, 12); x.fillRect(0, 230, 512, 12);
  x.strokeStyle = '#2f3b22'; x.lineWidth = 5;
  for (const cx of [128, 384]) {
    x.beginPath(); x.ellipse(cx, 128, 62, 78, 0, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#2f3b22'; x.beginPath(); x.moveTo(cx, 70); x.lineTo(cx + 34, 128); x.lineTo(cx, 186); x.lineTo(cx - 34, 128); x.closePath(); x.fill();
    x.fillStyle = '#e7dcc0'; x.beginPath(); x.arc(cx, 128, 12, 0, Math.PI * 2); x.fill();
  }
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0308, 0.0308, 0.062, 40, 1, true),
    new THREE.MeshStandardMaterial({ map: canvasTexture(c, { srgb: true, wrap: false }), roughness: 0.7, metalness: 0 }));
  label.position.y = 0.074; label.rotation.y = 2.2; label.renderOrder = 3;
  g.add(beer, glass, label);
  g.position.set(BOTTLE.x, TABLE.top, BOTTLE.z);
  return g;
}

// One arm of the tongs: a pressed steel channel, lying along x with its gripping end at -x.
function armGeometry(L, up) {
  const geo = new THREE.BoxGeometry(L, 0.0013, 1, 40, 1, 6), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / L + 0.5, zz = p.getZ(i) * 2;                          // u: 0 at the tip, 1 at the hinge; zz: -1..1 across
    const tip = 1 - THREE.MathUtils.smoothstep(u, 0, 0.2);
    let w = 0.0085 + 0.0055 * tip;                                              // the scalloped end is broader
    if (u < 0.012) w *= 0.86 + 0.14 * Math.abs(Math.sin(zz * Math.PI * 2.5));   // scallops along the edge of the tip
    const dish = (0.0026 + 0.003 * tip) * zz * zz;                              // pressed into a shallow channel for stiffness
    const curl = 0.006 * tip * tip;                                             // the tips curl in towards each other
    p.setZ(i, zz * w);
    p.setY(i, p.getY(i) + (dish + curl) * up);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildTongs() {
  const g = new THREE.Group(), L = 0.33;
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.78, 0.78, 0.77), metalness: 1, roughness: 0.3, envMapIntensity: 1.6 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.62, metalness: 0 });
  const arm = (up, angle) => {
    const a = new THREE.Group(), m = new THREE.Mesh(armGeometry(L, up), steel);
    m.position.x = -L / 2;                                                      // pivot at the hinge end
    const pad = new THREE.Mesh(new THREE.BoxGeometry(L * 0.4, 0.0046, 0.0196), grip);
    pad.position.set(-L * 0.27, 0.0016 * up, 0);
    a.add(m, pad);
    a.rotation.z = angle;
    a.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    return a;
  };
  const lower = arm(1, 0), upper = arm(-1, -0.2);
  upper.position.y = 0.0105;
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.0185, 14).rotateX(Math.PI / 2), steel);
  hinge.position.set(0.001, 0.0056, 0); hinge.castShadow = true;
  g.add(lower, upper, hinge);
  g.position.set(TONGS.x + L / 2, TABLE.top + 0.0009, TONGS.z);
  g.rotation.y = TONGS.rot;
  return g;
}

export function buildUtensils(scene) {
  const bottle = buildBottle(), tongs = buildTongs();
  scene.add(bottle, tongs);
  return { bottle, tongs };
}
