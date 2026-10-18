import type { FieldSpec, Vec2 } from '../shared/contracts';
import { clampLength } from './vec';

/**
 * Softened inverse-square field acceleration, with the frozen v0.1 edge falloff:
 *
 *   a = s · strength · d / (r² + ε²)^(3/2) · max(0, 1 − r/R)²
 *
 * d = source − target. s = +1 attraction/gravity, s = −1 repulsion.
 * The result is clamped per source to field.maxAcceleration.
 */
export function fieldAcceleration(
  target: Vec2,
  source: Vec2,
  field: FieldSpec,
  sign: 1 | -1,
): Vec2 {
  const dx = source.x - target.x;
  const dy = source.y - target.y;
  const r2 = dx * dx + dy * dy;
  if (r2 <= 0) return { x: 0, y: 0 };

  const r = Math.sqrt(r2);
  if (r >= field.radius) return { x: 0, y: 0 };

  const soft2 = field.softening * field.softening;
  const edge = Math.max(0, 1 - r / field.radius);
  const denom = (r2 + soft2) * Math.sqrt(r2 + soft2);
  const k = (sign * field.strength * edge * edge) / denom;

  return clampLength({ x: dx * k, y: dy * k }, field.maxAcceleration);
}

/** Acceleration contribution of one player field on a body. */
export function playerFieldAcceleration(
  target: Vec2,
  playerPos: Vec2,
  field: FieldSpec,
  playerId: 'attractor' | 'repulsor',
): Vec2 {
  return fieldAcceleration(target, playerPos, field, playerId === 'attractor' ? 1 : -1);
}
