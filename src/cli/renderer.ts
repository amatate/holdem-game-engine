import type { PlayerObservationV1 } from '../agents/types.js';
import type { HandCategory } from '../core/hand-evaluator.js';
import type { PublicGameEvent } from '../core/public-events.js';
import type { Card } from '../core/types.js';

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

const ACTION_LABELS = {
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  bet: '下注',
  raise: '加注',
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
  const labels: string[] = [];
  if (seatIndex === observation.buttonPosition) labels.push('按钮');
  if (seatIndex === observation.smallBlindSeat) labels.push('小盲');
  if (seatIndex === observation.bigBlindSeat) labels.push('大盲');
  return labels.length === 0 ? '' : ` [${labels.join('/')}]`;
}

function legalText(observation: Readonly<PlayerObservationV1>): string {
  const legal = observation.legalActions;
  const commands: string[] = [];
  if (legal.fold) commands.push('f 弃牌');
  if (legal.check) commands.push('x 过牌');
  if (legal.call !== null) commands.push(`c 跟注 ${legal.call.pay}`);
  if (legal.raiseTo !== null) commands.push(`r ${legal.raiseTo.min}-${legal.raiseTo.max} 加注到`);
  if (legal.allIn !== null) commands.push(`a 全下到 ${legal.allIn.to}`);
  return commands.join(' | ');
}

export function renderTable(observation: Readonly<PlayerObservationV1>): string {
  const sidePots = observation.sidePots.length === 0
    ? '无'
    : observation.sidePots.map((pot, index) =>
      `边池 ${index + 1}: ${pot.amount}（座位 ${pot.eligibleSeatIndexes.join('、')}）`).join('；');
  const seats = observation.seats.map((seat) => {
    const marker = seat.seatIndex === observation.actorSeatIndex ? '>' : ' ';
    const reveal = seat.revealedHoleCards === null
      ? ''
      : ` | 亮牌 ${cardsText(seat.revealedHoleCards)}`;
    return `${marker} 座位 ${seat.seatIndex} ${seat.playerId}${positionText(seat.seatIndex, observation)}`
      + ` | 筹码 ${seat.stack} | ${STATUS_LABELS[seat.status]}`
      + ` | 本街投入 ${seat.committedStreet} | 本手投入 ${seat.committedHand}${reveal}`;
  });

  return [
    `=== 第 ${observation.handNumber} 手 · ${STREET_LABELS[observation.street]} ===`,
    `你的手牌: ${cardsText(observation.holeCards)}`,
    `公共牌: ${cardsText(observation.board)}`,
    `底池 ${observation.potTotal} | ${sidePots}`,
    `位置: 按钮 座位 ${observation.buttonPosition} | 小盲 ${observation.smallBlindSeat === null ? '无' : `座位 ${observation.smallBlindSeat}`} | 大盲 座位 ${observation.bigBlindSeat}`,
    `盲注: ${observation.smallBlind}/${observation.bigBlind}`,
    ...seats,
    `合法操作: ${legalText(observation)}`,
  ].join('\n');
}

function assertNever(event: never): never {
  void event;
  throw new Error('Unhandled public event variant');
}

export function renderPublicEvent(event: Readonly<PublicGameEvent>): string | null {
  switch (event.type) {
    case 'gameStarted':
      return `比赛开始：${event.maxSeats} 人桌，每人 ${event.startingStack} 筹码。`;
    case 'handStarted':
      return `第 ${event.handNumber} 手开始，盲注 ${event.smallBlind}/${event.bigBlind}。`;
    case 'positionsAssigned':
      return `位置：按钮座位 ${event.buttonPosition}，小盲${event.smallBlindSeat === null ? '无' : `座位 ${event.smallBlindSeat}`}，大盲座位 ${event.bigBlindSeat}。`;
    case 'blindPosted':
      return `座位 ${event.seatIndex} 支付${event.kind === 'small' ? '小盲' : '大盲'} ${event.amount}${event.allIn ? '（全下）' : ''}。`;
    case 'playerActed': {
      const reached = event.kind === 'call' || event.kind === 'bet' || event.kind === 'raise';
      return `座位 ${event.seatIndex} ${ACTION_LABELS[event.kind]}${event.paid > 0 ? ` ${event.paid}` : ''}${reached && event.betTo > 0 ? `，到 ${event.betTo}` : ''}${event.allIn ? '（全下）' : ''}。`;
    }
    case 'ownHoleCardsDealt':
      return `你的手牌：${cardsText(event.cards)}。`;
    case 'bettingRoundStarted':
      return `${STREET_LABELS[event.street]}行动开始，当前下注到 ${event.currentBetTo}${event.actor === null ? '，无需行动' : `，座位 ${event.actor} 行动`}。`;
    case 'bettingRoundClosed':
      return `${STREET_LABELS[event.street]}行动结束。`;
    case 'communityCardsDealt':
      return `${STREET_LABELS[event.street]}：${cardsText(event.cards)}。`;
    case 'holeCardsRevealed':
      return `座位 ${event.seatIndex} 亮牌 ${cardsText(event.cards)}（${event.reason === 'all-in' ? '全下' : '摊牌'}）。`;
    case 'uncalledBetReturned':
      return `退还座位 ${event.seatIndex} 未被跟注的 ${event.amount} 筹码。`;
    case 'showdownStarted':
      return `开始摊牌，亮牌顺序：座位 ${event.revealOrder.join('、')}。`;
    case 'potConstructed':
      return `形成底池 ${event.potId}：${event.amount}，可争夺座位 ${event.eligibleSeats.join('、')}。`;
    case 'handEvaluated':
      return `座位 ${event.seatIndex} 最佳牌型：${HAND_CATEGORY_LABELS[event.category]}｜最佳五张：${cardsText(event.bestFive)}`;
    case 'potAwarded':
      return `底池 ${event.potId} 发给座位 ${event.winners.join('、')}，筹码 ${event.amounts.join('、')}${event.oddChipRecipients.length === 0 ? '' : `，奇数筹码给座位 ${event.oddChipRecipients.join('、')}`}。`;
    case 'playerEliminated':
      return `座位 ${event.seatIndex} 被淘汰。`;
    case 'handCompleted':
      return `本手结束：${event.finalStacks.map((seat) => `座位 ${seat.seatIndex}=${seat.stack}`).join('，')}。`;
    case 'gameCompleted':
      return `比赛结束，座位 ${event.winnerSeat} 成为冠军！`;
    default:
      return assertNever(event);
  }
}

export function renderPublicEvents(events: readonly PublicGameEvent[]): string {
  return events
    .map((event) => renderPublicEvent(event))
    .filter((line): line is string => line !== null)
    .join('\n');
}
