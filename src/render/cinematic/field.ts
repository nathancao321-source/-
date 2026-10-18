/** Pure world-space visual deformation. This module never changes physics. */
export type FieldKind = 'attractor' | 'repulsor';

export interface FieldSource {
  x: number;
  y: number;
  fieldRadius: number;
  /** Visual strength, normalized to 0..1.8 by the caller. */
  strength: number;
  active: boolean;
  kind: FieldKind;
}

export interface SpaceRipple {
  x: number;
  y: number;
  startedAt: number;
  strength: number;
  kind: FieldKind;
}

export interface FieldSample {
  dx: number;
  dy: number;
  /** Signed luminance adjustment: blue attraction darkens; gold repulsion brightens. */
  shade: number;
}

/** Seconds. Emit events at activation/rapid-strength edges, never every frame. */
export const RIPPLE_LIFETIME = 3;

const MAX_DISPLACEMENT = 22;
const MAX_SHADE = 0.23;

interface FieldJacobian {
  xx: number;
  xy: number;
  yx: number;
  yy: number;
}

function visualStrength(value: number): number {
  return Number.isFinite(value) ? Math.min(1.8, Math.max(0, value)) : 0;
}

/**
 * Evaluates one field, optionally its analytic spatial Jacobian. Accumulate
 * every source first, then smoothly limit the combined displacement.
 */
function evaluateSpaceField(
  x: number,
  y: number,
  nodes: readonly FieldSource[],
  ripples: readonly SpaceRipple[],
  time: number,
  distortion: number,
  out: FieldSample,
  jacobian?: FieldJacobian,
): FieldSample {
  let dx = 0;
  let dy = 0;
  let shade = 0;
  let xx = 0;
  let xy = 0;
  let yx = 0;
  let yy = 0;
  const amount = Number.isFinite(distortion) ? Math.max(0, distortion) : 0;

  if (amount > 0) {
    for (const node of nodes) {
      const radius = node.fieldRadius;
      if (!node.active || !(radius > 0) || !Number.isFinite(radius)) continue;
      const strength = visualStrength(node.strength);
      if (strength === 0) continue;
      const rx = x - node.x;
      const ry = y - node.y;
      const inverseRadius2 = 1 / (radius * radius);
      const q = (rx * rx + ry * ry) * inverseRadius2;
      if (!(q < 1)) continue;
      const edge = 1 - q;
      const edge2 = edge * edge;
      const support = edge2 * edge;
      const sign = node.kind === 'attractor' ? -1 : 1;
      // Radius-aware gain avoids a singular, folded core for ordinary two-node
      // scenes. Multiplication by (rx, ry) makes the exact center finite.
      const gain = sign * Math.min(38, radius * 0.22) * strength / radius;
      const k = gain * support;
      dx += rx * k;
      dy += ry * k;
      shade += sign * strength * 0.085 * support;
      if (jacobian) {
        const gradient = -6 * gain * edge2 * inverseRadius2;
        xx += k + rx * rx * gradient;
        xy += rx * ry * gradient;
        yx += rx * ry * gradient;
        yy += k + ry * ry * gradient;
      }
    }

    for (const ripple of ripples) {
      const age = time - ripple.startedAt;
      if (!(age > 0 && age < RIPPLE_LIFETIME)) continue;
      const strength = visualStrength(ripple.strength);
      if (strength === 0) continue;
      const rx = x - ripple.x;
      const ry = y - ripple.y;
      const r = Math.hypot(rx, ry);
      const waveRadius = 28 + age * 112;
      const width = 20 + age * 12;
      // All angular perturbations fit inside this inexpensive radial rejection.
      if (!(r > 0) || Math.abs(r - waveRadius) >= width * 1.18) continue;
      const ux = rx / r;
      const uy = ry / r;
      const theta = Math.atan2(ry, rx);
      const phase = age * 0.24 + (ripple.kind === 'attractor' ? 0.7 : 2.2);
      const a = theta * 3 + phase;
      const b = theta * 5 - phase * 0.7;
      const irregularity = 0.12 * (Math.sin(a) + 0.45 * Math.sin(b));
      const z = (r - waveRadius) / width - irregularity;
      if (Math.abs(z) >= 1) continue;
      const progress = age / RIPPLE_LIFETIME;
      // Zero value and first derivative at birth/death: no activation pop.
      const temporal = Math.sin(Math.PI * progress) ** 2 * (1 - progress);
      const sign = ripple.kind === 'attractor' ? -1 : 1;
      const amplitude = sign * strength * 3.3 * temporal;
      const edge = 1 - z * z;
      const edge2 = edge * edge;
      const support = edge2 * edge;
      // A compact bipolar wave packet deforms existing texture and stars;
      // it is not a separately drawn expanding circle.
      const oscillation = Math.sin(Math.PI * z);
      const radial = amplitude * support * oscillation;
      dx += ux * radial;
      dy += uy * radial;
      shade += amplitude * 0.012 * support;
      if (jacobian) {
        const angularDerivative = 0.12 * (3 * Math.cos(a) + 2.25 * Math.cos(b));
        const zx = ux / width + angularDerivative * uy / r;
        const zy = uy / width - angularDerivative * ux / r;
        const radialDerivative = amplitude * (
          Math.PI * Math.cos(Math.PI * z) * support - 6 * z * edge2 * oscillation
        );
        const fx = radialDerivative * zx;
        const fy = radialDerivative * zy;
        xx += radial * uy * uy / r + ux * fx;
        xy += -radial * ux * uy / r + ux * fy;
        yx += -radial * ux * uy / r + uy * fx;
        yy += radial * ux * ux / r + uy * fy;
      }
    }
  }

  dx *= amount;
  dy *= amount;
  const magnitude = Math.hypot(dx, dy);
  const saturated = Math.tanh(magnitude / MAX_DISPLACEMENT);
  const scale = magnitude > 1e-8 ? MAX_DISPLACEMENT * saturated / magnitude : 1;
  out.dx = dx * scale;
  out.dy = dy * scale;
  out.shade = MAX_SHADE * Math.tanh(shade * amount / MAX_SHADE);
  if (jacobian) {
    xx *= amount;
    xy *= amount;
    yx *= amount;
    yy *= amount;
    const radialGradient = magnitude > 1e-8
      ? (1 - saturated * saturated - scale) / (magnitude * magnitude)
      : 0;
    const dotX = dx * xx + dy * yx;
    const dotY = dx * xy + dy * yy;
    jacobian.xx = scale * xx + radialGradient * dx * dotX;
    jacobian.xy = scale * xy + radialGradient * dx * dotY;
    jacobian.yx = scale * yx + radialGradient * dy * dotX;
    jacobian.yy = scale * yy + radialGradient * dy * dotY;
  }
  return out;
}

/**
 * Forward deformation at a world point. A star at (x,y) renders at
 * (x + dx,y + dy). Time and ripple.startedAt are measured in seconds.
 * Callers may reuse out to avoid allocating per star/pixel.
 */
export function sampleSpaceField(
  x: number,
  y: number,
  nodes: readonly FieldSource[],
  ripples: readonly SpaceRipple[],
  time: number,
  distortion = 1,
  out: FieldSample = { dx: 0, dy: 0, shade: 0 },
): FieldSample {
  return evaluateSpaceField(x, y, nodes, ripples, time, distortion, out);
}

/**
 * Returns the world-space texture source whose forward-deformed position is
 * (x,y). Three bounded Newton iterations use the same field and its analytic
 * Jacobian, avoiding extra finite-difference field samples. Apply camera
 * conversion outside this function, after/before world-space sampling.
 */
export function inverseSpacePoint(
  x: number,
  y: number,
  nodes: readonly FieldSource[],
  ripples: readonly SpaceRipple[],
  time: number,
  distortion = 1,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  const sample: FieldSample = { dx: 0, dy: 0, shade: 0 };
  const jacobian: FieldJacobian = { xx: 0, xy: 0, yx: 0, yy: 0 };
  let sx = x;
  let sy = y;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    evaluateSpaceField(sx, sy, nodes, ripples, time, distortion, sample, jacobian);
    const ex = sx + sample.dx - x;
    const ey = sy + sample.dy - y;
    const a = 1 + jacobian.xx;
    const b = jacobian.xy;
    const c = jacobian.yx;
    const d = 1 + jacobian.yy;
    const determinant = a * d - b * c;
    if (Math.abs(determinant) > 0.025) {
      sx -= (d * ex - b * ey) / determinant;
      sy -= (a * ey - c * ex) / determinant;
    } else {
      // Fixed-point fallback for unusually degenerate caller configurations.
      sx = x - sample.dx;
      sy = y - sample.dy;
    }
    // Every legitimate inverse lies within the forward displacement bound.
    const distance = Math.hypot(sx - x, sy - y);
    if (distance > MAX_DISPLACEMENT) {
      const bound = MAX_DISPLACEMENT / distance;
      sx = x + (sx - x) * bound;
      sy = y + (sy - y) * bound;
    }
  }
  out.x = sx;
  out.y = sy;
  return out;
}
