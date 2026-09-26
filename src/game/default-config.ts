import type { TournamentConfig } from '../core/config.js';

export const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = Object.freeze({
  maxSeats: 4,
  startingStack: 100,
  handsPerLevel: 8,
  blindLevels: Object.freeze([
    Object.freeze({ smallBlind: 1, bigBlind: 2 }),
    Object.freeze({ smallBlind: 2, bigBlind: 4 }),
    Object.freeze({ smallBlind: 3, bigBlind: 6 }),
    Object.freeze({ smallBlind: 5, bigBlind: 10 }),
    Object.freeze({ smallBlind: 10, bigBlind: 20 }),
    Object.freeze({ smallBlind: 20, bigBlind: 40 }),
    Object.freeze({ smallBlind: 40, bigBlind: 80 }),
    Object.freeze({ smallBlind: 80, bigBlind: 160 }),
  ]),
  initialButtonSeat: 0,
});
