import { describe, expect, it } from 'vitest';
import type { FieldSpec } from '../src/shared/contracts';
import { fieldAcceleration } from '../src/physics/field';
import { clampLength, normalizeMove } from '../src/physics/vec';
import {
  circleInsideDock,
  circleOutsideWorld,
  sweptCircleHit,
} from '../src/physics/collision';
import { createGame } from '../src/game';
import { levels } from '../src/levels';

const field: FieldSpec = {
  radius: 300,
  strength: 2_000_000,
  softening: 70,
  maxAcceleration: 100,
};

describe('softened field', () => {
  it('attracts toward the source and repels away from it', () => {
    const attract = fieldAcceleration({ x: 0, y: 0 }, { x: 120, y: 0 }, field, 1);
    const repel = fieldAcceleration({ x: 0, y: 0 }, { x: 120, y: 0 }, field, -1);
    expect(attract.x).toBeGreaterThan(0);
    expect(repel.x).toBeLessThan(0);
    expect(attract.y).toBeCloseTo(0, 8);
    expect(repel.y).toBeCloseTo(0, 8);
  });

  it('is zero outside the radius and at zero distance', () => {
    expect(fieldAcceleration({ x: 0, y: 0 }, { x: 300, y: 0 }, field, 1)).toEqual({
      x: 0,
      y: 0,
    });
    expect(fieldAcceleration({ x: 5, y: 5 }, { x: 5, y: 5 }, field, 1)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('clamps each source to maxAcceleration', () => {
    const a = fieldAcceleration(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { ...field, maxAcceleration: 12 },
      1,
    );
    expect(Math.hypot(a.x, a.y)).toBeLessThanOrEqual(12 + 1e-9);
  });

  it('normalizes diagonal movement so it is not faster', () => {
    const diagonal = normalizeMove({ x: 1, y: 1 });
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 8);
    expect(clampLength({ x: 30, y: 40 }, 10)).toEqual({ x: 6, y: 8 });
  });
});

describe('collision and docking', () => {
  it('detects a swept circle crossing a moving target', () => {
    const hit = sweptCircleHit(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 20 },
      { x: 50, y: -20 },
      10,
    );
    expect(hit).toBe(true);
  });

  it('does not report a clean miss', () => {
    expect(
      sweptCircleHit(
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 40 },
        { x: 50, y: 40 },
        10,
      ),
    ).toBe(false);
  });

  it('requires the whole ark circle inside the dock', () => {
    expect(circleInsideDock({ x: 0, y: 0 }, 10, { x: 0, y: 0 }, 20)).toBe(true);
    expect(circleInsideDock({ x: 15, y: 0 }, 10, { x: 0, y: 0 }, 20)).toBe(false);
  });

  it('allows touching the world boundary but not crossing it', () => {
    expect(circleOutsideWorld({ x: 9, y: 100 }, 10, 1200, 720)).toBe(true);
    expect(circleOutsideWorld({ x: 10, y: 100 }, 10, 1200, 720)).toBe(false);
    expect(circleOutsideWorld({ x: 11, y: 100 }, 10, 1200, 720)).toBe(false);
  });
});

describe('runtime lifecycle', () => {
  it('restart resets state, increments runId and keeps the level', () => {
    const game = createGame(levels[0]!, levels);
    game.command({ type: 'toggle-pause' });
    for (let i = 0; i < 30; i += 1) {
      game.step({
        players: {
          attractor: { move: { x: 1, y: 0 }, fieldActive: true },
          repulsor: { move: { x: 0, y: 0 }, fieldActive: false },
        },
      });
    }
    const before = game.snapshot();
    expect(before.tick).toBe(30);
    game.command({ type: 'restart' });
    const after = game.snapshot();
    expect(after.phase).toBe('ready');
    expect(after.tick).toBe(0);
    expect(after.runId).toBe(before.runId + 1);
    expect(after.players[0]!.position).toEqual(levels[0]!.players[0]!.spawn);
  });

  it('unknown load-level throws RangeError without changing state', () => {
    const game = createGame(levels[0]!, levels);
    const before = game.snapshot();
    expect(() => game.command({ type: 'load-level', levelId: 'missing' })).toThrow(
      RangeError,
    );
    const after = game.snapshot();
    expect(after.levelId).toBe(before.levelId);
    expect(after.runId).toBe(before.runId);
    expect(after.tick).toBe(before.tick);
  });

  it('loading a known level starts a new ready run', () => {
    const game = createGame(levels[0]!, levels);
    const before = game.snapshot();
    game.command({ type: 'load-level', levelId: levels[2]!.id });
    const after = game.snapshot();
    expect(after.levelId).toBe(levels[2]!.id);
    expect(after.phase).toBe('ready');
    expect(after.runId).toBe(before.runId + 1);
    expect(after.tick).toBe(0);
  });
});
