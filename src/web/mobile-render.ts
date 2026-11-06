import type { Bootstrap, WebTable, SeatIdentity } from './protocol.js';
import type { PlaybackFrame } from './playback.js';
import type { SessionMode } from '../game/session-types.js';
import type { AiDifficulty } from '../agents/difficulty.js';
import type { NightAbility } from '../game/first-night.js';
import { escapeHtml as h, renderSeat, portrait, settlement, renderAbilityPanel, renderRecaps, CATEGORIES, type PresentationTable } from './render.js';
import { renderGuide, renderObservations, renderStory } from './experience-render.js';
import { renderNight, bilingual } from './first-night-render.js';
import { renderCampaignScene, renderStoryJournal } from './story-render.js';
import { renderJourney, renderJourneyEntrance, renderJourneyLedger, renderBuyIn } from './second-night-render.js';
import { renderChipPile } from './chips.js';
import { cardFace } from './poker-cards.js';
import { STREET_NAMES } from './view.js';
import { mobileRaise, type MobileUiState } from './mobile-model.js';

const b = (zh: string, en: string) => bilingual(zh, en, h);
const amount = (n: number) => n.toLocaleString('zh-CN');
const signed = (n: number) => `${n > 0 ? '+' : ''}${amount(n)}`;
export interface MobileSetup {
  count: number; mode: SessionMode; difficulty: AiDifficulty; social: boolean; nightAbility: NightAbility | null;
}
const option = (id: string, zh: string, en: string, selected: boolean) => `<option value="${id}" data-no-i18n data-zh="${h(zh)}" data-en="${h(en)}"${selected ? ' selected' : ''}>${h(zh)}</option>`;
function strength(value: AiDifficulty, id: string): string {
  return `<label>${b('对手强度', 'Opponent strength')}<select id="${id}">${option('casual','休闲','Casual',value==='casual')}${option('standard','标准','Standard',value==='standard')}${option('challenging','挑战','Challenging',value==='challenging')}</select></label>`;
}
function menu(): string {
  return `<button class="mobile-menu" data-action="mobile-settings" data-live-ui aria-label="${h('设置')}" title="${h('设置')}"><span aria-hidden="true">⋯</span></button>`;
}
export function renderMobileHome(state: Bootstrap, setup: MobileSetup, ui: MobileUiState): string {
  const night = state.table?.firstNight, saved = state.chapterSave?.saved;
  const resume = night && night.phase !== 'complete' ? 'resume' : saved && !saved.ended ? 'night-restore' : 'mobile-night-setup';
  const free = state.save?.saved;
  const campaign=state.table?.campaign, journey=state.journeySave?.saved;
  const continuing=!!campaign||!!journey;
  const mainTitle=continuing?b(campaign?`第 ${campaign.night} 夜` : journey?.storyNight?`第 ${journey.storyNight} 夜`:'夜局故事',campaign?`Night ${campaign.night}`:journey?.storyNight?`Night ${journey.storyNight}`:'Night Table story'):b('第一卷 · 留个位置','Volume One · A Seat Kept');
  const mainText=continuing?b(campaign?.task??'金额和之前的选择都留着，接着往下走。',campaign?.taskEn??'Your money and earlier choices are kept. Continue the story.'):b('阿凯说楼上有桌。你到了，他还没来。两卷十二夜，输赢都能继续。','Kai said there was a game upstairs. You’re here. He isn’t. Two volumes, twelve nights; the story continues after a loss.');
  const mainAction=continuing?(state.table?.secondNight?'resume':'journey-restore'):(night&&night.phase!=='complete'||saved&&!saved.ended?resume:'volume-start');
  return `<section class="mobile-home mobile-screen"><div class="mobile-home-room" aria-hidden="true"></div><header class="mobile-home-heading"><div class="mobile-logo"><h1>夜局</h1><p>— HOLD’EM —</p><span aria-hidden="true">♠</span></div>${menu()}</header><div class="mobile-home-chapter"><span class="mobile-chapter-rule"></span><h2>${mainTitle}</h2><p>${mainText}</p></div><div class="mobile-home-actions"><p class="mobile-home-save">${continuing ? b('行程检查点已保留','Your story checkpoint is saved') : night && night.phase !== 'complete' ? b('这一晚，还没结束。','The night isn’t over yet.') : saved && !saved.ended ? b('第一夜的检查点已保留','Your First Night checkpoint is saved') : b('二楼，门开着。','Upstairs. The door is open.')}</p><button class="mobile-primary mobile-enter" data-action="${mainAction}">${continuing?b(campaign?.phase==='complete'||journey?.storyNight&&journey.ended?'继续 / 回看故事':'继续故事',campaign?.phase==='complete'||journey?.storyNight&&journey.ended?'Continue / Revisit story':'Continue story'):b(mainAction==='volume-start'?'走进第一卷':'继续第一夜',mainAction==='volume-start'?'Enter Volume One':'Continue First Night')} <span aria-hidden="true">›</span></button>${continuing?`<div class="story-home-links"><button class="text-button" data-action="mobile-night-setup">${b('旧版第一夜入口','Legacy First Night entry')}</button><button class="text-button" data-action="journey-new">${b('新行程 · 金额重置','New journey · Reset wallet')}</button></div>`:renderJourneyEntrance(state.journeySave,h)}<div class="mobile-home-secondary"><button data-action="mobile-setup">${b('自由牌桌','Free play')}</button><button data-action="tutorial-start">${b('新手教学','Learn to play')}</button></div><div class="mobile-home-links">${state.table && !night ? `<button class="text-button" data-action="resume">${b('返回当前牌桌','Return to current table')}</button>` : ''}${free ? `<button class="text-button" data-action="restore">${b('继续自由牌桌存档','Resume free-play save')}</button>` : ''}${saved ? `<button class="text-button" data-action="mobile-night-setup">${b('重新开始第一夜','Start First Night again')}</button>` : ''}</div></div>${renderMobileSheet(null,state,setup,ui)}</section>`;
}

function tableTitle(table: WebTable): string {
  return table.campaign ? b(`第 ${table.campaign.night} 夜`,`Night ${table.campaign.night}`) : table.secondNight ? b('第二夜','Second Night') : table.firstNight ? b('第一夜','First Night') : table.tutorial ? b('莫叔的桌边课','Mo’s lessons')
    : table.experience === 'competitive' ? b('竞技练习','Competitive practice') : table.experience === 'living' ? b('留一张椅子','A Seat for You') : b('自由牌桌','Free play');
}
function hud(table: WebTable, frame?: PlaybackFrame): string {
  const view = frame?.view ?? table.view;
  return `<header class="mobile-hud"><div><strong>${tableTitle(table)} <span>· ${table.roster.length} ${b('人桌','players')}</span></strong><p>${b(`第 ${view.handNumber} 手`,`Hand ${view.handNumber}`)} · ${STREET_NAMES[view.street]} <span class="mobile-blinds">${b('盲注','Blinds')} ${view.smallBlind}/${view.bigBlind}</span></p></div>${menu()}</header>`;
}

export function renderMobileTable(table: WebTable, state: Bootstrap, setup: MobileSetup, ui: MobileUiState,
  options: { frame?: PlaybackFrame; step?: number; total?: number; muted?: boolean } = {}): string {
  const { frame } = options;
  const story = table.campaign ?? table.secondNight ?? table.firstNight;
  const review=!frame&&story&&table.packet.kind==='hand-result'&&['waiting','duel-offer','leaving','settled'].includes(story.phase)&&ui.reviewedResult!==`${table.id}:${table.packet.packetIndex}`;
  if(!frame&&table.campaign&&table.campaign.phase!=='playing'&&!review)return renderCampaignScene(table,h,true,renderMobileSheet(table,state,setup,ui));
  if (!frame && story && story.phase !== 'playing' && !review) return renderMobileScene(table,state,setup,ui);
  const present: PresentationTable = frame ? { ...table, packet: null, view: frame.view, living: null } : table;
  const view = present.view, settled = !frame && table.packet.kind !== 'decision';
  const pot = !frame && table.packet.kind === 'hand-result' ? table.packet.handResult.pots.reduce((sum,p)=>sum+p.amount,0) : view.potTotal;
  const chips = settled ? 0 : Math.max(0, view.potTotal - view.seats.reduce((sum,s)=>sum+s.committedStreet,0));
  const line = frame ? frame.line : options.muted ? table.living?.lines.filter(l=>l.kind==='observation').at(-1) : table.living?.lines.at(-1);
  const hero = view.seats.find(s=>s.seatIndex===0)!;
  const info = frame ? b(`正在播放 ${options.step} / ${options.total}`,`Playing ${options.step} / ${options.total}`)
    : table.tutorial ? h(table.tutorial.hint) : line ? `<strong>${h(line.speaker)}</strong> ${h(line.text)}` : table.firstNight?.atTableStart
      ? table.firstNight.lastLines.map(l=>`${l.who ? h(l.who)+' · ' : ''}${b(l.text,l.en)}`).join(' ') : b('轮到你时，牌桌会停下来。','The table pauses on your turn.');
  const available = table.mode === 'ability-lab';
  const energy = table.firstNight?.ability ? `${table.firstNight.energy}/3` : '';
  return `<section class="mobile-screen mobile-play" data-experience="${table.experience ?? 'free'}" data-location="${table.campaign?.location ?? table.secondNight?.location ?? 'old'}">${hud(table,frame)}<section class="arena mobile-arena" data-count="${table.roster.length}" aria-label="${h('德州牌桌')}"><div class="mobile-room" aria-hidden="true"></div><div class="felt" aria-hidden="true"></div><div class="table-center"><div class="pot-display"><span class="pot-chip-bank" data-chip-total="${chips}">${renderChipPile(chips)}</span><span>${settled ? b('已结算底池','Settled pot') : b('底池','Pot')}</span><strong>${amount(pot)}</strong></div><div class="board" aria-label="公共牌">${Array.from({length:5},(_,i)=>view.board[i] ? cardFace(view.board[i]!) : '<span class="card-slot" aria-label="尚未发出的公共牌">+</span>').join('')}</div></div>${table.roster.map(person=>renderSeat(present,person,frame,true)).join('')}</section><div class="mobile-table-caption" aria-live="polite">${info}</div><div class="mobile-utilities">${available ? `<button data-action="mobile-abilities">${b('暗手','Your edge')} ${energy ? `<strong>${energy}</strong>` : ''}</button>` : `${table.campaign||table.secondNight ? `<button data-action="mobile-journey">${b('手头','Wallet')} ${table.campaign?.wallet??table.secondNight!.wallet}</button>` : `<span>${b('经典德州','Classic Hold’em')}</span>`}`}<button data-action="${table.tutorial ? 'mobile-lesson' : 'mobile-notes'}">${table.tutorial ? b('教学提示','Coach') : b('桌边记忆','Table notebook')}</button>${frame ? `<button data-action="mobile-skip" data-live-ui>${b('跳过 ›','Skip ›')}</button>` : ''}</div><div class="mobile-action-dock">${frame ? `<p class="mobile-watching">${b('筹码正在移动…','The hand is playing…')}</p>` : mobileDock(table,ui)}</div>${!frame ? renderMobileSheet(table,state,setup,ui) : ''}<span class="mobile-sr-only">${hero.stack} 筹码</span></section>`;
}

function mobileDock(table: WebTable, ui: MobileUiState): string {
  const packet = table.packet;
  if (packet.kind === 'hand-result') {
    const hero = packet.handResult.seats.find(s=>s.seatIndex===0)!;
    const chapter=table.campaign??table.secondNight??table.firstNight;
    const chapterEnd=chapter&&chapter.phase!=='playing';
    const next=chapterEnd?'mobile-to-scene':table.tutorial?'mobile-lesson':table.living?.ended?'mobile-notes':'continue';
    const winnerSeats=[...new Set(packet.handResult.pots.flatMap(p=>p.winnerSeatIndexes))];
    const winner=winnerSeats.map(seat=>table.roster.find(p=>p.seatIndex===seat)!.name).join('、');
    const category=winnerSeats.length===1?packet.handResult.seats.find(s=>s.seatIndex===winnerSeats[0])?.category:null;
    return `<div class="mobile-result-mini"><button class="mobile-result-open" data-action="mobile-receipt"><small>${b('本手净结果','Net this hand')}</small><strong>${signed(hero.net)}</strong><span>${h(winner)} · ${category?h(CATEGORIES[category]):b('赢得底池','wins the pot')} ›</span></button><button class="mobile-primary" data-action="${next}">${chapterEnd?b('继续故事 ›','Continue story ›'):table.tutorial?b('课后问题','Lesson question'):table.living?.ended?b('离桌对话','Before you leave'):b('下一手 ›','Next hand ›')}</button></div>${(table.campaign?.phase==='playing'||table.firstNight?.phase==='playing'||!table.campaign&&table.secondNight?.phase==='playing')?`<button class="mobile-leave-hand" data-action="${table.campaign?'story-leave':table.secondNight?'journey-choice':'night-choice'}" data-choice="leave-table">${b('结完这手，先走了','Leave after this hand')}</button>`:''}`;
  }
  if (packet.kind === 'game-result') {
    const winner = table.roster.find(s=>s.seatIndex===packet.winnerSeatIndex)!;
    return `<div class="mobile-game-end"><strong>${h(winner.name)} ${b('赢得本场','wins the game')}</strong><button class="mobile-primary" data-action="home">${b('回到主页','Back home')}</button></div>`;
  }
  const commands = packet.actionPanel.commands;
  const fixed = commands.filter(c=>c.kind==='fixed');
  const fold = fixed.find(c=>c.intent.type==='fold');
  const main = fixed.find(c=>c.intent.type==='check') ?? fixed.find(c=>c.intent.type==='call');
  const allin = fixed.find(c=>c.intent.type==='allIn');
  const range = mobileRaise(table);
  return `<div class="mobile-action-context"><span>${b('轮到你了','Your turn')}</span><small>${packet.actionPanel.facingBet ? `${b('待跟','To call')} ${amount(packet.observation.legalActions.call?.pay ?? 0)}` : b('可以过牌','You can check')}</small></div><div class="mobile-main-actions">${fold ? `<button class="mobile-fold" data-action="act" data-intent="fold">${h(fold.label)}</button>` : ''}${main ? `<button class="mobile-primary" data-action="act" data-intent="${main.intent.type}">${h(main.label)}</button>` : ''}${range ? `<button class="mobile-raise" data-action="mobile-raise">${b('加注','Raise')}</button>` : allin && main?.intent.type !== 'call' ? `<button class="mobile-raise" data-action="mobile-all-in">${h(allin.label)}</button>` : ''}</div>`;
}

const SCENE_ART = { hunter:'hunter-v1', maniac:'maniac-v1', 'calling-station':'calling-station-v1' };
function renderMobileScene(table: WebTable,state: Bootstrap,setup:MobileSetup,ui:MobileUiState): string {
  const night=table.secondNight??table.firstNight!;
  const complete=night.phase==='complete', lines=night.lines, index=Math.min(ui.line,Math.max(0,lines.length-1));
  const current=lines[index], last=index>=lines.length-1;
  const who=current?.who ?? '';
  const id=who.includes('林岚') ? 'hunter' : who.includes('阿凯') ? 'maniac' : who.includes('莫叔') ? 'calling-station' : who.includes('韩烈') ? 'value-bettor' : who.includes('苏蔓') ? 'trapper' : who.includes('程墨') ? 'small-ball' : null;
  const art = id && id in SCENE_ART ? `${SCENE_ART[id as keyof typeof SCENE_ART]}.png` : `${id}-v2.png`;
  return `<section data-location="${table.secondNight?.location??'old'}" class="mobile-screen mobile-story ${night.phase==='invitation'||complete ? 'mobile-message-scene' : ''}"><div class="mobile-story-room" aria-hidden="true"></div><header class="mobile-hud"><div><strong>${table.secondNight?b('第二夜','Second Night'):b('第一夜','First Night')}</strong><p>${b(night.title,night.titleEn)}</p></div>${menu()}</header>${complete ? `<div class="mobile-story-ending">${table.secondNight?renderJourney(table,h):renderNight(table,h)}${!table.secondNight||table.secondNight.result?`<button class="mobile-secondary" data-action="mobile-receipt">${b('回看最后一手结算','Review the last hand')}</button>`:''}</div>` : `<div class="mobile-scene-stage">${id ? `<div class="mobile-scene-portrait" aria-hidden="true"><img src="./art/${art}" alt="" draggable="false"></div>` : `<p class="mobile-scene-time">${b(night.title,night.titleEn)}</p>`}</div><div class="mobile-dialogue-box">${table.secondNight?`<p class="journey-scene-wallet">${b('手头','Wallet')} <strong>${table.secondNight.wallet}</strong><button class="text-button" data-action="mobile-journey">${b('今晚的事 · 明细','Tonight · Ledger')} ›</button></p>`:''}<div class="mobile-dialogue-heading"><strong>${who ? h(who) : b('牌室','The room')}</strong><small>${index+1} / ${Math.max(1,lines.length)}</small></div><p>${current ? b(current.text,current.en) : b('这一桌结完了。','The table is settled.')}</p>${last&&table.secondNight?renderBuyIn(table,h):''}${!last ? `<button class="mobile-dialogue-next" data-action="mobile-scene-next">${b('继续 ›','Continue ›')}</button>` : `<div class="mobile-scene-choices">${night.choices.map(c=>`<button class="mobile-secondary" data-action="${table.secondNight?'journey-choice':'night-choice'}" data-choice="${h(c.id)}">${b(c.text,c.en)}${table.firstNight?.ability&&(c.id==='rest'||c.id==='wait') ? `<small>${b('精力 +1，上限 3','Energy +1, max 3')}</small>` : ''}</button>`).join('')}${night.phase==='intro' ? `<button class="text-button" data-action="tutorial-start">${b('先跟莫叔学三手','Learn the basics with Mo first')}</button>` : ''}</div>`}</div>`}${renderMobileSheet(table,state,setup,ui)}</section>`;
}

export function renderMobileSheet(table:WebTable|null,state:Bootstrap,setup:MobileSetup,ui:MobileUiState):string {
  if(!ui.sheet)return '';
  let title='', content='';
  if(ui.sheet==='setup') {
    title=b('自由开一桌','Set up a table');
    content=`<div class="mobile-setup-fields"><label>${b('牌桌人数','Players')}<select id="players">${[2,3,4,5,6].map(n=>option(String(n),`${n} 人桌`,`${n} players`,setup.count===n)).join('')}</select></label><label>${b('今晚的玩法','Game mode')}<select id="game-mode">${option('classic','经典德州','Classic Hold’em',setup.mode==='classic')}${option('ability-lab','能力实验','Ability Lab',setup.mode==='ability-lab')}</select></label>${strength(setup.difficulty,'ai-difficulty')}<label class="mobile-check"><input type="checkbox" id="social-enabled"${setup.social?' checked':''}>${b('人物记忆与闲聊','NPC memory & conversation')}</label></div><div class="mobile-roster-preview">${(state.rosters[setup.count]??[]).filter(p=>p.seatIndex!==0).map(p=>`<span>${h(p.name)}</span>`).join('')}</div><p class="mobile-sheet-note">${b('系统安排对手 · 每人 100 · 初始盲注 1/2','Opponents assigned · 100 each · Starting blinds 1/2')}</p><button class="mobile-primary" data-action="start">${b('入座发牌','Sit down & deal')}</button>${state.save?.error ? `<p role="status">${h(state.save.error)}</p>` : ''}<div class="mobile-extra-modes"><button class="text-button" data-action="competitive-start">${b('竞技练习','Competitive practice')}</button><button class="text-button" data-action="living-start">${b('旧版六手片段','Original six-hand vignette')}</button></div>`;
  } else if(ui.sheet==='night-setup') {
    title=b('今晚的你','Your way to play');
    content=`<p>${b('普通牌手，或者带一点自己的办法。','Play it straight, or bring an edge of your own.')}</p><div class="mobile-setup-fields"><label>${b('选择路线','Choose your route')}<select id="night-route">${option('classic','普通牌手','An ordinary player',!setup.nightAbility)}${option('peek','偷看一张 · 2 精力','Peek · 2 energy',setup.nightAbility==='peek')}${option('read','粗略读牌 · 1 精力','Read · 1 energy',setup.nightAbility==='read')}${option('swap','更换底牌 · 2 精力','Swap · 2 energy',setup.nightAbility==='swap')}</select></label>${strength(setup.difficulty,'night-difficulty')}</div><p class="mobile-sheet-note">${setup.nightAbility ? b('初始精力 3 · 只带这一种 · 每桌最多一次','Start with 3 energy · One ability · Once per table') : b('按标准德州规则打牌。','Play by standard Hold’em rules.')}</p><p class="mobile-sheet-note">${b('章节单独存档。每桌重新买入 100，保留真实盈亏。','Separate chapter save. Fresh 100 each table; real results are recorded.')}</p><button class="mobile-primary" data-action="night-start">${b('上二楼 ›','Go upstairs ›')}</button>${state.chapterSave?.error ? `<p role="status">${h(state.chapterSave.error)}</p>` : ''}`;
  } else if(table) {
    if(ui.sheet==='raise') {
      const range=mobileRaise(table); if(!range)return '';
      const value=Math.max(range.minimum,Math.min(range.maximum,ui.amount??range.minimum));
      const full=range.allIn&&value===range.maximum;
      title=b('加注到','Raise to');
      content=`<output class="mobile-raise-total" data-raise-total>${value}</output><p class="mobile-range-note">${b('范围','Range')} ${range.minimum}–${range.maximum}</p><div class="mobile-slider-row"><button data-action="mobile-step" data-step="-1" aria-label="减少下注">−</button><input id="mobile-raise-amount" type="range" min="${range.minimum}" max="${range.maximum}" step="1" value="${value}" aria-label="加注到"><button data-action="mobile-step" data-step="1" aria-label="增加下注">+</button></div><div class="mobile-bet-presets">${range.choices.map(c=>`<button data-action="mobile-preset" data-amount="${c.amount}" aria-pressed="${c.amount===value}">${b(c.label,c.en)}<strong>${c.amount}</strong></button>`).join('')}</div><button class="mobile-primary" data-action="mobile-raise-submit">${b(`确认${full?'全下':'加注'} ${value}`,`Confirm ${full?'all-in':'raise'} ${value}`)}</button><p class="mobile-sheet-note">${b('本轮总投入，不是额外投入','Total bet this round, not extra chips')}</p><button class="text-button" data-action="mobile-exact">${b('精确输入金额','Enter an exact amount')}</button>${ui.exactAmount ? `<label class="mobile-exact-field">${b('加注到','Raise to')}<input id="mobile-raise-number" type="number" inputmode="numeric" min="${range.minimum}" max="${range.maximum}" step="1" value="${value}"></label>` : ''}`;
    } else if(ui.sheet==='all-in') {
      title=b('确认全下','Confirm all-in');
      const hero=table.view.seats.find(s=>s.seatIndex===0)!;
      content=`<p>${b(`投入剩余 ${hero.stack} 筹码。`,`Commit your remaining ${hero.stack} chips.`)}</p><button class="mobile-primary" data-action="mobile-all-in-confirm">${b('确认全下','Confirm all-in')}</button>`;
    } else if(ui.sheet==='abilities') {
      title=b('你的暗手','Your edge');content=renderAbilityPanel(table);
    } else if(ui.sheet==='journey') {
      title=b('行程与记录','Journal');content=table.campaign?renderStoryJournal(table,h):renderJourneyLedger(table,h);
    } else if(ui.sheet==='notes') {
      title=table.tutorial ? b('莫叔的桌边课','Mo’s lessons') : b('桌边记忆','Table notebook');
      content=table.tutorial ? renderGuide(table,h) : `${renderRecaps(table)}${renderObservations(table,h)}${table.firstNight ? renderNight(table,h) : renderStory(table,h)}<details><summary>${b('本手行动记录','This hand’s actions')}</summary><ol class="mobile-action-log">${table.view.log.map(l=>`<li>${h(l)}</li>`).join('')}</ol></details>`;
    } else if(ui.sheet==='profile') {
      const person=table.roster.find(p=>p.seatIndex===ui.seat);if(!person)return '';
      const note=table.living?.notes.find(p=>p.seatIndex===person.seatIndex);
      title=h(person.name);
      content=`<div class="mobile-profile-hero">${portrait(person,'neutral')}<div><strong>${h(person.nickname)}</strong><p>${h(person.style)}</p></div></div><p>${h(person.about??'教学陪练，按课程配合。')}</p>${note ? `<section class="mobile-public-memory"><h3>${b('公开印象','Public impression')}</h3><p>${h(note.fact)}</p><small>${h(note.inference)}</small></section>` : ''}${table.firstNight?.previousObservations.filter(m=>m.characterId===person.characterId).map(m=>`<p class="mobile-sheet-note">${b(`上一桌看过你 ${m.hands} 手：加注 ${m.raises}、跟注 ${m.calls}、弃牌 ${m.folds}。`,`Saw ${m.hands} hands at the previous table: ${m.raises} raises, ${m.calls} calls, ${m.folds} folds.`)}</p>`).join('')??''}<p class="mobile-sheet-note">${b('只记公开动作，不显示对手底牌或胜率。','Public actions only. No hidden cards or equity information.')}</p>`;
    } else if(ui.sheet==='receipt') {
      title=b('本手结算','Hand result');content=settlement(table);
      if(!content)content=`<p>${b('这一手还没有结算。','This hand has not settled yet.')}</p>`;
    }
  }
  if(!content)return '';
  return `<div class="mobile-sheet-backdrop"><button class="mobile-sheet-scrim" data-action="mobile-close" aria-label="关闭面板"></button><section class="mobile-sheet mobile-sheet-${ui.sheet}" role="dialog" aria-modal="true" aria-labelledby="mobile-sheet-title" tabindex="-1"><div class="mobile-sheet-handle" aria-hidden="true"></div><header><h2 id="mobile-sheet-title">${title}</h2><button class="mobile-sheet-close" data-action="mobile-close" aria-label="关闭面板">×</button></header><div class="mobile-sheet-content">${content}</div></section></div>`;
}
