// Shared procedural building blocks: seeded RNG, a tileable 3D noise volume
// (used by the fire, coals and food shaders) and 2D noise fields for canvas textures.
import * as THREE from 'three';

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// One octave of tileable Perlin noise added into `out` (N^3 floats), lattice period P.
function perlin3(N, P, rnd, out, amp) {
  const g = new Float32Array(P * P * P * 3);
  for (let i = 0; i < P * P * P; i++) {
    const u = rnd() * 2 - 1, a = rnd() * 6.2831853, s = Math.sqrt(1 - u * u);
    g[i * 3] = s * Math.cos(a); g[i * 3 + 1] = s * Math.sin(a); g[i * 3 + 2] = u;
  }
  const d = (ix, iy, iz, dx, dy, dz) => { const k = ((iz * P + iy) * P + ix) * 3; return g[k] * dx + g[k + 1] * dy + g[k + 2] * dz; };
  const inv = P / N;
  let o = 0;
  for (let z = 0; z < N; z++) {
    const pz = z * inv, z0 = pz | 0, fz = pz - z0, z1 = (z0 + 1) % P, wz = fade(fz);
    for (let y = 0; y < N; y++) {
      const py = y * inv, y0 = py | 0, fy = py - y0, y1 = (y0 + 1) % P, wy = fade(fy);
      for (let x = 0; x < N; x++, o++) {
        const px = x * inv, x0 = px | 0, fx = px - x0, x1 = (x0 + 1) % P, wx = fade(fx);
        const a = d(x0, y0, z0, fx, fy, fz), b = d(x1, y0, z0, fx - 1, fy, fz);
        const c = d(x0, y1, z0, fx, fy - 1, fz), e = d(x1, y1, z0, fx - 1, fy - 1, fz);
        const f = d(x0, y0, z1, fx, fy, fz - 1), h = d(x1, y0, z1, fx - 1, fy, fz - 1);
        const i = d(x0, y1, z1, fx, fy - 1, fz - 1), j = d(x1, y1, z1, fx - 1, fy - 1, fz - 1);
        const ab = a + (b - a) * wx, ce = c + (e - c) * wx, fh = f + (h - f) * wx, ij = i + (j - i) * wx;
        const lo = ab + (ce - ab) * wy, hi = fh + (ij - fh) * wy;
        out[o] += (lo + (hi - lo) * wz) * amp;
      }
    }
  }
}

function normalize01(f) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < f.length; i++) { if (f[i] < mn) mn = f[i]; if (f[i] > mx) mx = f[i]; }
  const k = 1 / (mx - mn || 1);
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - mn) * k;
  return f;
}

// RGBA volume: R = soft fBm, G = finer fBm, B = ridged R, A = ridged G. Tiles in all axes.
export function makeNoise3D(N = 64, seed = 11) {
  const rnd = rng(seed);
  const a = new Float32Array(N * N * N), b = new Float32Array(N * N * N);
  perlin3(N, 4, rnd, a, 1); perlin3(N, 8, rnd, a, 0.5); perlin3(N, 16, rnd, a, 0.25);
  perlin3(N, 8, rnd, b, 1); perlin3(N, 16, rnd, b, 0.5); perlin3(N, 32, rnd, b, 0.25);
  normalize01(a); normalize01(b);
  const data = new Uint8Array(N * N * N * 4);
  for (let i = 0, o = 0; i < a.length; i++, o += 4) {
    data[o] = a[i] * 255; data[o + 1] = b[i] * 255;
    data[o + 2] = (1 - Math.abs(a[i] * 2 - 1)) * 255; data[o + 3] = (1 - Math.abs(b[i] * 2 - 1)) * 255;
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.generateMipmaps = true; tex.unpackAlignment = 1; tex.needsUpdate = true;
  return tex;
}

// Tileable 2D fBm field in [0,1] (Float32Array size*size).
export function fbm2(size, period, octaves, seed, gain = 0.5) {
  const rnd = rng(seed), out = new Float32Array(size * size);
  let amp = 1;
  for (let oc = 0, P = period; oc < octaves && P <= size; oc++, P *= 2, amp *= gain) {
    const g = new Float32Array(P * P * 2);
    for (let i = 0; i < P * P; i++) { const a = rnd() * 6.2831853; g[i * 2] = Math.cos(a); g[i * 2 + 1] = Math.sin(a); }
    const d = (ix, iy, dx, dy) => { const k = (iy * P + ix) * 2; return g[k] * dx + g[k + 1] * dy; };
    const inv = P / size;
    let o = 0;
    for (let y = 0; y < size; y++) {
      const py = y * inv, y0 = py | 0, fy = py - y0, y1 = (y0 + 1) % P, wy = fade(fy);
      for (let x = 0; x < size; x++, o++) {
        const px = x * inv, x0 = px | 0, fx = px - x0, x1 = (x0 + 1) % P, wx = fade(fx);
        const a = d(x0, y0, fx, fy), b = d(x1, y0, fx - 1, fy), c = d(x0, y1, fx, fy - 1), e = d(x1, y1, fx - 1, fy - 1);
        const ab = a + (b - a) * wx, ce = c + (e - c) * wx;
        out[o] += (ab + (ce - ab) * wy) * amp;
      }
    }
  }
  return normalize01(out);
}

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return c;
}

// Paint a canvas per pixel: fn(x, y, i) -> [r, g, b, a] in 0..255 (a optional).
export function paint(canvas, fn) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0, i = 0, o = 0; y < h; y++) for (let x = 0; x < w; x++, i++, o += 4) {
    const c = fn(x, y, i);
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c.length > 3 ? c[3] : 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Tangent-space normal map from a tileable height field.
export function normalCanvas(height, size, strength = 2) {
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  return paint(makeCanvas(size), (x, y) => {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = 1 / Math.hypot(dx, dy, 1);
    return [(-dx * l * 0.5 + 0.5) * 255, (dy * l * 0.5 + 0.5) * 255, (l * 0.5 + 0.5) * 255];
  });
}

export function canvasTexture(canvas, { srgb = false, repeat = null, aniso = 4, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  return t;
}

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
