import type {
  BodyView,
  FrameSnapshot,
  LevelSpec,
  PlayerView,
  Vec2,
} from '../shared/contracts';
import { fieldAcceleration, playerFieldAcceleration } from '../physics/field';
import { circleInsideDock, circleOutsideWorld, sweptCircleHit } from '../physics/collision';
import { add, clampLength, scale } from '../physics/vec';
import { jetAcceleration } from './mission';

export type PredictionOutcome =
  | 'none'
  | 'collision'
  | 'consumed'
  | 'out-of-bounds'
  | 'dock';

export interface PredictionPoint {
  readonly x: number;
  readonly y: number;
  readonly t: number;
  readonly outcome: PredictionOutcome;
}

interface BodyRef {
  readonly view: BodyView;
  readonly spec: LevelSpec['bodies'][number];
}

interface PlayerRef {
  readonly view: PlayerView;
  readonly spec: LevelSpec['players'][number];
}

/**
 * Short-horizon forward integration for the HUD trajectory line. This is a
 * visual estimate only: it uses the same field/gravity/integration rules as
 * the runtime, treats other bodies as moving linearly, and never writes back
 * into the simulation.
 */
export function predictArkPath(
  level: LevelSpec,
  snapshot: FrameSnapshot,
  horizonSeconds = 3.4,
  stepSeconds = 1 / 30,
): PredictionPoint[] {
  const arkView = snapshot.bodies.find((body) => body.kind === 'ark');
  if (!arkView) return [];
  const arkSpec = level.bodies.find((body) => body.id === arkView.id);
  if (!arkSpec || arkSpec.motionResponse === 0) return [];

  const fixedDt = level.physics.fixedDt;
  const dt = Math.max(1 / 120, Math.min(0.1, stepSeconds));
  const steps = Math.max(1, Math.round(horizonSeconds / dt));

  const bodies: BodyRef[] = [];
  for (const view of snapshot.bodies) {
    if (view.id === arkView.id) continue;
    const spec = level.bodies.find((body) => body.id === view.id);
    if (spec) bodies.push({ view, spec });
  }

  const players: PlayerRef[] = [];
  for (const view of snapshot.players) {
    const spec = level.players.find((player) => player.id === view.id);
    if (spec) players.push({ view, spec });
  }

  let position: Vec2 = { x: arkView.position.x, y: arkView.position.y };
  let velocity: Vec2 = { x: arkView.velocity.x, y: arkView.velocity.y };
  const points: PredictionPoint[] = [
    { x: position.x, y: position.y, t: 0, outcome: 'none' },
  ];

  for (let step = 1; step <= steps; step += 1) {
    const t = step * dt;

    // Moving bodies are extrapolated linearly; static planets/sun/hole are exact.
    const futureBodies = bodies.map((ref) => ({
      ref,
      position: {
        x: ref.view.position.x + ref.view.velocity.x * t,
        y: ref.view.position.y + ref.view.velocity.y * t,
      },
    }));

    let ax = 0;
    let ay = 0;

    if (arkSpec.receivesGravity) {
      for (const body of futureBodies) {
        const gravity = body.ref.view.gravity;
        if (!gravity) continue;
        const a = fieldAcceleration(position, body.position, gravity, 1);
        ax += a.x;
        ay += a.y;
      }
    }

    if (arkSpec.receivesPlayerFields) {
      for (const player of players) {
        if (!player.view.fieldActive) continue;
        const a = playerFieldAcceleration(
          position,
          player.view.position,
          player.spec.field,
          player.view.id,
        );
        ax += a.x;
        ay += a.y;
      }
    }

    let acceleration = clampLength(
      scale({ x: ax, y: ay }, arkSpec.motionResponse),
      level.physics.maxTotalAcceleration,
    );

    if (snapshot.phase === 'running') {
      const futureTick = snapshot.tick + Math.round(t / fixedDt);
      const jet = jetAcceleration(level.mission?.jet, position, futureTick, fixedDt);
      if (jet.x !== 0 || jet.y !== 0) {
        acceleration = clampLength(
          add(acceleration, jet),
          level.physics.maxTotalAcceleration,
        );
      }
    }

    const nextVelocity = clampLength(
      add(velocity, scale(acceleration, dt)),
      level.physics.maxBodySpeed,
    );
    const nextPosition = add(position, scale(nextVelocity, dt));

    let outcome: PredictionOutcome = 'none';

    if (
      circleOutsideWorld(
        nextPosition,
        arkSpec.radius,
        level.world.width,
        level.world.height,
      )
    ) {
      outcome = 'out-of-bounds';
    }

    if (outcome === 'none') {
      for (const body of futureBodies) {
        const consumeRadius = body.ref.view.consumeRadius;
        if (
          consumeRadius !== undefined &&
          sweptCircleHit(
            position,
            nextPosition,
            body.position,
            body.position,
            consumeRadius,
          )
        ) {
          outcome = 'consumed';
          break;
        }
        if (
          body.ref.view.hazardousToArk &&
          sweptCircleHit(
            position,
            nextPosition,
            body.position,
            body.position,
            arkSpec.radius + body.ref.view.radius,
          )
        ) {
          outcome = 'collision';
          break;
        }
      }
    }

    if (outcome === 'none') {
      const required =
        snapshot.mission?.resonanceRequired ??
        level.mission?.requiredResonance ??
        0;
      const count = snapshot.mission?.resonanceCount ?? 0;
      const gateOpen =
        !level.mission?.gateRequiresResonance || count >= required;
      const speed = Math.hypot(nextVelocity.x, nextVelocity.y);
      if (
        gateOpen &&
        circleInsideDock(
          nextPosition,
          arkSpec.radius,
          level.dock.center,
          level.dock.radius,
        ) &&
        speed <= level.dock.maxEntrySpeed
      ) {
        outcome = 'dock';
      }
    }

    points.push({
      x: nextPosition.x,
      y: nextPosition.y,
      t,
      outcome,
    });

    position = nextPosition;
    velocity = nextVelocity;

    if (outcome !== 'none') break;
  }

  return points;
}

export function predictionColor(
  outcome: PredictionOutcome,
): 'neutral' | 'danger' | 'success' {
  if (outcome === 'collision' || outcome === 'consumed' || outcome === 'out-of-bounds') {
    return 'danger';
  }
  if (outcome === 'dock') return 'success';
  return 'neutral';
}
