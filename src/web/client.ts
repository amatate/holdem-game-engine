import type { Bootstrap, WebTable, SaveStatus } from './protocol.js';
import { requestTable, browserTable } from './transport.js';
import { renderLobby, renderTable, renderPlaybackFrame } from './render.js';
import { buildPlaybackFrames, PlaybackClock, type PlaybackFrame } from './playback.js';
import { installTableReadTool, type TableToolContext } from './agent-tools.js';
import type { ActionIntent } from '../core/legal-actions.js';
import type { AbilityCommandView } from '../game/peek-ability.js';
import type { SessionMode } from '../game/session-types.js';
import { installLocalization } from './i18n.js';
import { installSoundControls, frameSound, boundarySound } from './sound.js';
import type { SoundCue } from './sound-assets.js';
import { AI_LABELS, isAiDifficulty, type AiDifficulty } from '../agents/difficulty.js';
import { installCharacterInfo } from './character-info.js';
import { installMusicControls } from './music.js';
import { installDeckSkins } from './deck-skins.js';

const localization = installLocalization(document, window);
const sound = installSoundControls(document, window, () => localization.refresh());
installMusicControls(document, window, () => localization.refresh());
const characterInfo = installCharacterInfo(document, window, () => localization.refresh());
const deckSkins = installDeckSkins(document, window, () => localization.refresh());

const app = document.querySelector<HTMLElement>('#app')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
let state: Bootstrap = { rosters: {}, table: null };
let count = 4;
let mode: SessionMode = 'classic';
let busy = false;
let choosingTable = false;
let talkMuted = false;
let socialEnabled = true;
let difficulty: AiDifficulty = 'standard';
try { const saved = localStorage.getItem('holdem.ai-difficulty'); if (isAiDifficulty(saved)) difficulty = saved; } catch { /* Optional preference. */ }
try { talkMuted = localStorage.getItem('holdem.talk-muted') === 'true'; } catch { /* Optional preference. */ }
try { socialEnabled = localStorage.getItem('holdem.social-enabled') !== 'false'; } catch { /* Optional preference. */ }
const clock = new PlaybackClock();
const speedControl = document.querySelector<HTMLSelectElement>('#playback-speed');
const skipControl = document.querySelector<HTMLButtonElement>('#playback-skip');
const replaceDialog = document.querySelector<HTMLDialogElement>('#replace-table-dialog');
const speedKey = 'holdem.playback-speed';
let playing = false;
let frame: PlaybackFrame | null = null;
let frameIndex = 0;
let frameCount = 0;
let animations: Animation[] = [];
// Keep only presentation preferences; never copy cards or commands between renders.
let displayedTableId: string | null = null;
let displayedDecisionKey: string | null = null;
const expandedPanels = new Map<string, boolean>();
try { clock.setSpeed(Number(localStorage.getItem(speedKey))); } catch { /* Storage may be unavailable. */ }
if (speedControl) speedControl.value = String(clock.speed);
const toolLifecycle = installTableReadTool(
  (document as Document & { modelContext?: TableToolContext }).modelContext,
  () => choosingTable || playing ? null : state.table,
);
window.addEventListener('pagehide', () => { toolLifecycle.abort(); clock.skip(); clearAnimations(); }, { once: true });

function draw(): void {
  characterInfo?.close();
  const visibleTable = state.table && !choosingTable ? state.table : null;
  // Public experience identity only; never the hand, AI intent, or future events.
  deckSkins?.setSceneDeck(visibleTable?.experience === 'tutorial' ? 'lantern' : visibleTable?.experience === 'living' ? 'blue-hour' : 'night');
  const nextTableId = visibleTable?.id ?? null;
  const sameTable = displayedTableId === nextTableId;
  if (!sameTable) expandedPanels.clear();
  displayedTableId = nextTableId;
  const nextDecisionKey = !frame && visibleTable?.packet.kind === 'decision' ? visibleTable.packet.decisionKey : null;
  const oldRaise = app.querySelector<HTMLInputElement>('#raise-amount');
  const raiseDraft = sameTable && nextDecisionKey && nextDecisionKey === displayedDecisionKey ? oldRaise?.value : undefined;
  const restoreRaiseFocus = !!oldRaise && document.activeElement === oldRaise;
  app.innerHTML = frame && state.table ? renderPlaybackFrame(frame, state.table.roster, frameIndex, frameCount, state.table.mode)
    : state.table && !choosingTable ? renderTable(state.table, talkMuted)
      : `${state.table ? '<button class="text-button resume-table" data-action="resume">← 返回尚未关闭的牌桌</button>' : ''}${renderLobby(state.rosters, count, mode, socialEnabled, state.save, !!state.table, difficulty)}`;
  document.body.classList.toggle('at-table', !!visibleTable);
  if (!sameTable && visibleTable) window.scrollTo(0, 0);
  for (const panel of app.querySelectorAll<HTMLDetailsElement>('details[data-panel]')) {
    const saved = expandedPanels.get(panel.dataset.panel!);
    if (saved !== undefined) panel.open = saved;
  }
  const newRaise = app.querySelector<HTMLInputElement>('#raise-amount');
  if (raiseDraft !== undefined && newRaise) {
    newRaise.value = raiseDraft;
    if (restoreRaiseFocus) newRaise.focus({ preventScroll: true });
  }
  displayedDecisionKey = nextDecisionKey;
  const label = document.querySelector('#mode-label');
  const visibleMode = state.table && !choosingTable ? state.table.mode : mode;
  if (label) label.textContent = state.table && !choosingTable && state.table.experience === 'tutorial' ? '新手教学'
    : `${state.table && !choosingTable && state.table.living ? state.table.experience === 'living' ? '剧情序章 · ' : '人物互动 · ' : ''}${visibleMode === 'ability-lab' ? '能力实验' : '经典德州'}`;
  if (label && visibleTable?.experience !== 'tutorial' && visibleTable) {
    label.textContent += ` · ${AI_LABELS[visibleTable.difficulty ?? 'standard']}`;
  }
  lock(busy);
}
app.addEventListener('toggle', (event) => {
  const panel = event.target;
  if (panel instanceof HTMLDetailsElement && panel.isConnected && panel.dataset.panel) {
    expandedPanels.set(panel.dataset.panel, panel.open);
    if (expandedPanels.size > 64) expandedPanels.delete(expandedPanels.keys().next().value!);
  }
}, true);
function lock(value: boolean): void {
  busy = value;
  app.setAttribute('aria-busy', String(value));
  for (const element of app.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select')) {
    element.disabled = value && !element.matches?.('[data-character-info]');
  }
  connection.textContent = playing ? '正在播放牌局…' : value ? '正在处理牌局…' : browserTable ? '浏览器单机' : '本地牌桌';
  if (skipControl) skipControl.disabled = !playing;
  localization.refresh();
}
function message(text: string): void { notice.textContent = text; notice.hidden = text.length === 0; localization.refresh(); }

function clearAnimations(): void {
  animations.forEach((animation) => animation.cancel());
  animations = [];
}

function animateFrame(current: PlaybackFrame): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const animate = (element: Element, keyframes: Keyframe[], duration: number) => {
    if (typeof element.animate !== 'function') return;
    const animation = element.animate(keyframes, { duration, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
    animation.playbackRate = clock.speed;
    animations.push(animation);
  };
  const event = current.event;
  for (const bubble of app.querySelectorAll('.seat-bubble')) {
    animate(bubble, [{ opacity: 0, transform: 'translateY(6px) scale(.97)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], 240);
  }
  if (current.reactionOnly) return;
  const cardSelector = event.type === 'communityCardsDealt' ? '.board .card'
    : event.type === 'ownHoleCardsDealt' ? '.seat:not(.is-out) .seat-cards .card'
    : event.type === 'holeCardsRevealed' ? `[data-seat="${event.seatIndex}"] .seat-cards .card` : null;
  if (cardSelector) {
    const cards = [...app.querySelectorAll(cardSelector)];
    cards.slice(event.type === 'communityCardsDealt' ? current.previousBoardCount : 0).forEach((card, index) => {
      animate(card, [
        { opacity: 0, transform: 'translateY(-22px) rotateY(85deg) scale(.9)' },
        { opacity: 1, transform: 'translateY(0) rotateY(0) scale(1)' },
      ], Math.min(current.holdMs - 80, 480 + index * 60));
    });
  }
  for (const seat of app.querySelectorAll('.is-acting .seat-body, .is-awarded .seat-body')) {
    animate(seat, [{ boxShadow: '0 0 0 5px #e7bb7255' }, { boxShadow: '0 0 0 2px #e7bb7222' }], 650);
  }
  const flyChips = (seatIndex: number, chips: number, toWinner: boolean) => {
    if (chips <= 0) return;
    const arena = app.querySelector('.arena');
    const seat = app.querySelector(`[data-seat="${seatIndex}"] .seat-body`);
    const pot = app.querySelector('.pot-display');
    if (!arena || !seat || !pot) return;
    const bounds = arena.getBoundingClientRect();
    const coordinates = (element: Element) => {
      const box = element.getBoundingClientRect();
      return `translate(${box.left + box.width / 2 - bounds.left}px, ${box.top + box.height / 2 - bounds.top}px) translate(-50%, -50%)`;
    };
    const origin = coordinates(toWinner ? pot : seat);
    const target = coordinates(toWinner ? seat : pot);
    const chip = document.createElement('span');
    chip.className = 'flying-chip';
    chip.setAttribute('aria-hidden', 'true');
    chip.textContent = `◉ ${chips.toLocaleString('zh-CN')}`;
    arena.append(chip);
    animate(chip, [
      { transform: origin, opacity: 0, offset: 0 },
      { transform: origin, opacity: 1, offset: 0.12 },
      { transform: target, opacity: 1, offset: 0.85 },
      { transform: target, opacity: 0, offset: 1 },
    ], Math.min(current.holdMs - 80, 650));
  };
  if (event.type === 'playerActed') flyChips(event.seatIndex, event.paid, false);
  if (event.type === 'blindPosted') flyChips(event.seatIndex, event.amount, false);
  if (event.type === 'uncalledBetReturned') flyChips(event.seatIndex, event.amount, true);
  if (event.type === 'potAwarded') event.winners.forEach((winner, index) => flyChips(winner, event.amounts[index]!, true));
}

async function play(previous: WebTable | null, next: WebTable): Promise<void> {
  // A missing/noncontiguous predecessor cannot safely be reconstructed: sync directly.
  const sameTable = previous?.id === next.id;
  if (sameTable && (next.packet.packetIndex !== previous.packet.packetIndex + 1
    || next.packet.coreEventRange.fromVersionInclusive !== previous.packet.coreEventRange.toVersionExclusive)) return;
  if (!sameTable && !next.packet.viewerEventsSinceLastPacket.some((event) => event.type === 'gameStarted')) return;
  const frames = buildPlaybackFrames(sameTable ? previous.view : null, next.packet.viewerEventsSinceLastPacket, next.roster,
    next.living ? { packetIndex: next.packet.packetIndex,
      lines: next.living.lines.filter((line) => !talkMuted || line.kind === 'observation'), memories: next.living.memories ?? [] } : undefined);
  if (!frames.length) return;
  playing = true; clock.start(); frameCount = frames.length;
  try {
    for (const [index, current] of frames.entries()) {
      if (clock.skipped) break;
      clearAnimations(); frame = current; frameIndex = index + 1; draw(); animateFrame(current);
      sound?.play(frameSound(current));
      await clock.wait(current.holdMs);
    }
  } finally {
    clearAnimations(); frame = null; playing = false;
  }
}

speedControl?.addEventListener('change', () => {
  clock.setSpeed(Number(speedControl.value));
  animations.forEach((animation) => { animation.playbackRate = clock.speed; });
  try { localStorage.setItem(speedKey, String(clock.speed)); } catch { /* Keep the in-memory preference. */ }
});
skipControl?.addEventListener('click', () => { clock.skip(); clearAnimations(); sound?.stop(); });
replaceDialog?.addEventListener('close', () => {
  if (replaceDialog.returnValue !== 'choose') return;
  choosingTable = true; message(''); draw();
});

async function synchronize(): Promise<void> {
  const response = await requestTable('/api/bootstrap');
  if (!response.ok) throw new Error(browserTable ? '浏览器牌桌暂未就绪，请刷新重试。' : '无法连接本地牌桌，请确认服务仍在运行。');
  state = await response.json() as Bootstrap;
}

async function mutate(path: string, body: unknown): Promise<void> {
  if (busy) return;
  lock(true); message('');
  const previous = state.table;
  let cue: SoundCue | null = null;
  try {
    const response = await requestTable(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json() as { table?: WebTable; error?: string; save?: SaveStatus };
    if (result.save || result.table?.save) state.save = result.save ?? result.table!.save!;
    if (result.table) { state.table = result.table; choosingTable = false; }
    if (!response.ok) {
      if (response.status === 401) { state.table = null; choosingTable = false; }
      message(result.error ?? '操作未完成，请同步牌桌后重试。');
    } else if (result.table) {
      if (path !== '/api/resume') {
        await play(previous, result.table);
        cue = boundarySound(previous, result.table);
      }
    }
  } catch {
    // Never automatically replay a wager after an uncertain network result.
    try { await synchronize(); choosingTable = false; message('连接曾中断，已同步实际牌局；没有重复提交操作。'); }
    catch { message(browserTable ? '浏览器引擎未响应。请刷新页面，从上次结算恢复；不要重复下注。' : '连接中断。恢复服务后点击右上角“同步牌桌”，不要重复下注。'); }
  } finally { lock(false); draw(); sound?.play(cue); }
}

async function act(intent: ActionIntent): Promise<void> {
  const table = state.table;
  if (!table || table.packet.kind !== 'decision' || choosingTable) return;
  await mutate('/api/action', { tableId: table.id, command: { type: 'act',
    decisionKey: table.packet.decisionKey, expectedPacketIndex: table.packet.packetIndex, intent } });
}

async function useAbility(selection: AbilityCommandView): Promise<void> {
  const table = state.table;
  if (busy || choosingTable || !table || table.mode !== 'ability-lab' || table.packet.kind !== 'decision') return;
  if (!table.packet.abilities?.availableCommands.some((command) => command.ability === selection.ability
    && (command.ability === 'swap' && selection.ability === 'swap'
      ? command.holeCardIndex === selection.holeCardIndex
      : command.ability !== 'swap' && selection.ability !== 'swap' && command.targetSeatIndex === selection.targetSeatIndex))) return;
  await mutate('/api/action', { tableId: table.id, command: { type: 'useAbility', ...selection,
    decisionKey: table.packet.decisionKey, expectedPacketIndex: table.packet.packetIndex } });
}

app.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.id === 'ai-difficulty' && isAiDifficulty(target.value)) {
    difficulty = target.value;
    try { localStorage.setItem('holdem.ai-difficulty', difficulty); } catch { /* Optional preference. */ }
    draw();
  }
  if (target instanceof HTMLSelectElement && target.id === 'players') { count = Number(target.value); draw(); }
  if (target instanceof HTMLSelectElement && target.id === 'game-mode'
    && (target.value === 'classic' || target.value === 'ability-lab')) { mode = target.value; draw(); }
  if (target instanceof HTMLInputElement && target.id === 'social-enabled') {
    socialEnabled = target.checked;
    try { localStorage.setItem('holdem.social-enabled', String(socialEnabled)); } catch { /* Optional preference. */ }
    draw();
  }
});
app.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
  if (!button || busy) return;
  switch (button.dataset.action) {
    case 'start': void mutate('/api/table', { players: count, mode, socialEnabled, difficulty }); break;
    case 'tutorial-start': void mutate('/api/table', { players: 2, mode: 'classic', experience: 'tutorial' }); break;
    case 'living-start': void mutate('/api/table', { players: 4, mode, experience: 'living', difficulty }); break;
    case 'practice-start': void mutate('/api/table', { players: 4, mode: 'classic', experience: 'free', socialEnabled, difficulty }); break;
    case 'home': sound?.stop(); choosingTable = true; message(''); draw(); break;
    case 'resume': choosingTable = false; message(''); draw(); break;
    case 'restore':
      if (state.save?.saved) void mutate('/api/resume', { checkpointId: state.save.saved.id });
      break;
    case 'toggle-talk':
      talkMuted = !talkMuted;
      try { localStorage.setItem('holdem.talk-muted', String(talkMuted)); } catch { /* Optional preference. */ }
      draw(); break;
    case 'reply':
      if (state.table?.living) void mutate('/api/reply', { tableId: state.table.id,
        expectedPacketIndex: state.table.packet.packetIndex, revision: state.table.living.revision,
        promptId: button.dataset.prompt, choice: button.dataset.choice });
      break;
    case 'lesson-answer':
    case 'lesson-next':
    case 'lesson-restart':
      if (state.table?.tutorial) void mutate('/api/lesson', { tableId: state.table.id,
        expectedPacketIndex: state.table.packet.packetIndex, revision: state.table.tutorial.revision,
        operation: button.dataset.action.slice(7), answer: button.dataset.answer });
      break;
    case 'peek':
    case 'read': {
      const target = Number(button.dataset.targetSeat);
      if (Number.isSafeInteger(target)) void useAbility({ ability: button.dataset.action, targetSeatIndex: target });
      break;
    }
    case 'swap': {
      const index = Number(button.dataset.holeIndex);
      if (index === 0 || index === 1) void useAbility({ ability: 'swap', holeCardIndex: index });
      break;
    }
    case 'new':
      if (state.table?.packet.kind !== 'game-result' && replaceDialog) {
        replaceDialog.returnValue = 'cancel';
        replaceDialog.showModal();
        return;
      }
      choosingTable = true; message(''); draw(); break;
    case 'continue':
      if (state.table) void mutate('/api/continue', { tableId: state.table.id, expectedPacketIndex: state.table.packet.packetIndex });
      break;
    case 'act': {
      const type = button.dataset.intent;
      if (type === 'fold' || type === 'check' || type === 'call' || type === 'allIn') void act({ type });
      break;
    }
  }
});
app.addEventListener('submit', (event) => {
  if (!(event.target instanceof HTMLFormElement) || event.target.id !== 'raise-form') return;
  event.preventDefault();
  const value = Number(new FormData(event.target).get('amount'));
  if (Number.isSafeInteger(value)) void act({ type: 'raiseTo', amount: value });
});
document.querySelector('#sync')!.addEventListener('click', () => {
  if (playing) { clock.skip(); sound?.stop(); return; }
  if (busy) return;
  lock(true);
  void synchronize().then(() => { choosingTable = false; message('已同步当前牌桌。'); })
    .catch((error: Error) => message(error.message)).finally(() => { lock(false); draw(); });
});

void synchronize().then(draw).catch((error: Error) => { app.textContent = '牌桌暂时无法载入。请确认本地服务仍在运行，再点击“同步牌桌”。'; message(error.message); });
