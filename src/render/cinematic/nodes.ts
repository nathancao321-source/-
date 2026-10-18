/**
 * THE LAST ARK · soft, organic energy nodes.
 * All dimensions are world units. `time` / `dt` are seconds. No RAF, listeners,
 * external assets, or changes to the caller's transform are required.
 */
export interface EnergyNode {
  id: string;
  kind: 'attractor' | 'repulsor';
  x: number;
  y: number;
  radius: number;
  fieldRadius: number;
  strength: number;
  active: boolean;
  vx: number;
  vy: number;
}

interface NodeDrawOptions {
  glow: number;
  particles: number;
  quality: 'high' | 'medium' | 'low';
  effects: boolean;
}

type Surface = HTMLCanvasElement | OffscreenCanvas;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Kind = EnergyNode['kind'];
type Quality = NodeDrawOptions['quality'];

interface Mote {
  angle: number;
  offset: number;
  period: number;
  reach: number;
  size: number;
  flicker: number;
}

interface NodeState {
  activity: number;
  clock: number;
  lastTime: number;
  motes: Mote[];
  offset: number;
}

interface CloudAtlas {
  size: number;
  frames: Array<Surface | undefined>;
  noise: Float32Array;
}

interface Palette {
  mist: [number, number, number];
  light: [number, number, number];
  nucleus: string;
  tint: string;
}

const TAU = Math.PI * 2;
const NOISE_SIZE = 128;
const FRAME_COUNT = 32;
const CLOUD_SECONDS = 7.5;
const PALETTES: Record<Kind, Palette> = {
  attractor: { mist: [37, 109, 165], light: [125, 225, 251], nucleus: '#eefcff', tint: '94,205,245' },
  repulsor: { mist: [163, 88, 40], light: [255, 208, 126], nucleus: '#fff8e7', tint: '249,188,99' },
};

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const fract = (value: number): number => value - Math.floor(value);
const smoothstep = (low: number, high: number, value: number): number => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};

function hash(value: number): number {
  let n = value | 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function hashId(id: string, seed: number): number {
  let n = seed | 0;
  for (let i = 0; i < id.length; i += 1) n = Math.imul(n ^ id.charCodeAt(i), 16777619);
  return n;
}

function makeSurface(size: number): Surface | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/** Periodic value noise is generated once; animated frames only sample it. */
function makeNoise(seed: number): Float32Array {
  const field = new Float32Array(NOISE_SIZE * NOISE_SIZE);
  const periods = [32, 16, 8, 4, 2];
  const weights = [0.45, 0.27, 0.15, 0.085, 0.045];
  for (let octave = 0; octave < periods.length; octave += 1) {
    const period = periods[octave];
    const cells = NOISE_SIZE / period;
    const lattice = new Float32Array(cells * cells);
    const interpolation = new Float32Array(period);
    for (let i = 0; i < period; i += 1) interpolation[i] = smoothstep(0, 1, i / period);
    for (let y = 0; y < cells; y += 1) {
      for (let x = 0; x < cells; x += 1) {
        lattice[y * cells + x] = hash(seed + x * 374761393 + y * 668265263 + octave * 1013904223);
      }
    }
    for (let y = 0; y < NOISE_SIZE; y += 1) {
      const iy = Math.floor(y / period);
      const row = iy * cells;
      const nextRow = ((iy + 1) % cells) * cells;
      const fy = interpolation[y % period];
      for (let x = 0; x < NOISE_SIZE; x += 1) {
        const ix = Math.floor(x / period);
        const nx = (ix + 1) % cells;
        const fx = interpolation[x % period];
        const a = lattice[row + ix];
        const b = lattice[row + nx];
        const c = lattice[nextRow + ix];
        const d = lattice[nextRow + nx];
        field[y * NOISE_SIZE + x] += ((a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy) * weights[octave];
      }
    }
  }
  return field;
}

function noiseAt(field: Float32Array, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const x0 = ix & 127;
  const x1 = (ix + 1) & 127;
  const y0 = (iy & 127) * NOISE_SIZE;
  const y1 = ((iy + 1) & 127) * NOISE_SIZE;
  const a = field[y0 + x0] + (field[y0 + x1] - field[y0 + x0]) * fx;
  const b = field[y1 + x0] + (field[y1 + x1] - field[y1 + x0]) * fx;
  return a + (b - a) * fy;
}

/**
 * Two overlapping radial advection cycles have zero weight at their reset.
 * They compress blue clouds and expand amber clouds without rotating a sprite,
 * creating arms, exposing a loop seam, or reversing the direction of flow.
 */
function makeCloudFrame(atlas: CloudAtlas, kind: Kind, index: number): Surface | undefined {
  const surface = makeSurface(atlas.size);
  if (!surface) return undefined;
  const context = surface.getContext('2d') as Context2D | null;
  if (!context) return undefined;
  const image = context.createImageData(atlas.size, atlas.size);
  const pixels = image.data;
  const phaseA = index / FRAME_COUNT;
  const phaseB = fract(phaseA + 0.5);
  const weightA = Math.sin(Math.PI * phaseA) ** 2;
  const weightB = 1 - weightA;
  const direction = kind === 'attractor' ? 1 : -1;
  const scaleA = Math.exp(direction * (phaseA - 0.5) * 1.05);
  const scaleB = Math.exp(direction * (phaseB - 0.5) * 1.05);
  const palette = PALETTES[kind];
  const light = palette.light;
  const mist = palette.mist;
  const half = atlas.size / 2;
  const field = atlas.noise;
  // Cartesian domain warping produces small, irregular billows, never spokes.
  const density = (x: number, y: number, scale: number, phase: number): [number, number] => {
    const u = x * 39 * scale + 61;
    const v = y * 39 * scale + 57;
    const warp = (noiseAt(field, u * 0.72 + 24, v * 0.72 + 37) - 0.5) * 11;
    const cloud = noiseAt(field, u + warp + phase * 3.8, v - warp * 0.58 + phase * 2.3);
    const detail = noiseAt(field, u * 2.7 + warp * 0.6 + 14, v * 2.7 + phase * 5.2);
    return [cloud, detail];
  };
  for (let py = 0; py < atlas.size; py += 1) {
    const y = (py + 0.5 - half) / half;
    for (let px = 0; px < atlas.size; px += 1) {
      const x = (px + 0.5 - half) / half;
      const rr = x * x + y * y;
      if (rr >= 1) continue;
      const radius = Math.sqrt(rr);
      const a = density(x, y, scaleA, phaseA);
      const b = density(x, y, scaleB, phaseB);
      const cloud = a[0] * weightA + b[0] * weightB;
      const detail = a[1] * weightA + b[1] * weightB;
      const billow = smoothstep(0.25, 0.76, cloud);
      const thread = Math.pow(clamp(1 - Math.abs(detail - 0.51) * 7.6, 0, 1), 3);
      const edge = 1 - smoothstep(0.68, 1, radius);
      const inner = Math.exp(-rr * 31);
      const body = Math.exp(-rr * 5.4) * billow;
      const gauze = Math.exp(-rr * 3.5) * Math.max(0, cloud - 0.36);
      const alpha = edge * (body * 0.71 + inner * (0.13 + thread * 0.25) + gauze * 0.22);
      const illumination = clamp(0.12 + billow * 0.43 + inner * 0.37 + thread * inner * 0.2, 0, 1);
      const at = (py * atlas.size + px) * 4;
      pixels[at] = mist[0] + (light[0] - mist[0]) * illumination;
      pixels[at + 1] = mist[1] + (light[1] - mist[1]) * illumination;
      pixels[at + 2] = mist[2] + (light[2] - mist[2]) * illumination;
      pixels[at + 3] = clamp(alpha * 255, 0, 220);
    }
  }
  context.putImageData(image, 0, 0);
  return surface;
}

function createMotes(seed: number): Mote[] {
  return Array.from({ length: 72 }, (_, i) => {
    const n = seed + i * 92837111;
    return {
      angle: hash(n + 3) * TAU,
      offset: hash(n + 19),
      period: 4.1 + hash(n + 31) * 5.3,
      reach: 0.66 + hash(n + 47) * 0.34,
      size: 0.43 + hash(n + 61) * 0.91,
      flicker: hash(n + 79) * TAU,
    };
  });
}

function drawNucleus(ctx: CanvasRenderingContext2D, radius: number, palette: Palette, activity: number, time: number, glow: number, effects: boolean): void {
  const breath = 1 + Math.sin(time * 1.45) * 0.035 + Math.sin(time * 0.59) * 0.02;
  const core = radius * 0.28 * breath;
  if (effects && glow > 0) {
    const light = ctx.createRadialGradient(0, 0, core * 0.35, 0, 0, radius * 1.2);
    light.addColorStop(0, `rgba(${palette.tint},${0.36 * glow})`);
    light.addColorStop(0.24, `rgba(${palette.tint},${0.15 * glow})`);
    light.addColorStop(0.66, `rgba(${palette.tint},${0.045 * glow})`);
    light.addColorStop(1, `rgba(${palette.tint},0)`);
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.2, 0, TAU);
    ctx.fill();
  }
  const coreFill = ctx.createRadialGradient(-core * 0.16, -core * 0.2, 0, 0, 0, core);
  coreFill.addColorStop(0, palette.nucleus);
  coreFill.addColorStop(0.42, palette.nucleus);
  coreFill.addColorStop(0.78, `rgba(${palette.tint},0.98)`);
  coreFill.addColorStop(1, `rgba(${palette.tint},0.5)`);
  ctx.fillStyle = coreFill;
  ctx.beginPath();
  ctx.arc(0, 0, core, 0, TAU);
  ctx.fill();
  // A very faint closed rim protects readability without a hard neon outline.
  ctx.strokeStyle = `rgba(${palette.tint},${0.12 + activity * 0.08})`;
  ctx.lineWidth = Math.max(0.55, radius * 0.032);
  ctx.beginPath();
  ctx.arc(0, 0, core * 1.63, 0, TAU);
  ctx.stroke();
}

export function createEnergyNodeRenderer(seed = 1701): {
  draw(ctx: CanvasRenderingContext2D, node: EnergyNode, time: number, dt: number, options: NodeDrawOptions): void;
  reset(): void;
  dispose(): void;
} {
  const states = new Map<string, NodeState>();
  const atlases = new Map<string, CloudAtlas>();
  let disposed = false;

  function getAtlas(kind: Kind, quality: Quality): CloudAtlas {
    const key = `${kind}:${quality}`;
    let atlas = atlases.get(key);
    if (!atlas) {
      atlas = {
        size: quality === 'high' ? 128 : quality === 'medium' ? 96 : 64,
        frames: new Array<Surface | undefined>(FRAME_COUNT),
        noise: makeNoise(seed ^ (kind === 'attractor' ? 0x173cd9 : 0x75bd21)),
      };
      atlases.set(key, atlas);
    }
    return atlas;
  }

  function getState(node: EnergyNode, time: number, dt: number): NodeState {
    let state = states.get(node.id);
    if (!state) {
      const nodeSeed = hashId(node.id, seed);
      state = {
        activity: node.active ? 1 : 0,
        clock: time * (node.active ? 1.1 : 0.4),
        lastTime: time,
        motes: createMotes(nodeSeed),
        offset: hash(nodeSeed + 113) * CLOUD_SECONDS,
      };
      states.set(node.id, state);
      // Bounded state for games which continuously spawn uniquely named nodes.
      if (states.size > 128) {
        const oldest = states.keys().next().value as string | undefined;
        if (oldest !== undefined && oldest !== node.id) states.delete(oldest);
      }
    } else {
      const elapsed = time - state.lastTime;
      if (elapsed < 0) {
        state.clock = time * (node.active ? 1.1 : 0.4);
        state.activity = node.active ? 1 : 0;
      } else if (elapsed > 0) {
        const step = Math.min(elapsed, Number.isFinite(dt) && dt > 0 ? Math.max(dt, 1 / 120) : 0.1, 0.12);
        state.activity += ((node.active ? 1 : 0) - state.activity) * (1 - Math.exp(-step * 5));
        state.clock += step * (0.4 + state.activity * 0.7);
      }
      state.lastTime = time;
    }
    return state;
  }

  function draw(ctx: CanvasRenderingContext2D, node: EnergyNode, time: number, dt: number, options: NodeDrawOptions): void {
    if (disposed || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.radius) || node.radius <= 0) return;
    const t = Number.isFinite(time) ? time : 0;
    const radius = node.radius;
    const glow = Number.isFinite(options.glow) ? clamp(options.glow, 0, 2) : 1;
    const particleDensity = Number.isFinite(options.particles) ? clamp(options.particles, 0, 2) : 1;
    const palette = PALETTES[node.kind];
    const state = getState(node, t, dt);
    const activity = state.activity;
    const cloudRadius = radius * (3.23 + activity * 0.23);
    const pulse = 1 + Math.sin(t * 0.73 + state.offset) * 0.027;
    ctx.save();
    try {
      ctx.translate(node.x, node.y);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      if (!options.effects) {
        drawNucleus(ctx, radius, palette, activity, t, 0, false);
        return;
      }

      if (glow > 0) {
        const auraRadius = cloudRadius * 1.17;
        const aura = ctx.createRadialGradient(0, 0, radius * 0.21, 0, 0, auraRadius);
        aura.addColorStop(0, `rgba(${palette.tint},${0.085 * glow})`);
        aura.addColorStop(0.34, `rgba(${palette.tint},${0.032 * glow})`);
        aura.addColorStop(0.73, `rgba(${palette.tint},${0.008 * glow})`);
        aura.addColorStop(1, `rgba(${palette.tint},0)`);
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(0, 0, auraRadius, 0, TAU);
        ctx.fill();
      }

      const atlas = getAtlas(node.kind, options.quality);
      const frame = fract((state.clock + state.offset) / CLOUD_SECONDS) * FRAME_COUNT;
      const index = Math.floor(frame);
      const nextIndex = (index + 1) % FRAME_COUNT;
      const blend = frame - index;
      atlas.frames[index] ??= makeCloudFrame(atlas, node.kind, index);
      atlas.frames[nextIndex] ??= makeCloudFrame(atlas, node.kind, nextIndex);
      const cloudSize = cloudRadius * pulse;
      const opacity = clamp((0.86 + activity * 0.19) * (0.77 + glow * 0.23), 0, 1);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = options.quality === 'low' ? 'low' : 'high';
      ctx.globalCompositeOperation = 'screen';
      const first = atlas.frames[index];
      const second = atlas.frames[nextIndex];
      if (first) {
        ctx.globalAlpha = opacity * (1 - blend);
        ctx.drawImage(first, -cloudSize, -cloudSize, cloudSize * 2, cloudSize * 2);
      }
      if (second) {
        ctx.globalAlpha = opacity * blend;
        ctx.drawImage(second, -cloudSize, -cloudSize, cloudSize * 2, cloudSize * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      const budget = options.quality === 'high' ? 36 : options.quality === 'medium' ? 25 : 14;
      const count = Math.min(state.motes.length, Math.ceil(budget * particleDensity));
      const reach = Math.min(radius * 7.2, Number.isFinite(node.fieldRadius) && node.fieldRadius > 0 ? node.fieldRadius * 0.45 : radius * 7.2);
      const near = radius * 0.33;
      const strength = Number.isFinite(node.strength) ? clamp(Math.abs(node.strength), 0.65, 1.35) : 1;
      ctx.lineCap = 'round';
      for (let i = 0; i < count; i += 1) {
        const mote = state.motes[i];
        const progress = fract(state.clock / mote.period + mote.offset);
        const travel = node.kind === 'attractor' ? Math.pow(1 - progress, 0.67) : Math.pow(progress, 0.84);
        const distance = near + Math.max(0, reach * mote.reach - near) * travel;
        const angle = mote.angle + Math.sin(t * 0.39 + mote.flicker) * 0.025;
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance;
        const envelope = smoothstep(0, 0.13, progress) * (1 - smoothstep(0.76, 1, progress));
        const shimmer = 0.79 + Math.sin(t * 1.7 + mote.flicker) * 0.12;
        const alpha = envelope * shimmer * (0.19 + activity * 0.43) * strength;
        if (alpha < 0.012) continue;
        const size = mote.size * (radius / 18) * (0.81 + activity * 0.19);
        // World-local positions are recomputed each frame. Moving the node can
        // never smear a particle trail through its previous world location.
        if (options.quality !== 'low' && activity > 0.2 && i % 3 === 0) {
          const tail = (1.2 + activity * 2.7) * (radius / 18);
          const sign = node.kind === 'attractor' ? 1 : -1;
          ctx.strokeStyle = `rgba(${palette.tint},${alpha * 0.24})`;
          ctx.lineWidth = Math.max(0.4, size * 0.74);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(angle) * tail * sign, y + Math.sin(angle) * tail * sign);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(${palette.tint},${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
        if (options.quality === 'high' && i % 7 === 0 && glow > 0) {
          ctx.fillStyle = `rgba(${palette.tint},${alpha * 0.09 * glow})`;
          ctx.beginPath();
          ctx.arc(x, y, size * 2.9, 0, TAU);
          ctx.fill();
        }
      }
      drawNucleus(ctx, radius, palette, activity, t + state.offset, glow, true);
    } finally {
      ctx.restore();
    }
  }

  function reset(): void {
    states.clear();
  }

  function dispose(): void {
    states.clear();
    for (const atlas of atlases.values()) {
      for (const frame of atlas.frames) {
        if (frame) {
          frame.width = 0;
          frame.height = 0;
        }
      }
    }
    atlases.clear();
    disposed = true;
  }

  return { draw, reset, dispose };
}
