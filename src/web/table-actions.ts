import { continueAfterHandResult, submitSessionCommand } from '../game/game-session.js';
import type { SessionCommand } from '../game/session-types.js';
import { chooseFirstNight, NIGHT_COST, NIGHT_TABLES } from '../game/first-night.js';
import { chooseSecondNight, settleSecondNight } from '../game/second-night.js';
import { startStory, advanceStory, settleStoryTable, type StoryInput } from '../game/story-campaign.js';
import { TableMemory } from '../agents/table-memory.js';
import type { CharacterId } from '../agents/characters.js';
import { openLocalTable, advanceSession, finishNightTable, refreshPresentation, type LocalSession } from './table-session.js';

/** The same gates run in Node, the browser worker and checkpoint replay. */
export async function tableCommand(session: LocalSession, command: SessionCommand) {
  if(session.campaign?session.campaign.phase!=='playing':session.secondNight&&session.secondNight.phase!=='playing')return {accepted:false,rejection:'chapter-paused'} as const;
  const night = session.firstNight;
  if (night) {
    if (night.phase !== 'playing') return { accepted: false, rejection: 'chapter-paused' } as const;
    if (command?.type === 'useAbility' && (command.ability !== night.ability || night.energy < NIGHT_COST[command.ability])) {
      return { accepted: false, rejection: 'chapter-ability-unavailable' } as const;
    }
  }
  const result = await submitSessionCommand(session.handle, command);
  if (result.accepted) {
    if(session.campaign)session.campaign.atTableStart=false;
    else if (session.secondNight) session.secondNight.atTableStart = false;
    if (night) {
      night.atTableStart = false;
      if (command.type === 'useAbility') night.energy -= NIGHT_COST[command.ability];
    }
    advanceSession(session);
  }
  return result;
}
export async function tableContinue(session: LocalSession, packetIndex: number) {
  if(session.campaign?session.campaign.phase!=='playing':session.secondNight&&session.secondNight.phase!=='playing')return {accepted:false,rejection:'chapter-paused'} as const;
  if (session.firstNight && session.firstNight.phase !== 'playing') return { accepted: false, rejection: 'chapter-paused' } as const;
  const result = await continueAfterHandResult(session.handle, packetIndex);
  if (result.accepted) {
    if (session.firstNight) session.firstNight.atTableStart = false;
    if(session.campaign)session.campaign.atTableStart=false;
    else if (session.secondNight) session.secondNight.atTableStart = false;
    advanceSession(session);
  }
  return result;
}
export async function chapterChoice(session: LocalSession, choice: string, revision: number): Promise<boolean> {
  if (!session.firstNight || revision !== session.firstNight.revision) return false;
  if (choice === 'leave-table') {
    if (!finishNightTable(session, 'left')) return false;
  } else {
    // Opening the next engine may fail. Commit the conversation only after it succeeds.
    const night = structuredClone(session.firstNight), oldStage = night.stage;
    const effect = chooseFirstNight(night, choice, revision);
    if (!effect) return false;
    if (effect === 'next-table') {
      night.atTableStart = true;
      const setup = session.setup, journal = session.journal, save = session.table.save;
      const memories = new Map<CharacterId, TableMemory>();
      const newIds = ['hero', ...NIGHT_TABLES[night.stage]!.npcs];
      const seatMap = new Map(session.table.roster.filter(person => newIds.includes(person.characterId)).map(person => [person.seatIndex, newIds.indexOf(person.characterId)]));
      night.previousObservations = [];
      for (const id of NIGHT_TABLES[night.stage]!.npcs) {
        const source = session.nightMemories?.get(id);
        if (!source) continue; // An absent NPC cannot inherit another character's observations.
        const memory = new TableMemory(); memory.carryFrom(source, seatMap); memories.set(id, memory);
        const evidence = memory.evidence(0, 1);
        night.previousObservations.push({ characterId: id, hands: evidence.hands, raises: evidence.raises, calls: evidence.calls, folds: evidence.folds, fromStage: oldStage });
      }
      const next = await openLocalTable(2, setup.mode, 'first-night', 0, true, setup.runSeed, setup.difficulty, setup.nightAbility, night, memories);
      Object.assign(session, next, { setup, journal, busy: session.busy });
      if (save) session.table.save = save;
    } else session.firstNight = night;
  }
  refreshPresentation(session);
  return true;
}

export async function secondNightChoice(session: LocalSession, choice: string, revision: number): Promise<boolean> {
  if (session.campaign || !session.secondNight || revision !== session.secondNight.revision) return false;
  const nextState = structuredClone(session.secondNight);
  if (choice === 'leave-table') {
    const packet = session.table.packet;
    if (packet.kind !== 'hand-result' || !settleSecondNight(nextState,
      packet.handResult.seats.find(s => s.seatIndex === 0)!.finalStack, packet.handNumber, 'left')) return false;
    session.secondNight = nextState;
  } else {
    const effect = chooseSecondNight(nextState, choice, revision);
    if (!effect) return false;
    if (effect === 'open-table') {
      const { setup, journal, busy } = session, save = session.table.save;
      const next = await openLocalTable(2, 'classic', 'second-night', 0, true, setup.runSeed, setup.difficulty,
        null, undefined, undefined, nextState);
      Object.assign(session, next, { setup, journal, busy });
      if (save) session.table.save = save;
    } else session.secondNight = nextState;
  }
  refreshPresentation(session);
  return true;
}

export async function storyCommand(session: LocalSession, input: StoryInput): Promise<boolean> {
  if(!input||!Number.isSafeInteger(input.revision))return false;
  if(input.operation==='start'){
    if(session.campaign||!session.secondNight||session.secondNight.phase!=='complete'||input.revision!==session.secondNight.revision)return false;
    session.campaign=startStory(session.secondNight);refreshPresentation(session);return true;
  }
  if(!session.campaign)return false;
  const nextState=structuredClone(session.campaign);
  if(input.operation==='leave-table'){
    const p=session.table.packet;
    if(input.revision!==nextState.revision||p.kind!=='hand-result'
      ||!settleStoryTable(nextState,p.handResult.seats.find(s=>s.seatIndex===0)!.finalStack,p.handNumber,'left'))return false;
    session.campaign=nextState;
  }else{
    const effect=advanceStory(nextState,input);
    if(!effect)return false;
    if(effect==='open-table'){
      const {setup,journal,busy}=session,save=session.table.save;
      const next=await openLocalTable(2,'classic','second-night',0,true,setup.runSeed,setup.difficulty,
        null,undefined,undefined,session.secondNight!,nextState,session.setup.storyEdition);
      Object.assign(session,next,{setup,journal,busy});if(save)session.table.save=save;
    }else session.campaign=nextState;
  }
  refreshPresentation(session);return true;
}
