import { CHARACTERS, type CharacterId } from '../agents/characters.js';
import { isAiDifficulty, type AiDifficulty } from '../agents/difficulty.js';
import { DEFAULT_TOURNAMENT_CONFIG } from '../game/default-config.js';
import { continueAfterHandResult, getCurrentPacket, openGameSession, submitSessionCommand } from '../game/game-session.js';
import { createCharacterParticipant, selectNpcRoster } from '../game/roster.js';
import type { GameSessionHandle, SessionCommand, SessionMode } from '../game/session-types.js';
import type { SeatIdentity, WebTable, TableExperience, SaveStatus } from './protocol.js';
import type { TableSetup, JournalEntry } from './checkpoints.js';
import { advanceTableView } from './view.js';
import { LivingParticipant } from '../agents/table-memory.js';
import { LivingTable } from '../game/living-table.js';
import { tablePerson } from '../game/table-personas.js';
import { newTutorial, tutorialView, tutorialAllows, answerTutorial, tutorialCoach, type TutorialState } from '../game/tutorial.js';


const STYLES: Record<CharacterId, string> = {
  rock: '挑牌入局 · 不爱冒险', hunter: '挑准位置 · 出手有压迫感', maniac: '爱凑热闹 · 敢下重注',
  'calling-station': '舍不得弃牌 · 爱跟到底', 'small-ball': '小注试探 · 一点点争取',
  trapper: '不急着加注 · 擅长慢打', 'value-bettor': '少打花招 · 下注讲分量',
};

export function rosterFor(players: number): SeatIdentity[] {
  return [{ seatIndex: 0, playerId: '你', name: '你', nickname: '玩家', style: '由你决定', characterId: 'hero' },
    ...selectNpcRoster(players).map((id, index) => {
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
}

export async function openLocalTable(players: number, mode: SessionMode, experience: TableExperience, lesson = 0, socialEnabled = false,
  runSeed = experience === 'tutorial' ? `night-school-v1-lesson-${lesson}` : crypto.randomUUID(), difficulty: AiDifficulty = 'standard'): Promise<LocalSession> {
  if (!isAiDifficulty(difficulty)) throw new Error('Invalid AI difficulty');
  if (experience === 'tutorial') difficulty = 'standard'; // The coach is scripted, not ranked.
  const tutorial = experience === 'tutorial' ? newTutorial(lesson) : null;
  const roster = tutorial ? [rosterFor(2)[0]!, { seatIndex: 1, playerId: '莫叔（教学）', name: '莫叔',
    nickname: '教学陪练', style: '按课程配合 · 不代表正式 NPC 强度', characterId: 'calling-station' }] : rosterFor(players);
  const living = !tutorial && (experience === 'living' || socialEnabled) ? new LivingTable({ story: experience === 'living',
    people: roster.filter((person) => person.seatIndex !== 0).map((person) => ({ seatIndex: person.seatIndex, characterId: person.characterId as CharacterId })) }) : null;
  const participants = tutorial ? [null, tutorialCoach(lesson, roster[1]!.playerId)]
    : [null, ...selectNpcRoster(players).map((id, index) => living
      ? new LivingParticipant(id, living.memory, () => living.mood(index + 1), { difficulty }) : createCharacterParticipant(id, { difficulty }))];
  const step = await openGameSession({ mode, config: { ...DEFAULT_TOURNAMENT_CONFIG, maxSeats: players,
    ...(tutorial ? { initialButtonSeat: 0 } : {}) },
    seats: roster.map(({ playerId, seatIndex }) => ({ playerId, seatIndex })), participants,
    humanSeatIndex: 0, runSeed, invalidAgentActionMode: 'fallback' });
  living?.ingest(step.packet.packetIndex, step.packet.viewerEventsSinceLastPacket);
  const table: WebTable = { id: crypto.randomUUID(), mode, experience, difficulty, roster, packet: step.packet,
    view: advanceTableView(null, step.packet, roster), living: living?.view() ?? null,
    tutorial: tutorial ? tutorialView(tutorial, step.packet) : null, recentHands: [] };
  const session: LocalSession = { handle: step.handle, table, living, tutorial, touched: Date.now(), busy: false,
    setup: { players, mode, experience, lesson, socialEnabled, runSeed, difficulty }, journal: [] };
  refreshPresentation(session);
  return session;
}

export function refreshPresentation(session: LocalSession): void {
  session.table = { ...session.table, living: session.living?.view() ?? null,
    tutorial: session.tutorial ? tutorialView(session.tutorial, session.table.packet) : null };
  const packet = session.table.packet;
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

export function advanceSession(session: LocalSession): void {
  const packet = getCurrentPacket(session.handle);
  session.table = { ...session.table, packet, view: advanceTableView(session.table.view, packet, session.table.roster) };
  session.living?.ingest(packet.packetIndex, packet.viewerEventsSinceLastPacket);
  if (session.tutorial) session.tutorial.revision++;
  refreshPresentation(session);
}
