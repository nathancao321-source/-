import { describe, expect, it } from 'vitest';
import type { BodySpec, FrameSnapshot, InputFrame, LevelSpec, Vec2 } from '../src/shared/contracts';
import { createGame } from '../src/game';
import { levels } from '../src/levels';

const IDLE: InputFrame = {
  players: {
    attractor: { move: { x: 0, y: 0 }, fieldActive: false },
    repulsor: { move: { x: 0, y: 0 }, fieldActive: false },
  },
};

function speed(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

function arkOf(snapshot: FrameSnapshot): FrameSnapshot['bodies'][number] {
  const ark = snapshot.bodies.find((body) => body.kind === 'ark');
  if (!ark) throw new Error('ark missing');
  return ark;
}

function fieldInput(
  attractor: boolean,
  repulsor: boolean,
): InputFrame {
  return {
    players: {
      attractor: { move: { x: 0, y: 0 }, fieldActive: attractor },
      repulsor: { move: { x: 0, y: 0 }, fieldActive: repulsor },
    },
  };
}

function customLevel(
  base: LevelSpec,
  bodies: BodySpec[],
  players: LevelSpec['players'],
): LevelSpec {
  return { ...structuredClone(base), bodies, players };
}

describe('escort speed budget', () => {
  it('keeps configured cruise speeds readable on a single screen', () => {
    for (const level of levels) {
      expect(level.physics.maxBodySpeed, `${level.id} speed cap`).toBeLessThanOrEqual(160);
      const ark = level.bodies.find((body) => body.kind === 'ark');
      expect(ark, `${level.id} ark`).toBeDefined();
      expect(speed(ark!.velocity), `${level.id} initial ark cruise`).toBeLessThanOrEqual(60);
      for (const body of level.bodies) {
        expect(
          speed(body.velocity),
          `${level.id}/${body.id} initial speed`,
        ).toBeLessThanOrEqual(level.physics.maxBodySpeed);
      }
    }
  });

  it('never lets a body exceed the level speed cap under sustained fields', () => {
    const base = levels[1]!;
    const ark = base.bodies.find((body) => body.kind === 'ark')!;
    const fieldBody: BodySpec = {
      ...ark,
      position: { x: 600, y: 360 },
      velocity: { x: 0, y: 0 },
      gravity: undefined,
    };
    const players = [
      { ...base.players[0]!, spawn: { x: 420, y: 360 } },
      { ...base.players[1]!, spawn: { x: 900, y: 620 } },
    ] as unknown as LevelSpec['players'];
    const level = customLevel(base, [fieldBody], players);
    const game = createGame(level, [level]);
    game.command({ type: 'toggle-pause' });

    let peak = 0;
    for (let i = 0; i < 300; i += 1) {
      game.step(fieldInput(true, false));
      const snapshot = game.snapshot();
      expect(snapshot.phase).toBe('running');
      const current = speed(arkOf(snapshot).velocity);
      peak = Math.max(peak, current);
      expect(Number.isFinite(current)).toBe(true);
      expect(current).toBeLessThanOrEqual(level.physics.maxBodySpeed + 1e-6);
    }
    // The test is only meaningful if the field actually accelerated the ship.
    expect(peak).toBeGreaterThan(level.physics.maxBodySpeed * 0.75);
  });

  it('lets a repulsor arrest a ship that leaves the field at cruise speed', () => {
    const base = levels[1]!;
    const ark = base.bodies.find((body) => body.kind === 'ark')!;
    const movingArk: BodySpec = {
      ...ark,
      position: { x: 300, y: 360 },
      velocity: { x: 150, y: 0 },
    };
    const players = [
      { ...base.players[0]!, spawn: { x: 1080, y: 120 } },
      // The repulsor is placed ahead of the ship, well inside its 285 px field.
      { ...base.players[1]!, spawn: { x: 480, y: 360 } },
    ] as unknown as LevelSpec['players'];
    const level = customLevel(base, [movingArk], players);
    const game = createGame(level, [level]);
    game.command({ type: 'toggle-pause' });

    const start = arkOf(game.snapshot()).position;
    for (let i = 0; i < 120; i += 1) {
      game.step(fieldInput(false, true));
    }
    const snapshot = game.snapshot();
    const end = arkOf(snapshot);

    expect(snapshot.phase).toBe('running');
    expect(speed(end.velocity)).toBeLessThan(90);
    expect(Math.hypot(end.position.x - start.x, end.position.y - start.y)).toBeLessThan(220);
    expect(Number.isFinite(end.position.x)).toBe(true);
  });

  it('keeps idle bodies finite and capped in every shipped level', () => {
    for (const level of levels) {
      const game = createGame(level, levels);
      game.command({ type: 'toggle-pause' });
      for (let i = 0; i < 600; i += 1) {
        game.step(IDLE);
        const snapshot = game.snapshot();
        for (const body of snapshot.bodies) {
          const current = speed(body.velocity);
          expect(Number.isFinite(current), `${level.id}/${body.id} finite`).toBe(true);
          expect(
            current,
            `${level.id}/${body.id} capped`,
          ).toBeLessThanOrEqual(level.physics.maxBodySpeed + 1e-6);
        }
        if (snapshot.phase === 'won' || snapshot.phase === 'lost') break;
      }
    }
  });
});
