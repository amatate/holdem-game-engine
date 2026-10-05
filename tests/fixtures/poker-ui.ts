import { parseCard } from '../../src/core/cards.js';
import type { WebTable } from '../../src/web/protocol.js';
import { advanceTableView } from '../../src/web/view.js';
import { rosterFor } from '../../src/web/table-session.js';

/** Public-only reproduction of the screenshot: JJ beats K8 for a 201-chip pot. */
export function pokerUiTable(players = 4): WebTable {
  const roster = rosterFor(players);
  const board = ['3h', 'Ks', 'Jh', '7d', '8c'].map(parseCard);
  const packet: WebTable['packet'] = { schemaVersion:1, packetIndex:3, kind:'hand-result', handNumber:1,
    coreEventRange:{ fromVersionInclusive:1, toVersionExclusive:2 }, viewerEventsSinceLastPacket:[], privateEventsSinceLastPacket:[],
    handResult:{ handNumber:1, seats:roster.map(person => ({
      seatIndex:person.seatIndex, playerId:person.playerId,
      holeCards:person.seatIndex === 0 ? [parseCard('Js'), parseCard('Jc')] : person.seatIndex === 2 ? [parseCard('Kh'), parseCard('8s')] : null,
      category:person.seatIndex === 0 ? 'three-of-a-kind' : person.seatIndex === 2 ? 'two-pair' : null,
      bestFive:person.seatIndex === 0 ? ['Ks','Jh','8c','Js','Jc'].map(parseCard) : person.seatIndex === 2 ? ['Ks','Jh','8c','Kh','8s'].map(parseCard) : null,
      potWon:person.seatIndex === 0 ? 201 : 0, invested:person.seatIndex === 0 || person.seatIndex === 2 ? 100 : person.seatIndex === 1 ? 1 : 0,
      returned:0, net:person.seatIndex === 0 ? 101 : person.seatIndex === 2 ? -100 : person.seatIndex === 1 ? -1 : 0,
      finalStack:person.seatIndex === 0 ? 201 : person.seatIndex === 2 ? 0 : person.seatIndex === 1 ? 99 : 100,
    })), pots:[{ potId:'pot-0', label:'底池', amount:201, eligibleSeatIndexes:[0,2], winnerSeatIndexes:[0], awards:[201] }] } };
  const view = advanceTableView(null, packet, roster);
  view.handNumber = 1; view.board = board; view.holeCards = [parseCard('Js'), parseCard('Jc')]; view.street = 'river';
  view.buttonPosition = 0; view.smallBlindSeat = 1; view.bigBlindSeat = 2;
  for (const seat of view.seats) {
    seat.status = seat.seatIndex === 0 || seat.seatIndex === 2 ? 'all-in' : 'folded';
    seat.lastAction = seat.status === 'all-in' ? '跟注 100（全下）' : '弃牌';
  }
  return { id:'poker-ui-fixture', mode:'classic', roster, packet, view };
}
