import type { LevelSpec } from '../shared/contracts';
import { CONTRACT_VERSION } from '../shared/contracts';

/**
 * Chapter 1 · Solar Exodus (compressed vertical slice).
 * Four resonance anchors orbit a dying sun. After the ark clears Mars, the sun
 * collapses and a shockwave expands from its center. Reach the Pluto gate with
 * all four resonances and ≤ 60 speed before the wave catches the ark.
 */
export const levelSolarExodus: LevelSpec = {
  contractVersion: CONTRACT_VERSION,
  id: 'solar-exodus',
  title: '逃离太阳系',
  world: { width: 1200, height: 720 },
  seed: 3141,
  physics: {
    fixedDt: 1 / 60,
    maxBodySpeed: 160,
    maxTotalAcceleration: 140,
    maxCatchUpSteps: 6,
  },
  players: [
    {
      id: 'attractor',
      spawn: { x: 230, y: 430 },
      radius: 14,
      moveSpeed: 250,
      field: { radius: 300, strength: 2_000_000, softening: 75, maxAcceleration: 95 },
    },
    {
      id: 'repulsor',
      spawn: { x: 220, y: 620 },
      radius: 14,
      moveSpeed: 250,
      field: { radius: 300, strength: 2_000_000, softening: 75, maxAcceleration: 95 },
    },
  ],
  bodies: [
    {
      id: 'ark-01',
      kind: 'ark',
      position: { x: 140, y: 560 },
      velocity: { x: 48, y: -2 },
      radius: 11,
      receivesPlayerFields: true,
      receivesGravity: true,
      motionResponse: 1,
      hazardousToArk: false,
    },
    {
      id: 'sun-01',
      kind: 'star',
      position: { x: 600, y: 350 },
      velocity: { x: 0, y: 0 },
      radius: 88,
      receivesPlayerFields: true,
      receivesGravity: false,
      motionResponse: 0.02,
      hazardousToArk: true,
      gravity: { radius: 430, strength: 1_100_000, softening: 130, maxAcceleration: 30 },
    },
    {
      id: 'venus',
      kind: 'planet',
      position: { x: 300, y: 500 },
      velocity: { x: 0, y: 0 },
      radius: 20,
      receivesPlayerFields: false,
      receivesGravity: false,
      motionResponse: 0,
      hazardousToArk: true,
      gravity: { radius: 190, strength: 120_000, softening: 60, maxAcceleration: 11 },
    },
    {
      id: 'mercury',
      kind: 'planet',
      position: { x: 430, y: 150 },
      velocity: { x: 0, y: 0 },
      radius: 16,
      receivesPlayerFields: false,
      receivesGravity: false,
      motionResponse: 0,
      hazardousToArk: true,
      gravity: { radius: 170, strength: 90_000, softening: 55, maxAcceleration: 10 },
    },
    {
      id: 'mars',
      kind: 'planet',
      position: { x: 740, y: 155 },
      velocity: { x: 0, y: 0 },
      radius: 18,
      receivesPlayerFields: false,
      receivesGravity: false,
      motionResponse: 0,
      hazardousToArk: true,
      gravity: { radius: 180, strength: 100_000, softening: 55, maxAcceleration: 10 },
    },
    {
      id: 'jupiter',
      kind: 'planet',
      position: { x: 880, y: 520 },
      velocity: { x: 0, y: 0 },
      radius: 26,
      receivesPlayerFields: false,
      receivesGravity: false,
      motionResponse: 0,
      hazardousToArk: true,
      gravity: { radius: 250, strength: 180_000, softening: 70, maxAcceleration: 13 },
    },
  ],
  dock: {
    id: 'pluto-gate',
    center: { x: 1110, y: 560 },
    radius: 62,
    maxEntrySpeed: 60,
    kind: 'gate',
    label: '冥王星之门',
  },
  narrative: {
    chapter: 'SOLAR EXODUS',
    sector: 'SECTOR 01 · INNER SYSTEM',
    briefing: [
      '太阳比预言早死了十亿年。',
      '人类叫它天灾。只有你们知道：这是银河中心的一次呼吸。',
      '借行星的引力收集共振——四道主共振，才能跑赢太阳最后的呼吸。',
    ],
    success:
      '方舟越过冥王星轨道。太阳在身后变成一颗新星。人类第一次写下：我们离开了太阳系。',
    failure: {
      collision: '方舟被日冕吞没。从最近的引力锚点再来一次。',
      consumed: '太阳的最后一次呼吸追上了方舟。把缺掉的行星补回来。',
      'out-of-bounds': '方舟漂出了引力项链。回到行星链上。',
    },
    hints: [
      {
        id: 'solar-start',
        voice: 'court',
        title: '引力项链',
        text: '贴近行星的引力环，收集共振；远离日冕红色区域。',
      },
      {
        id: 'resonance-first',
        voice: 'system',
        text: '第一道共振已记录。四道共振全部集齐，冥王星之门才会开启。',
      },
      {
        id: 'sun-corridor',
        voice: 'system',
        title: 'CAUTION',
        text: '日冕之门 · 太阳引力增强 · 蓝场在前，金场在后。',
      },
      {
        id: 'solar-collapse',
        voice: 'court',
        title: '最后的呼吸',
        text: '太阳正在坍缩。冲击波即将出发，去冥王星之门！',
      },
      {
        id: 'gate-locked',
        voice: 'system',
        text: '共振不足 · 冥王星之门不会开启 · 回头补录还来得及。',
      },
      {
        id: 'gate-approach',
        voice: 'system',
        text: '冥王星之门 · 减速至 ≤ 60 后进入。',
      },
    ],
  },
  mission: {
    script: 'solar',
    objective: '收集四道引力共振，跑赢太阳冲击波',
    requiredResonance: 4,
    gateRequiresResonance: true,
    resonanceZones: [
      { id: 'res-venus', label: '金星', center: { x: 300, y: 500 }, radius: 95 },
      { id: 'res-mercury', label: '水星', center: { x: 430, y: 150 }, radius: 90 },
      { id: 'res-mars', label: '火星', center: { x: 740, y: 155 }, radius: 95 },
      { id: 'res-jupiter', label: '木星', center: { x: 880, y: 520 }, radius: 115 },
    ],
    shockwave: {
      origin: { x: 600, y: 350 },
      triggerX: 760,
      delaySeconds: 5,
      speed: 60,
    },
  },
};
