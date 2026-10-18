import type { FieldSpec, LevelSpec, Vec2 } from '../shared/contracts';
import { CONTRACT_VERSION } from '../shared/contracts';

function finite(n: number): boolean {
  return Number.isFinite(n);
}

function finiteVec(v: Vec2): boolean {
  return finite(v.x) && finite(v.y);
}

function validField(field: FieldSpec): boolean {
  return (
    finite(field.radius) &&
    field.radius > 0 &&
    finite(field.strength) &&
    field.strength >= 0 &&
    finite(field.softening) &&
    field.softening > 0 &&
    finite(field.maxAcceleration) &&
    field.maxAcceleration >= 0
  );
}

export function validateLevel(level: LevelSpec): void {
  if (level.contractVersion !== CONTRACT_VERSION) {
    throw new Error(`Unsupported contract version for level ${level.id}`);
  }
  if (!level.id) throw new Error('Level id is required');
  if (!finite(level.world.width) || !finite(level.world.height)) {
    throw new Error(`Level ${level.id}: world size must be finite`);
  }
  if (level.world.width <= 0 || level.world.height <= 0) {
    throw new Error(`Level ${level.id}: world size must be positive`);
  }

  const ph = level.physics;
  if (!finite(ph.fixedDt) || ph.fixedDt <= 0) throw new Error('fixedDt must be positive');
  if (!finite(ph.maxBodySpeed) || ph.maxBodySpeed <= 0) throw new Error('maxBodySpeed must be positive');
  if (!finite(ph.maxTotalAcceleration) || ph.maxTotalAcceleration <= 0) {
    throw new Error('maxTotalAcceleration must be positive');
  }
  if (!Number.isInteger(ph.maxCatchUpSteps) || ph.maxCatchUpSteps < 1) {
    throw new Error('maxCatchUpSteps must be a positive integer');
  }

  const ids = new Set<string>();
  for (const p of level.players) {
    if (p.id !== 'attractor' && p.id !== 'repulsor') throw new Error(`Unknown player id ${p.id}`);
    if (ids.has(p.id)) throw new Error(`Duplicate player id ${p.id}`);
    ids.add(p.id);
    if (!finiteVec(p.spawn)) throw new Error(`Player ${p.id}: invalid spawn`);
    if (!finite(p.radius) || p.radius <= 0) throw new Error(`Player ${p.id}: invalid radius`);
    if (!finite(p.moveSpeed) || p.moveSpeed < 0) throw new Error(`Player ${p.id}: invalid moveSpeed`);
    if (!validField(p.field)) throw new Error(`Player ${p.id}: invalid field`);
  }

  const ark = level.bodies.filter((b) => b.kind === 'ark');
  if (ark.length !== 1) throw new Error(`Level ${level.id}: exactly one ark is required`);

  const bodyIds = new Set<string>();
  for (const b of level.bodies) {
    if (!b.id) throw new Error('Body id is required');
    if (bodyIds.has(b.id)) throw new Error(`Duplicate body id ${b.id}`);
    bodyIds.add(b.id);
    if (!finiteVec(b.position) || !finiteVec(b.velocity)) {
      throw new Error(`Body ${b.id}: non-finite position or velocity`);
    }
    if (!finite(b.radius) || b.radius <= 0) throw new Error(`Body ${b.id}: invalid radius`);
    if (!finite(b.motionResponse) || b.motionResponse < 0 || b.motionResponse > 1) {
      throw new Error(`Body ${b.id}: motionResponse must be in [0, 1]`);
    }
    if (b.motionResponse === 0 && (b.velocity.x !== 0 || b.velocity.y !== 0)) {
      throw new Error(`Body ${b.id}: motionResponse 0 requires zero initial velocity`);
    }
    if (b.gravity && !validField(b.gravity)) throw new Error(`Body ${b.id}: invalid gravity field`);
    if (b.consumeRadius !== undefined && (!finite(b.consumeRadius) || b.consumeRadius <= 0)) {
      throw new Error(`Body ${b.id}: invalid consumeRadius`);
    }
  }

  if (!finiteVec(level.dock.center)) throw new Error('Dock center is not finite');
  if (!finite(level.dock.radius) || level.dock.radius <= 0) throw new Error('Dock radius invalid');
  if (!finite(level.dock.maxEntrySpeed) || level.dock.maxEntrySpeed < 0) {
    throw new Error('Dock maxEntrySpeed invalid');
  }
  if (level.dock.radius <= ark[0]!.radius) {
    throw new Error('Dock radius must exceed the ark radius');
  }

  const mission = level.mission;
  if (mission) {
    if (!['tutorial', 'planet', 'solar', 'blackhole'].includes(mission.script)) {
      throw new Error(`Unknown mission script ${mission.script}`);
    }
    for (const zone of mission.resonanceZones ?? []) {
      if (!finiteVec(zone.center) || !finite(zone.radius) || zone.radius <= 0) {
        throw new Error(`Resonance zone ${zone.id} invalid`);
      }
    }
    const required = mission.requiredResonance;
    if (required !== undefined && (!Number.isInteger(required) || required < 0)) {
      throw new Error('requiredResonance must be a non-negative integer');
    }
    if (mission.shockwave) {
      const w = mission.shockwave;
      if (!finiteVec(w.origin) || !finite(w.triggerX) || !finite(w.delaySeconds) || w.delaySeconds < 0) {
        throw new Error('Shockwave configuration invalid');
      }
      if (!finite(w.speed) || w.speed <= 0) throw new Error('Shockwave speed must be positive');
    }
    if (mission.jet) {
      const j = mission.jet;
      if (!finiteVec(j.center) || !finiteVec(j.direction)) throw new Error('Jet center/direction invalid');
      if (j.halfWidth <= 0 || j.halfHeight <= 0) throw new Error('Jet size must be positive');
      if (j.periodSeconds <= 0 || j.activeSeconds <= 0 || j.activeSeconds > j.periodSeconds) {
        throw new Error('Jet timing invalid');
      }
      if (!finite(j.force) || j.force <= 0) throw new Error('Jet force must be positive');
    }
  }
}
