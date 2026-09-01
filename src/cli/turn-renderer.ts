import type { PlayerObservationV1 } from '../agents/types.js';
import type { HandCategory } from '../core/hand-evaluator.js';
import type { ActionRejectionCode } from '../core/legal-actions.js';
import type { PublicGameEvent } from '../core/public-events.js';
import type { Card } from '../core/types.js';
import type { HandResultSummary } from '../game/hand-result.js';
import type { AbilityRejectionCode } from '../game/session-types.js';
import type { ClassicDecisionPacket, RenderableCommand, TurnPacket } from '../game/turn-packet.js';
import { renderPublicEvent } from './renderer.js';

export interface RenderBlock {
  readonly kind: 'ordinary-actions' | 'street-reveal' | 'showdown' | 'settlement' | 'decision';
  readonly delayBeforeMs: 0 | 1000;
  readonly text: string;
}

const STREET_LABELS = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
} as const;

const STATUS_LABELS = {
  active: '行动中',
  folded: '已弃牌',
  'all-in': '已全下',
  eliminated: '已淘汰',
} as const;

const HAND_CATEGORY_LABELS: Readonly<Record<HandCategory, string>> = {
  'high-card': '高牌',
  'one-pair': '一对',
  'two-pair': '两对',
  'three-of-a-kind': '三条',
  straight: '顺子',
  flush: '同花',
  'full-house': '葫芦',
  'four-of-a-kind': '四条',
  'straight-flush': '同花顺',
};

function cardText(card: Readonly<Card>): string {
  const suit = { c: '♣', d: '♦', h: '♥', s: '♠' }[card.suit];
  return `${card.code.slice(0, -1)}${suit}`;
}

function cardsText(cards: readonly Readonly<Card>[]): string {
  return cards.length === 0 ? '（无）' : cards.map(cardText).join(' ');
}

function positionText(seatIndex: number, observation: Readonly<PlayerObservationV1>): string {
  const positions: string[] = [];
  if (seatIndex === observation.buttonPosition) positions.push('按钮');
  if (seatIndex === observation.smallBlindSeat) positions.push('小盲');
  if (seatIndex === observation.bigBlindSeat) positions.push('大盲');
  return positions.length === 0 ? '' : ` [${positions.join('/')}]`;
}

function renderCommand(command: Readonly<RenderableCommand>): string {
  if (command.kind === 'fixed') return `${command.inputs.join('/')} ${command.label}`;
  return `r ${command.minimum}-${command.maximum} ${command.label}`;
}

function renderDecision(packet: Readonly<ClassicDecisionPacket>): string {
  const observation = packet.observation;
  const smallBlindSeat = observation.smallBlindSeat === null
    ? '无'
    : `座位 ${observation.smallBlindSeat}`;
  const seats = observation.seats.map((seat) => {
    const marker = seat.seatIndex === observation.actorSeatIndex ? '> ' : '';
    const revealed = seat.revealedHoleCards === null
      ? ''
      : ` | 亮牌 ${cardsText(seat.revealedHoleCards)}`;
    return `${marker}座位 ${seat.seatIndex} ${seat.playerId}${positionText(seat.seatIndex, observation)}`
      + ` | 筹码 ${seat.stack} | ${STATUS_LABELS[seat.status]}`
      + ` | 本轮下注 ${seat.committedStreet} | 本手累计投入 ${seat.committedHand}${revealed}`;
  });
  const contestable = packet.actionPanel.facingBet
    ? `当前桌面投入 ${packet.actionPanel.tableCommittedTotal}；跟注 ${observation.legalActions.call?.pay ?? 0} 后你最多可争夺 ${packet.actionPanel.heroContestableTotal}。`
    : `当前桌面投入 ${packet.actionPanel.tableCommittedTotal}；你当前可争夺 ${packet.actionPanel.heroContestableTotal}。`;

  return [
    `第 ${observation.handNumber} 手｜${STREET_LABELS[observation.street]}`,
    `你的手牌：${cardsText(observation.holeCards)}`,
    `公共牌：${cardsText(observation.board)}`,
    `位置：按钮 座位 ${observation.buttonPosition}｜小盲 ${smallBlindSeat}｜大盲 座位 ${observation.bigBlindSeat}`,
    `盲注：${observation.smallBlind}/${observation.bigBlind}`,
    ...seats,
    contestable,
    `操作：${packet.actionPanel.commands.map(renderCommand).join(' | ')}`,
  ].join('\n');
}

function rankCounts(cards: readonly Readonly<Card>[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index < cards.length; index += 1) {
    const rank = cards[index]!.code.slice(0, -1);
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }
  return counts;
}

function repeatedRanks(cards: readonly Readonly<Card>[], count: number): readonly string[] {
  const counts = rankCounts(cards);
  const ranks: string[] = [];
  for (let index = 0; index < cards.length; index += 1) {
    const rank = cards[index]!.code.slice(0, -1);
    if (counts.get(rank) === count && !ranks.includes(rank)) ranks.push(rank);
  }
  return ranks;
}

function describedCategory(
  category: HandCategory,
  bestFive: readonly Readonly<Card>[],
): string {
  const base = HAND_CATEGORY_LABELS[category];
  if (category === 'one-pair') return `${base}${repeatedRanks(bestFive, 2)[0] ?? ''}`;
  if (category === 'two-pair') return `${base}${repeatedRanks(bestFive, 2).join('和')}`;
  if (category === 'three-of-a-kind') return `${base}${repeatedRanks(bestFive, 3)[0] ?? ''}`;
  if (category === 'four-of-a-kind') return `${base}${repeatedRanks(bestFive, 4)[0] ?? ''}`;
  if (category === 'full-house') {
    const trips = repeatedRanks(bestFive, 3)[0] ?? '';
    const pair = repeatedRanks(bestFive, 2)[0] ?? '';
    return `${base}${trips}${pair.length === 0 ? '' : `带${pair}`}`;
  }
  return base;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function renderSettlement(summary: Readonly<HandResultSummary>): string {
  const playerBySeat = new Map<number, string>();
  const lines = [
    `第 ${summary.handNumber} 手结算`,
    '玩家 | 手牌 | 牌型 | 赢得底池 | 本手投入 | 退回 | 净结果',
  ];
  for (let index = 0; index < summary.seats.length; index += 1) {
    const seat = summary.seats[index]!;
    playerBySeat.set(seat.seatIndex, seat.playerId);
    const holeCards = seat.holeCards === null ? '—' : cardsText(seat.holeCards);
    const category = seat.category === null || seat.bestFive === null
      ? '—'
      : `${describedCategory(seat.category, seat.bestFive)}（${cardsText(seat.bestFive)}）`;
    lines.push(`${seat.playerId} | ${holeCards} | ${category} | ${seat.potWon}`
      + ` | ${seat.invested} | ${seat.returned} | ${signed(seat.net)}`);
  }
  for (let potIndex = 0; potIndex < summary.pots.length; potIndex += 1) {
    const pot = summary.pots[potIndex]!;
    const awards: string[] = [];
    for (let winnerIndex = 0; winnerIndex < pot.winnerSeatIndexes.length; winnerIndex += 1) {
      const player = playerBySeat.get(pot.winnerSeatIndexes[winnerIndex]!)
        ?? `座位 ${pot.winnerSeatIndexes[winnerIndex]}`;
      awards.push(`${player} ${pot.awards[winnerIndex]}`);
    }
    lines.push(`${pot.label} ${pot.amount}：${awards.join('；')}`);
  }
  const conclusions: string[] = [];
  for (let index = 0; index < summary.seats.length; index += 1) {
    const seat = summary.seats[index]!;
    if (seat.potWon > 0) {
      const spacing = /[A-Za-z0-9]$/.test(seat.playerId) ? ' ' : '';
      conclusions.push(`${seat.playerId}${spacing}赢得 ${seat.potWon}`);
    }
  }
  lines.push(`结论：${conclusions.length === 0 ? '无人赢得底池' : conclusions.join('；')}。`);
  return lines.join('\n');
}

type EventBlockKind = Exclude<RenderBlock['kind'], 'settlement' | 'decision'>;

function eventKind(event: Readonly<PublicGameEvent>): EventBlockKind {
  if (event.type === 'communityCardsDealt') return 'street-reveal';
  if (event.type === 'showdownStarted'
    || event.type === 'holeCardsRevealed'
    || event.type === 'handEvaluated') return 'showdown';
  return 'ordinary-actions';
}

function isRawSettlementEvent(event: Readonly<PublicGameEvent>): boolean {
  return event.type === 'uncalledBetReturned'
    || event.type === 'potConstructed'
    || event.type === 'handEvaluated'
    || event.type === 'potAwarded'
    || event.type === 'handCompleted';
}

function renderEventBlocks(
  events: readonly Readonly<PublicGameEvent>[],
  suppressSettlement: boolean,
): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (suppressSettlement && isRawSettlementEvent(event)) continue;
    const text = renderPublicEvent(event);
    if (text === null) continue;
    const kind = eventKind(event);
    const previous = blocks.at(-1);
    const startsNewStreet = kind === 'street-reveal';
    if (previous !== undefined && previous.kind === kind && !startsNewStreet) {
      blocks[blocks.length - 1] = { ...previous, text: `${previous.text}\n${text}` };
    } else {
      blocks.push({
        kind,
        delayBeforeMs: kind === 'ordinary-actions' ? 0 : 1000,
        text,
      });
    }
  }
  return blocks;
}

function assertNeverPacket(packet: never): never {
  void packet;
  throw new Error('Unhandled turn packet variant');
}

export function renderTurnPacket(
  packet: Readonly<TurnPacket>,
): readonly Readonly<RenderBlock>[] {
  switch (packet.kind) {
    case 'decision':
      return [
        ...renderEventBlocks(packet.viewerEventsSinceLastPacket, false),
        { kind: 'decision', delayBeforeMs: 0, text: renderDecision(packet) },
      ];
    case 'hand-result':
      return [
        ...renderEventBlocks(packet.viewerEventsSinceLastPacket, true),
        { kind: 'settlement', delayBeforeMs: 1000, text: renderSettlement(packet.handResult) },
      ];
    case 'game-result': {
      const lines = packet.viewerEventsSinceLastPacket
        .map((event) => renderPublicEvent(event))
        .filter((line): line is string => line !== null);
      if (lines.length === 0) lines.push(`比赛结束，座位 ${packet.winnerSeatIndex} 成为冠军！`);
      return [{ kind: 'ordinary-actions', delayBeforeMs: 0, text: lines.join('\n') }];
    }
    default:
      return assertNeverPacket(packet);
  }
}

function assertNeverRejection(rejection: never): never {
  void rejection;
  throw new Error('Unhandled session rejection');
}

export function renderSessionRejection(
  rejection: AbilityRejectionCode | ActionRejectionCode,
): string {
  switch (rejection) {
    case 'wrong-mode': return '经典模式不能使用能力。';
    case 'not-human-turn': return '当前不是你的行动回合。';
    case 'stale-decision': return '牌局决策已变化，请按最新局面操作。';
    case 'stale-packet': return '该操作来自旧局面，请按最新局面操作。';
    case 'ability-spent': return '本手该能力已经用完。';
    case 'ability-already-used-this-decision': return '本次决策已经使用过能力，请完成扑克行动。';
    case 'invalid-target': return '该座位不能作为能力目标。';
    case 'target-cards-public': return '该座位的底牌已经公开。';
    case 'invalid-hole-card-index': return '换牌位置只能是第 1 张或第 2 张。';
    case 'deck-exhausted': return '牌堆没有可用于换牌的牌。';
    case 'malformed-command': return '命令格式无效，请按当前可用命令输入。';
    case 'not-current-actor': return '当前不是该座位行动。';
    case 'seat-cannot-act': return '该座位当前不能行动。';
    case 'action-not-legal': return '当前操作不合法。';
    case 'invalid-amount': return '操作金额无效。';
    case 'raise-out-of-range': return '加注金额超出当前范围。';
    case 'raise-not-reopened': return '当前尚未重新开放加注。';
    default: return assertNeverRejection(rejection);
  }
}
