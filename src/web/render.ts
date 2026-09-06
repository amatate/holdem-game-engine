import type { Card } from '../core/types.js';
import type { HandCategory } from '../core/hand-evaluator.js';
import type { SeatIdentity, WebTable } from './protocol.js';
import type { PlaybackFrame } from './playback.js';
import type { SessionMode } from '../game/session-types.js';
import { STREET_NAMES } from './view.js';

const CATEGORIES: Record<HandCategory, string> = {
  'high-card': '高牌', 'one-pair': '一对', 'two-pair': '两对', 'three-of-a-kind': '三条',
  straight: '顺子', flush: '同花', 'full-house': '葫芦', 'four-of-a-kind': '四条', 'straight-flush': '同花顺',
};
const SUITS = { s: '♠', h: '♥', d: '♦', c: '♣' };
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
const amount = (value: number) => value.toLocaleString('zh-CN');
const signed = (value: number) => `${value > 0 ? '+' : ''}${amount(value)}`;

function cardFace(card: Readonly<Card> | null, small = false): string {
  if (!card) return '<span class="card card-back" role="img" aria-label="未公开的底牌"><span aria-hidden="true">♠</span></span>';
  const rank = card.code.slice(0, -1);
  const suit = SUITS[card.suit];
  return `<span class="card ${small ? 'card-small' : ''} ${card.suit === 'h' || card.suit === 'd' ? 'card-red' : ''}" role="img" aria-label="${escapeHtml(rank + suit)}"><span class="card-corner" aria-hidden="true">${rank}<small>${suit}</small></span><span class="card-suit" aria-hidden="true">${suit}</span></span>`;
}

function identity(person: SeatIdentity): string {
  return `<span class="avatar avatar-${escapeHtml(person.characterId)}" aria-hidden="true">${escapeHtml(person.name.slice(-1))}</span><span class="person"><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.nickname)}</span></span>`;
}

function board(cards: readonly Card[]): string {
  return `<div class="board" aria-label="公共牌">${Array.from({ length: 5 }, (_, index) => cards[index]
    ? cardFace(cards[index]!) : '<span class="card-slot" aria-label="尚未发出的公共牌">·</span>').join('')}</div>`;
}

export function renderLobby(rosters: Record<number, SeatIdentity[]>, playerCount: number, mode: SessionMode = 'classic'): string {
  const roster = rosters[playerCount] ?? [];
  return `<section class="lobby" aria-label="选择牌桌">
    <div class="arena arena-lobby" data-count="${playerCount}"><div class="felt"></div>
      <div class="table-center"><div class="table-mark">夜 局</div><p class="table-subtitle">NO-LIMIT TEXAS HOLD’EM</p>${board([])}<p class="table-caption">选好人数，即可发牌</p></div>
      ${roster.map((person) => `<article class="seat" data-seat="${person.seatIndex}"><div class="seat-body">${identity(person)}<p class="seat-stack">100 <small>筹码</small></p><p class="seat-style">${escapeHtml(person.style)}</p></div></article>`).join('')}
    </div>
    <div class="mode-picker"><div><label for="game-mode">今晚的玩法</label><p>${mode === 'classic' ? '只凭牌技，按标准德州规则对局。' : '多一次秘密选择：每场可以偷看一张对手底牌。'}</p></div><select id="game-mode"><option value="classic" ${mode === 'classic' ? 'selected' : ''}>经典德州</option><option value="ability-lab" ${mode === 'ability-lab' ? 'selected' : ''}>能力实验 · 偷看一次</option></select></div>
    <div class="setup-bar"><div><h1>今晚，几个人？</h1><p>系统安排对手，你只管入座。</p></div>
      <div class="setup-controls"><label for="players">牌桌人数</label><select id="players">${[2, 3, 4, 5, 6].map((count) => `<option value="${count}" ${count === playerCount ? 'selected' : ''}>${count} 人桌</option>`).join('')}</select><button class="button button-primary" data-action="start">入座发牌 <span aria-hidden="true">↗</span></button></div>
    </div><p class="footnote">${mode === 'classic' ? '经典德州' : '能力实验 · 仅你拥有能力'} · 每人 100 筹码 · 初始盲注 1 / 2 · 每 8 手升盲</p>
  </section>`;
}

type PresentationTable = Omit<WebTable, 'packet'> & { packet: WebTable['packet'] | null };

function renderSeat(table: PresentationTable, person: SeatIdentity, frame?: PlaybackFrame): string {
  const seat = table.view.seats.find((item) => item.seatIndex === person.seatIndex)!;
  const hero = person.seatIndex === 0;
  const current = hero && table.packet?.kind === 'decision';
  const event = frame?.event;
  const acting = event && 'seatIndex' in event && event.seatIndex === person.seatIndex;
  const awarded = event?.type === 'potAwarded' && event.winners.includes(person.seatIndex);
  const result = table.packet?.kind === 'hand-result'
    ? table.packet.handResult.seats.find((item) => item.seatIndex === person.seatIndex) : null;
  const badges = [
    table.view.buttonPosition === person.seatIndex ? '<span class="position dealer" title="按钮位">D</span>' : '',
    table.view.smallBlindSeat === person.seatIndex ? '<span class="position">小盲</span>' : '',
    table.view.bigBlindSeat === person.seatIndex ? '<span class="position">大盲</span>' : '',
  ].join('');
  const cards = hero ? table.view.holeCards : seat.cards;
  const cardsHtml = seat.status === 'eliminated' && (!cards || cards.length === 0) ? ''
    : `<div class="seat-cards ${hero ? 'hero-cards' : ''}">${cardFace(cards?.[0] ?? null, !hero)}${cardFace(cards?.[1] ?? null, !hero)}</div>`;
  const status = { active: '', folded: '已弃牌', 'all-in': '已全下', eliminated: '已淘汰' }[seat.status];
  const winnings = result && result.potWon > 0 ? `<span class="won-label">赢得 ${amount(result.potWon)}</span>` : '';
  return `<article class="seat ${hero ? 'hero' : ''} ${current ? 'is-current' : ''} ${acting ? 'is-acting' : ''} ${awarded ? 'is-awarded' : ''} ${seat.status === 'folded' || seat.status === 'eliminated' ? 'is-out' : ''}" data-seat="${person.seatIndex}" aria-label="${escapeHtml(person.name)}${current ? '，轮到你' : ''}">
    ${cardsHtml}<div class="seat-body">${identity(person)}<div class="seat-positions">${badges}</div><p class="seat-stack">${amount(seat.stack)} <small>筹码</small></p>
    <p class="seat-action">${current ? '轮到你' : escapeHtml(acting ? seat.lastAction || status || '亮牌' : status || seat.lastAction || '等待行动')}</p>${winnings}</div>
    ${(!table.packet || table.packet.kind === 'decision') && seat.committedStreet > 0 ? `<div class="bet-chip"><span aria-hidden="true">◉</span> ${amount(seat.committedStreet)} <small>本轮</small></div>` : ''}
  </article>`;
}

function settlement(table: PresentationTable): string {
  if (table.packet?.kind !== 'hand-result') return '';
  const result = table.packet.handResult;
  const hero = result.seats.find((seat) => seat.seatIndex === 0)!;
  const title = hero.net > 0 ? `本手净赢 ${signed(hero.net)}` : hero.net < 0 ? `本手净输 ${amount(-hero.net)}` : '本手持平';
  const name = (index: number) => escapeHtml(table.roster.find((person) => person.seatIndex === index)?.name ?? '玩家');
  return `<section class="settlement" aria-label="本手结算"><div class="result-heading"><div><p class="eyebrow">第 ${result.handNumber} 手 · 已结算</p><h2>${title}</h2></div><button class="button button-primary" data-action="continue">${hero.finalStack === 0 ? '继续观看' : '下一手'} <span aria-hidden="true">→</span></button></div>
    <div class="pot-results">${result.pots.map((pot) => `<p><span class="pot-label">${escapeHtml(pot.label)} ${amount(pot.amount)}</span>${pot.winnerSeatIndexes.map((winner, index) => `${name(winner)} 获得 ${amount(pot.awards[index]!)}`).join(' · ')}${pot.winnerSeatIndexes.length > 1 ? '（平分）' : ''}</p>`).join('')}</div>
    <div class="ledger-scroll"><table class="ledger"><thead><tr><th scope="col">玩家 / 牌型</th><th scope="col">底牌</th><th scope="col">赢得底池</th><th scope="col">本手投入</th><th scope="col">退回</th><th scope="col">净结果</th></tr></thead><tbody>
    ${result.seats.map((seat) => `<tr><th scope="row">${name(seat.seatIndex)}<small>${seat.category ? CATEGORIES[seat.category] : '未公开牌型'}</small></th><td>${seat.holeCards ? seat.holeCards.map((card) => `${card.code.slice(0, -1)}${SUITS[card.suit]}`).join(' ') : '未亮牌'}</td><td>${amount(seat.potWon)}</td><td>${amount(seat.invested)}</td><td>${amount(seat.returned)}</td><td class="${seat.net > 0 ? 'net-win' : ''}">${signed(seat.net)}</td></tr>${seat.bestFive ? `<tr class="best-five-row"><td colspan="6"><span>最佳五张</span> ${seat.bestFive.map((card) => cardFace(card, true)).join('')}</td></tr>` : ''}`).join('')}</tbody></table></div>
  </section>`;
}

function renderAbilityPanel(table: PresentationTable): string {
  const packet = table.packet;
  if (!packet || table.mode !== 'ability-lab') return '';
  if (packet.kind !== 'decision') return '<p class="private-cleared">能力实验 · 本手私有情报已清除</p>';
  const abilities = packet.abilities;
  if (!abilities) return '';
  const name = (seatIndex: number) => escapeHtml(table.roster.find((person) => person.seatIndex === seatIndex)?.name ?? '对手');
  const spent = abilities.charges.peek === 0;
  return `<section class="ability-panel" aria-label="偷看能力"><div class="ability-heading"><div><p class="eyebrow">能力实验 / 仅你可见</p><h2>偷看一张</h2></div><span class="ability-charge">本场剩余 ${abilities.charges.peek} / 1</span></div>
    ${spent ? '<p class="ability-description">本场已使用，下一手不会恢复。你仍需完成正常打牌操作。</p>'
      : '<p class="ability-description">选择一名对手，随机偷看其一张底牌。每场仅一次，不替代本次打牌。</p>'}
    ${abilities.availableCommands.length ? `<div class="peek-targets">${abilities.availableCommands.map((command) => `<button class="button button-peek" data-action="peek" data-target-seat="${command.targetSeatIndex}">偷看 ${name(command.targetSeatIndex)}</button>`).join('')}</div>`
      : !spent ? '<p class="ability-description">当前没有可偷看的对手：已弃牌、已淘汰或已亮牌者不可选。</p>' : ''}
    ${abilities.knowledge.length ? `<div class="private-intel" role="status" aria-live="polite" aria-label="本手私有情报">${abilities.knowledge.map((entry) => `<div class="intel-card">${cardFace(entry.card)}<div><strong>${name(entry.targetSeatIndex)} 的一张底牌</strong><p>仅你可见 · 对手尚未因此亮牌</p><small>本手结束后清除 · 不会传给 NPC</small></div></div>`).join('')}</div>` : ''}
  </section>`;
}

function controls(table: PresentationTable): string {
  const packet = table.packet;
  if (!packet) return '';
  if (packet.kind === 'hand-result') return renderAbilityPanel(table) + settlement(table);
  if (packet.kind === 'game-result') {
    const winner = table.roster.find((person) => person.seatIndex === packet.winnerSeatIndex)!;
    return `<section class="decision"><p class="eyebrow">比赛结束</p><h2>${escapeHtml(winner.name)} 赢得本场</h2><p>最终筹码 ${amount(packet.finalStacks.find((seat) => seat.seatIndex === packet.winnerSeatIndex)!.stack)}</p><button class="button button-primary" data-action="new">再开一桌</button></section>`;
  }
  const commands = packet.actionPanel.commands;
  const raise = commands.find((command) => command.kind === 'raise-range');
  return `${renderAbilityPanel(table)}<section class="decision" aria-label="你的操作"><div class="decision-heading"><div><p class="eyebrow">YOUR MOVE</p><h2>轮到你了</h2></div><p class="contestable">${packet.actionPanel.facingBet ? `跟注 ${amount(packet.observation.legalActions.call?.pay ?? 0)} 后，最多可争夺` : '你当前可争夺'} <strong>${amount(packet.actionPanel.heroContestableTotal)}</strong></p></div>
    <div class="action-row">${commands.filter((command) => command.kind === 'fixed').map((command) => {
      const type = command.intent.type;
      return `<button class="button ${type === 'call' || type === 'check' ? 'button-primary' : type === 'allIn' ? 'button-allin' : 'button-secondary'}" data-action="act" data-intent="${type}">${escapeHtml(command.label)}</button>`;
    }).join('')}</div>
    ${raise ? `<form id="raise-form" class="raise-form"><label for="raise-amount">加注到</label><input id="raise-amount" name="amount" type="number" inputmode="numeric" min="${raise.minimum}" max="${raise.maximum}" step="1" value="${raise.minimum}" required><span class="raise-range">${raise.minimum}–${raise.maximum}</span><button class="button button-raise" type="submit">确认加注</button><small>本轮下注总额，不是额外投入</small></form>` : ''}
  </section>`;
}

export function renderTable(table: WebTable): string {
  return renderSurface(table);
}

function frameCaption(frame: PlaybackFrame, roster: readonly SeatIdentity[]): string {
  const event = frame.event;
  const name = (index: number) => roster.find((person) => person.seatIndex === index)?.name ?? '玩家';
  switch (event.type) {
    case 'handStarted':
    case 'positionsAssigned': return `第 ${frame.view.handNumber} 手 · 准备发牌`;
    case 'blindPosted':
    case 'playerActed': return `${name(event.seatIndex)} · ${frame.view.seats.find((seat) => seat.seatIndex === event.seatIndex)?.lastAction ?? ''}`;
    case 'ownHoleCardsDealt': return '你的底牌已发出';
    case 'communityCardsDealt': return `${STREET_NAMES[event.street]} · ${event.cards.map((card) => card.code.slice(0, -1) + SUITS[card.suit]).join(' ')}`;
    case 'holeCardsRevealed': return `${name(event.seatIndex)} · ${event.reason === 'all-in' ? '全下亮牌' : '摊牌'}`;
    case 'showdownStarted': return '开始摊牌';
    case 'handEvaluated': return `${name(event.seatIndex)} · ${CATEGORIES[event.category]}`;
    case 'uncalledBetReturned': return `${name(event.seatIndex)} · 未跟注部分退回 ${amount(event.amount)}`;
    case 'potAwarded': return event.winners.map((winner, index) => `${name(winner)} 获得 ${amount(event.amounts[index]!)}`).join(' · ');
    default: return '牌局进行中';
  }
}

export function renderPlaybackFrame(frame: PlaybackFrame, roster: SeatIdentity[], step: number, total: number, mode: SessionMode = 'classic'): string {
  const evaluated = frame.event.type === 'handEvaluated'
    ? `<div class="playback-best-five"><span>最佳五张</span>${frame.event.bestFive.map((card) => cardFace(card, true)).join('')}</div>` : '';
  const panel = `<section class="decision playback-status" role="status" aria-live="polite"><p class="eyebrow">正在播放 · ${step} / ${total}</p><h2>${escapeHtml(frameCaption(frame, roster))}</h2>${evaluated}<p class="playback-hint">轮到你时会自动停下 · 可在上方调速或跳过</p></section>`;
  return renderSurface({ id: '', mode, roster, packet: null, view: frame.view }, panel, frame);
}

function renderSurface(table: PresentationTable, playbackPanel = '', frame?: PlaybackFrame): string {
  const view = table.view;
  const settled = table.packet !== null && table.packet.kind !== 'decision';
  const pot = table.packet?.kind === 'hand-result'
    ? table.packet.handResult.pots.reduce((sum, item) => sum + item.amount, 0) : view.potTotal;
  return `<div class="table-toolbar"><div><span class="live-dot" aria-hidden="true"></span> ${table.roster.length} 人桌 <span class="separator">/</span> 第 ${view.handNumber} 手 <span class="separator">/</span> ${settled ? '结算' : STREET_NAMES[view.street]}</div><div class="blind-label">盲注 <strong>${view.smallBlind} / ${view.bigBlind}</strong></div><button class="text-button" data-action="new">重新开桌</button></div>
    <div class="game-layout"><div class="play-column"><section class="arena" data-count="${table.roster.length}" aria-label="德州牌桌"><div class="felt"></div><div class="table-center"><div class="pot-display"><span>${settled ? '本手总底池 · 已结算' : '当前桌面投入'}</span><strong>${amount(pot)}</strong></div>${board(view.board)}<p class="table-caption">${frame ? escapeHtml(frameCaption(frame, table.roster)) : settled ? '查看下方结算，再继续下一手' : `${STREET_NAMES[view.street]} · ${view.board.length === 0 ? '等待翻牌' : `${view.board.length} 张公共牌`}`}</p></div>${table.roster.map((person) => renderSeat(table, person, frame)).join('')}</section>${playbackPanel || controls(table)}</div>
      <aside class="table-aside"><section class="opponents"><h2>这一桌的人</h2>${table.roster.filter((person) => person.seatIndex !== 0).map((person) => `<div class="opponent">${identity(person)}<p>${escapeHtml(person.style)}</p></div>`).join('')}<p class="aside-note">风格是倾向，不是每一手的答案。</p></section><details class="history" open><summary>本手记录 <span>${view.log.length}</span></summary><ol>${view.log.slice(-14).reverse().map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol></details></aside>
    </div>`;
}
