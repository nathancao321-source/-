/** A static, world-anchored universe. Camera/node state never enters generation. */
export interface CosmicBackground {
  texture: HTMLCanvasElement;
  pixels: ImageData;
  stars: ReadonlyArray<{
    x: number;
    y: number;
    radius: number;
    alpha: number;
    /** Normalized colour temperature: 0 = amber, 1 = blue-white. */
    temperature: number;
    phase: number;
  }>;
  /** Extent in world units; texture and pixels use their own pixel dimensions. */
  width: number;
  height: number;
  mode: 'web' | 'deep';
}

type Star = CosmicBackground['stars'][number];
const TAU = Math.PI * 2;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Separate deterministic streams keep colour/grain changes from moving stars. */
function randomStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let v = Math.imul(state ^ (state >>> 15), 1 | state);
    v ^= v + Math.imul(v ^ (v >>> 7), 61 | v);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded 2D simplex noise with no allocations or trig in its hot path. */
function makeNoise(seed: number): (x: number, y: number) => number {
  const random = randomStream(seed);
  const permutation = new Uint8Array(512);
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i++) source[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const value = source[i];
    source[i] = source[j];
    source[j] = value;
  }
  for (let i = 0; i < 512; i++) permutation[i] = source[i & 255];
  const gx = new Int8Array([1, -1, 1, -1, 1, -1, 0, 0]);
  const gy = new Int8Array([1, 1, -1, -1, 0, 0, 1, -1]);
  const f2 = 0.3660254037844386;
  const g2 = 0.21132486540518713;
  return (x: number, y: number): number => {
    const skew = (x + y) * f2;
    const i = Math.floor(x + skew);
    const j = Math.floor(y + skew);
    const unskew = (i + j) * g2;
    const x0 = x - i + unskew;
    const y0 = y - j + unskew;
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + g2;
    const y1 = y0 - j1 + g2;
    const x2 = x0 - 1 + 2 * g2;
    const y2 = y0 - 1 + 2 * g2;
    const ii = i & 255;
    const jj = j & 255;
    let sum = 0;
    let t = 0.5 - x0 * x0 - y0 * y0;
    if (t > 0) {
      const h = permutation[ii + permutation[jj]] & 7;
      t *= t;
      sum += t * t * (gx[h] * x0 + gy[h] * y0);
    }
    t = 0.5 - x1 * x1 - y1 * y1;
    if (t > 0) {
      const h = permutation[ii + i1 + permutation[jj + j1]] & 7;
      t *= t;
      sum += t * t * (gx[h] * x1 + gy[h] * y1);
    }
    t = 0.5 - x2 * x2 - y2 * y2;
    if (t > 0) {
      const h = permutation[ii + 1 + permutation[jj + 1]] & 7;
      t *= t;
      sum += t * t * (gx[h] * x2 + gy[h] * y2);
    }
    return 70 * sum;
  };
}

/** Fine photographic grain: a stable hash of texture/world sample position. */
function grainAt(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ seed, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function sampleField(field: Float32Array, width: number, height: number, u: number, v: number): number {
  const x = clamp01(u) * (width - 1);
  const y = clamp01(v) * (height - 1);
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const nx = Math.min(width - 1, ix + 1);
  const ny = Math.min(height - 1, iy + 1);
  const fx = x - ix;
  const fy = y - iy;
  const a = field[iy * width + ix] * (1 - fx) + field[iy * width + nx] * fx;
  const b = field[ny * width + ix] * (1 - fx) + field[ny * width + nx] * fx;
  return a * (1 - fy) + b * fy;
}

/** Bake very small distant galaxies, including a broken dust lane, into the same field. */
function addDistantGalaxies(
  pixels: ImageData, seed: number, mode: 'web' | 'deep', noise: (x: number, y: number) => number,
): void {
  const random = randomStream(seed ^ 0x5f18c349);
  const { width, height, data } = pixels;
  const count = mode === 'web' ? 10 : 4;
  const scale = Math.min(width / 1536, height / 960);
  for (let galaxy = 0; galaxy < count; galaxy++) {
    const cx = (0.07 + random() * 0.86) * width;
    const cy = (0.07 + random() * 0.86) * height;
    const angle = random() * TAU;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const major = (3.4 + random() * 5.8) * Math.max(0.65, scale);
    const minor = major * (0.18 + random() * 0.35);
    const luminosity = 17 + random() * 23;
    const warm = random();
    const extent = Math.ceil(major * 3);
    for (let y = Math.max(0, Math.floor(cy - extent)); y <= Math.min(height - 1, cy + extent); y++) {
      for (let x = Math.max(0, Math.floor(cx - extent)); x <= Math.min(width - 1, cx + extent); x++) {
        const dx = x - cx;
        const dy = y - cy;
        const a = (dx * ca + dy * sa) / major;
        const b = (-dx * sa + dy * ca) / minor;
        const r = Math.sqrt(a * a + b * b);
        const fleck = 0.78 + 0.22 * noise(a * 7 + galaxy * 31, b * 5);
        const lane = Math.exp(-Math.pow((b + 0.13 * noise(a * 3, galaxy * 19)) * 7, 2));
        const disc = Math.exp(-r * 2.0) * fleck * (1 - lane * 0.58);
        const core = Math.exp(-(dx * dx + dy * dy) / (major * minor * 0.06));
        const light = luminosity * (disc + core * 0.92);
        const p = (y * width + x) * 4;
        data[p] = Math.min(255, data[p] + light * (0.72 + warm * 0.24));
        data[p + 1] = Math.min(255, data[p + 1] + light * (0.77 + warm * 0.13));
        data[p + 2] = Math.min(255, data[p + 2] + light * (1 - warm * 0.16));
      }
    }
  }
}

/**
 * Generate once when a world/mode changes, never while dragging a node.
 * All positions and stellar radii are world units; `pixels` is the unmodified
 * source for a common inverse warp and `stars` for its corresponding forward warp.
 * Seed, world extent and mode completely determine the resulting image.
 */
export function createCosmicBackground(
  seed: number, worldWidth: number, worldHeight: number, mode: 'web' | 'deep',
): CosmicBackground {
  if (!Number.isFinite(worldWidth) || !Number.isFinite(worldHeight) || worldWidth <= 0 || worldHeight <= 0) {
    throw new RangeError('Cosmic background requires finite, positive world dimensions.');
  }
  const safeSeed = Number.isFinite(seed) ? seed | 0 : 0;
  const ratio = Math.min(1536 / worldWidth, 960 / worldHeight);
  const width = Math.max(2, Math.round(worldWidth * ratio));
  const height = Math.max(2, Math.round(worldHeight * ratio));
  const fieldWidth = Math.max(2, Math.ceil(width / 2));
  const fieldHeight = Math.max(2, Math.ceil(height / 2));
  const texture = document.createElement('canvas');
  texture.width = width;
  texture.height = height;
  const context = texture.getContext('2d', { alpha: false });
  if (!context) throw new Error('Cosmic background requires a Canvas 2D context.');
  const pixels = context.createImageData(width, height);
  const data = pixels.data;
  const noise = makeNoise(safeSeed ^ 0x157a6c2d);
  const density = new Float32Array(fieldWidth * fieldHeight);
  const colour = new Float32Array(fieldWidth * fieldHeight);
  const dustField = new Float32Array(fieldWidth * fieldHeight);
  const shortSide = Math.min(worldWidth, worldHeight);
  const extentX = worldWidth / shortSide * 4.6;
  const extentY = worldHeight / shortSide * 4.6;
  const deep = mode === 'deep';

  // Two nested warps bend noise contours into branching, torn filaments.
  // Independent extinction creates cold cavities instead of uniformly glowing fog.
  for (let y = 0; y < fieldHeight; y++) {
    const v = y / (fieldHeight - 1) * extentY;
    for (let x = 0; x < fieldWidth; x++) {
      const u = x / (fieldWidth - 1) * extentX;
      const qx = noise(u * 0.47 + 17.3, v * 0.47 - 11.1);
      const qy = noise(u * 0.47 - 8.7, v * 0.47 + 23.6);
      const wx = u + qx * 1.26 + noise(u * 1.08 + qy, v * 1.08 + 51.8) * 0.21;
      const wy = v + qy * 1.26 + noise(u * 1.08 - 13.8, v * 1.08 + qx) * 0.21;
      const large = noise(wx * 0.52 + 73.4, wy * 0.52 - 19.2);
      const middle = noise(wx * 1.64 - 35.9, wy * 1.64 + 82.1);
      const fine = noise(wx * 5.2 + middle * 0.24, wy * 5.2 - 16.1);
      const granular = noise(wx * 13.7 + 61.1, wy * 13.7 - 4.3);
      const powder = noise(wx * 31.4 - 9.7, wy * 31.4 + 23.8);
      const ridgeA = Math.pow(Math.max(0, 1 - Math.abs(noise(wx * 0.93 + 7.4, wy * 0.93))), 7);
      const ridgeB = Math.pow(Math.max(0, 1 - Math.abs(noise(wx * 2.13 + middle * 0.38, wy * 2.13 - 41.5))), 11);
      const ridgeC = Math.pow(Math.max(0, 1 - Math.abs(fine)), 15);
      const regions = smooth(-0.42, 0.63, large * 0.78 + middle * 0.26);
      const torn = smooth(-0.68, 0.47, fine * 0.59 + granular * 0.31 + powder * 0.14 + 0.1);
      const extinction = smooth(-0.04, 0.69, noise(wx * 2.75 + 92.7, wy * 2.75 - 38.3) * 0.72 + middle * 0.35);
      const mist = smooth(-0.5, 0.8, large + middle * 0.32) * (0.10 + torn * 0.085);
      const branches = ridgeA * 0.50 + ridgeB * (0.14 + ridgeA * 0.3) + ridgeC * 0.075;
      const luminous = (mist + branches * (0.23 + regions * 1.05) * (0.27 + torn * 0.73)) * (1 - extinction * 0.88);
      const isolation = deep ? 0.035 + smooth(0.12, 0.75, large) * 0.25 : 1;
      const i = y * fieldWidth + x;
      density[i] = clamp01(luminous * isolation);
      colour[i] = clamp01(0.47 + noise(wx * 0.64 + 46, wy * 0.64 - 67) * 0.5 + middle * 0.15);
      dustField[i] = extinction;
    }
  }

  // Bilinear upsampling retains the fine fibre structure; deterministic grain
  // breaks colour banding without any frame-to-frame shimmer.
  for (let y = 0; y < height; y++) {
    const fy = y / (height - 1) * (fieldHeight - 1);
    const iy = Math.floor(fy);
    const ny = Math.min(fieldHeight - 1, iy + 1);
    const ty = fy - iy;
    for (let x = 0; x < width; x++) {
      const fx = x / (width - 1) * (fieldWidth - 1);
      const ix = Math.floor(fx);
      const nx = Math.min(fieldWidth - 1, ix + 1);
      const tx = fx - ix;
      const a = iy * fieldWidth + ix;
      const b = iy * fieldWidth + nx;
      const c = ny * fieldWidth + ix;
      const d = ny * fieldWidth + nx;
      const wa = (1 - tx) * (1 - ty);
      const wb = tx * (1 - ty);
      const wc = (1 - tx) * ty;
      const wd = tx * ty;
      const den = density[a] * wa + density[b] * wb + density[c] * wc + density[d] * wd;
      const tint = colour[a] * wa + colour[b] * wb + colour[c] * wc + colour[d] * wd;
      const dust = dustField[a] * wa + dustField[b] * wb + dustField[c] * wc + dustField[d] * wd;
      const grain = grainAt(x, y, safeSeed);
      const micro = (grain - 0.5) * (0.9 + den * 3.8);
      const light = Math.pow(den, 0.84);
      const purple = smooth(0.37, 0.94, tint);
      const cold = 1 - purple;
      const floor = 1 - dust * 0.24;
      const p = (y * width + x) * 4;
      data[p] = 2.1 * floor + light * (20 + purple * 33) + micro;
      data[p + 1] = 3.8 * floor + light * (32 + cold * 10) + micro;
      data[p + 2] = 8.1 * floor + light * (68 + cold * 19) + micro * 1.3;
      data[p + 3] = 255;
    }
  }

  // Unresolved stellar dust is dim enough to read as texture. Major stars stay
  // separate so the renderer can displace them using the same physical field.
  const dustRandom = randomStream(safeSeed ^ 0x31a6b8d9);
  const dustCount = Math.round((deep ? 350 : 3800) * width * height / (1536 * 960));
  for (let i = 0; i < dustCount; i++) {
    const u = dustRandom();
    const v = dustRandom();
    const den = sampleField(density, fieldWidth, fieldHeight, u, v);
    if (dustRandom() > 0.14 + den * 2.4) continue;
    const x = Math.min(width - 1, Math.floor(u * width));
    const y = Math.min(height - 1, Math.floor(v * height));
    const brightness = 5 + dustRandom() * 17;
    const p = (y * width + x) * 4;
    data[p] += brightness * 0.57;
    data[p + 1] += brightness * 0.73;
    data[p + 2] += brightness;
  }
  addDistantGalaxies(pixels, safeSeed, mode, noise);
  context.putImageData(pixels, 0, 0);

  const stars: Star[] = [];
  const random = randomStream(safeSeed ^ 0x72b9e5a1);
  const worldPerPixel = worldWidth / width;
  const candidates = Math.round((deep ? 1500 : 7600) * width * height / (1536 * 960));
  for (let i = 0; i < candidates; i++) {
    const u = random();
    const v = random();
    const den = sampleField(density, fieldWidth, fieldHeight, u, v);
    const extinction = sampleField(dustField, fieldWidth, fieldHeight, u, v);
    const probability = (deep ? 0.27 : 0.17 + den * 1.62) * (1 - extinction * 0.48);
    if (random() > probability) continue;
    const brilliance = Math.pow(random(), 5);
    const giant = random() > 0.995;
    stars.push({
      x: u * worldWidth,
      y: v * worldHeight,
      radius: (0.27 + brilliance * 0.61 + (giant ? 0.46 : 0)) * worldPerPixel,
      alpha: Math.min(0.94, 0.15 + brilliance * 0.72 + (giant ? 0.13 : 0)),
      temperature: random() < 0.15 ? random() * 0.29 : 0.48 + random() * 0.52,
      phase: random() * TAU,
    });
  }
  return { texture, pixels, stars, width: worldWidth, height: worldHeight, mode };
}
