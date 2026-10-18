import type {
  DockSpec,
  GammaJetSpec,
  LevelSpec,
  MissionView,
  Phase,
  Vec2,
} from '../shared/contracts';
import { distance } from '../physics/vec';

export interface MissionPlayer {
  readonly id: 'attractor' | 'repulsor';
  readonly spawn: Vec2;
  readonly position: Vec2;
  readonly fieldActive: boolean;
  readonly fieldRadius: number;
}

export interface MissionArk {
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly radius: number;
}

export interface MissionState {
  visited: Set<string>;
  emitted: Set<string>;
  hintId: string | null;
  hintUntilTick: number;
  collapsed: boolean;
  waveStartTick: number | null;
  tutorialStep: number;
  p1FieldTicks: number;
  p2FieldTicks: number;
  bothFieldTicks: number;
  p1CoverTicks: number;
  planetWasPerturbed: boolean;
}

export interface MissionContext {
  readonly level: LevelSpec;
  readonly players: readonly MissionPlayer[];
  readonly ark: MissionArk;
  readonly tick: number;
  readonly fixedDt: number;
  readonly phase: Phase;
  readonly speed: number;
  readonly dock: DockSpec;
  readonly dockOverspeed: boolean;
  /** Fastest non-ark, field-responsive body; used by the planet tutorial. */
  readonly planetSpeed: number;
  readonly state: MissionState;
  setHint(id: string, seconds?: number): void;
}

export interface MissionUpdate {
  readonly view: MissionView | undefined;
  readonly gateOpen: boolean;
  readonly waveHit: boolean;
}

export function createMissionState(): MissionState {
  return {
    visited: new Set<string>(),
    emitted: new Set<string>(),
    hintId: null,
    hintUntilTick: 0,
    collapsed: false,
    waveStartTick: null,
    tutorialStep: 0,
    p1FieldTicks: 0,
    p2FieldTicks: 0,
    bothFieldTicks: 0,
    p1CoverTicks: 0,
    planetWasPerturbed: false,
  };
}

export function isJetActive(jet: GammaJetSpec | undefined, tick: number, fixedDt: number): boolean {
  if (!jet) return false;
  const periodTicks = Math.max(1, Math.round(jet.periodSeconds / fixedDt));
  const activeTicks = Math.max(1, Math.round(jet.activeSeconds / fixedDt));
  return tick % periodTicks < activeTicks;
}

export function jetAcceleration(
  jet: GammaJetSpec | undefined,
  position: Vec2,
  tick: number,
  fixedDt: number,
): Vec2 {
  if (!jet || !isJetActive(jet, tick, fixedDt)) return { x: 0, y: 0 };
  const inside =
    Math.abs(position.x - jet.center.x) <= jet.halfWidth &&
    Math.abs(position.y - jet.center.y) <= jet.halfHeight;
  if (!inside) return { x: 0, y: 0 };
  const len = Math.hypot(jet.direction.x, jet.direction.y);
  if (len <= 1e-9) return { x: 0, y: 0 };
  return {
    x: (jet.direction.x / len) * jet.force,
    y: (jet.direction.y / len) * jet.force,
  };
}

function once(ctx: MissionContext, id: string, seconds = 6): void {
  if (ctx.state.emitted.has(id)) return;
  ctx.state.emitted.add(id);
  ctx.setHint(id, seconds);
}

function tutorialHintForStep(step: number): string | null {
  switch (step) {
    case 0:
      return 'move-p1';
    case 1:
      return 'attract-p1';
    case 2:
      return 'watch-attract';
    case 3:
      return 'move-p2';
    case 4:
      return 'repel-p2';
    case 5:
      return 'both';
    case 6:
      return 'release';
    default:
      return null;
  }
}

function updateTutorial(ctx: MissionContext): MissionUpdate {
  const p1 = ctx.players.find((p) => p.id === 'attractor')!;
  const p2 = ctx.players.find((p) => p.id === 'repulsor')!;
  const s = ctx.state;

  const step = s.tutorialStep;
  if (step === 0 && distance(p1.position, p1.spawn) >= 8) s.tutorialStep = 1;
  else if (step === 1) {
    if (p1.fieldActive) s.p1FieldTicks += 1;
    if (s.p1FieldTicks >= 12) s.tutorialStep = 2;
  } else if (step === 2) {
    if (p1.fieldActive && distance(p1.position, ctx.ark.position) <= p1.fieldRadius) {
      s.p1CoverTicks += 1;
    }
    if (s.p1CoverTicks >= 40) s.tutorialStep = 3;
  } else if (step === 3 && distance(p2.position, p2.spawn) >= 8) s.tutorialStep = 4;
  else if (step === 4) {
    if (p2.fieldActive) s.p2FieldTicks += 1;
    if (s.p2FieldTicks >= 12) s.tutorialStep = 5;
  } else if (step === 5) {
    if (p1.fieldActive && p2.fieldActive) s.bothFieldTicks += 1;
    if (s.bothFieldTicks >= 40) s.tutorialStep = 6;
  } else if (step === 6) {
    if (distance(ctx.ark.position, ctx.dock.center) <= 260) s.tutorialStep = 7;
  }

  const hint = tutorialHintForStep(s.tutorialStep);
  if (hint && s.hintId !== hint) ctx.setHint(hint, Number.MAX_SAFE_INTEGER);

  const view: MissionView = {
    script: 'tutorial',
    objective: ctx.level.mission?.objective ?? '护送方舟进入跃迁门',
    progress: `教学 ${Math.min(s.tutorialStep, 7)} / 7`,
  };
  return { view, gateOpen: true, waveHit: false };
}

function updatePlanet(ctx: MissionContext): MissionUpdate {
  const s = ctx.state;
  if (ctx.tick === 1) once(ctx, 'planet-start', 9);

  if (ctx.planetSpeed >= 2) {
    s.planetWasPerturbed = true;
    once(ctx, 'planet-awake', 7);
  }
  if (ctx.ark.position.x > 340) once(ctx, 'route-up', 7);
  if (ctx.ark.position.x > 760) once(ctx, 'approach', 7);
  if (ctx.dockOverspeed) once(ctx, 'slow-dock', 5);

  const view: MissionView = {
    script: 'planet',
    objective: ctx.level.mission?.objective ?? '避开行星，低速泊入告别港',
    progress: `速度 ${ctx.speed.toFixed(0)} / ≤ ${ctx.dock.maxEntrySpeed.toFixed(0)}`,
    status: s.planetWasPerturbed ? '行星正在回应你们的引力' : undefined,
  };
  return { view, gateOpen: true, waveHit: false };
}

function updateSolar(ctx: MissionContext): MissionUpdate {
  const mission = ctx.level.mission!;
  const s = ctx.state;
  const zones = mission.resonanceZones ?? [];
  const required = mission.requiredResonance ?? zones.length;

  for (const zone of zones) {
    if (s.visited.has(zone.id)) continue;
    if (distance(ctx.ark.position, zone.center) <= zone.radius) {
      s.visited.add(zone.id);
      if (s.visited.size === 1) once(ctx, 'resonance-first', 6);
    }
  }

  const sun = ctx.level.bodies.find((b) => b.kind === 'star');
  if (sun && distance(ctx.ark.position, sun.position) <= 210) {
    once(ctx, 'sun-corridor', 6);
  }

  const count = s.visited.size;
  const gateOpen = !mission.gateRequiresResonance || count >= required;

  let waveRadius = 0;
  let waveHit = false;
  let countdown: number | undefined;
  let alert: string | undefined;

  const wave = mission.shockwave;
  if (wave) {
    if (!s.collapsed && ctx.ark.position.x >= wave.triggerX) {
      s.collapsed = true;
      s.waveStartTick = ctx.tick + Math.round(wave.delaySeconds / ctx.fixedDt);
      once(ctx, 'solar-collapse', 8);
    }

    if (s.collapsed && s.waveStartTick !== null) {
      if (ctx.tick >= s.waveStartTick) {
        waveRadius = (ctx.tick - s.waveStartTick) * ctx.fixedDt * wave.speed;
        const ahead = distance(ctx.ark.position, wave.origin) - waveRadius;
        countdown = Math.max(0, ahead / wave.speed);
        waveHit = ahead <= 0;
        alert = `冲击波将在 ${countdown.toFixed(1)} 秒后抵达`;
      } else {
        const delayLeft = (s.waveStartTick - ctx.tick) * ctx.fixedDt;
        countdown = delayLeft;
        alert = `太阳正在坍缩 · 冲击波 ${Math.ceil(delayLeft)} 秒后出发`;
      }
    }
  }

  if (!gateOpen) {
    const nearGate = distance(ctx.ark.position, ctx.dock.center) <= 280;
    if (nearGate) {
      alert = `共振 ${count}/${required} · 还差 ${required - count} 道 · 回头补录`;
      once(ctx, 'gate-locked', 6);
    }
  } else if (distance(ctx.ark.position, ctx.dock.center) <= 260) {
    once(ctx, 'gate-approach', 5);
  }

  const view: MissionView = {
    script: 'solar',
    objective: mission.objective,
    progress: `共振 ${count} / ${required}`,
    alert,
    countdown,
    waveRadius,
    resonanceCount: count,
    resonanceRequired: required,
    resonanceFlags: zones.map((zone) => s.visited.has(zone.id)),
    status: gateOpen ? '冥王星之门已开启' : `还差 ${required - count} 道共振`,
  };
  return { view, gateOpen, waveHit };
}

function updateBlackhole(ctx: MissionContext): MissionUpdate {
  const mission = ctx.level.mission!;
  const jet = mission.jet;
  const jetActive = isJetActive(jet, ctx.tick, ctx.fixedDt);

  if (ctx.tick === 1) once(ctx, 'bh-start', 8);

  const hole = ctx.level.bodies.find((b) => b.kind === 'blackHole');
  let alert: string | undefined;
  let status: string | undefined;
  if (hole) {
    const d = distance(ctx.ark.position, hole.position);
    const threshold = hole.consumeRadius ?? 60;
    status = `视界距离 ${Math.max(0, Math.round(d - threshold))}`;
    if (d < 360) once(ctx, 'bh-near', 6);
    if (d < 220) alert = '潮汐走廊 · 远离红色潮汐圈';
  }
  if (jetActive) {
    alert = '伽马喷流开启 · 对准白色喷流柱 · 借力上升';
    once(ctx, 'bh-jet', 6);
  }
  if (ctx.ark.position.x > 840) once(ctx, 'bh-exit', 6);

  const view: MissionView = {
    script: 'blackhole',
    objective: mission.objective,
    alert,
    status,
    jetActive,
  };
  return { view, gateOpen: true, waveHit: false };
}

export function updateMission(ctx: MissionContext): MissionUpdate {
  const mission = ctx.level.mission;
  if (!mission) return { view: undefined, gateOpen: true, waveHit: false };

  switch (mission.script) {
    case 'tutorial':
      return updateTutorial(ctx);
    case 'planet':
      return updatePlanet(ctx);
    case 'solar':
      return updateSolar(ctx);
    case 'blackhole':
      return updateBlackhole(ctx);
  }
}
