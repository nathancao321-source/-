import { describe, expect, it } from 'vitest';
import type { FrameSnapshot, InputFrame, LevelSpec, Vec2 } from '../src/shared/contracts';
import { createGame } from '../src/game';
import { levels } from '../src/levels';

const IDLE: InputFrame = {
  players: {
    attractor: { move: { x: 0, y: 0 }, fieldActive: false },
    repulsor: { move: { x: 0, y: 0 }, fieldActive: false },
  },
};

function arkOf(snapshot: FrameSnapshot) {
  const ark = snapshot.bodies.find((body) => body.kind === 'ark');
  if (!ark) throw new Error('ark missing');
  return ark;
}

function norm(a: Vec2): Vec2 {
  const len = Math.hypot(a.x, a.y);
  return len <= 1e-9 ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function seek(from: Vec2, to: Vec2): Vec2 {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d < 3) return { x: 0, y: 0 };
  return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}

function clampToWorld(p: Vec2, level: LevelSpec): Vec2 {
  return {
    x: Math.max(16, Math.min(level.world.width - 16, p.x)),
    y: Math.max(16, Math.min(level.world.height - 16, p.y)),
  };
}

interface Plan {
  readonly waypoints: readonly Vec2[];
  readonly cruiseSpeed: number;
  readonly finalSpeed: number;
  readonly acceptRadius: number;
}

function autopilotFrame(
  snapshot: FrameSnapshot,
  level: LevelSpec,
  plan: Plan,
  waypointIndex: number,
): { input: InputFrame; waypointIndex: number } {
  const ark = arkOf(snapshot);
  const position = ark.position;
  let index = waypointIndex;

  if (snapshot.mission?.script === 'solar') {
    // Advance exactly when the current resonance anchor is recorded; this is
    // both the mission objective and a safe route gate.
    const flags = snapshot.mission.resonanceFlags ?? [];
    while (
      index < plan.waypoints.length - 1 &&
      flags[index] &&
      Math.hypot(
        plan.waypoints[index]!.x - position.x,
        plan.waypoints[index]!.y - position.y,
      ) < plan.acceptRadius
    ) {
      index += 1;
    }
  } else {
    while (
      index < plan.waypoints.length - 1 &&
      Math.hypot(
        plan.waypoints[index]!.x - position.x,
        plan.waypoints[index]!.y - position.y,
      ) < plan.acceptRadius
    ) {
      index += 1;
    }
  }

  const target = plan.waypoints[index]!;
  const dir = norm({ x: target.x - position.x, y: target.y - position.y });
  const speed = Math.hypot(ark.velocity.x, ark.velocity.y);
  const atGoal = index === plan.waypoints.length - 1;
  const distanceToGoal = Math.hypot(target.x - position.x, target.y - position.y);

  const offset = 132;
  const velDir =
    speed > 4 ? { x: ark.velocity.x / speed, y: ark.velocity.y / speed } : dir;
  const dot = clamp(velDir.x * dir.x + velDir.y * dir.y, -1, 1);
  const angleError = Math.acos(dot);
  // Slow down for corners and before reaching a waypoint: a fast ark cannot
  // turn tightly with fixed, binary fields.
  const turnScale =
    angleError > 0.55 ? 0.5 : angleError > 0.28 ? 0.75 : 1;
  const approachScale = distanceToGoal < 150 ? 0.68 : 1;
  const baseDesired =
    atGoal && distanceToGoal < 280 ? plan.finalSpeed : plan.cruiseSpeed;
  const desired = baseDesired * turnScale * approachScale;
  const accelerate = speed < desired - 3;
  const brake = speed > desired + 3;
  const steer = speed < 4 || angleError > 0.06;
  // The repulsor pushes away from itself. Placing it slightly ahead of the
  // velocity and offset from the target direction yields brake + steer at once.
  const brakeDir = norm({
    x: velDir.x - dir.x * 0.45,
    y: velDir.y - dir.y * 0.45,
  });

  const attractorTarget = {
    x: position.x + dir.x * offset,
    y: position.y + dir.y * offset,
  };
  const repulsorTarget = {
    x: position.x + brakeDir.x * offset,
    y: position.y + brakeDir.y * offset,
  };

  const p1 = snapshot.players.find((p) => p.id === 'attractor')!;
  const p2 = snapshot.players.find((p) => p.id === 'repulsor')!;
  const aTarget = clampToWorld(attractorTarget, level);
  const rTarget = clampToWorld(repulsorTarget, level);
  const p1InRange =
    Math.hypot(p1.position.x - position.x, p1.position.y - position.y) <
    p1.field.radius - 5;
  const p2InRange =
    Math.hypot(p2.position.x - position.x, p2.position.y - position.y) <
    p2.field.radius - 5;

  const input: InputFrame = {
    players: {
      attractor: {
        move: seek(p1.position, aTarget),
        fieldActive: (accelerate || steer) && p1InRange,
      },
      repulsor: {
        move: seek(p2.position, rTarget),
        fieldActive: brake && p2InRange,
      },
    },
  };
  return { input, waypointIndex: index };
}

function runIdle(level: LevelSpec, ticks: number): FrameSnapshot {
  const game = createGame(level, levels);
  game.command({ type: 'toggle-pause' });
  for (let i = 0; i < ticks; i += 1) {
    game.step(IDLE);
    const snap = game.snapshot();
    if (snap.phase === 'won' || snap.phase === 'lost') return snap;
  }
  return game.snapshot();
}

function runAutopilot(
  level: LevelSpec,
  plan: Plan,
  maxTicks: number,
): { snapshot: FrameSnapshot; recorded: InputFrame[]; time: number } {
  const game = createGame(level, levels);
  game.command({ type: 'toggle-pause' });
  const recorded: InputFrame[] = [];
  let waypointIndex = 0;

  // The tutorial level is intentionally driftable: zero input is a legal
  // solution, and it proves the ark can reach the wormhole unassisted.
  if (level.id === 'first-contact') {
    for (let i = 0; i < maxTicks; i += 1) {
      const snap = game.snapshot();
      if (snap.phase === 'won' || snap.phase === 'lost') {
        return { snapshot: snap, recorded, time: snap.elapsedSeconds };
      }
      recorded.push(IDLE);
      game.step(IDLE);
    }
  }

  for (let i = 0; i < maxTicks; i += 1) {
    const snap = game.snapshot();
    if (snap.phase === 'won' || snap.phase === 'lost') {
      return { snapshot: snap, recorded, time: snap.elapsedSeconds };
    }
    const result = autopilotFrame(snap, level, plan, waypointIndex);
    waypointIndex = result.waypointIndex;
    recorded.push(result.input);
    if (process.env.DEBUG_LEVEL === level.id && i % 15 === 0) {
      const ark = arkOf(snap);
      console.log(
        `[trace] t=${(snap.tick * level.physics.fixedDt).toFixed(2)} ` +
          `pos=${ark.position.x.toFixed(0)},${ark.position.y.toFixed(0)} ` +
          `v=${ark.velocity.x.toFixed(0)},${ark.velocity.y.toFixed(0)} wp=${waypointIndex} ` +
          `p1=${result.input.players.attractor.fieldActive ? 'ON' : 'off'} ` +
          `p2=${result.input.players.repulsor.fieldActive ? 'ON' : 'off'}`,
      );
    }
    game.step(result.input);
  }
  return { snapshot: game.snapshot(), recorded, time: game.snapshot().elapsedSeconds };
}

function replay(level: LevelSpec, recorded: readonly InputFrame[]): FrameSnapshot {
  const game = createGame(level, levels);
  game.command({ type: 'toggle-pause' });
  for (const frame of recorded) {
    game.step(frame);
    const snap = game.snapshot();
    if (snap.phase === 'won' || snap.phase === 'lost') return snap;
  }
  return game.snapshot();
}

const plans: Record<string, Plan> = {
  'first-contact': {
    waypoints: [{ x: 1060, y: 360 }],
    cruiseSpeed: 60,
    finalSpeed: 60,
    acceptRadius: 40,
  },
  'moving-world': {
    waypoints: [
      { x: 430, y: 220 },
      { x: 740, y: 225 },
      { x: 960, y: 300 },
      { x: 1050, y: 360 },
    ],
    cruiseSpeed: 78,
    finalSpeed: 42,
    acceptRadius: 70,
  },
  'solar-exodus': {
    waypoints: [
      { x: 210, y: 500 },
      { x: 430, y: 235 },
      { x: 700, y: 225 },
      { x: 820, y: 590 },
      { x: 1110, y: 560 },
    ],
    cruiseSpeed: 62,
    finalSpeed: 48,
    acceptRadius: 55,
  },
  'beyond-horizon': {
    waypoints: [
      { x: 420, y: 235 },
      { x: 640, y: 225 },
      { x: 850, y: 205 },
      { x: 1080, y: 170 },
    ],
    cruiseSpeed: 72,
    finalSpeed: 55,
    acceptRadius: 65,
  },
};

describe('level baselines', () => {
  it('reports no-input outcomes', () => {
    for (const level of levels) {
      const snap = runIdle(level, 60 * 90);
      console.log(
        `[idle] ${level.id}: phase=${snap.phase} reason=${snap.failureReason ?? '-'} ` +
          `t=${snap.elapsedSeconds.toFixed(1)}s speed=${snap.arkSpeed.toFixed(1)}`,
      );
    }
    expect(levels.length).toBe(4);
  });

  it('autopilot can complete every level with legal input only', () => {
    for (const level of levels) {
      const plan = plans[level.id];
      expect(plan, `missing plan for ${level.id}`).toBeDefined();
      const result = runAutopilot(level, plan!, 90 * 60);
      console.log(
        `[auto] ${level.id}: phase=${result.snapshot.phase} ` +
          `reason=${result.snapshot.failureReason ?? '-'} t=${result.time.toFixed(1)}s ` +
          `speed=${result.snapshot.arkSpeed.toFixed(1)} ticks=${result.snapshot.tick}`,
      );
      if (process.env.DEBUG_LEVEL === level.id) {
        console.log(
          '[bodies] ' +
            result.snapshot.bodies
              .map(
                (body) =>
                  `${body.id}@${body.position.x.toFixed(0)},${body.position.y.toFixed(0)}`,
              )
              .join(' '),
        );
      }
      expect(result.snapshot.phase, `${level.id} autopilot failed`).toBe('won');
    }
  });

  it('recorded legal inputs replay deterministically', () => {
    for (const level of levels) {
      const plan = plans[level.id]!;
      const result = runAutopilot(level, plan, 90 * 60);
      expect(result.snapshot.phase).toBe('won');
      const replayed = replay(level, result.recorded);
      console.log(
        `[replay] ${level.id}: phase=${replayed.phase} t=${replayed.elapsedSeconds.toFixed(1)}s ` +
          `ticks=${replayed.tick}`,
      );
      expect(replayed.phase).toBe('won');
      expect(replayed.tick).toBe(result.snapshot.tick);
    }
  });
});
