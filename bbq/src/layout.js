// Where things stand on the deck, and where food may be put down.
import { GRILL } from './grill.js';

// The table stands to the right of the kettle. `top` is measured from the model once it has loaded.
export const TABLE = { x: 0.987, z: 0, top: 0.799, hx: 0.567, hz: 0.353 };
// Butcher paper with the raw food (front), enamel tray for what comes off the grill (back).
export const PAPER = { x: 0.70, z: 0.185, hx: 0.235, hz: 0.15, get y() { return TABLE.top + 0.0008; } };
export const TRAY = { x: 0.705, z: -0.185, hx: 0.235, hz: 0.145, wall: 0.024, floor: 0.0034, rim: 0.019, get y() { return TABLE.top + this.floor; } };
// The right half of the table is set dressing: buns on a board, a lantern, a bottle and the tongs.
export const BOARD = { x: 1.215, z: 0.145, rot: -0.06 };
export const LANTERN = { x: 1.44, z: -0.235 };
export const BOTTLE = { x: 1.09, z: -0.262 };
export const TONGS = { x: 1.2, z: -0.085, rot: 0.09 };
export const FOOD_X1 = 0.95;                       // food stays on the left part of the table; the rest is props
export const GRATE_TOP = GRILL.grateY + GRILL.rodR;

const clamp = (v, a, b) => (a > b ? (a + b) / 2 : Math.min(b, Math.max(a, v)));   // too big to fit: centre it

// What is underneath (x, z)? -> { y, on } or null. Used while carrying something around.
export function surfaceAt(x, z) {
  if (Math.hypot(x, z) <= GRILL.rimR) return { y: GRATE_TOP, on: 'grate' };
  if (Math.abs(x - TABLE.x) <= TABLE.hx + 0.02 && Math.abs(z - TABLE.z) <= TABLE.hz + 0.02) {
    if (Math.abs(x - TRAY.x) <= TRAY.hx && Math.abs(z - TRAY.z) <= TRAY.hz) return { y: TRAY.y + TRAY.rim * 0.6, on: 'tray' };
    return { y: TABLE.top, on: 'table' };
  }
  return null;
}

// Nearest spot to (x, z) where a footprint of discs [{ dx, dz, r }] can lie flat.
// -> { x, z, y, on, dist } (dist = how far it had to move), or null when nothing is near enough.
export function settle(x, z, discs, reach = 0.17) {
  let ex = 0, ez = 0;
  for (const d of discs) { ex = Math.max(ex, Math.abs(d.dx) + d.r); ez = Math.max(ez, Math.abs(d.dz) + d.r); }
  const cands = [];
  // the cooking grate: every disc has to stay on the bars
  {
    const R = GRILL.grateR - 0.008, inside = (k) => discs.every((d) => Math.hypot(x * k + d.dx, z * k + d.dz) + d.r <= R);
    let k = 1;
    if (!inside(1)) { let a = 0, b = 1; for (let i = 0; i < 10; i++) { k = (a + b) / 2; if (inside(k)) a = k; else b = k; } k = a; }
    cands.push({ x: x * k, z: z * k, y: GRATE_TOP, on: 'grate' });
  }
  // inside the walls of the tray
  cands.push({
    x: clamp(x, TRAY.x - TRAY.hx + TRAY.wall + ex, TRAY.x + TRAY.hx - TRAY.wall - ex),
    z: clamp(z, TRAY.z - TRAY.hz + TRAY.wall + ez, TRAY.z + TRAY.hz - TRAY.wall - ez), y: TRAY.y, on: 'tray',
  });
  // the paper and the bare boards around it, in front of the tray
  {
    const tx = clamp(x, TABLE.x - TABLE.hx + 0.012 + ex, FOOD_X1 - ex);
    const tz = clamp(z, TRAY.z + TRAY.hz + 0.01 + ez, TABLE.z + TABLE.hz - 0.012 - ez);
    const onPaper = Math.abs(tx - PAPER.x) <= PAPER.hx && Math.abs(tz - PAPER.z) <= PAPER.hz;
    cands.push({ x: tx, z: tz, y: onPaper ? PAPER.y : TABLE.top, on: 'table' });
  }
  let best = null;
  for (const c of cands) { c.dist = Math.hypot(c.x - x, c.z - z); if (!best || c.dist < best.dist) best = c; }
  return best.dist <= reach ? best : null;
}
