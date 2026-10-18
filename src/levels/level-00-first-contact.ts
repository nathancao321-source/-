import type { LevelSpec } from '../shared/contracts';
import { CONTRACT_VERSION } from '../shared/contracts';

/** Chapter 0a · First Contact — movement, attraction, repulsion, stacking. */
export const levelFirstContact: LevelSpec = {
  contractVersion: CONTRACT_VERSION,
  id: 'first-contact',
  title: '第一次牵引',
  world: { width: 1200, height: 720 },
  seed: 1042,
  physics: {
    fixedDt: 1 / 60,
    maxBodySpeed: 150,
    maxTotalAcceleration: 140,
    maxCatchUpSteps: 6,
  },
  players: [
    {
      id: 'attractor',
      spawn: { x: 360, y: 250 },
      radius: 14,
      moveSpeed: 240,
      field: { radius: 300, strength: 1_800_000, softening: 70, maxAcceleration: 90 },
    },
    {
      id: 'repulsor',
      spawn: { x: 250, y: 500 },
      radius: 14,
      moveSpeed: 240,
      field: { radius: 300, strength: 1_800_000, softening: 70, maxAcceleration: 90 },
    },
  ],
  bodies: [
    {
      id: 'ark-01',
      kind: 'ark',
      position: { x: 160, y: 360 },
      velocity: { x: 40, y: 0 },
      radius: 11,
      receivesPlayerFields: true,
      receivesGravity: true,
      motionResponse: 1,
      hazardousToArk: false,
    },
  ],
  dock: {
    id: 'wormhole-01',
    center: { x: 1060, y: 360 },
    radius: 72,
    maxEntrySpeed: 999,
    kind: 'wormhole',
    label: '跃迁门',
  },
  narrative: {
    chapter: 'FIRST CONTACT',
    sector: 'SECTOR 00 · EARTH ORBIT',
    briefing: [
      '地球的最后一次日落已经过去。',
      '方舟在轨道上醒来。你们，是它未曾察觉的守护者。',
      '你们无法触碰飞船，只能改变它周围的引力。',
    ],
    success:
      '人类还没有看见你们，但他们已经学会，在黑暗中相信一点看不见的引力。',
    failure: {
      collision: '方舟撞上了天体。重试时更早改变航线。',
      consumed: '方舟被无法返回的边界吞没。',
      'out-of-bounds': '方舟漂出了信标覆盖区。重试时提前修正。',
    },
    hints: [
      {
        id: 'move-p1',
        title: '移动蓝色节点',
        voice: 'system',
        text: 'P1：用 WASD 移动蓝色节点，把它留在飞船右上方。',
      },
      {
        id: 'attract-p1',
        title: '开启吸引',
        voice: 'system',
        text: 'P1：按一次 F 开启蓝色吸引力；再按一次关闭。',
      },
      {
        id: 'watch-attract',
        title: '观察引力',
        voice: 'system',
        text: '保持蓝场开启并靠近飞船，观察航迹向蓝色节点弯曲。',
      },
      {
        id: 'move-p2',
        title: '移动金色节点',
        voice: 'system',
        text: 'P2：用方向键移动金色节点，把它留在飞船左下方。',
      },
      {
        id: 'repel-p2',
        title: '开启排斥',
        voice: 'system',
        text: 'P2：按一次 Enter 开启金色斥力；再按一次关闭。',
      },
      {
        id: 'both',
        title: '两场叠加',
        voice: 'system',
        text: '保持蓝场和金场同时覆盖飞船，观察两股力共同改变航迹。',
      },
      {
        id: 'release',
        title: '惯性入港',
        voice: 'system',
        text: '再按一次 F / Enter 关闭力场，让飞船惯性滑入绿环。',
      },
    ],
  },
  mission: {
    script: 'tutorial',
    objective: '护送方舟进入跃迁门',
  },
};
