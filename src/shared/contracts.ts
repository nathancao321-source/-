/** THE LAST ARK · agent integration contract v0.2.0.
 * Screen/world units: logical pixels, seconds, px/s and px/s².
 * Simulation owns mutable state. Renderers receive detached readonly snapshots.
 *
 * v0.2 is an additive, backwards-compatible extension over v0.1:
 * - optional LevelSpec.mission (campaign scripts: tutorial / planet / solar / blackhole)
 * - optional FrameSnapshot.mission (HUD-facing mission state)
 * - optional voice metadata on narrative hints
 * - optional DockSpec.kind/label for wormholes and gates
 * All v0.1 fields keep their exact meaning and ordering.
 */
export const CONTRACT_VERSION = '0.2.0' as const;
export type EntityId = string;
export type PlayerId = 'attractor' | 'repulsor';
export type BodyKind = 'ark' | 'asteroid' | 'planet' | 'star' | 'blackHole';
export type Phase = 'ready' | 'running' | 'paused' | 'won' | 'lost';
export type FailureReason = 'collision' | 'consumed' | 'out-of-bounds';
export interface Vec2 { readonly x: number; readonly y: number }
export interface FieldSpec {
  readonly radius: number;
  readonly strength: number; // px³/s²; softened inverse-square coefficient
  readonly softening: number; // px, strictly positive
  readonly maxAcceleration: number; // px/s², per source
}
export interface PlayerSpec {
  readonly id: PlayerId;
  readonly spawn: Vec2;
  readonly radius: number;
  readonly moveSpeed: number;
  readonly field: FieldSpec;
}
export interface BodySpec {
  readonly id: EntityId;
  readonly kind: BodyKind;
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly radius: number;
  readonly receivesPlayerFields: boolean;
  readonly receivesGravity: boolean;
  /** Multiply total acceleration by this value; 1 for ark/asteroids,
   * typically 0.002 for large bodies. This is a gameplay simplification.
   * Must be in [0,1]. Zero requires zero initial velocity and skips integration;
   * it is reserved for explicitly immobile scenery. */
  readonly motionResponse: number;
  readonly hazardousToArk: boolean;
  readonly gravity?: FieldSpec;
  readonly consumeRadius?: number; // black hole, center-distance threshold
}
export interface DockSpec {
  readonly id: EntityId;
  readonly center: Vec2;
  readonly radius: number; // entire ark collision circle must fit inside
  readonly maxEntrySpeed: number; // inclusive, px/s
  readonly kind?: 'dock' | 'wormhole' | 'gate';
  readonly label?: string;
}
export type NarrativeVoice = 'court' | 'ark' | 'system';
export interface NarrativeHint {
  readonly id: string;
  readonly text: string;
  readonly voice?: NarrativeVoice;
  readonly title?: string;
}
export interface NarrativeSpec {
  readonly briefing: readonly string[];
  readonly success: string;
  readonly failure: Readonly<Record<FailureReason, string>>;
  readonly hints: readonly NarrativeHint[];
  /** English chapter label shown next to the Chinese title. */
  readonly chapter?: string;
  /** Short label for the sector / map corner. */
  readonly sector?: string;
}

/* ------------------------------------------------------------------ *
 * Campaign mission layer (v0.2, optional).
 * Physics never depends on these fields; they are read by the mission
 * script in src/game/mission.ts to add objectives, timers and set pieces.
 * ------------------------------------------------------------------ */
export type MissionScript = 'tutorial' | 'planet' | 'solar' | 'blackhole';

export interface ResonanceZoneSpec {
  readonly id: string;
  readonly label: string;
  readonly center: Vec2;
  readonly radius: number;
}

export interface ShockwaveSpec {
  readonly origin: Vec2;
  /** Wave begins after the ark's x first exceeds this value. */
  readonly triggerX: number;
  /** Seconds between the trigger and the wave starting to expand. */
  readonly delaySeconds: number;
  /** Expansion speed, px/s. */
  readonly speed: number;
}

export interface GammaJetSpec {
  readonly center: Vec2;
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** Direction of the jet; normalized by the engine. */
  readonly direction: Vec2;
  readonly periodSeconds: number;
  readonly activeSeconds: number;
  /** Extra acceleration applied to the ark while inside an active jet. */
  readonly force: number;
}

export interface MissionSpec {
  readonly script: MissionScript;
  /** HUD objective line, kept short. */
  readonly objective: string;
  readonly resonanceZones?: readonly ResonanceZoneSpec[];
  readonly requiredResonance?: number;
  readonly shockwave?: ShockwaveSpec;
  readonly jet?: GammaJetSpec;
  /** Dock only accepts the ark after the resonance target is met. */
  readonly gateRequiresResonance?: boolean;
}

export interface MissionView {
  readonly script: MissionScript;
  readonly objective: string;
  readonly progress?: string;
  readonly alert?: string;
  readonly status?: string;
  readonly countdown?: number;
  readonly waveRadius?: number;
  readonly jetActive?: boolean;
  readonly resonanceCount?: number;
  readonly resonanceRequired?: number;
  readonly resonanceFlags?: readonly boolean[];
}
export interface LevelSpec {
  readonly contractVersion: typeof CONTRACT_VERSION;
  readonly id: string;
  readonly title: string;
  readonly world: { readonly width: number; readonly height: number };
  readonly seed: number;
  readonly physics: {
    readonly fixedDt: number;
    readonly maxBodySpeed: number;
    readonly maxTotalAcceleration: number;
    readonly maxCatchUpSteps: number;
  };
  readonly players: readonly [PlayerSpec, PlayerSpec];
  readonly bodies: readonly BodySpec[]; // exactly one ark; unique IDs
  readonly dock: DockSpec;
  readonly narrative: NarrativeSpec;
  readonly mission?: MissionSpec;
}
export interface PlayerInput {
  readonly move: Vec2; // each axis in [-1, 1]; simulation normalizes diagonals
  readonly fieldActive: boolean;
}
export interface InputFrame {
  readonly players: Readonly<Record<PlayerId, PlayerInput>>;
}
/** Keydown edge only; repeat suppressed. Commands are queued in DOM order. */
export type GameCommand =
  | { readonly type: 'toggle-pause' }
  | { readonly type: 'restart' }
  | { readonly type: 'load-level'; readonly levelId: string };
export interface PlayerView {
  readonly id: PlayerId;
  readonly previousPosition: Vec2;
  readonly position: Vec2;
  readonly radius: number;
  readonly field: FieldSpec;
  readonly fieldActive: boolean; // effective field; false outside running phase
}
export interface BodyView {
  readonly id: EntityId;
  readonly kind: BodyKind;
  readonly previousPosition: Vec2;
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly radius: number;
  readonly gravity?: FieldSpec;
  readonly consumeRadius?: number;
  readonly hazardousToArk: boolean;
}
export interface FrameSnapshot {
  readonly contractVersion: typeof CONTRACT_VERSION;
  readonly runId: number; // increments on every restart/load; tick may return to 0
  readonly levelId: string;
  readonly phase: Phase;
  readonly tick: number; // advances only when phase === running
  readonly elapsedSeconds: number; // tick * fixedDt
  readonly world: LevelSpec['world'];
  readonly players: readonly PlayerView[];
  readonly bodies: readonly BodyView[];
  readonly dock: DockSpec;
  readonly arkSpeed: number;
  /** Entire ark collision circle is inside dock, but speed > maxEntrySpeed.
   * Warning only; slowing down inside the dock may subsequently win. */
  readonly dockOverspeed: boolean;
  readonly failureReason?: FailureReason;
  readonly hintId?: string;
  readonly mission?: MissionView;
}
export type GameEvent = {
  readonly runId: number;
  readonly eventId: number; // monotonic within this run, deduplicate by runId+eventId
  readonly tick: number;
} & (
  | { readonly type: 'phase-changed'; readonly phase: Phase }
  | { readonly type: 'failed'; readonly reason: FailureReason; readonly bodyId?: EntityId }
  | { readonly type: 'docked'; readonly entrySpeed: number }
  | { readonly type: 'hint'; readonly hintId: string }
);
export interface GameRuntime {
  /** Unknown load-level id throws RangeError without mutating state.
   * Loading a known level increments runId and resets to ready. */
  command(command: GameCommand): void;
  /** One fixed tick when running; ready permits player-only repositioning.
   * Paused/won/lost do not mutate positions. Never supply browser frame dt. */
  step(input: InputFrame): void;
  snapshot(): FrameSnapshot;
  drainEvents(): readonly GameEvent[]; // drained once by host; renderer consumes a copy
}
export interface InputAdapter {
  sample(): InputFrame;
  drainCommands(): readonly GameCommand[];
  clear(): void; // blur/visibilitychange; prevents stuck movement/fields
  dispose(): void;
}
/** Ordered actions also record ready-state positioning, when tick does not advance.
 * Commands occur between steps; one step entry expands to N identical InputFrames.
 * Check levelContentHash against the complete canonicalized LevelSpec before replay. */
export type ReplayAction =
  | { readonly type: 'command'; readonly command: GameCommand }
  | { readonly type: 'step'; readonly count: number; readonly input: InputFrame };
export interface InputReplay {
  readonly contractVersion: typeof CONTRACT_VERSION;
  readonly levelId: string;
  readonly levelContentHash: string; // SHA-256, lowercase hex, harness-defined canonical JSON
  readonly fixedDt: number;
  readonly actions: readonly ReplayAction[];
}
export interface LevelDirectoryEntry {
  readonly id: string;
  readonly label?: string;
  readonly title: string;
  readonly chapter?: string;
  readonly sector?: string;
  readonly objective?: string;
}
export interface LevelMenuView {
  readonly open: boolean;
  readonly index: number;
  readonly levels: readonly LevelDirectoryEntry[];
}
export interface RenderFrame {
  readonly snapshot: FrameSnapshot;
  readonly events: readonly GameEvent[];
  readonly interpolationAlpha: number; // [0,1]; use 1 outside running phase
  readonly visualTimeSeconds: number; // wall time; never fed back into simulation
  readonly narrative: NarrativeSpec;
  /** Static level geometry (resonance rings, jet column, dock labels).
   * Read-only scene data; the renderer must never write to it. */
  readonly level?: LevelSpec;
  readonly campaign?: {
    readonly index: number;
    readonly total: number;
    readonly hasNext: boolean;
  };
  /** Chapter directory overlay; controlled by the host. */
  readonly menu?: LevelMenuView;
}
export interface CanvasRenderer {
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  render(frame: RenderFrame): void;
  dispose(): void;
}
export type GameFactory = (
  level: LevelSpec,
  availableLevels?: readonly LevelSpec[],
) => GameRuntime;
/** Factory registry always includes the initial level. Reject conflicting duplicate IDs
 * during construction. main resolves the current LevelSpec by snapshot.levelId.
 * Factory ownership: agent 3 exports createGame: GameFactory from game/;
 * agent 2 exports createRenderer(canvas): CanvasRenderer from render/;
 * agent 1 exports levels: readonly LevelSpec[] from levels/index.ts.
 * main.ts (agent 3) is the only integration composition root. */
