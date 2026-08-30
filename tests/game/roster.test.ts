import { describe, expect, it, vi } from 'vitest';

import {
  CHARACTER_IDS,
  CHARACTERS,
  type CharacterId,
} from '../../src/agents/characters.js';
import {
  createCharacterParticipant,
  selectNpcRoster,
} from '../../src/game/roster.js';

const EXPECTED_ROSTERS = new Map<number, readonly CharacterId[]>([
  [2, ['hunter']],
  [3, ['small-ball', 'calling-station']],
  [4, ['hunter', 'maniac', 'calling-station']],
  [5, ['rock', 'hunter', 'small-ball', 'value-bettor']],
  [6, ['rock', 'hunter', 'maniac', 'trapper', 'value-bettor']],
]);

describe('selectNpcRoster', () => {
  it.each([...EXPECTED_ROSTERS])(
    'returns the exact catalog-backed NPC roster for %i players',
    (playerCount, expectedRoster) => {
      const roster = selectNpcRoster(playerCount);

      expect(roster).toEqual(expectedRoster);
      expect(roster).toHaveLength(playerCount - 1);
      expect(new Set(roster).size).toBe(roster.length);
      for (const characterId of roster) {
        expect(CHARACTERS[characterId]).toBeDefined();
      }
    },
  );

  it.each([...EXPECTED_ROSTERS.keys()])(
    'returns a fresh frozen roster for %i players',
    (playerCount) => {
      const first = selectNpcRoster(playerCount);
      const second = selectNpcRoster(playerCount);

      expect(first).not.toBe(second);
      expect(Object.isFrozen(first)).toBe(true);
      expect(() => { (first as CharacterId[]).push('rock'); }).toThrow(TypeError);
    },
  );

  it.each([1, 7, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects unsupported player count %s',
    (playerCount) => {
      expect(() => selectNpcRoster(playerCount)).toThrow(/playerCount/i);
    },
  );

  it('does not consult ambient randomness or time', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('roster must not use randomness');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('roster must not use time');
    });

    expect(selectNpcRoster(6)).toEqual(EXPECTED_ROSTERS.get(6));
  });
});

describe('createCharacterParticipant', () => {
  it('uses only catalog-derived player names', () => {
    for (const characterId of CHARACTER_IDS) {
      const definition = CHARACTERS[characterId];
      const participant = createCharacterParticipant(characterId, { equitySamples: 20 });

      expect(participant.playerId).toBe(`${definition.displayName}“${definition.nickname}”`);
    }
  });
});
