import type { CharacterId } from '../agents/characters.js';

export type NightAbility = 'peek' | 'read' | 'swap';
export type NightPhase = 'intro' | 'playing' | 'waiting' | 'arrival' | 'duel-offer' | 'leaving' | 'invitation' | 'complete';
export const NIGHT_TABLES: readonly { name: string; en: string; hands: number; npcs: CharacterId[] }[] = [
  { name: '先打两手', en: 'While we wait', hands: 4, npcs: ['calling-station'] },
  { name: '人到齐了', en: 'Everyone is here', hands: 6, npcs: ['hunter', 'maniac', 'calling-station'] },
  { name: '再坐一会儿', en: 'One more table', hands: 6, npcs: ['hunter'] },
];
export const NIGHT_COST = { peek: 2, read: 1, swap: 2 } as const;
export interface NightScore { stage: number; hands: number; net: number; stack: number; reason: 'limit' | 'bust' | 'table-ended' | 'left' }
export interface NightLine { who: string; text: string; en: string }
export interface NightChoice { id: string; text: string; en: string }
export interface FirstNightState {
  stage: number; phase: NightPhase; revision: number; ability: NightAbility | null; energy: number;
  scores: NightScore[]; rested: boolean; lastLines: NightLine[]; invitation: string | null;
  atTableStart: boolean;
  previousObservations: { characterId: CharacterId; hands: number; raises: number; calls: number; folds: number; fromStage: number }[];
}
export interface FirstNightView extends FirstNightState {
  title: string; titleEn: string; lines: NightLine[]; choices: NightChoice[]; limit: number;
}
const line = (who: string, text: string, en: string): NightLine => ({ who, text, en });
const choice = (id: string, text: string, en: string): NightChoice => ({ id, text, en });
export function isNightAbility(value: unknown): value is NightAbility { return value === 'peek' || value === 'read' || value === 'swap'; }
export function newFirstNight(ability: NightAbility | null): FirstNightState {
  return { stage: 0, phase: 'intro', revision: 0, ability, energy: 3, scores: [], rested: false, lastLines: [], invitation: null, atTableStart: true, previousObservations: [] };
}
export function firstNightView(state: FirstNightState): FirstNightView {
  let title = '第一夜', titleEn = 'First Night', lines: NightLine[] = [], choices: NightChoice[] = [];
  switch (state.phase) {
    case 'intro':
      title = '二楼，门开着'; titleEn = 'Upstairs. The door is open.';
      lines = [line('阿凯 · 消息', '上二楼，门开着。我马上到。', 'Go upstairs. Door’s open. I’ll be there soon.'),
        line('', '屋里只有一个人。他把旁边的椅子往外挪了挪。', 'There’s one man inside. He pulls out the chair beside him.'),
        line('莫叔', '阿凯叫来的？', 'Kai sent you?')];
      choices = [choice('where', '“他人呢？”', '“Where is he?”'), choice('beginner', '“我不太会。”', '“I’m pretty new.”'), choice('sit', '点点头，坐下', 'Nod and sit down')]; break;
    case 'playing':
      title = NIGHT_TABLES[state.stage]!.name; titleEn = NIGHT_TABLES[state.stage]!.en; lines = state.lastLines; break;
    case 'waiting':
      title = '阿凯还没来'; titleEn = 'Still waiting for Kai';
      lines = [line('', '莫叔看了一眼手机，又把屏幕扣了回去。', 'Mo checks his phone, then puts it face down.')];
      choices = [choice('ask', '“他每次都这样？”', '“Is he always this late?”'), choice('wait', '歇一会儿，等阿凯', 'Take a break and wait')]; break;
    case 'arrival':
      title = '人到齐了'; titleEn = 'Everyone is here';
      lines = [...state.lastLines, line('阿凯', '等久了？我那边刚关门。', 'Been waiting long? Just closed up.'),
        line('莫叔', '饭吃了没？', 'Had dinner?'), line('阿凯', '吃了。牌呢？', 'Yeah. Where are the cards?'),
        line('', '林岚跟着进来，把外套搭在椅背上。', 'Lin comes in behind him and hangs her coat on a chair.'),
        line('阿凯', '这我叫来的，刚来。你少加点。', 'My friend. First time here. Go easy on the raises.'), line('林岚', '会打吗？', 'You play?')];
      choices = [choice('normal', '“会，正常打。”', '“Yeah. Play normally.”'), choice('slow', '“会一点，慢点。”', '“A little. Give me a moment.”'), choice('deal', '“先打一手吧。”', '“Let’s deal a hand.”')]; break;
    case 'duel-offer':
      title = '还打吗？'; titleEn = 'Keep playing?';
      lines = [...state.lastLines, line('', '莫叔站起来活动肩膀。阿凯接了个电话，走到门外。', 'Mo gets up to stretch. Kai takes a call outside.'), line('林岚', '还打吗？', 'Keep playing?')];
      choices = [choice('duel', '“来，咱俩打。”', '“Sure. Heads-up?”'), ...(!state.rested ? [choice('rest', '歇一会儿，等阿凯回来', 'Rest a moment. Wait for Kai.')] : []), choice('leave', '“今天先这样。”', '“That’s enough for tonight.”')]; break;
    case 'leaving':
      title = '楼梯口'; titleEn = 'At the stairs';
      lines = [line('阿凯', '这就走了？', 'Leaving already?')];
      choices = [choice('next-time', '“先走，下次你早点到。”', '“Yeah. Be on time next time.”'), choice('bye', '“走了。”', '“See you.”')]; break;
    case 'invitation':
      title = '几天后'; titleEn = 'A few days later';
      lines = [...state.lastLines, line('阿凯 · 消息', '周六有桌，换个地方。一起去？', 'There’s a game Saturday. Different place. Coming?')];
      choices = [choice('who', '“都有谁？”', '“Who’s playing?”'), choice('stakes', '“打多大？”', '“What stakes?”'), choice('decline', '“这次不去了。”', '“I’ll pass this time.”'), choice('later', '晚点再回', 'Reply later')]; break;
    case 'complete':
      title = '第一夜 · 结束'; titleEn = 'First Night · End'; lines = state.lastLines; break;
  }
  return { ...state, scores: state.scores.map(score => ({ ...score })), lastLines: [...state.lastLines], title, titleEn, lines, choices, limit: NIGHT_TABLES[state.stage]!.hands };
}

/** Changes conversation only. The host opens real tables and settles real results. */
export function chooseFirstNight(state: FirstNightState, id: string, revision: number): 'stay' | 'next-table' | false {
  const view = firstNightView(state);
  if (revision !== state.revision || !view.choices.some(c => c.id === id)) return false;
  const old = state.phase;
  if (old === 'intro') {
    state.lastLines = id === 'where' ? [line('莫叔', '还在店里。你先坐。', 'Still at the shop. Have a seat.')]
      : id === 'beginner' ? [line('莫叔', '哪儿不明白就问。先打两手。', 'Ask if anything’s unclear. Let’s play a couple.')]
      : [line('', '莫叔把筹码推到你手边。', 'Mo slides a stack of chips toward you.')];
    state.phase = 'playing';
  } else if (old === 'waiting') {
    state.lastLines = id === 'ask' ? [line('莫叔', '平时比我还早。今天店里有辆车没交。', 'Usually here before me. There’s a car he hasn’t finished today.')]
      : [line('', '你去倒了杯水。楼下传来关卷帘门的声音。', 'You get some water. Downstairs, a shutter rattles closed.')];
    if (id === 'wait') state.energy = Math.min(3, state.energy + 1);
    state.phase = 'arrival';
  } else if (old === 'arrival') {
    state.stage = 1; state.rested = false; state.phase = 'playing';
    state.lastLines = id === 'normal' ? [line('林岚', '行。', 'Okay.')]
      : id === 'slow' ? [line('林岚', '好。轮到你不用急。', 'Sure. Take your time on your turn.')]
      : [line('', '林岚把牌递给莫叔。', 'Lin hands the deck to Mo.')];
  } else if (old === 'duel-offer') {
    if (id === 'rest') {
      state.rested = true; state.energy = Math.min(3, state.energy + 1);
      state.lastLines = [line('', '阿凯回来拿了杯水，又指指电话。林岚把牌拢好，等你开口。', 'Kai comes back for water and gestures at his phone. Lin gathers the cards and waits.')];
    } else if (id === 'duel') {
      state.stage = 2; state.phase = 'playing'; state.lastLines = [line('林岚', '还是一百，打完就收。', 'A hundred each again. Then we call it a night.')];
    } else { state.phase = 'leaving'; state.lastLines = []; }
  } else if (old === 'leaving') {
    state.phase = 'invitation'; state.lastLines = [line('阿凯', '行。我发你消息。', 'Okay. I’ll text you.')];
  } else if (old === 'invitation') {
    state.invitation = id; state.phase = 'complete';
    state.lastLines = id === 'who' ? [line('你', '都有谁？', 'Who’s playing?'), line('阿凯 · 消息', '认识的人。我带你过去。', 'People I know. I’ll take you there.')]
      : id === 'stakes' ? [line('你', '打多大？', 'What stakes?'), line('', '消息发了出去。还没有回复。', 'Message sent. No reply yet.')]
      : id === 'decline' ? [line('你', '这次不去了。', 'I’ll pass this time.'), line('阿凯 · 消息', '行。', 'Okay.')]
      : [line('', '你把手机放回口袋。', 'You put your phone away.')];
  }
  state.revision++;
  return old === 'arrival' || (old === 'duel-offer' && id === 'duel') ? 'next-table' : 'stay';
}
