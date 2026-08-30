import { describe, expect, it } from 'vitest';

import { parseCard } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { orderOddChipWinners, settleShowdown } from '../../src/core/settlement.js';
import { createTournament, type TournamentState } from '../../src/core/state.js';

function tiedState(
  contributions: readonly number[],
  folded: readonly number[],
  buttonPosition: number,
): TournamentState {
  const maxSeats = contributions.length;
  const tableConfig: TournamentConfig = {
    maxSeats,
    startingStack: 100,
    handsPerLevel: 8,
    blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
    initialButtonSeat: buttonPosition,
  };
  const base = createTournament(
    tableConfig,
    Array.from({ length: maxSeats }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
    'odd-chip-settlement',
  ).state;
  const holeCodes = [
    ['2c', '3d'], ['4c', '5d'], ['6c', '7d'], ['8c', '9d'], ['Tc', 'Jd'], ['Qc', 'Kd'],
  ] as const;
  return {
    ...base,
    seats: base.seats.map((seat, seatIndex) => ({
      ...seat,
      stack: 100 - contributions[seatIndex]!,
      status: folded.includes(seatIndex) ? 'folded' as const : 'active' as const,
      holeCards: holeCodes[seatIndex]!.map(parseCard) as unknown as readonly [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>],
      committedStreet: contributions[seatIndex]!,
      committedHand: contributions[seatIndex]!,
    })),
    activeHand: {
      handId: 'odd-chip-settlement/hand/1', phase: 'showdown', street: 'river',
      board: ['As', 'Ks', 'Qs', 'Js', 'Ts'].map(parseCard), burnedCards: [], deck: [],
      dealCursor: 0, revealedHoleCardSeats: [],
      positions: { buttonPosition, smallBlindSeat: null, bigBlindSeat: 0 },
      currentActorSeat: null, currentBetTo: 0, lastFullRaiseSize: 2,
      lastAggressorSeat: null, pendingActors: [],
    },
  };
}

describe('odd-chip order', () => {
  it('orders tied winners clockwise from the first winner left of the physical button', () => {
    expect(orderOddChipWinners([0, 2], 1, 4)).toEqual([2, 0]);
    expect(orderOddChipWinners([0, 3], 1, 4)).toEqual([3, 0]);
  });

  it('skips dead and empty physical seats without moving the button', () => {
    expect(orderOddChipWinners([0, 4], 1, 6)).toEqual([4, 0]);
  });

  it('distributes two remainder chips in a three-way tie', () => {
    const order = orderOddChipWinners([0, 2, 4], 1, 6);
    const awards = new Map(order.map((seat) => [seat, 33]));
    for (const seat of order.slice(0, 2)) {
      awards.set(seat, awards.get(seat)! + 1);
    }
    expect([...awards.entries()].sort(([left], [right]) => left - right)).toEqual([
      [0, 33], [2, 34], [4, 34],
    ]);
  });

  it('restarts the same physical-button order for every independently tied pot', () => {
    const first = orderOddChipWinners([0, 2], 1, 4);
    const second = orderOddChipWinners([0, 2], 1, 4);
    expect(first).toEqual([2, 0]);
    expect(second).toEqual([2, 0]);
    expect({ seat0: 101 / 2 | 0, seat2: (101 / 2 | 0) + 1 }).toEqual({ seat0: 50, seat2: 51 });
  });

  it('settles aggregate 101 as 50/51 for two tied winners', () => {
    const result = settleShowdown(tiedState([33, 34, 34], [0], 0));
    const awards = result.events.filter((event) => event.type === 'PotAwarded');
    expect(awards).toMatchObject([
      { potId: 'pot-0', winners: [1, 2], amounts: [51, 50], oddChipRecipients: [1] },
    ]);
    expect(result.state.seats.slice(1).map((seat) => seat.stack)).toEqual([117, 116]);
  });

  it('settles a three-way tie with remainder two in physical order', () => {
    const result = settleShowdown(tiedState([1, 1, 1, 1, 1], [1, 3], 1));
    expect(result.events.find((event) => event.type === 'PotAwarded')).toMatchObject({
      winners: [0, 2, 4],
      amounts: [1, 2, 2],
      oddChipRecipients: [2, 4],
    });
  });

  it('restarts odd-chip ordering for genuine main and side pots that both tie', () => {
    const result = settleShowdown(tiedState([1, 2, 2, 2, 1], [0, 2], 0));
    expect(result.events.filter((event) => event.type === 'PotAwarded')).toMatchObject([
      {
        potId: 'pot-0', winners: [1, 3, 4], amounts: [2, 2, 1], oddChipRecipients: [1, 3],
      },
      { potId: 'pot-1', winners: [1, 3], amounts: [2, 1], oddChipRecipients: [1] },
    ]);
  });
});
