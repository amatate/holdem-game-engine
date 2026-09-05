import type { Street, PlayerHandStatus } from '../core/state.js';
import type { Card } from '../core/types.js';
import type { TurnPacket } from '../game/turn-packet.js';

export interface SeatIdentity {
  seatIndex: number;
  playerId: string;
  name: string;
  nickname: string;
  style: string;
  characterId: string;
}

export interface TableSeat {
  seatIndex: number;
  stack: number;
  status: PlayerHandStatus;
  committedStreet: number;
  committedHand: number;
  cards: readonly Card[] | null;
  lastAction: string;
}

export interface TableView {
  handNumber: number;
  street: Street;
  smallBlind: number;
  bigBlind: number;
  buttonPosition: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number;
  board: readonly Card[];
  holeCards: readonly Card[];
  potTotal: number;
  seats: TableSeat[];
  log: string[];
}

export interface WebTable {
  id: string;
  roster: SeatIdentity[];
  packet: Readonly<TurnPacket>;
  view: TableView;
}

export interface Bootstrap {
  rosters: Record<number, SeatIdentity[]>;
  table: WebTable | null;
}
