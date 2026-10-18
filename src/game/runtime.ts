import type {
  BodySpec,
  BodyView,
  FailureReason,
  FrameSnapshot,
  GameCommand,
  GameEvent,
  GameRuntime,
  InputFrame,
  LevelSpec,
  MissionView,
  Phase,
  PlayerSpec,
  PlayerView,
  Vec2,
} from '../shared/contracts';
import { CONTRACT_VERSION } from '../shared/contracts';
import {
  add,
  clampLength,
  length,
  normalizeMove,
  scale,
} from '../physics/vec';
import { circleInsideDock, circleOutsideWorld, sweptCircleHit } from '../physics/collision';
import { fieldAcceleration, playerFieldAcceleration } from '../physics/field';
import {
  createMissionState,
  jetAcceleration,
  updateMission,
  type MissionState,
  type MissionUpdate,
} from './mission';
import { validateLevel } from './validate';

interface PlayerState {
  readonly spec: PlayerSpec;
  position: Vec2;
  previousPosition: Vec2;
  fieldActive: boolean;
}

interface BodyState {
  readonly spec: BodySpec;
  position: Vec2;
  velocity: Vec2;
  previousPosition: Vec2;
}

const ZERO: Vec2 = { x: 0, y: 0 };

export class ArkGame implements GameRuntime {
  private readonly registry = new Map<string, LevelSpec>();
  private level: LevelSpec;
  private runId = 0;
  private phase: Phase = 'ready';
  private tick = 0;

  private players: PlayerState[] = [];
  private bodies: BodyState[] = [];
  private ark!: BodyState;

  private events: GameEvent[] = [];
  private nextEventId = 0;

  private hintId: string | undefined;
  private hintUntilTick = 0;
  private missionState: MissionState = createMissionState();
  private missionView: MissionView | undefined;

  private dockOverspeed = false;
  private failureReason: FailureReason | undefined;

  constructor(level: LevelSpec, availableLevels?: readonly LevelSpec[]) {
    validateLevel(level);
    this.registry.set(level.id, level);

    for (const candidate of availableLevels ?? []) {
      const existing = this.registry.get(candidate.id);
      if (existing === candidate) continue;
      if (existing) {
        throw new Error(`Conflicting level definition for id ${candidate.id}`);
      }
      validateLevel(candidate);
      this.registry.set(candidate.id, candidate);
    }

    this.level = level;
    this.resetToLevel(level, false);
  }

  command(command: GameCommand): void {
    switch (command.type) {
      case 'toggle-pause': {
        if (this.phase === 'ready') this.changePhase('running');
        else if (this.phase === 'running') this.changePhase('paused');
        else if (this.phase === 'paused') this.changePhase('running');
        return;
      }
      case 'restart': {
        this.resetToLevel(this.level, true);
        return;
      }
      case 'load-level': {
        const next = this.registry.get(command.levelId);
        if (!next) throw new RangeError(`Unknown level id: ${command.levelId}`);
        validateLevel(next);
        this.resetToLevel(next, true);
        return;
      }
    }
  }

  step(input: InputFrame): void {
    const dt = this.level.physics.fixedDt;

    if (this.phase === 'ready') {
      for (const p of this.players) p.previousPosition = p.position;
      this.movePlayers(input, dt);
      for (const p of this.players) p.fieldActive = false;
      return;
    }
    if (this.phase !== 'running') return;

    for (const p of this.players) p.previousPosition = p.position;
    for (const b of this.bodies) b.previousPosition = b.position;

    this.movePlayers(input, dt);
    for (const p of this.players) {
      p.fieldActive = input.players[p.spec.id].fieldActive;
    }

    // All accelerations are computed from the same pre-integration body state.
    const accelerations = new Map<string, Vec2>();
    const nextTick = this.tick + 1;
    for (const body of this.bodies) {
      accelerations.set(body.spec.id, this.computeAcceleration(body, nextTick, dt));
    }

    for (const body of this.bodies) {
      if (body.spec.motionResponse === 0) {
        body.velocity = { x: 0, y: 0 };
        continue;
      }
      const a = accelerations.get(body.spec.id) ?? ZERO;
      let velocity = add(body.velocity, scale(a, dt));
      velocity = clampLength(velocity, this.level.physics.maxBodySpeed);
      if (!Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) velocity = ZERO;
      body.velocity = velocity;
      body.position = add(body.position, scale(velocity, dt));
    }

    this.tick = nextTick;

    const speed = length(this.ark.velocity);
    const planetSpeed = this.bodies.reduce((max, body) => {
      if (body.spec.kind !== 'planet') return max;
      return Math.max(max, length(body.velocity));
    }, 0);

    const missionUpdate = this.evaluateMission(dt, speed, planetSpeed);
    this.missionView = missionUpdate.view;

    let consumed = missionUpdate.waveHit;
    let collision = false;
    let collisionBodyId: string | undefined;

    for (const body of this.bodies) {
      if (body.spec.id === this.ark.spec.id) continue;
      const consumeRadius = body.spec.consumeRadius;
      if (
        consumeRadius !== undefined &&
        sweptCircleHit(
          this.ark.previousPosition,
          this.ark.position,
          body.previousPosition,
          body.position,
          consumeRadius,
        )
      ) {
        consumed = true;
      }
      if (
        body.spec.hazardousToArk &&
        sweptCircleHit(
          this.ark.previousPosition,
          this.ark.position,
          body.previousPosition,
          body.position,
          this.ark.spec.radius + body.spec.radius,
        )
      ) {
        collision = true;
        collisionBodyId = body.spec.id;
      }
    }

    const outOfBounds =
      circleOutsideWorld(
        this.ark.previousPosition,
        this.ark.spec.radius,
        this.level.world.width,
        this.level.world.height,
      ) ||
      circleOutsideWorld(
        this.ark.position,
        this.ark.spec.radius,
        this.level.world.width,
        this.level.world.height,
      );

    const insideDock = circleInsideDock(
      this.ark.position,
      this.ark.spec.radius,
      this.level.dock.center,
      this.level.dock.radius,
    );
    const docked =
      missionUpdate.gateOpen && insideDock && speed <= this.level.dock.maxEntrySpeed;
    this.dockOverspeed =
      missionUpdate.gateOpen && insideDock && speed > this.level.dock.maxEntrySpeed;

    // Failure priority: consumed > collision > out-of-bounds. Failure beats win.
    let failure: FailureReason | undefined;
    if (consumed) failure = 'consumed';
    else if (collision) failure = 'collision';
    else if (outOfBounds) failure = 'out-of-bounds';

    if (failure) {
      this.failureReason = failure;
      this.players.forEach((p) => (p.fieldActive = false));
      this.changePhase('lost');
      this.emit(
        failure === 'collision'
          ? { type: 'failed', reason: failure, bodyId: collisionBodyId }
          : { type: 'failed', reason: failure },
      );
      return;
    }

    if (docked) {
      this.players.forEach((p) => (p.fieldActive = false));
      this.changePhase('won');
      this.emit({ type: 'docked', entrySpeed: speed });
    }
  }

  snapshot(): FrameSnapshot {
    const players: PlayerView[] = this.players.map((p) => ({
      id: p.spec.id,
      previousPosition: { ...p.previousPosition },
      position: { ...p.position },
      radius: p.spec.radius,
      field: p.spec.field,
      fieldActive: this.phase === 'running' ? p.fieldActive : false,
    }));

    const bodies: BodyView[] = this.bodies.map((b) => ({
      id: b.spec.id,
      kind: b.spec.kind,
      previousPosition: { ...b.previousPosition },
      position: { ...b.position },
      velocity: { ...b.velocity },
      radius: b.spec.radius,
      hazardousToArk: b.spec.hazardousToArk,
      ...(b.spec.gravity ? { gravity: b.spec.gravity } : {}),
      ...(b.spec.consumeRadius !== undefined ? { consumeRadius: b.spec.consumeRadius } : {}),
    }));

    const hintVisible =
      this.hintId !== undefined && this.tick <= this.hintUntilTick ? this.hintId : undefined;

    return {
      contractVersion: CONTRACT_VERSION,
      runId: this.runId,
      levelId: this.level.id,
      phase: this.phase,
      tick: this.tick,
      elapsedSeconds: this.tick * this.level.physics.fixedDt,
      world: this.level.world,
      players,
      bodies,
      dock: this.level.dock,
      arkSpeed: length(this.ark.velocity),
      dockOverspeed: this.dockOverspeed,
      ...(this.failureReason ? { failureReason: this.failureReason } : {}),
      ...(hintVisible ? { hintId: hintVisible } : {}),
      ...(this.missionView ? { mission: { ...this.missionView } } : {}),
    };
  }

  drainEvents(): readonly GameEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  /* ------------------------------------------------------------------ */

  private resetToLevel(level: LevelSpec, incrementRun: boolean): void {
    if (incrementRun) this.runId += 1;
    this.level = level;
    this.phase = 'ready';
    this.tick = 0;

    this.players = level.players.map((spec) => ({
      spec,
      position: { ...spec.spawn },
      previousPosition: { ...spec.spawn },
      fieldActive: false,
    }));

    this.bodies = level.bodies.map((spec) => ({
      spec,
      position: { ...spec.position },
      velocity: { ...spec.velocity },
      previousPosition: { ...spec.position },
    }));

    const ark = this.bodies.find((b) => b.spec.kind === 'ark');
    if (!ark) throw new Error(`Level ${level.id}: ark missing after validation`);
    this.ark = ark;

    this.events = [];
    this.nextEventId = 0;
    this.hintId = undefined;
    this.hintUntilTick = 0;
    this.missionState = createMissionState();
    this.missionView = level.mission
      ? { script: level.mission.script, objective: level.mission.objective }
      : undefined;
    this.dockOverspeed = false;
    this.failureReason = undefined;

    this.emit({ type: 'phase-changed', phase: 'ready' });
  }

  private movePlayers(input: InputFrame, dt: number): void {
    const world = this.level.world;
    for (const p of this.players) {
      const playerInput = input.players[p.spec.id] ?? { move: ZERO, fieldActive: false };
      const dir = normalizeMove(playerInput.move);
      const next = add(p.position, scale(dir, p.spec.moveSpeed * dt));
      const r = p.spec.radius;
      const minX = Math.min(r, world.width / 2);
      const maxX = Math.max(world.width - r, world.width / 2);
      const minY = Math.min(r, world.height / 2);
      const maxY = Math.max(world.height - r, world.height / 2);
      p.position = {
        x: Math.max(minX, Math.min(maxX, next.x)),
        y: Math.max(minY, Math.min(maxY, next.y)),
      };
    }
  }

  private computeAcceleration(body: BodyState, tick: number, dt: number): Vec2 {
    if (body.spec.motionResponse === 0) return ZERO;

    let ax = 0;
    let ay = 0;

    if (body.spec.receivesGravity) {
      for (const source of this.bodies) {
        if (source.spec.id === body.spec.id || !source.spec.gravity) continue;
        const a = fieldAcceleration(body.position, source.position, source.spec.gravity, 1);
        ax += a.x;
        ay += a.y;
      }
    }

    if (body.spec.receivesPlayerFields) {
      for (const p of this.players) {
        if (!p.fieldActive) continue;
        const a = playerFieldAcceleration(body.position, p.position, p.spec.field, p.spec.id);
        ax += a.x;
        ay += a.y;
      }
    }

    // Per-source clamps happened inside fieldAcceleration. Now:
    // total vector × motionResponse → total acceleration clamp.
    let effective = scale({ x: ax, y: ay }, body.spec.motionResponse);
    effective = clampLength(effective, this.level.physics.maxTotalAcceleration);

    if (body.spec.kind === 'ark') {
      const jet = jetAcceleration(this.level.mission?.jet, body.position, tick, dt);
      if (jet.x !== 0 || jet.y !== 0) {
        effective = clampLength(add(effective, jet), this.level.physics.maxTotalAcceleration);
      }
    }

    if (!Number.isFinite(effective.x) || !Number.isFinite(effective.y)) return ZERO;
    return effective;
  }

  private evaluateMission(dt: number, speed: number, planetSpeed: number): MissionUpdate {
    return updateMission({
      level: this.level,
      players: this.players.map((p) => ({
        id: p.spec.id,
        spawn: p.spec.spawn,
        position: p.position,
        fieldActive: p.fieldActive,
        fieldRadius: p.spec.field.radius,
      })),
      ark: {
        position: this.ark.position,
        velocity: this.ark.velocity,
        radius: this.ark.spec.radius,
      },
      tick: this.tick,
      fixedDt: dt,
      phase: this.phase,
      speed,
      dock: this.level.dock,
      dockOverspeed: this.dockOverspeed,
      planetSpeed,
      state: this.missionState,
      setHint: (id: string, seconds?: number) => this.setHint(id, seconds),
    });
  }

  private setHint(id: string, seconds = 6): void {
    const dt = this.level.physics.fixedDt;
    this.hintId = id;
    this.missionState.hintId = id;
    this.hintUntilTick =
      seconds > 1e9 ? Number.MAX_SAFE_INTEGER : this.tick + Math.max(1, Math.ceil(seconds / dt));
    this.emit({ type: 'hint', hintId: id });
  }

  private changePhase(next: Phase): void {
    if (this.phase === next) return;
    this.phase = next;
    if (next !== 'running') {
      this.players.forEach((p) => (p.fieldActive = false));
    }
    this.emit({ type: 'phase-changed', phase: next });
  }

  private emit(
    event:
      | { type: 'phase-changed'; phase: Phase }
      | { type: 'failed'; reason: FailureReason; bodyId?: string }
      | { type: 'docked'; entrySpeed: number }
      | { type: 'hint'; hintId: string },
  ): void {
    this.events.push({
      ...event,
      runId: this.runId,
      eventId: this.nextEventId++,
      tick: this.tick,
    } as GameEvent);
  }
}
