import type { Card } from '../core/types.js';
import type { HandCategory } from '../core/hand-evaluator.js';
import type { SeatIdentity, WebTable, SaveStatus } from './protocol.js';
import type { PlaybackFrame } from './playback.js';
import type { SessionMode } from '../game/session-types.js';
import { STREET_NAMES } from './view.js';
import { AI_DIFFICULTIES, AI_LABELS, type AiDifficulty } from '../agents/difficulty.js';
import { renderEntrances, renderGuide, renderStory, renderObservations, renderPulse } from './experience-render.js';
import { cardFace, orderedBestFive } from './poker-cards.js';

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

// Fixed asset names only. Neither the choice of portrait nor its expression sees private cards.
const PORTRAITS = new Map([
  ['hunter', './art/hunter-v1.png'], ['maniac', './art/maniac-v1.png'],
  ['calling-station', './art/calling-station-v1.png'],
  ['rock', './art/rock-v2.png'], ['small-ball', './art/small-ball-v2.png'],
  ['trapper', './art/trapper-v2.png'], ['value-bettor', './art/value-bettor-v2.png'],
]);
function portrait(person: SeatIdentity, state: 'neutral' | 'speaking' | 'win'): string {
  const source = PORTRAITS.get(person.characterId);
  return source ? `<div class="character-portrait portrait-${state}" data-portrait="${escapeHtml(person.characterId)}" aria-hidden="true"><img class="portrait-atlas" src="${source}" alt="" draggable="false" decoding="async"></div>`
    : '<div class="character-portrait portrait-fallback" aria-hidden="true"><span class="portrait-silhouette"></span></div>';
}

function identity(person: SeatIdentity): string {
  return `<span class="avatar avatar-${escapeHtml(person.characterId)}" aria-hidden="true">${escapeHtml(person.name.slice(-1))}</span><span class="person"><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.nickname)}</span></span>`;
}

function renderCast(roster: readonly SeatIdentity[]): string {
  return `<details class="cast-guide" data-panel="cast"><summary>认识这桌对手</summary><p class="cast-note">这些是他们的习惯，不是这一手的底牌提示。</p><div class="cast-grid">${roster.filter(person => person.seatIndex !== 0).map(person => `<article class="cast-card">${portrait(person, 'neutral')}<div class="cast-copy"><h2>${escapeHtml(person.name)}<small>${escapeHtml(person.nickname)}</small></h2><p class="cast-style">${escapeHtml(person.style)}</p>${person.about ? `<p>${escapeHtml(person.about)}</p>` : ''}</div></article>`).join('')}</div></details>`;
}

function board(cards: readonly Card[]): string {
  return `<div class="board" aria-label="公共牌">${Array.from({ length: 5 }, (_, index) => cards[index]
    ? cardFace(cards[index]!) : '<span class="card-slot" aria-label="尚未发出的公共牌">·</span>').join('')}</div>`;
}

export function renderLobby(rosters: Record<number, SeatIdentity[]>, playerCount: number, mode: SessionMode = 'classic', socialEnabled = true,
  save?: SaveStatus, hasActiveTable = false, difficulty: AiDifficulty = 'standard'): string {
  const roster = rosters[playerCount] ?? [];
  return `<section class="lobby" aria-label="选择牌桌">
    ${renderSavedProgress(save, hasActiveTable)}
    ${renderEntrances()}
    <div class="arena arena-lobby" data-count="${playerCount}"><div class="felt"></div>
      <div class="table-center"><div class="table-mark">夜 局</div><p class="table-subtitle">NO-LIMIT TEXAS HOLD’EM</p>${board([])}<p class="table-caption">选好人数，即可发牌</p></div>
      ${roster.map((person) => `<article class="seat" data-seat="${person.seatIndex}"><div class="seat-body">${identity(person)}<p class="seat-stack">100 <small>筹码</small></p><p class="seat-style">${escapeHtml(person.style)}</p></div></article>`).join('')}
    </div>
    <div class="mode-picker"><div><label for="game-mode">今晚的玩法</label><p>${mode === 'classic' ? '只凭牌技，按标准德州规则对局。' : '偷看、读牌、换牌：每种能力每场一次，每次行动最多用一种。'}</p></div><select id="game-mode"><option value="classic" ${mode === 'classic' ? 'selected' : ''}>经典德州</option><option value="ability-lab" ${mode === 'ability-lab' ? 'selected' : ''}>能力实验 · 三种能力</option></select></div>
    <div class="social-picker"><label for="social-enabled"><input type="checkbox" id="social-enabled" ${socialEnabled ? 'checked' : ''}><span><strong>人物记忆与闲聊</strong><small>${socialEnabled ? '开启：对手会记住公开动作，桌边会有气泡与观察提示。' : '关闭：安静打牌，保留当前强度，不启用跨手人物记忆。'}</small></span></label><p>与经典／能力规则独立，不进入剧情，也不限制六手。新开桌时生效。</p></div>
    <div class="difficulty-picker"><div><label for="ai-difficulty">对手强度</label><p>性格不变，判断更讲究。新开桌生效；教学仍由莫叔按课程配合。</p><small>${difficulty === 'casual' ? '休闲：判断较粗，比较舍不得弃牌。' : difficulty === 'challenging' ? '挑战：更重视赔率、连续加注和多人底池，减少无意义诈唬。' : '标准：结合公开下注读牌，保留人物牌风。'}</small></div><select id="ai-difficulty">${AI_DIFFICULTIES.map(level => `<option value="${level}" ${difficulty === level ? 'selected' : ''}>${AI_LABELS[level]}</option>`).join('')}</select></div>
    <div class="setup-bar"><div><h1>今晚，几个人？</h1><p>系统安排对手，你只管入座。</p></div>
      <div class="setup-controls"><label for="players">牌桌人数</label><select id="players">${[2, 3, 4, 5, 6].map((count) => `<option value="${count}" ${count === playerCount ? 'selected' : ''}>${count} 人桌</option>`).join('')}</select><button class="button button-primary" data-action="start">入座发牌 <span aria-hidden="true">↗</span></button></div>
    </div>${renderCast(roster)}<p class="footnote">${mode === 'classic' ? '经典德州' : '能力实验 · 仅你拥有能力'} · 每人 100 筹码 · 初始盲注 1 / 2 · 每 8 手升盲</p>
  </section>`;
}

function renderSavedProgress(save: SaveStatus | undefined, hasActiveTable: boolean): string {
  if (!save?.enabled) return '';
  const saved = save.saved;
  if (!saved) return `<p class="save-empty">${escapeHtml(save.error ?? '每手结算后自动保存。下次回来，可以从这里继续。')}</p>`;
  const date = new Date(saved.savedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const experience = saved.experience === 'tutorial' ? `桌边课 · 第 ${(saved.lesson ?? 0) + 1} 关` : saved.experience === 'living' ? '留一张椅子 · 序章' : '自由牌桌';
  return `<section class="resume-ticket" aria-label="上次结算存档"><div class="ticket-stub"><span>留席签</span><strong>${saved.hand}</strong><small>手 · 已结算</small></div>
    <div class="ticket-body"><p class="eyebrow">${experience} · ${saved.players} 人 · ${saved.mode === 'classic' ? '经典' : '能力实验'}</p><h1>${saved.ended ? '这一局的结果，替你留着。' : '椅子还在，接着打。'}</h1><p>你的筹码 <strong>${amount(saved.heroStack)}</strong> <span class="separator">/</span> <time datetime="${escapeHtml(saved.savedAt)}">${escapeHtml(date)}</time> 保存</p>
    <p class="ticket-note">${hasActiveTable ? '当前牌桌仍在运行，可从上方返回。' : `恢复到第 ${saved.hand} 手结算，未完成的一手不保存。`}</p>
    ${save.error ? `<p class="save-error" role="status">${escapeHtml(save.error)}</p>` : ''}</div>
    ${!hasActiveTable ? '<button class="button button-primary" data-action="restore">继续游戏 <span aria-hidden="true">↗</span></button>' : ''}
    <p class="ticket-footnote">仅此浏览器与当前网站地址 · 新开桌第一手结算后将覆盖这份存档</p></section>`;
}

function renderSaveStatus(table: WebTable): string {
  const save = table.save;
  if (!save?.enabled) return '';
  const label = save.error ?? (save.saved ? save.current ? `已保存到第 ${save.saved.hand} 手结算${table.packet.kind === 'decision' ? ' · 当前这手尚未保存' : ''}`
    : `保留上一桌／关的第 ${save.saved.hand} 手结算 · 本手结束后覆盖` : '本手结算后自动保存 · 现在离开尚无本桌存档');
  return `<div class="save-status ${save.error ? 'save-error' : ''}"><span role="status">${escapeHtml(label)}</span><button class="text-button" data-action="home">返回主页</button></div>`;
}

function renderRecaps(table: WebTable): string {
  if (!table.recentHands?.length) return '<p class="recap-empty">打完一手后，这里会留下交锋与净结果。</p>';
  return `<section class="recent-hands" aria-label="最近交锋"><h2>最近 ${table.recentHands.length} 手交锋</h2><p class="aside-note">只回顾已结算的公开事实，不推断未亮出的底牌。</p><ol>${[...table.recentHands].reverse().map((hand) => `<li><div class="recap-heading"><strong>第 ${hand.hand} 手</strong><span class="${hand.net > 0 ? 'net-win' : ''}">净${hand.net > 0 ? '赢' : hand.net < 0 ? '输' : '结果'} ${amount(Math.abs(hand.net))}</span><small>结算后 ${amount(hand.stack)}</small></div><p>${escapeHtml(hand.text)}</p>${hand.facts.map((fact) => `<p class="recap-fact">${escapeHtml(fact)}</p>`).join('')}</li>`).join('')}</ol></section>`;
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
  // All-in describes the hand's action, not the player's state after chips are paid.
  const settled = !!result || table.packet?.kind === 'game-result' || event?.type === 'handCompleted';
  const status = settled ? seat.stack === 0 ? '已淘汰' : seat.status === 'folded' ? '本手弃牌' : '本手已结束'
    : { active: '', folded: '已弃牌', 'all-in': '已全下', eliminated: '已淘汰' }[seat.status];
  const winnings = result ? `<span class="won-label ${result.net > 0 ? 'net-win' : result.net < 0 ? 'net-loss' : ''}">${result.net > 0 ? '净赢' : result.net < 0 ? '净输' : '持平'} ${amount(Math.abs(result.net))}</span>` : '';
  const speaking = frame?.line?.seatIndex === person.seatIndex;
  const remembered = frame?.memory?.seatIndex === person.seatIndex;
  const topSeat = ({ 2: 1, 4: 2, 6: 3 } as Record<number, number>)[table.roster.length] === person.seatIndex;
  const expression = awarded || (result?.net ?? 0) > 0 ? 'win' : speaking && frame?.line?.kind !== 'observation' ? 'speaking' : 'neutral';
  const note = table.packet ? table.living?.notes.find(note => note.seatIndex === person.seatIndex) : undefined;
  const profile = hero ? '' : `<button type="button" class="character-inspect" data-character-info="profile-${person.seatIndex}" aria-label="${escapeHtml(person.name)} · 人物资料" aria-expanded="false"><span aria-hidden="true">i</span></button><template id="profile-${person.seatIndex}"><p class="eyebrow">桌边人物</p><h2>${escapeHtml(person.name)} <small>${escapeHtml(person.nickname)}</small></h2><p class="profile-style">${escapeHtml(person.style)}</p><p>${escapeHtml(person.about ?? '教学陪练，按课程配合。')}</p><p class="profile-state">${amount(seat.stack)} 筹码 · ${escapeHtml(status || '在座')}</p>${note ? `<p class="profile-mood">${escapeHtml(note.mood)}</p><div class="profile-memory"><strong>公开印象</strong><p>${escapeHtml(note.fact)}</p><small>${escapeHtml(note.inference)}</small></div>` : ''}<p class="profile-footnote">只展示人物设定和已发生的公开信息，不显示底牌或胜率。</p></template>`;
  return `<article class="seat ${hero ? 'hero' : 'npc-seat'} ${current ? 'is-current' : ''} ${acting ? 'is-acting' : ''} ${speaking || remembered ? 'is-speaking' : ''} ${awarded ? 'is-awarded' : ''} ${seat.status === 'folded' || seat.status === 'eliminated' ? 'is-out' : ''}" data-seat="${person.seatIndex}" aria-label="${escapeHtml(person.name)}${current ? '，轮到你' : ''}">
    ${hero ? '' : portrait(person, expression)}${profile}
    ${cardsHtml}<div class="seat-body">${identity(person)}<div class="seat-positions">${badges}</div><p class="seat-stack">${amount(seat.stack)} <small>筹码</small></p>
    <p class="seat-action">${current ? '轮到你' : escapeHtml(settled ? status : acting ? seat.lastAction || status || '亮牌' : status || seat.lastAction || '等待行动')}</p>${winnings}</div>
    ${(!table.packet || table.packet.kind === 'decision') && seat.committedStreet > 0 ? `<div class="bet-chip"><span aria-hidden="true">◉</span> ${amount(seat.committedStreet)} <small>本轮</small></div>` : ''}
    ${speaking ? `<div class="seat-bubble ${frame!.line!.kind === 'observation' ? 'bubble-observation' : 'bubble-speech'} ${topSeat ? 'speech-top' : ''}" role="status" aria-label="${escapeHtml(person.name)} · ${frame!.line!.kind === 'observation' ? '观察到的动作' : '发言'}"><small class="bubble-kind">${frame!.line!.kind === 'observation' ? '观察' : '发言'}</small><span>${escapeHtml(frame!.line!.text)}</span></div>` : remembered ? '<span class="seat-memory-tag">记下了你的动作</span>' : ''}
  </article>`;
}

function settlement(table: PresentationTable): string {
  if (table.packet?.kind !== 'hand-result') return '';
  const result = table.packet.handResult;
  const hero = result.seats.find((seat) => seat.seatIndex === 0)!;
  const title = hero.net > 0 ? `本手净赢 ${signed(hero.net)}` : hero.net < 0 ? `本手净输 ${amount(-hero.net)}` : '本手持平';
  const name = (index: number) => escapeHtml(table.roster.find((person) => person.seatIndex === index)?.name ?? '玩家');
  return `<section class="settlement" aria-label="本手结算"><div class="result-heading"><div><p class="eyebrow">第 ${result.handNumber} 手 · 已结算</p><h2>${title}</h2></div>${!table.tutorial && !table.living?.ended ? `<button class="button button-primary" data-action="continue">${hero.finalStack === 0 ? '继续观看' : '下一手'} <span aria-hidden="true">→</span></button>` : ''}</div>
    <div class="pot-results">${result.pots.map((pot) => `<p><span class="pot-label">${escapeHtml(pot.label)} ${amount(pot.amount)}</span>${pot.winnerSeatIndexes.map((winner, index) => `${name(winner)} 获得 ${amount(pot.awards[index]!)}`).join(' · ')}${pot.winnerSeatIndexes.length > 1 ? pot.awards.every(award => award === pot.awards[0]) ? '（平分）' : '（分池，含零头筹码）' : ''}</p>`).join('')}</div>
    <details class="settlement-details" data-panel="settlement-${result.handNumber}"><summary>结算账单 · 牌型与筹码去向</summary>
      <p class="settlement-key">金色底边标记组成牌型的底牌；底池收入包含自己的投入，净结果才是盈亏。</p>
      <div class="settlement-ledger">${result.seats.map((seat) => `<article class="hand-receipt ${seat.net > 0 ? 'receipt-positive' : ''}" data-result-seat="${seat.seatIndex}">
        <header class="receipt-heading"><div><strong>${name(seat.seatIndex)}</strong><span class="hand-category">${seat.category ? CATEGORIES[seat.category] : '未公开牌型'}</span></div><div class="receipt-net ${seat.net > 0 ? 'net-win' : seat.net < 0 ? 'net-loss' : ''}"><small>净结果</small><strong>${signed(seat.net)}</strong></div></header>
        <div class="receipt-cards">${seat.bestFive && seat.category ? `<div class="receipt-best"><span class="receipt-label">最佳五张</span><div class="receipt-card-row">${orderedBestFive(seat.bestFive, seat.category).map(card => cardFace(card, true, seat.holeCards?.some(hole => hole.code === card.code))).join('')}</div></div>` : ''}
          <div class="receipt-hole"><span class="receipt-label">底牌</span><div class="receipt-card-row">${seat.holeCards ? seat.holeCards.map(card => cardFace(card, true)).join('') : '<span class="unrevealed-cards">未亮牌</span>'}</div></div></div>
        <dl class="receipt-accounting"><div><dt>本手投入</dt><dd>${amount(seat.invested)}</dd></div><div><dt>底池收入</dt><dd>${amount(seat.potWon)}</dd></div><div><dt>退回</dt><dd>${amount(seat.returned)}</dd></div><div><dt>结算筹码</dt><dd>${amount(seat.finalStack)}</dd></div></dl>
      </article>`).join('')}</div></details>
  </section>`;
}

function renderAbilityPanel(table: PresentationTable): string {
  const packet = table.packet;
  if (!packet || table.mode !== 'ability-lab') return '';
  if (packet.kind !== 'decision') return '<p class="private-cleared">能力实验 · 本手私有情报已清除</p>';
  const abilities = packet.abilities;
  if (!abilities) return '';
  const name = (seatIndex: number) => escapeHtml(table.roster.find((person) => person.seatIndex === seatIndex)?.name ?? '对手');
  const labels = { peek: '偷看一张', read: '粗略读牌', swap: '更换底牌' };
  const descriptions = {
    peek: '随机得知对手的一张底牌，不会让其公开亮牌。',
    read: '估算对手当前牌力：弱 / 中等 / 强，不保证胜负。',
    swap: '选自己的一张牌，换成下一张未发出的牌；不可预览或撤销。',
  };
  const slots = (['peek', 'read', 'swap'] as const).map((ability) => {
    const spent = abilities.charges[ability] === 0;
    const commands = abilities.availableCommands.filter((command) => command.ability === ability);
    return `<section class="ability-slot ${spent ? 'is-spent' : ''}" aria-label="${labels[ability]}"><div class="ability-slot-heading"><h3>${labels[ability]}</h3><span class="ability-charge">本场剩余 ${abilities.charges[ability]} / 1</span></div>
      <p class="ability-description">${descriptions[ability]}</p>
      ${commands.length ? `<div class="peek-targets">${commands.map((command) => command.ability === 'swap'
        ? `<button class="button button-peek button-swap" data-action="swap" data-hole-index="${command.holeCardIndex}">换掉 ${cardFace(packet.observation.holeCards[command.holeCardIndex], true)}</button>`
        : `<button class="button button-peek" data-action="${command.ability}" data-target-seat="${command.targetSeatIndex}">${command.ability === 'peek' ? '偷看' : '读牌'} ${name(command.targetSeatIndex)}</button>`).join('')}</div>`
        : `<p class="ability-state">${spent ? '本场已使用 · 下一手不会恢复' : abilities.usedThisDecision ? '本次行动已锁定' : '当前没有可用目标'}</p>`}
    </section>`;
  }).join('');
  const bands = { weak: '弱', medium: '中等', strong: '强' };
  const intel = abilities.knowledge.map((entry) => {
    if (entry.type === 'peek') return `<div class="intel-card">${cardFace(entry.card)}<div><strong>${name(entry.targetSeatIndex)} 的一张底牌</strong><p>仅你可见 · 对手尚未因此亮牌</p></div></div>`;
    if (entry.type === 'read') return `<div class="intel-card"><span class="strength-band strength-${entry.band}">${bands[entry.band]}</span><div><strong>${name(entry.targetSeatIndex)} · ${STREET_NAMES[entry.street]}时的牌力</strong><p>一次性估算，不随新公共牌更新，也不代表胜负。</p></div></div>`;
    return `<div class="intel-card"><div class="swap-receipt">${cardFace(entry.oldCard, true)}<span aria-label="换成">→</span>${cardFace(entry.newCard, true)}</div><div><strong>第 ${entry.holeCardIndex + 1} 张底牌已更换</strong><p>旧牌退出本手，本手将按新牌结算。</p></div></div>`;
  }).join('');
  return `<section class="ability-panel" aria-label="私有能力"><div class="ability-heading"><div><p class="eyebrow">能力实验 / 仅你可见</p><h2>你的暗手</h2></div><span class="ability-rule">每种每场一次</span></div>
    <p class="ability-description">${Object.values(abilities.charges).every((remaining) => remaining === 0) ? '本场三种能力均已用完，请继续正常打牌。' : abilities.usedThisDecision ? '本次已使用能力，请完成正常打牌操作；下次轮到你时可用另一种。' : '先用一种能力，或直接打牌。能力不消耗筹码，也不会替你下注。'}</p>
    <div class="ability-grid">${slots}</div>
    ${intel ? `<div class="private-intel" role="status" aria-live="polite" aria-label="本手私有情报">${intel}<p class="ability-description">本手结束后清除 · 不会传给 NPC</p></div>` : ''}
  </section>`;
}

function controls(table: PresentationTable): string {
  const packet = table.packet;
  if (!packet) return '';
  if (packet.kind === 'hand-result') return settlement(table);
  if (packet.kind === 'game-result') {
    const winner = table.roster.find((person) => person.seatIndex === packet.winnerSeatIndex)!;
    return `<section class="decision"><p class="eyebrow">比赛结束</p><h2>${escapeHtml(winner.name)} 赢得本场</h2><p>最终筹码 ${amount(packet.finalStacks.find((seat) => seat.seatIndex === packet.winnerSeatIndex)!.stack)}</p><button class="button button-primary" data-action="new">再开一桌</button></section>`;
  }
  const commands = packet.actionPanel.commands;
  const raise = commands.find((command) => command.kind === 'raise-range');
  const call = packet.observation.legalActions.call?.pay ?? 0;
  return `<section class="decision" aria-label="你的操作">${table.tutorial ? `<p class="dock-coach" id="coach-hint"><strong>莫叔提醒</strong>${escapeHtml(table.tutorial.hint)}</p>` : ''}<div class="decision-heading"><h2>轮到你了 <span class="call-due">${packet.actionPanel.facingBet ? `待跟 ${amount(call)}` : '可以过牌'}</span></h2><p class="contestable">${packet.actionPanel.facingBet ? `跟注 ${amount(call)} 后，最多可争夺` : '你当前可争夺'} <strong>${amount(packet.actionPanel.heroContestableTotal)}</strong></p></div>
    <div class="decision-actions">
    <div class="action-row">${commands.filter((command) => command.kind === 'fixed').map((command) => {
      const type = command.intent.type;
      const guided = table.tutorial?.recommended?.type === type;
      return `<button class="button ${guided ? 'is-guided ' : ''}${type === 'call' || type === 'check' ? 'button-primary' : type === 'allIn' ? 'button-allin' : 'button-secondary'}" data-action="act" data-intent="${type}"${guided ? ' aria-describedby="coach-hint"' : ''}>${escapeHtml(command.label)}${guided ? ' · 试这个' : ''}</button>`;
    }).join('')}</div>
    ${raise ? `<form id="raise-form" class="raise-form"><label for="raise-amount">加注到</label><input id="raise-amount" name="amount" type="number" inputmode="numeric" min="${raise.minimum}" max="${raise.maximum}" step="1" value="${raise.minimum}" aria-describedby="raise-help" required><button class="button button-raise ${table.tutorial?.recommended?.type === 'raiseTo' ? 'is-guided' : ''}" type="submit"${table.tutorial?.recommended?.type === 'raiseTo' ? ' aria-describedby="coach-hint"' : ''}>确认加注</button><small id="raise-help"><span class="raise-range">${raise.minimum}–${raise.maximum}</span> · 本轮下注总额，不是额外投入</small></form>` : ''}
  </div></section>`;
}

export function renderTable(table: WebTable, muted = false): string {
  return renderSurface(table, '', undefined, muted);
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
    case 'handCompleted': return '本手结算完成';
    default: return '牌局进行中';
  }
}

export function renderPlaybackFrame(frame: PlaybackFrame, roster: SeatIdentity[], step: number, total: number, mode: SessionMode = 'classic'): string {
  const evaluated = frame.event.type === 'handEvaluated'
    ? `<div class="playback-best-five"><span>最佳五张</span>${orderedBestFive(frame.event.bestFive, frame.event.category).map((card) => cardFace(card, true)).join('')}</div>` : '';
  const panel = `<section class="decision playback-status" role="status" aria-live="polite"><p class="eyebrow">正在播放 · ${step} / ${total}</p><h2>${escapeHtml(frameCaption(frame, roster))}</h2>${evaluated}<p class="playback-hint">轮到你时会自动停下 · 可在上方调速或跳过</p></section>`;
  return renderSurface({ id: '', mode, roster, packet: null, view: frame.view }, panel, frame);
}

function renderSurface(table: PresentationTable, playbackPanel = '', frame?: PlaybackFrame, muted = false): string {
  const view = table.view;
  const settled = table.packet !== null && table.packet.kind !== 'decision';
  const pot = table.packet?.kind === 'hand-result'
    ? table.packet.handResult.pots.reduce((sum, item) => sum + item.amount, 0) : view.potTotal;
  const fullTable = table.packet ? table as WebTable : null;
  const guide = fullTable ? renderGuide(fullTable, escapeHtml) : '';
  const story = fullTable ? renderStory(fullTable, escapeHtml) : '';
  const pulse = frame ? renderPulse(frame.line || frame.memory ? { lines: frame.line ? [frame.line] : [], memories: frame.memory ? [frame.memory] : [] } : null, escapeHtml, false, true)
    : renderPulse(table.living && table.recentHands?.length ? { ...table.living, recap: null } : table.living, escapeHtml, muted);
  const observations = fullTable ? renderObservations(fullTable, escapeHtml) : '';
  const caption = settled ? table.tutorial ? '这手已结束，完成下方课后问题' : table.living?.ended ? '序章已结束，下方保留真实结算' : '查看结算，再继续下一手'
    : `${STREET_NAMES[view.street]} · ${view.board.length === 0 ? '等待翻牌' : `${view.board.length} 张公共牌`}`;
  const latestLine = frame?.line ?? table.living?.lines.filter((line) => !muted || line.kind === 'observation').at(-1);
  const latestMemory = frame?.memory ?? table.living?.memories?.at(-1);
  const memoryIsLatest = latestMemory && (!latestLine || latestMemory.packetIndex > latestLine.packetIndex
    || (latestMemory.packetIndex === latestLine.packetIndex && latestMemory.eventIndex >= latestLine.eventIndex));
  const latest = memoryIsLatest ? `第 ${latestMemory.hand} 手 · ${latestMemory.title}`
    : latestLine ? `第 ${latestLine.hand} 手 · ${latestLine.speaker} · ${latestLine.kind === 'observation' ? '观察' : '发言'}：${latestLine.text}` : '人物观察与本手记录';
  const ability = renderAbilityPanel(table);
  return `<div class="table-surface pixel-table ${table.tutorial && !settled ? 'has-coach' : ''}"><div class="table-toolbar"><div><span class="live-dot" aria-hidden="true"></span> ${table.roster.length} 人桌 <span class="separator">/</span> 第 ${view.handNumber} 手 <span class="separator">/</span> ${settled ? '结算' : STREET_NAMES[view.street]}</div><div class="blind-label">盲注 <strong>${view.smallBlind} / ${view.bigBlind}</strong></div><button class="text-button" data-action="new">重新开桌</button></div>
    <div class="game-layout"><div class="play-column"><section class="arena" data-count="${table.roster.length}" aria-label="德州牌桌"><div class="room-backdrop" aria-hidden="true"></div><div class="felt" aria-hidden="true"></div><div class="table-center"><div class="pot-display"><span>${settled ? '本手总底池 · 已结算' : '当前底池'}</span><strong>${amount(pot)}</strong></div>${board(view.board)}<p class="table-caption">${frame ? escapeHtml(frameCaption(frame, table.roster)) : caption}</p></div>${table.roster.map((person) => renderSeat(table, person, frame)).join('')}</section>
    <div class="action-dock">${playbackPanel || controls(table)}</div>
    ${fullTable ? renderSaveStatus(fullTable) : ''}
    <div class="table-tools">${ability ? `<details class="table-pocket ability-pocket" data-panel="abilities"><summary>你的暗手 <span>${table.packet?.kind === 'decision' ? table.packet.abilities?.usedThisDecision ? '已用能力 · 查看情报' : '偷看 / 读牌 / 换牌' : '本手情报已清除'}</span></summary>${ability}</details>` : ''}
    <details class="table-pocket notebook-pocket" data-panel="notebook"><summary>桌边记录 <span>${escapeHtml(latest)}</span></summary>${fullTable ? renderRecaps(fullTable) : ''}<div class="notebook-content">${pulse}<aside class="table-aside">${observations || `<section class="opponents"><h2>这一桌的人</h2>${table.roster.filter((person) => person.seatIndex !== 0).map((person) => `<div class="opponent">${identity(person)}<p>${escapeHtml(person.style)}</p></div>`).join('')}<p class="aside-note">风格是倾向，不是每一手的答案。</p></section>`}<details class="history" data-panel="history"><summary>本手记录 <span>${view.log.length}</span></summary><ol>${view.log.slice(-14).reverse().map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol></details></aside></div></details>
    ${guide ? `<details class="table-pocket lesson-pocket" data-panel="lesson-${table.tutorial?.lesson}-${table.tutorial?.atResult ? 'result' : 'play'}"${table.tutorial?.atResult ? ' open' : ''}><summary>莫叔的桌边课 <span>${table.tutorial?.atResult ? '完成课后问题' : '教学详解与规则速查'}</span></summary>${guide}</details>` : ''}
    ${story ? `<details class="table-pocket story-pocket" data-panel="story-${table.living?.ended ? 'ended' : 'play'}"${table.living?.ended ? ' open' : ''}><summary>桌边故事 <span>${escapeHtml(table.living?.prompt?.title ?? '留一张椅子')}</span></summary>${story}</details>` : ''}</div></div></div></div>`;
}
