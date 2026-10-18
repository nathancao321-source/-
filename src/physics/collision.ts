import type { Vec2 } from '../shared/contracts';

/**
 * Relative-motion swept circle test. True when two circles of radii whose sum
 * is radiusSum touch or overlap at any time t ∈ [0, 1].
 *
 * r(t) = r0 + t·dr, where r0 = p0 − q0 and
 * dr = (p1 − p0) − (q1 − q0). Touching counts as a hit.
 */
export function sweptCircleHit(
  p0: Vec2,
  p1: Vec2,
  q0: Vec2,
  q1: Vec2,
  radiusSum: number,
): boolean {
  const r0x = p0.x - q0.x;
  const r0y = p0.y - q0.y;
  const drx = p1.x - p0.x - (q1.x - q0.x);
  const dry = p1.y - p0.y - (q1.y - q0.y);

  const c = r0x * r0x + r0y * r0y - radiusSum * radiusSum;
  if (c <= 0) return true; // already overlapping at t = 0

  const a = drx * drx + dry * dry;
  if (a <= 1e-12) return false; // no relative motion, no overlap

  const b = 2 * (r0x * drx + r0y * dry);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;

  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  return t2 >= 0 && t1 <= 1;
}

/** Distance from a point to the segment p0→p1. */
export function pointSegmentDistance(p: Vec2, p0: Vec2, p1: Vec2): number {
  const vx = p1.x - p0.x;
  const vy = p1.y - p0.y;
  const wx = p.x - p0.x;
  const wy = p.y - p0.y;
  const vv = vx * vx + vy * vy;
  if (vv <= 1e-12) return Math.hypot(wx, wy);
  let t = (wx * vx + wy * vy) / vv;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (p0.x + vx * t), p.y - (p0.y + vy * t));
}

/** True when the center is closer than the threshold at any point of the segment. */
export function segmentEntersRadius(p0: Vec2, p1: Vec2, center: Vec2, radius: number): boolean {
  return pointSegmentDistance(center, p0, p1) <= radius;
}

/** The whole circle of the given radius must stay inside the world rectangle. */
export function circleOutsideWorld(
  p: Vec2,
  radius: number,
  worldWidth: number,
  worldHeight: number,
): boolean {
  return (
    p.x - radius < 0 ||
    p.y - radius < 0 ||
    p.x + radius > worldWidth ||
    p.y + radius > worldHeight
  );
}

/** Entire collision circle fits inside the dock ring. */
export function circleInsideDock(
  p: Vec2,
  arkRadius: number,
  dockCenter: Vec2,
  dockRadius: number,
): boolean {
  return Math.hypot(p.x - dockCenter.x, p.y - dockCenter.y) <= dockRadius - arkRadius;
}
