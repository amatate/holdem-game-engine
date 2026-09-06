import type { Bootstrap, WebTable } from './protocol.js';
import { renderLobby, renderTable, renderPlaybackFrame } from './render.js';
import { buildPlaybackFrames, PlaybackClock, type PlaybackFrame } from './playback.js';
import { installTableReadTool, type TableToolContext } from './agent-tools.js';
import type { ActionIntent } from '../core/legal-actions.js';

const app = document.querySelector<HTMLElement>('#app')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
let state: Bootstrap = { rosters: {}, table: null };
let count = 4;
let busy = false;
let choosingTable = false;
const clock = new PlaybackClock();
const speedControl = document.querySelector<HTMLSelectElement>('#playback-speed');
const skipControl = document.querySelector<HTMLButtonElement>('#playback-skip');
const speedKey = 'holdem.playback-speed';
let playing = false;
let frame: PlaybackFrame | null = null;
let frameIndex = 0;
let frameCount = 0;
let animations: Animation[] = [];
try { clock.setSpeed(Number(localStorage.getItem(speedKey))); } catch { /* Storage may be unavailable. */ }
if (speedControl) speedControl.value = String(clock.speed);
const toolLifecycle = installTableReadTool(
  (document as Document & { modelContext?: TableToolContext }).modelContext,
  () => choosingTable || playing ? null : state.table,
);
window.addEventListener('pagehide', () => { toolLifecycle.abort(); clock.skip(); clearAnimations(); }, { once: true });

function draw(): void {
  app.innerHTML = frame && state.table ? renderPlaybackFrame(frame, state.table.roster, frameIndex, frameCount)
    : state.table && !choosingTable ? renderTable(state.table) : renderLobby(state.rosters, count);
  lock(busy);
}
function lock(value: boolean): void {
  busy = value;
  app.setAttribute('aria-busy', String(value));
  for (const element of app.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select')) {
    element.disabled = value;
  }
  connection.textContent = playing ? '正在播放牌局…' : value ? '正在处理牌局…' : '本地牌桌';
  if (skipControl) skipControl.disabled = !playing;
}
function message(text: string): void { notice.textContent = text; notice.hidden = text.length === 0; }

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
  const frames = buildPlaybackFrames(sameTable ? previous.view : null, next.packet.viewerEventsSinceLastPacket, next.roster);
  if (!frames.length) return;
  playing = true; clock.start(); frameCount = frames.length;
  try {
    for (const [index, current] of frames.entries()) {
      if (clock.skipped) break;
      clearAnimations(); frame = current; frameIndex = index + 1; draw(); animateFrame(current);
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
skipControl?.addEventListener('click', () => { clock.skip(); clearAnimations(); });

async function synchronize(): Promise<void> {
  const response = await fetch('/api/bootstrap');
  if (!response.ok) throw new Error('无法连接本地牌桌，请确认服务仍在运行。');
  state = await response.json() as Bootstrap;
}

async function mutate(path: string, body: unknown): Promise<void> {
  if (busy) return;
  lock(true); message('');
  const previous = state.table;
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json() as { table?: WebTable; error?: string };
    if (result.table) { state.table = result.table; choosingTable = false; }
    if (!response.ok) {
      if (response.status === 401) { state.table = null; choosingTable = false; }
      message(result.error ?? '操作未完成，请同步牌桌后重试。');
    } else if (result.table) {
      await play(previous, result.table);
    }
  } catch {
    // Never automatically replay a wager after an uncertain network result.
    try { await synchronize(); choosingTable = false; message('连接曾中断，已同步实际牌局；没有重复提交操作。'); }
    catch { message('连接中断。恢复服务后点击右上角“同步牌桌”，不要重复下注。'); }
  } finally { lock(false); draw(); }
}

async function act(intent: ActionIntent): Promise<void> {
  const table = state.table;
  if (!table || table.packet.kind !== 'decision' || choosingTable) return;
  await mutate('/api/action', { tableId: table.id, command: { type: 'act',
    decisionKey: table.packet.decisionKey, expectedPacketIndex: table.packet.packetIndex, intent } });
}

app.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.id === 'players') { count = Number(target.value); draw(); }
});
app.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
  if (!button || busy) return;
  switch (button.dataset.action) {
    case 'start': void mutate('/api/table', { players: count }); break;
    case 'new':
      if (state.table?.packet.kind !== 'game-result' && !window.confirm('离开当前牌桌并重新选人数？点击“入座发牌”后，旧牌局将结束。')) return;
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
  if (playing) { clock.skip(); return; }
  if (busy) return;
  lock(true);
  void synchronize().then(() => { choosingTable = false; message('已同步当前牌桌。'); })
    .catch((error: Error) => message(error.message)).finally(() => { lock(false); draw(); });
});

void synchronize().then(draw).catch((error: Error) => { app.textContent = '牌桌暂时无法载入。请确认本地服务仍在运行，再点击“同步牌桌”。'; message(error.message); });
