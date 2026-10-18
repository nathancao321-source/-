import type { Vec2 } from '../shared/contracts';

export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function lengthSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Clamp a vector to max length. Safe for the zero vector and max <= 0. */
export function clampLength(a: Vec2, max: number): Vec2 {
  if (!Number.isFinite(max) || max <= 0) return { x: 0, y: 0 };
  const len = Math.hypot(a.x, a.y);
  if (!Number.isFinite(len) || len <= max || len === 0) return a;
  const k = max / len;
  return { x: a.x * k, y: a.y * k };
}

/** Normalize a movement vector; diagonal input must not be faster. */
export function normalizeMove(a: Vec2): Vec2 {
  const len = Math.hypot(a.x, a.y);
  if (!Number.isFinite(len) || len <= 1e-9) return { x: 0, y: 0 };
  // Each axis is expected to be within [-1, 1]; clamp before normalizing.
  const cx = Math.max(-1, Math.min(1, a.x));
  const cy = Math.max(-1, Math.min(1, a.y));
  const clen = Math.hypot(cx, cy);
  if (clen <= 1e-9) return { x: 0, y: 0 };
  return { x: cx / clen, y: cy / clen };
}

export function finiteVec(a: Vec2): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y);
}
