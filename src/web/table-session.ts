import { CHARACTERS, type CharacterId } from '../agents/characters.js';
import { isAiDifficulty, type AiDifficulty } from '../agents/difficulty.js';
import { DEFAULT_TOURNAMENT_CONFIG } from '../game/default-config.js';
import { continueAfterHandResult, getCurrentPacket, openGameSession, submitSessionCommand } from '../game/game-session.js';
import { createCharacterParticipant, selectNpcRoster } from '../game/roster.js';
import type { GameSessionHandle, SessionCommand, SessionMode } from '../game/session-types.js';
import type { SeatIdentity, WebTable, TableExperience, SaveStatus } from './protocol.js';
import type { TableSetup, JournalEntry } from './checkpoints.js';
import { advanceTableView } from './view.js';
import { LivingParticipant, TableMemory } from '../agents/table-memory.js';
import { LivingTable } from '../game/living-table.js';
import { tablePerson } from '../game/table-personas.js';
import { COMPETITIVE_CONFIG, competitiveParticipant } from '../game/competitive-practice.js';
import { newTutorial, tutorialView, tutorialAllows, answerTutorial, tutorialCoach, type TutorialState } from '../game/tutorial.js';
import { NIGHT_TABLES, newFirstNight, firstNightView, isNightAbility, type FirstNightState, type NightAbility, type NightScore } from '../game/first-night.js';
import { SECOND_TABLES, newSecondNight, secondNightView, settleSecondNight, type SecondNightState } from '../game/second-night.js';
import { startVolume } from '../game/volume-one.js';
import { STORY_TABLES, storyView, settleStoryTable, type StoryState } from '../game/story-campaign.js';


const STYLES: Record<CharacterId, string> = {
  rock: '挑牌入局 · 不爱冒险', hunter: '挑准位置 · 出手有压迫感', maniac: '爱凑热闹 · 敢下重注',
  'calling-station': '舍不得弃牌 · 爱跟到底', 'small-ball': '小注试探 · 一点点争取',
  trapper: '不急着加注 · 擅长慢打', 'value-bettor': '少打花招 · 下注讲分量',
};

export function rosterFor(players: number): SeatIdentity[] {
  return rosterForCharacters(selectNpcRoster(players));
}
function rosterForCharacters(ids: readonly CharacterId[]): SeatIdentity[] {
  return [{ seatIndex: 0, playerId: '你', name: '你', nickname: '玩家', style: '由你决定', characterId: 'hero' },
    ...ids.map((id, index) => {
      const character = CHARACTERS[id];
      return { seatIndex: index + 1, playerId: `${character.displayName}“${character.nickname}”`,
        name: character.displayName, nickname: character.nickname, style: STYLES[id], characterId: id,
        about: tablePerson({ characterId: id, seatIndex: index + 1 }).about };
    })];
}


export interface LocalSession {
  handle: GameSessionHandle; table: WebTable; touched: number; busy: boolean;
  living: LivingTable | null; tutorial: TutorialState | null;
  setup: TableSetup; journal: JournalEntry[];
  firstNight: FirstNightState | null;
  secondNight: SecondNightState | null;
  campaign: StoryState | null;
  nightMemories: Map<CharacterId, TableMemory> | null;
}

export async function openLocalTable(players: number, mode: SessionMode, experience: TableExperience, lesson = 0, socialEnabled = false,
  runSeed = experience === 'tutorial' ? `night-school-v1-lesson-${lesson}` : crypto.randomUUID(), difficulty: AiDifficulty = 'standard',
  nightAbility: NightAbility | null = null, nightState?: FirstNightState, carriedMemories?: Map<CharacterId, TableMemory>, secondState?: SecondNightState, campaign: StoryState | null = null, storyEdition?: 2): Promise<LocalSession> {
  if (!isAiDifficulty(difficulty)) throw new Error('Invalid AI difficulty');
  const firstNight = experience === 'first-night' ? nightState ?? newFirstNight(nightAbility) : null;
  const secondNight = experience === 'second-night' ? secondState ?? newSecondNight() : null;
  if (secondNight) {
    if (mode !== 'classic') throw new Error('第二夜使用经典德州。');
    socialEnabled = true; lesson = 0; players = secondNight.route ? SECOND_TABLES[secondNight.route].npcs.length + 1 : 2;
  }
  if(storyEdition===2)campaign??=startVolume();
  if(campaign && campaign.edition!==2 && (!secondNight || campaign.phase!=='playing'||!campaign.activeTable))throw new Error('Story table unavailable');
  const storyConfig=campaign?.activeTable?STORY_TABLES[campaign.activeTable]!:null;
  if(storyConfig)players=storyConfig.npcs.length+1;
  const secondConfig = !campaign&&secondNight?.route ? SECOND_TABLES[secondNight.route] : null;
  const nightMemories = firstNight ? carriedMemories ?? new Map<CharacterId, TableMemory>() : null;
  if (firstNight) {
    if (mode === 'ability-lab' ? !isNightAbility(nightAbility) : nightAbility !== null) throw new Error('Choose one chapter ability');
    players = NIGHT_TABLES[firstNight.stage]!.npcs.length + 1; socialEnabled = true; lesson = 0;
    for (const id of NIGHT_TABLES[firstNight.stage]!.npcs) if (!nightMemories!.has(id)) nightMemories!.set(id, new TableMemory());
  }
  const competitive = experience === 'competitive';
  if (competitive) {
    if (mode !== 'classic') throw new Error('竞技练习使用经典规则，不启用能力。');
    players = 2;
    difficulty = 'challenging';
    socialEnabled = false;
    lesson = 0;
  }
  if (experience === 'tutorial') difficulty = 'standard'; // The coach is scripted, not ranked.
  const tutorial = experience === 'tutorial' ? newTutorial(lesson) : null;
  const roster = tutorial ? [rosterFor(2)[0]!, { seatIndex: 1, playerId: '莫叔（教学）', name: '莫叔',
    nickname: '教学陪练', style: '按课程配合 · 不代表正式 NPC 强度', characterId: 'calling-station' }]
    : firstNight ? rosterForCharacters(NIGHT_TABLES[firstNight.stage]!.npcs)
      : storyConfig ? rosterForCharacters(storyConfig.npcs) : secondConfig ? rosterForCharacters(secondConfig.npcs) : rosterFor(players);
  if (competitive) roster[1] = { ...roster[1]!, nickname: '竞技基线 v0',
    style: '固定挑战策略 · 无跨手人物记忆',
    about: '采用评测场的 hunter-challenge 策略，每次决策 600 次胜率采样。只看自己的牌与公开行动，不读你的底牌；不是 GTO 求解器。' };
  const living = !tutorial && (experience === 'living' || socialEnabled) ? new LivingTable({ story: experience === 'living', greet: !firstNight && !secondNight,
    people: roster.filter((person) => person.seatIndex !== 0).map((person) => ({ seatIndex: person.seatIndex, characterId: person.characterId as CharacterId })) }) : null;
  const participants = competitive ? [null, competitiveParticipant(roster[1]!.playerId)]
    : tutorial ? [null, tutorialCoach(lesson, roster[1]!.playerId)]
    : [null, ...(firstNight ? NIGHT_TABLES[firstNight.stage]!.npcs : storyConfig?.npcs ?? secondConfig?.npcs ?? selectNpcRoster(players)).map((id, index) => living
      ? new LivingParticipant(id, nightMemories?.get(id) ?? living.memory, () => living.mood(index + 1), { difficulty }) : createCharacterParticipant(id, { difficulty }))];
  const step = await openGameSession({ mode, config: { ...(competitive ? COMPETITIVE_CONFIG : DEFAULT_TOURNAMENT_CONFIG), maxSeats: players,
    ...(tutorial ? { initialButtonSeat: 0 } : {}),
    ...(firstNight ? { handsPerLevel: 999, blindLevels: [{ smallBlind: 1, bigBlind: 2 }] } : {}),
    ...(secondConfig ? { startingStack: secondConfig.buyIn, handsPerLevel: 999,
      blindLevels: [{ smallBlind: secondConfig.smallBlind, bigBlind: secondConfig.bigBlind }] } : {}),
    ...(storyConfig ? {startingStack:storyConfig.buyIn,handsPerLevel:999,blindLevels:[{smallBlind:storyConfig.smallBlind,bigBlind:storyConfig.bigBlind}]}:{}) },
    seats: roster.map(({ playerId, seatIndex }) => ({ playerId, seatIndex })), participants,
    humanSeatIndex: 0, runSeed: firstNight ? `${runSeed}:first-night:${firstNight.stage}`
      : campaign ? `${runSeed}:story:${campaign.activeTable}` : secondNight ? `${runSeed}:second-night:${secondNight.route ?? 'intro'}` : runSeed, invalidAgentActionMode: 'fallback' });
  living?.ingest(step.packet.packetIndex, step.packet.viewerEventsSinceLastPacket);
  const table: WebTable = { id: crypto.randomUUID(), mode, experience, difficulty, roster, packet: step.packet,
    view: advanceTableView(null, step.packet, roster), living: living?.view() ?? null,
    tutorial: tutorial ? tutorialView(tutorial, step.packet) : null, recentHands: [], ...(firstNight ? { firstNight: firstNightView(firstNight) } : {}) };
  const session: LocalSession = { handle: step.handle, table, living, tutorial, touched: Date.now(), busy: false,
    firstNight, secondNight, campaign, nightMemories, setup: { players: firstNight || secondNight ? 2 : players, mode, experience, lesson, socialEnabled, runSeed, difficulty,
      ...(storyEdition===2?{storyEdition}:{}), ...(firstNight ? { nightAbility } : {}) }, journal: [] };
  refreshPresentation(session);
  return session;
}

export function refreshPresentation(session: LocalSession): void {
  if (session.living && session.nightMemories) for (const memory of session.nightMemories.values()) memory.syncPublic(session.living.memory);
  session.table = { ...session.table, living: session.living?.view() ?? null,
    tutorial: session.tutorial ? tutorialView(session.tutorial, session.table.packet) : null };
  const packet = session.table.packet;
  const campaign=session.campaign;
  if(campaign?.phase==='playing'&&campaign.activeTable&&packet.kind==='hand-result'){
    const t=STORY_TABLES[campaign.activeTable]!,closing=packet.handResult.seats.find(s=>s.seatIndex===0)!.finalStack;
    if(closing===0)settleStoryTable(campaign,closing,packet.handNumber,'bust');
    else if(packet.handResult.seats.filter(s=>s.finalStack>0).length<=1)settleStoryTable(campaign,closing,packet.handNumber,'table-ended');
    else if(packet.handNumber>=t.hands)settleStoryTable(campaign,closing,packet.handNumber,'limit');
  }
  if(campaign)session.table.campaign=storyView(campaign);
  const second = session.secondNight;
  if (!campaign && second?.phase === 'playing' && second.route && packet.kind === 'hand-result') {
    const closing = packet.handResult.seats.find(s => s.seatIndex === 0)!.finalStack;
    if (closing === 0) settleSecondNight(second, closing, packet.handNumber, 'bust');
    else if (packet.handResult.seats.filter(s => s.finalStack > 0).length <= 1) settleSecondNight(second, closing, packet.handNumber, 'table-ended');
    else if (packet.handNumber >= SECOND_TABLES[second.route].hands) settleSecondNight(second, closing, packet.handNumber, 'limit');
  }
  if (second) session.table.secondNight = secondNightView(second);
  const night = session.firstNight;
  if (night?.phase === 'playing' && packet.kind === 'hand-result') {
    const hero = packet.handResult.seats.find(seat => seat.seatIndex === 0)!;
    if (hero.finalStack === 0) finishNightTable(session, 'bust');
    else if (packet.handResult.seats.filter(seat => seat.finalStack > 0).length <= 1) finishNightTable(session, 'table-ended');
    else if (packet.handNumber >= NIGHT_TABLES[night.stage]!.hands) finishNightTable(session, 'limit');
  }
  if (night) session.table.firstNight = firstNightView(night);
  if (packet.kind === 'hand-result' && !session.table.recentHands?.some((hand) => hand.hand === packet.handNumber)) {
    const hero = packet.handResult.seats.find((seat) => seat.seatIndex === 0)!;
    const name = (seat: number) => session.table.roster.find((person) => person.seatIndex === seat)!.name;
    const winners = packet.handResult.pots.map((pot) => `${pot.label} ${pot.amount}：${pot.winnerSeatIndexes.map(name).join('、')}${pot.winnerSeatIndexes.length > 1 ? '平分' : '赢得'}`).join('；');
    session.table.recentHands = [...(session.table.recentHands ?? []), { hand: packet.handNumber, net: hero.net,
      stack: hero.finalStack, text: session.table.living?.recap?.text ?? `${winners}。你本手投入 ${hero.invested}，退回 ${hero.returned}。`,
      facts: session.table.living?.memories.filter((memory) => memory.hand === packet.handNumber).slice(-2).map((memory) => memory.fact) ?? [],
    }].slice(-6);
  }
}

export function finishNightTable(session: LocalSession, reason: NightScore['reason']): boolean {
  const night = session.firstNight, packet = session.table.packet;
  if (!night || night.phase !== 'playing' || packet.kind !== 'hand-result' || night.scores.some(s => s.stage === night.stage)) return false;
  const stack = packet.handResult.seats.find(s => s.seatIndex === 0)!.finalStack;
  night.scores.push({ stage: night.stage, hands: packet.handNumber, net: stack - 100, stack, reason });
  night.phase = reason === 'left' ? 'leaving' : night.stage === 0 ? 'waiting' : night.stage === 1 ? 'duel-offer' : 'leaving';
  night.lastLines = []; night.revision++;
  return true;
}

export function canCheckpoint(session: LocalSession): boolean {
  if(session.campaign)return session.table.packet.kind!=='decision'||session.campaign.phase!=='playing'||session.campaign.atTableStart;
  return session.table.packet.kind !== 'decision' || !!session.firstNight && (session.firstNight.phase !== 'playing' || session.firstNight.atTableStart)
    || !!session.secondNight && (session.secondNight.phase !== 'playing' || session.secondNight.atTableStart);
}

export function advanceSession(session: LocalSession): void {
  const packet = getCurrentPacket(session.handle);
  session.table = { ...session.table, packet, view: advanceTableView(session.table.view, packet, session.table.roster) };
  session.living?.ingest(packet.packetIndex, packet.viewerEventsSinceLastPacket);
  if (session.tutorial) session.tutorial.revision++;
  refreshPresentation(session);
}
