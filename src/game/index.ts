import type { GameFactory, LevelSpec } from '../shared/contracts';
import { ArkGame } from './runtime';

export function createGame(level: LevelSpec, availableLevels?: readonly LevelSpec[]) {
  return new ArkGame(level, availableLevels);
}

export const gameFactory: GameFactory = (level, availableLevels) =>
  new ArkGame(level, availableLevels);

export { ArkGame } from './runtime';
