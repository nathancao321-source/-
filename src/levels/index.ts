import type { LevelSpec } from '../shared/contracts';
import { levelFirstContact } from './level-00-first-contact';
import { levelMovingWorld } from './level-01-moving-world';
import { levelSolarExodus } from './level-02-solar-exodus';
import { levelBeyondHorizon } from './level-03-beyond-horizon';

/** Campaign order. The first level is the default entry point. */
export const levels: readonly LevelSpec[] = [
  levelFirstContact,
  levelMovingWorld,
  levelSolarExodus,
  levelBeyondHorizon,
];

export const levelById = new Map(levels.map((level) => [level.id, level]));

export {
  levelFirstContact,
  levelMovingWorld,
  levelSolarExodus,
  levelBeyondHorizon,
};
