import type { LevelSpec } from '../shared/contracts';
import { CONTRACT_VERSION } from '../shared/contracts';

/**
 * Chapter 2 · Beyond the Horizon.
 * A fixed, unpushable black hole. Ride the gamma jet up through the tidal
 * corridor and dock at the galactic-edge gate at ≤ 65 speed.
 */
export const levelBeyondHorizon: LevelSpec = {
  contractVersion: CONTRACT_VERSION,
  id: 'beyond-horizon',
  title: '越过银河',
  world: { width: 1200, height: 720 },
  seed: 4210,
  physics: {
    fixedDt: 1 / 60,
    maxBodySpeed: 160,
    maxTotalAcceleration: 140,
    maxCatchUpSteps: 6,
  },
  players: [
    {
      id: 'attractor',
      spawn: { x: 220, y: 290 },
      radius: 14,
      moveSpeed: 250,
      field: { radius: 300, strength: 2_100_000, softening: 75, maxAcceleration: 108 },
    },
    {
      id: 'repulsor',
      spawn: { x: 220, y: 500 },
      radius: 14,
      moveSpeed: 250,
      field: { radius: 300, strength: 2_100_000, softening: 75, maxAcceleration: 108 },
    },
  ],
  bodies: [
    {
      id: 'ark-01',
      kind: 'ark',
      position: { x: 130, y: 420 },
      velocity: { x: 52, y: -3 },
      radius: 11,
      receivesPlayerFields: true,
      receivesGravity: true,
      motionResponse: 1,
      hazardousToArk: false,
    },
    {
      id: 'sagittarius-a',
      kind: 'blackHole',
      position: { x: 640, y: 360 },
      velocity: { x: 0, y: 0 },
      radius: 48,
      receivesPlayerFields: false,
      receivesGravity: false,
      motionResponse: 0,
      hazardousToArk: false,
      consumeRadius: 62,
      gravity: { radius: 520, strength: 1_250_000, softening: 120, maxAcceleration: 34 },
    },
    {
      id: 'debris-01',
      kind: 'asteroid',
      position: { x: 420, y: 610 },
      velocity: { x: 14, y: 0 },
      radius: 14,
      receivesPlayerFields: true,
      receivesGravity: false,
      motionResponse: 1,
      hazardousToArk: true,
    },
    {
      id: 'debris-02',
      kind: 'asteroid',
      position: { x: 760, y: 620 },
      velocity: { x: -10, y: 0 },
      radius: 16,
      receivesPlayerFields: true,
      receivesGravity: false,
      motionResponse: 1,
      hazardousToArk: true,
    },
    {
      id: 'debris-03',
      kind: 'asteroid',
      position: { x: 1020, y: 610 },
      velocity: { x: -16, y: 0 },
      radius: 12,
      receivesPlayerFields: true,
      receivesGravity: false,
      motionResponse: 1,
      hazardousToArk: true,
    },
  ],
  dock: {
    id: 'galactic-exit',
    center: { x: 1080, y: 170 },
    radius: 60,
    maxEntrySpeed: 65,
    kind: 'gate',
    label: '银河边缘出口',
  },
  narrative: {
    chapter: 'BEYOND THE HORIZON',
    sector: 'SECTOR 02 · GALACTIC CENTER',
    briefing: [
      '你们沿着杀死太阳的那道涟漪，来到银河中心。',
      '人类叫它 Sagittarius A*。潮汐之庭叫它：我们没能救下的那颗星。',
      '黑洞不能被推动。你们只能从它旁边经过。',
    ],
    success:
      '银河在身后合拢成一条光带。方舟第一次航行在没有太阳的风里。沈青在日志里写：我们出来了。有人还在吗？',
    failure: {
      collision: '方舟撞上了潮汐残骸。远离红圈，金场可以推开碎石。',
      consumed: '没有回声。方舟的名字从星图上消失。',
      'out-of-bounds': '方舟漂离了银河边缘出口。',
    },
    hints: [
      {
        id: 'bh-start',
        voice: 'court',
        title: '深渊',
        text: '它不回应引力，也不接受推动。从它的阴影之外经过。',
      },
      {
        id: 'bh-near',
        voice: 'court',
        text: '不要推它。它不在你们的力场里。',
      },
      {
        id: 'bh-jet',
        voice: 'system',
        text: '伽马喷流开启 · 对准白色喷流柱 · 借力上升',
      },
      {
        id: 'bh-exit',
        voice: 'system',
        text: '银河边缘跃迁出口 · 减速至 ≤ 65 后进入。',
      },
    ],
  },
  mission: {
    script: 'blackhole',
    objective: '绕过视界，借伽马喷流抵达银河边缘出口',
    jet: {
      center: { x: 640, y: 360 },
      halfWidth: 72,
      halfHeight: 250,
      direction: { x: 0, y: -1 },
      periodSeconds: 6,
      activeSeconds: 1.8,
      force: 38,
    },
  },
};
