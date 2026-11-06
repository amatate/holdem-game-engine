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
import { animateChipTransfers, CHIP_MAX_SPEED, type ChipMotionPlayback } from './chip-motion.js';
import { renderMobileHome, renderMobileTable } from './mobile-render.js';
import { newMobileUi, normalizeMobileUi, mobileRaise, validMobileRaise, type MobileSheet } from './mobile-model.js';
import { bilingual } from './first-night-render.js';
import { escapeHtml } from './render.js';

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
let nightAbility: 'peek' | 'read' | 'swap' | null = null;
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
let playbackChapter: WebTable | null = null;
let frameIndex = 0;
let frameCount = 0;
let animations: Animation[] = [];
let chipMotion: ChipMotionPlayback | null = null;
// Keep only presentation preferences; never copy cards or commands between renders.
let displayedTableId: string | null = null;
let displayedDecisionKey: string | null = null;
const expandedPanels = new Map<string, boolean>();
const mobileUi = newMobileUi();
const mobileMedia = window.matchMedia?.('(max-width: 760px)');
const requestedUi = window.location?.href ? new URL(window.location.href).searchParams.get('ui') : null;
const isMobile = () => requestedUi === 'mobile' || requestedUi !== 'desktop' && mobileMedia?.matches === true;
let renderedSheet: MobileSheet = null;
let mobileOpener = '';
const mobileSettings = document.querySelector<HTMLDialogElement>('#mobile-settings');
const settingsItems = ['.language-control', '#sync', '.playback-toolbar'].map(selector => {
  const element = document.querySelector<HTMLElement>(selector);
  return element ? { element, parent: element.parentNode!, next: element.nextSibling } : null;
}).filter(item => item !== null);
let settingsMounted = false;
function mountMobileSettings(enabled: boolean): void {
  if (enabled === settingsMounted || !mobileSettings) return;
  const target = mobileSettings.querySelector('#mobile-settings-content')!;
  for (const item of settingsItems) {
    if (enabled) target.append(item.element);
    else item.parent.insertBefore(item.element, item.next?.parentNode === item.parent ? item.next : null);
  }
  if (!enabled) mobileSettings.close();
  settingsMounted = enabled;
}
mobileMedia?.addEventListener?.('change', () => { clearAnimations(); draw(); });
document.querySelector('#mobile-settings-close')?.addEventListener('click', () => mobileSettings?.close());
document.querySelector('#mobile-go-home')?.addEventListener('click', () => {
  if(playing){clock.skip();clearAnimations();}
  mobileSettings?.close(); sound?.stop(); mobileUi.sheet=null; choosingTable=true; message(''); draw();
});
try { clock.setSpeed(Number(localStorage.getItem(speedKey))); } catch { /* Storage may be unavailable. */ }
if (speedControl) speedControl.value = String(clock.speed);
const toolLifecycle = installTableReadTool(
  (document as Document & { modelContext?: TableToolContext }).modelContext,
  () => choosingTable || playing
    || state.table?.firstNight && state.table.firstNight.phase !== 'playing'
    || (state.table?.campaign ? state.table.campaign.phase!=='playing' : state.table?.secondNight && state.table.secondNight.phase !== 'playing') ? null : state.table,
);
window.addEventListener('pagehide', () => { toolLifecycle.abort(); clock.skip(); clearAnimations(); }, { once: true });

function draw(): void {
  characterInfo?.close();
  const visibleTable = state.table && !choosingTable ? state.table : null;
  const mobile = isMobile();
  document.body.classList.toggle('mobile-ui', mobile);
  mountMobileSettings(mobile);
  normalizeMobileUi(mobileUi, visibleTable);
  const setup = { count, mode, difficulty, social: socialEnabled, nightAbility };
  const focusId = document.activeElement?.id && app.contains(document.activeElement) ? document.activeElement.id : '';
  // Public experience identity only; never the hand, AI intent, or future events.
  deckSkins?.setSceneDeck(visibleTable?.experience === 'tutorial' ? 'lantern' : visibleTable?.experience === 'living' ? 'blue-hour' : visibleTable?.experience === 'competitive' ? 'ghost' : 'night');
  const nextTableId = visibleTable?.id ?? null;
  const sameTable = displayedTableId === nextTableId;
  if (!sameTable) expandedPanels.clear();
  displayedTableId = nextTableId;
  const nextDecisionKey = !frame && visibleTable?.packet.kind === 'decision' ? visibleTable.packet.decisionKey : null;
  const oldRaise = app.querySelector<HTMLInputElement>('#raise-amount');
  const raiseDraft = sameTable && nextDecisionKey && nextDecisionKey === displayedDecisionKey ? oldRaise?.value : undefined;
  const restoreRaiseFocus = !!oldRaise && document.activeElement === oldRaise;
  app.innerHTML = mobile ? frame && state.table ? renderMobileTable(playbackChapter??state.table,state,setup,mobileUi,{frame,step:frameIndex,total:frameCount,muted:talkMuted})
    : visibleTable ? renderMobileTable(visibleTable,state,setup,mobileUi,{muted:talkMuted}) : renderMobileHome(state,setup,mobileUi)
    : frame && state.table ? renderPlaybackFrame(frame, state.table.roster, frameIndex, frameCount, state.table.mode, state.table.experience, playbackChapter)
    : state.table && !choosingTable ? renderTable(state.table, talkMuted)
      : `${state.table ? '<button class="text-button resume-table" data-action="resume">← 返回尚未关闭的牌桌</button>' : ''}${renderLobby(state.rosters, count, mode, socialEnabled, state.save, !!state.table, difficulty, state.chapterSave, nightAbility, state.journeySave)}`;
  document.body.classList.toggle('at-table', !!visibleTable);
  if (mobile && mobileUi.sheet && !frame) {
    const sheet = app.querySelector<HTMLElement>('.mobile-sheet');
    if (renderedSheet !== mobileUi.sheet) sheet?.querySelector<HTMLButtonElement>('.mobile-sheet-close')?.focus({preventScroll:true});
    else if (focusId) app.querySelector<HTMLElement>(`#${focusId}`)?.focus({preventScroll:true});
    else if (!sheet?.contains(document.activeElement)) sheet?.querySelector<HTMLButtonElement>('.mobile-sheet-close')?.focus({preventScroll:true});
  }
  renderedSheet = mobile ? mobileUi.sheet : null;
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
    : visibleTable?.experience === 'competitive' ? '竞技练习 · 实验版 v0' : `${visibleTable?.campaign ? `第 ${visibleTable.campaign.night} 夜 · ` : visibleTable?.secondNight ? '第二夜 · ' : visibleTable?.firstNight ? '第一夜 · ' : state.table && !choosingTable && state.table.living ? state.table.experience === 'living' ? '剧情序章 · ' : '人物互动 · ' : ''}${visibleMode === 'ability-lab' ? '能力实验' : '经典德州'}`;
  if (label && visibleTable?.experience !== 'tutorial' && visibleTable?.experience !== 'competitive' && visibleTable) {
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
    element.disabled = (value && !element.matches?.('[data-character-info],[data-live-ui]')) || element.dataset?.unavailable === 'true';
  }
  connection.textContent = playing ? '正在播放牌局…' : value ? '正在处理牌局…' : browserTable ? '浏览器单机' : '本地牌桌';
  if (skipControl) skipControl.disabled = !playing;
  localization.refresh();
}
function message(text: string): void { notice.textContent = text; notice.hidden = text.length === 0; localization.refresh(); }

function clearAnimations(): void {
  chipMotion?.cancel(); chipMotion = null;
  animations.forEach((animation) => animation.cancel());
  animations = [];
}

function animateFrame(current: PlaybackFrame): void {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  chipMotion = animateChipTransfers(app, current.reactionOnly ? [] : current.chipTransfers ?? [], clock.speed, reduced);
  if (reduced) return;
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
}

async function play(previous: WebTable | null, next: WebTable): Promise<void> {
  if(next.campaign){if(next.campaign.phase!=='playing'&&previous?.campaign?.phase!=='playing')return;}
  else if (next.firstNight?.phase === 'intro' || next.secondNight&&next.secondNight.phase!=='playing'&&previous?.secondNight?.phase!=='playing') return;
  const prior = previous?.firstNight?.phase === 'intro' && next.firstNight?.phase === 'playing' ? null : previous;
  // A missing/noncontiguous predecessor cannot safely be reconstructed: sync directly.
  const sameTable = prior?.id === next.id;
  if (sameTable && (next.packet.packetIndex !== prior.packet.packetIndex + 1
    || next.packet.coreEventRange.fromVersionInclusive !== prior.packet.coreEventRange.toVersionExclusive)) return;
  if (!sameTable && !next.packet.viewerEventsSinceLastPacket.some((event) => event.type === 'gameStarted')) return;
  const frames = buildPlaybackFrames(sameTable ? prior.view : null, next.packet.viewerEventsSinceLastPacket, next.roster,
    next.living ? { packetIndex: next.packet.packetIndex,
      lines: next.living.lines.filter((line) => !talkMuted || line.kind === 'observation'), memories: next.living.memories ?? [] } : undefined);
  if (!frames.length) return;
  playbackChapter = next.campaign ? sameTable&&prior?.campaign?.phase==='playing'?prior:next : next.secondNight ? sameTable&&prior?.secondNight?.phase==='playing'?prior:next : next.firstNight ? sameTable && prior?.firstNight?.phase === 'playing' ? prior : next : null;
  playing = true; clock.start(); frameCount = frames.length;
  try {
    for (const [index, current] of frames.entries()) {
      if (clock.skipped) break;
      clearAnimations(); frame = current; frameIndex = index + 1; draw(); animateFrame(current);
      sound?.play(frameSound(current));
      await clock.wait(current.holdMs, current.chipTransfers?.length
        && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? CHIP_MAX_SPEED : Infinity);
    }
  } finally {
    clearAnimations(); frame = null; playing = false; playbackChapter = null;
  }
}

speedControl?.addEventListener('change', () => {
  clock.setSpeed(Number(speedControl.value));
  animations.forEach((animation) => { animation.playbackRate = clock.speed; });
  chipMotion?.setSpeed(clock.speed);
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
  const reopenAbilities=isMobile()&&path==='/api/action'&&(body as {command?:{type?:string}})?.command?.type==='useAbility';
  const reopenLesson=isMobile()&&path==='/api/lesson'&&(body as {operation?:string})?.operation==='answer';
  mobileUi.sheet = null;
  lock(true); message('');
  const previous = state.table;
  let cue: SoundCue | null = null;
  try {
    const response = await requestTable(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json() as { table?: WebTable; error?: string; save?: SaveStatus };
    if (result.save) state.save = result.save;
    if (result.table?.save) {
      if (result.table.secondNight) state.journeySave = result.table.save;
      else if (result.table.firstNight) state.chapterSave = result.table.save;
      else state.save = result.table.save;
    }
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
  } finally {
    if(reopenAbilities&&state.table?.packet.kind==='decision')mobileUi.sheet='abilities';
    if(reopenLesson&&state.table?.tutorial)mobileUi.sheet='notes';
    lock(false); draw(); sound?.play(cue);
    if (!isMobile() && state.table?.firstNight?.phase !== previous?.firstNight?.phase) document.querySelector('#first-night-story')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }
}

async function submitStory(operation: import('../game/story-campaign.js').StoryInput['operation'],choice?:string):Promise<void>{
  const table=state.table;if(!table||choosingTable)return;
  const revision=operation==='start'?table.secondNight?.revision:table.campaign?.revision;
  if(revision===undefined)return;
  await mutate('/api/story',{tableId:table.id,expectedPacketIndex:table.packet.packetIndex,input:{operation,revision,...(choice?{choice}:{})}});
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
  if (target instanceof HTMLSelectElement && (target.id === 'ai-difficulty' || target.id === 'night-difficulty') && isAiDifficulty(target.value)) {
    difficulty = target.value;
    try { localStorage.setItem('holdem.ai-difficulty', difficulty); } catch { /* Optional preference. */ }
    draw();
  }
  if (target instanceof HTMLSelectElement && target.id === 'players') { count = Number(target.value); draw(); }
  if (target instanceof HTMLSelectElement && target.id === 'night-route') {
    nightAbility = target.value === 'peek' || target.value === 'read' || target.value === 'swap' ? target.value : null;
    draw();
  }
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
  if (!button) return;
  if (button.dataset.action === 'mobile-settings') { mobileSettings?.showModal(); return; }
  if (button.dataset.action === 'mobile-skip') { clock.skip(); clearAnimations(); sound?.stop(); return; }
  if (busy) return;
  switch (button.dataset.action) {
    case 'mobile-setup': openMobileSheet('setup',button); break;
    case 'mobile-night-setup': openMobileSheet('night-setup',button); break;
    case 'mobile-raise': if (state.table && mobileRaise(state.table)) openMobileSheet('raise',button); break;
    case 'mobile-all-in': openMobileSheet('all-in',button); break;
    case 'mobile-all-in-confirm':
      if (state.table?.packet.kind === 'decision' && mobileUi.decision === state.table.packet.decisionKey
        && state.table.packet.actionPanel.commands.some(c=>c.kind==='fixed'&&c.intent.type==='allIn')) void act({type:'allIn'});
      break;
    case 'mobile-abilities': openMobileSheet('abilities',button); break;
    case 'mobile-journey': openMobileSheet('journey',button); break;
    case 'mobile-notes': case 'mobile-lesson': openMobileSheet('notes',button); break;
    case 'mobile-receipt': openMobileSheet('receipt',button); break;
    case 'mobile-profile': mobileUi.seat=Number(button.dataset.seatIndex); openMobileSheet('profile',button); break;
    case 'mobile-close': closeMobileSheet(); break;
    case 'mobile-scene-next': mobileUi.line++; draw(); break;
    case 'mobile-to-scene':
      if(state.table?.packet.kind==='hand-result'){mobileUi.reviewedResult=`${state.table.id}:${state.table.packet.packetIndex}`;draw();}
      break;
    case 'mobile-preset': setMobileAmount(Number(button.dataset.amount)); break;
    case 'mobile-step': setMobileAmount((mobileUi.amount??0)+Number(button.dataset.step)); break;
    case 'mobile-exact': mobileUi.exactAmount=!mobileUi.exactAmount; draw(); app.querySelector<HTMLInputElement>('#mobile-raise-number')?.focus(); break;
    case 'mobile-raise-submit': {
      const table=state.table, value=table ? validMobileRaise(table,mobileUi) : null;
      if (table && value!==null) void act(mobileRaise(table)?.allIn && value===mobileRaise(table)?.maximum ? {type:'allIn'} : {type:'raiseTo',amount:value});
      break;
    }
    case 'story-start': void submitStory('start'); break;
    case 'story-next': void submitStory('next'); break;
    case 'story-choice': void submitStory('choose',button.dataset.choice); break;
    case 'story-retry-cancel': {
      const panel=button.closest('details');
      if(panel){panel.open=false;panel.querySelector('summary')?.focus();}
      break;
    }
    case 'story-leave': void submitStory('leave-table'); break;
    case 'journey-start':
      if(state.table?.secondNight){choosingTable=false;draw();}
      else if(state.journeySave?.saved&&!state.journeySave.error)void mutate('/api/resume',{checkpointId:state.journeySave.saved.id,slot:'journey',replace:!!state.table});
      else void mutate('/api/table',{experience:'second-night',mode:'classic',difficulty});
      break;
    case 'volume-start':
    case 'journey-new':
      if(state.journeySave?.saved&&!window.confirm(document.documentElement.lang.startsWith('en')?'Start a new Volume One? This replaces the story-journey save. Free play and legacy First Night are kept.':'重新开始第一卷将替换故事行程存档。自由牌桌与旧第一夜存档保留。继续吗？'))break;
      void mutate('/api/table',{experience:'second-night',mode:'classic',difficulty,storyEdition:2}); break;
    case 'journey-restore':
      if(state.table?.secondNight){choosingTable=false;draw();break;}
      if(state.journeySave?.saved)void mutate('/api/resume',{checkpointId:state.journeySave.saved.id,slot:'journey',replace:!!state.table});
      break;
    case 'journey-choice':
      if(state.table?.packet.kind==='hand-result')mobileUi.reviewedResult=`${state.table.id}:${state.table.packet.packetIndex}`;
      if(state.table?.secondNight)void mutate('/api/second-night',{tableId:state.table.id,expectedPacketIndex:state.table.packet.packetIndex,revision:state.table.secondNight.revision,choice:button.dataset.choice});
      break;
    case 'night-start': void mutate('/api/table', { experience: 'first-night', mode: nightAbility ? 'ability-lab' : 'classic', nightAbility, difficulty }); break;
    case 'night-restore':
      if (state.chapterSave?.saved) void mutate('/api/resume', { checkpointId: state.chapterSave.saved.id, slot: 'chapter', replace: !!state.table });
      break;
    case 'night-choice':
      if(state.table?.packet.kind==='hand-result')mobileUi.reviewedResult=`${state.table.id}:${state.table.packet.packetIndex}`;
      if (state.table?.firstNight) void mutate('/api/first-night', { tableId: state.table.id, expectedPacketIndex: state.table.packet.packetIndex,
        revision: state.table.firstNight.revision, choice: button.dataset.choice });
      break;
    case 'start': void mutate('/api/table', { players: count, mode, socialEnabled, difficulty }); break;
    case 'competitive-start': void mutate('/api/table', { players: 2, mode: 'classic', experience: 'competitive' }); break;
    case 'tutorial-start': void mutate('/api/table', { players: 2, mode: 'classic', experience: 'tutorial' }); break;
    case 'living-start': void mutate('/api/table', { players: 4, mode, experience: 'living', difficulty }); break;
    case 'practice-start': void mutate('/api/table', { players: 4, mode: 'classic', experience: 'free', socialEnabled, difficulty }); break;
    case 'home': sound?.stop(); choosingTable = true; message(''); draw(); break;
    case 'resume': choosingTable = false; message(''); draw(); break;
    case 'restore':
      if (state.save?.saved) void mutate('/api/resume', { checkpointId: state.save.saved.id, ...(isMobile() ? {replace:!!state.table} : {}) });
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
function openMobileSheet(sheet: MobileSheet, opener: HTMLButtonElement): void {
  mobileOpener=opener.dataset.action??''; mobileUi.sheet=sheet; draw();
}
function closeMobileSheet(): void {
  mobileUi.sheet=null; draw();
  app.querySelector<HTMLElement>(`[data-action="${mobileOpener}"]`)?.focus({preventScroll:true});
}
function setMobileAmount(value: number): void {
  const range=state.table ? mobileRaise(state.table) : null;
  if (!range || !Number.isFinite(value)) return;
  mobileUi.amount=Math.max(range.minimum,Math.min(range.maximum,Math.round(value)));
  const total=app.querySelector<HTMLOutputElement>('[data-raise-total]');if(total)total.textContent=String(mobileUi.amount);
  for (const input of app.querySelectorAll<HTMLInputElement>('#mobile-raise-amount,#mobile-raise-number')) input.value=String(mobileUi.amount);
  for (const preset of app.querySelectorAll<HTMLButtonElement>('[data-action="mobile-preset"]')) preset.setAttribute('aria-pressed',String(Number(preset.dataset.amount)===mobileUi.amount));
  const confirm=app.querySelector<HTMLButtonElement>('[data-action="mobile-raise-submit"]');
  if(confirm){const full=range.allIn&&mobileUi.amount===range.maximum;confirm.innerHTML=bilingual(`确认${full?'全下':'加注'} ${mobileUi.amount}`,`Confirm ${full?'all-in':'raise'} ${mobileUi.amount}`,escapeHtml);localization.refresh();}
}
app.addEventListener('input', event=>{
  const target=event.target;
  if(target instanceof HTMLInputElement && (target.id==='mobile-raise-amount'||target.id==='mobile-raise-number')) setMobileAmount(Number(target.value));
});
document.addEventListener?.('keydown',event=>{
  if(!isMobile()||!mobileUi.sheet||playing)return;
  if(event.key==='Escape'){event.preventDefault();closeMobileSheet();return;}
  if(event.key!=='Tab')return;
  const nodes=[...app.querySelectorAll<HTMLElement>('.mobile-sheet button:not(:disabled),.mobile-sheet input:not(:disabled),.mobile-sheet select:not(:disabled),.mobile-sheet a[href],.mobile-sheet [tabindex="0"]')];
  const first=nodes[0],last=nodes.at(-1);
  if(event.shiftKey&&(document.activeElement===first||!app.querySelector('.mobile-sheet')?.contains(document.activeElement))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&(document.activeElement===last||!app.querySelector('.mobile-sheet')?.contains(document.activeElement))){event.preventDefault();first?.focus();}
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
