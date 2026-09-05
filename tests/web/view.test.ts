import { describe, expect, it } from 'vitest';
import { advanceTableView } from '../../src/web/view.js';
import type { TurnPacket } from '../../src/game/turn-packet.js';

describe('public table view', () => {
  it('keeps a folded hero hand and displays an all-in call at the actual paid total', () => {
    const packet: TurnPacket = {
      schemaVersion: 1, packetIndex: 0,
      coreEventRange: { fromVersionInclusive: 0, toVersionExclusive: 9 },
      privateEventsSinceLastPacket: [], kind: 'game-result', winnerSeatIndex: 1,
      finalStacks: [{ seatIndex: 0, stack: 0 }, { seatIndex: 1, stack: 200 }],
      viewerEventsSinceLastPacket: [
        { type: 'gameStarted', maxSeats: 2, startingStack: 100 },
        { type: 'handStarted', handNumber: 1, smallBlind: 1, bigBlind: 2 },
        { type: 'ownHoleCardsDealt', cards: [{ code: 'Ks', rank: 13, suit: 's' }, { code: '3c', rank: 3, suit: 'c' }] },
        { type: 'playerActed', seatIndex: 0, kind: 'call', paid: 100, betTo: 100, allIn: true },
        { type: 'communityCardsDealt', street: 'flop', cards: [{ code: '7s', rank: 7, suit: 's' }, { code: '3h', rank: 3, suit: 'h' }, { code: '2h', rank: 2, suit: 'h' }] },
      ],
    };
    const view = advanceTableView(null, packet, [
      { seatIndex: 0, playerId: '你', name: '你', nickname: '玩家', style: '自己做决定', characterId: 'hero' },
      { seatIndex: 1, playerId: '猎手', name: '林岚', nickname: '猎手', style: '主动施压', characterId: 'hunter' },
    ]);
    expect(view.holeCards.map((card) => card.code)).toEqual(['Ks', '3c']);
    expect(view.board.map((card) => card.code)).toEqual(['7s', '3h', '2h']);
    expect(view.seats[0]?.lastAction).toContain('100');
    expect(view.seats[0]?.lastAction).not.toContain('200');
    expect(view.seats[1]?.cards).toBeNull();
    expect(view.seats[1]?.stack).toBe(200);
    expect(view.potTotal).toBe(0);
  });
});
