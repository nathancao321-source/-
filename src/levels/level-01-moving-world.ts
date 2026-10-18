import type { LevelSpec } from '../shared/contracts';
import { CONTRACT_VERSION } from '../shared/contracts';

/** Chapter 0b · The Moving World — the planet responds to gravity; brake to dock. */
export const levelMovingWorld: LevelSpec = {
  contractVersion: CONTRACT_VERSION,
  id: 'moving-world',
  title: '会动的世界',
  world: { width: 1200, height: 720 },
  seed: 2048,
  physics: {
    fixedDt: 1 / 60,
    maxBodySpeed: 150,
    maxTotalAcceleration: 140,
    maxCatchUpSteps: 6,
  },
  players: [
    {
      id: 'attractor',
      spawn: { x: 300, y: 280 },
      radius: 14,
      moveSpeed: 240,
      field: { radius: 285, strength: 2_200_000, softening: 70, maxAcceleration: 95 },
    },
    {
      id: 'repulsor',
      spawn: { x: 250, y: 500 },
      radius: 14,
      moveSpeed: 240,
      field: { radius: 285, strength: 2_200_000, softening: 70, maxAcceleration: 95 },
    },
  ],
  bodies: [
    {
      id: 'ark-01',
      kind: 'ark',
      position: { x: 140, y: 360 },
      velocity: { x: 60, y: 0 },
      radius: 11,
      receivesPlayerFields: true,
      receivesGravity: true,
      motionResponse: 1,
      hazardousToArk: false,
    },
    {
      id: 'planet-01',
      kind: 'planet',
      position: { x: 600, y: 350 },
      velocity: { x: 0, y: 0 },
      radius: 62,
      receivesPlayerFields: true,
      receivesGravity: false,
      motionResponse: 0.15,
      hazardousToArk: true,
      gravity: { radius: 280, strength: 260_000, softening: 90, maxAcceleration: 18 },
    },
    {
      id: 'asteroid-01',
      kind: 'asteroid',
      position: { x: 770, y: 560 },
      velocity: { x: -8, y: -4 },
      radius: 15,
      receivesPlayerFields: true,
      receivesGravity: true,
      motionResponse: 1,
      hazardousToArk: true,
    },
  ],
  dock: {
    id: 'departure-port',
    center: { x: 1050, y: 360 },
    radius: 82,
    maxEntrySpeed: 48,
    kind: 'dock',
    label: '告别港',
  },
  narrative: {
    chapter: 'THE MOVING WORLD',
    sector: 'SECTOR 00 · DEPARTURE PORT',
    briefing: [
      '虫洞另一端，一颗行星被太阳的潮汐推离了轨道。',
      '它正缓缓横在航道上。世界会回应你们。',
    ],
    success:
      '领航员沈青：泊位已锁定。船体完整，全员在眠。潮汐仪记录到两道无法解释的力场。……有人在帮我们。',
    failure: {
      collision: '方舟撞上天体。提前绕行，或先用金场推开它。',
      consumed: '方舟坠入了无法返回的引力井。',
      'out-of-bounds': '方舟掠过了告别港，漂出信标区。提前减速。',
    },
    hints: [
      {
        id: 'planet-start',
        voice: 'court',
        title: '会动的世界',
        text: '行星也会回应你们的引力。它不再是背景。',
      },
      {
        id: 'planet-awake',
        voice: 'system',
        title: 'CAUTION',
        text: '当心，行星也会被你吸引！',
      },
      {
        id: 'route-up',
        voice: 'system',
        text: '蓝色在前方牵引，金色从下方推离；为方舟留出绕行空间。',
      },
      {
        id: 'approach',
        voice: 'system',
        text: '告别港在右侧。一人修正位置，一人提前站到船头减速。',
      },
      {
        id: 'slow-dock',
        voice: 'system',
        text: '速度仍然过快。金色站到船头方向，推回它的速度。',
      },
    ],
  },
  mission: {
    script: 'planet',
    objective: '避开行星，以 ≤ 48 的速度泊入告别港',
  },
};
