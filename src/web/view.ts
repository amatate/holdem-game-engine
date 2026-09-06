import type { PublicGameEvent } from '../core/public-events.js';
import type { TurnPacket } from '../game/turn-packet.js';
import type { SeatIdentity, TableView } from './protocol.js';

export const STREET_NAMES = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' };

function actionText(event: Extract<PublicGameEvent, { type: 'playerActed' }>): string {
  const label = { fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注' }[event.kind];
  if (event.kind === 'fold' || event.kind === 'check') return label;
  return `${label} ${event.paid} · 到 ${event.betTo}${event.allIn ? ' · 全下' : ''}`;
}

// Apply only events that have reached the screen, without looking at a future packet.
export function applyPublicEvents(
  previous: TableView | null, events: readonly PublicGameEvent[], roster: readonly SeatIdentity[],
): TableView {
  const view: TableView = previous === null ? {
    handNumber: 0, street: 'preflop', smallBlind: 1, bigBlind: 2,
    buttonPosition: 0, smallBlindSeat: null, bigBlindSeat: 0,
    board: [], holeCards: [], potTotal: 0, log: [],
    seats: roster.map(({ seatIndex }) => ({ seatIndex, stack: 0, status: 'active',
      committedStreet: 0, committedHand: 0, cards: null, lastAction: '' })),
  } : structuredClone(previous);
  for (const event of events) {
    const seat = 'seatIndex' in event ? view.seats.find((item) => item.seatIndex === event.seatIndex) : undefined;
    const name = 'seatIndex' in event ? roster.find((item) => item.seatIndex === event.seatIndex)?.name ?? '玩家' : '';
    switch (event.type) {
      case 'gameStarted':
        view.seats.forEach((item) => { item.stack = event.startingStack; });
        break;
      case 'handStarted':
        Object.assign(view, { handNumber: event.handNumber, smallBlind: event.smallBlind,
          bigBlind: event.bigBlind, board: [], holeCards: [], potTotal: 0, street: 'preflop', log: [] });
        view.seats.forEach((item) => Object.assign(item, { cards: null, committedStreet: 0,
          committedHand: 0, lastAction: '', status: item.stack === 0 ? 'eliminated' : 'active' }));
        break;
      case 'positionsAssigned':
        Object.assign(view, { buttonPosition: event.buttonPosition, smallBlindSeat: event.smallBlindSeat,
          bigBlindSeat: event.bigBlindSeat });
        break;
      case 'ownHoleCardsDealt': view.holeCards = event.cards; break;
      case 'blindPosted':
      case 'playerActed':
        if (seat) {
          const paid = event.type === 'blindPosted' ? event.amount : event.paid;
          seat.stack -= paid; seat.committedStreet += paid; seat.committedHand += paid;
          view.potTotal += paid;
          if (event.allIn) seat.status = 'all-in';
          if (event.type === 'playerActed' && event.kind === 'fold') seat.status = 'folded';
          seat.lastAction = event.type === 'blindPosted'
            ? `${event.kind === 'small' ? '小盲' : '大盲'} ${paid}` : actionText(event);
          view.log.push(`${name} · ${seat.lastAction}`);
        }
        break;
      case 'communityCardsDealt':
        view.board = [...view.board, ...event.cards]; view.street = event.street;
        view.log.push(`${STREET_NAMES[event.street]} · ${event.cards.map((card) => card.code).join(' ')}`);
        break;
      case 'bettingRoundStarted':
        view.street = event.street;
        if (event.street !== 'preflop') view.seats.forEach((item) => {
          item.committedStreet = 0;
          if (item.status === 'active') item.lastAction = '';
        });
        break;
      case 'bettingRoundClosed':
        view.seats.forEach((item) => { item.committedStreet = 0; });
        break;
      case 'holeCardsRevealed': if (seat) seat.cards = event.cards; break;
      case 'uncalledBetReturned':
        if (seat) {
          seat.stack += event.amount; seat.committedHand -= event.amount;
          seat.committedStreet = Math.max(0, seat.committedStreet - event.amount);
          view.potTotal -= event.amount;
          view.log.push(`${name} · 未跟注部分退回 ${event.amount}`);
        }
        break;
      case 'potAwarded':
        event.winners.forEach((winner, index) => {
          const target = view.seats.find((item) => item.seatIndex === winner);
          const chips = event.amounts[index]!;
          if (target) target.stack += chips;
          view.potTotal -= chips;
          view.log.push(`${roster.find((item) => item.seatIndex === winner)?.name ?? '玩家'} · 获得 ${chips}`);
        });
        break;
      case 'playerEliminated': if (seat) seat.status = 'eliminated'; break;
      case 'handCompleted':
        for (const final of event.finalStacks) {
          const target = view.seats.find((item) => item.seatIndex === final.seatIndex);
          if (target) target.stack = final.stack;
        }
        view.potTotal = 0;
        break;
    }
  }
  view.log = view.log.slice(-60);
  return view;
}

// Reconciliation uses the authoritative public snapshot, only after playback ends.
export function advanceTableView(
  previous: TableView | null, packet: Readonly<TurnPacket>, roster: readonly SeatIdentity[],
): TableView {
  const view = applyPublicEvents(previous, packet.viewerEventsSinceLastPacket, roster);
  if (packet.kind === 'decision') {
    const o = packet.observation;
    Object.assign(view, { handNumber: o.handNumber, street: o.street, smallBlind: o.smallBlind,
      bigBlind: o.bigBlind, buttonPosition: o.buttonPosition, smallBlindSeat: o.smallBlindSeat,
      bigBlindSeat: o.bigBlindSeat, board: o.board, holeCards: o.holeCards, potTotal: o.potTotal });
    view.seats = o.seats.map((seat) => ({ seatIndex: seat.seatIndex, stack: seat.stack,
      status: seat.status, committedStreet: seat.committedStreet, committedHand: seat.committedHand,
      cards: seat.revealedHoleCards,
      lastAction: view.seats.find((item) => item.seatIndex === seat.seatIndex)?.lastAction ?? '' }));
  } else if (packet.kind === 'hand-result') {
    for (const result of packet.handResult.seats) {
      const seat = view.seats.find((item) => item.seatIndex === result.seatIndex);
      if (seat) { seat.stack = result.finalStack; if (result.holeCards) seat.cards = result.holeCards; }
    }
    view.potTotal = 0;
  } else {
    for (const final of packet.finalStacks) {
      const seat = view.seats.find((item) => item.seatIndex === final.seatIndex);
      if (seat) seat.stack = final.stack;
    }
    view.potTotal = 0;
  }
  view.log = view.log.slice(-60);
  return view;
}
