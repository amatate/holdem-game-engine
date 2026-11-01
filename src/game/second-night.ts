import type { CharacterId } from '../agents/characters.js';
import type { NightLine, NightChoice } from './first-night.js';

export type SecondPhase = 'message' | 'terms' | 'old-room' | 'buy-in' | 'playing' | 'settled' | 'outside' | 'complete';
export type SecondRoute = 'new' | 'old';
export const SECOND_TABLES: Record<SecondRoute, { buyIn: number; smallBlind: number; bigBlind: number; hands: number; npcs: CharacterId[] }> = {
  new: { buyIn: 300, smallBlind: 2, bigBlind: 5, hands: 8, npcs: ['maniac', 'value-bettor', 'trapper'] },
  old: { buyIn: 100, smallBlind: 1, bigBlind: 2, hands: 6, npcs: ['calling-station', 'small-ball'] },
};
export interface MoneyEntry { id: 'opening' | 'buy-in' | 'cash-out'; delta: number; balance: number; text: string; en: string }
export interface SecondNightState {
  phase: SecondPhase; revision: number; wallet: number; route: SecondRoute | null;
  ledger: MoneyEntry[]; askedWho: boolean; askedMo: boolean; questioned: boolean;
  atTableStart: boolean; lastLines: NightLine[]; facts: NightLine[];
  result: { hands: number; closing: number; net: number; reason: 'limit' | 'bust' | 'table-ended' | 'left' } | null;
}
export interface SecondNightView extends SecondNightState {
  title: string; titleEn: string; lines: NightLine[]; choices: NightChoice[];
  task: string; taskEn: string; goal: string; goalEn: string; location: 'phone' | 'old' | 'new'; limit: number;
}
const line = (who: string, text: string, en: string): NightLine => ({ who, text, en });
const choice = (id: string, text: string, en: string): NightChoice => ({ id, text, en });
export function newSecondNight(): SecondNightState {
  return { phase: 'message', revision: 0, wallet: 600, route: null,
    ledger: [{ id: 'opening', delta: 600, balance: 600, text: '第二夜起始金额', en: 'Second Night opening balance' }],
    askedWho: false, askedMo: false, questioned: false, atTableStart: true, lastLines: [], facts: [], result: null };
}
export function secondNightView(state: SecondNightState): SecondNightView {
  let title = '', titleEn = '', task = '', taskEn = '', lines: NightLine[] = [], choices: NightChoice[] = [];
  const room = state.route === 'new';
  switch (state.phase) {
    case 'message':
      title = '周六，傍晚'; titleEn = 'Saturday evening'; task = '回阿凯的消息'; taskEn = 'Reply to Kai';
      lines = [...state.lastLines, line('阿凯 · 消息', '今晚那桌还给你留着。七点，我在路口等你。', 'There’s still a seat tonight. Seven o’clock. I’ll meet you at the corner.')];
      choices = [...(!state.askedWho ? [choice('who', '“在哪儿？都有谁？”', '“Where? Who’s playing?”')] : []),
        choice('terms', '“先说清楚打多大。”', '“Tell me the stakes first.”'), choice('decline', '“今天不去了。我去莫叔那儿坐坐。”', '“Not tonight. I’ll stop by Mo’s.”')]; break;
    case 'terms':
      title = '先把数目说清'; titleEn = 'Know the numbers'; task = '决定要不要去新牌室'; taskEn = 'Decide whether to visit the new room';
      lines = [line('阿凯 · 消息', '三百入座，小盲二，大盲五。韩烈和苏蔓也在。', 'Three hundred to sit down. Blinds two and five. Han and Su will be there.'),
        line('阿凯 · 消息', '不抽成。这轮最多八手，结完一手随时能走。', 'No rake. Eight hands at most. You can leave after any settled hand.')];
      choices = [choice('visit', '“我先过去看看。”', '“I’ll come take a look.”'), choice('decline', '“这桌先不打了。”', '“I’ll pass on this game.”')]; break;
    case 'old-room':
      title = '还是二楼'; titleEn = 'Back upstairs'; task = '在旧牌室坐坐，或直接回去'; taskEn = 'Stay at the old room, or head home';
      lines = state.lastLines.length ? state.lastLines : [line('', '莫叔拿了个空杯子，放在桌角。程墨正低头拢筹码。', 'Mo puts an empty cup at the corner of the table. Cheng is gathering his chips.'),
        line('莫叔', '阿凯没跟你一起来？', 'Kai didn’t come with you?')];
      choices = [...(!state.askedMo ? [choice('ask-mo', '“他怎么老催我去那桌？”', '“Why’s he so keen to get me over there?”')] : []),
        choice('old-table', '“在这儿打几手吧。”', '“Let’s play a few hands here.”'), choice('head-home', '“今天歇歇，先回去了。”', '“I’ll take the night off.”')]; break;
    case 'buy-in':
      title = room ? '换个地方' : '熟悉的桌角'; titleEn = room ? 'A different room' : 'A familiar seat';
      task = '确认买入，或转身离开'; taskEn = 'Confirm the buy-in, or walk away';
      lines = room ? [line('', '这里比二楼安静。阿凯替你拉开椅子。', 'It’s quieter here. Kai pulls out a chair for you.'),
        line('韩烈', '三百一份。你想好了再拿。', 'Three hundred each. Take your time deciding.')]
        : [line('莫叔', '一百，老规矩，一和二。最多六手，打完我收桌。', 'A hundred. Same as usual, one and two. Six hands at most, then I’m closing up.')];
      choices = [choice('buy', `买入 ${SECOND_TABLES[state.route!].buyIn}，入座`, `Buy in for ${SECOND_TABLES[state.route!].buyIn}`),
        choice('cancel', '先不买入', 'Keep my money for now')]; break;
    case 'playing':
      title = room ? '另一张桌' : '旧牌室'; titleEn = room ? 'Another table' : 'The old room';
      task = '打完这一桌，或在结算后离桌'; taskEn = 'Play this table, or leave after a settled hand';
      lines = state.lastLines; break;
    case 'settled':
      title = '收回桌上的钱'; titleEn = 'Take your money off the table';
      task = '收好筹码，准备离开'; taskEn = 'Put your money away and get ready to leave';
      lines = [line('', state.result!.net > 0 ? '你把多出来的筹码和本金放在一起。' : state.result!.closing === 0 ? '你面前已经没有筹码了。' : '你数了一遍剩下的筹码。',
        state.result!.net > 0 ? 'You gather the extra chips with your buy-in.' : state.result!.closing === 0 ? 'There are no chips left in front of you.' : 'You count what is left.')];
      choices = [choice('after-table', '收好，准备走了', 'Put it away and get ready to leave')]; break;
    case 'outside':
      title = room ? '门口' : '手机响了'; titleEn = room ? 'At the door' : 'A message arrives';
      task = '问清那句话，或先留着'; taskEn = 'Ask about it, or keep it for later';
      lines = state.lastLines;
      choices = [choice('ask-record', room ? '“你那笔账，跟我来有关系？”' : '“什么叫这次不算？”',
        room ? '“Does that debt have something to do with me coming?”' : '“What do you mean it doesn’t count?”'),
        choice('later', '先不问，把这件事记下', 'Keep it in mind for now')]; break;
    case 'complete':
      title = '第二夜 · 结束'; titleEn = 'Second Night · End'; task = '今晚结束，金额与记录已保留'; taskEn = 'Tonight is over; your money and notes are kept';
      lines = state.lastLines; break;
  }
  return { ...structuredClone(state), title, titleEn, lines, choices, task, taskEn,
    goal: state.facts.some(f => f.who === '账的来路') ? '下次见阿凯，核对这笔账' : '先弄清这是怎样的一桌人',
    goalEn: state.facts.some(f => f.who === '账的来路') ? 'Ask Kai about the debt next time' : 'Get to know the people at this table',
    location: state.phase === 'message' || state.phase === 'terms' ? 'phone' : state.route === 'new' ? 'new' : 'old',
    limit: state.route ? SECOND_TABLES[state.route].hands : 0 };
}
function leaveRoom(state: SecondNightState): void {
  state.phase = 'outside';
  const fact = state.route === 'new'
    ? line('账的来路', '离桌时，你亲耳听到韩烈对阿凯说：“你那笔，明天给你划了。”', 'As you left, you heard Han tell Kai: “I’ll cross off that debt tomorrow.”')
    : line('账的来路', '你没去新牌室。阿凯发来：“韩烈说你没来，这次就不算了。”', 'You did not visit the new room. Kai texted: “Han says you didn’t come, so it doesn’t count this time.”');
  state.facts.push(fact);
  state.lastLines = state.route === 'new' ? [line('韩烈', '你那笔，明天给你划了。', 'I’ll cross off that debt tomorrow.'),
    line('阿凯', '行。回头说。', 'Okay. Talk later.'), line('', '阿凯转过身，发现你还在门口。', 'Kai turns around and sees you still by the door.')]
    : [line('阿凯 · 消息', '韩烈说你没来，这次就不算了。', 'Han says you didn’t come, so it doesn’t count this time.'),
      line('阿凯 · 消息', '没事，你别管。', 'It’s fine. Don’t worry about it.')];
}
/** Returns an intent; the host commits the cloned state only after a real table opens. */
export function chooseSecondNight(state: SecondNightState, id: string, revision: number): 'stay' | 'open-table' | false {
  if (revision !== state.revision || !secondNightView(state).choices.some(c => c.id === id)) return false;
  const phase = state.phase;
  let effect: 'stay' | 'open-table' = 'stay';
  if (phase === 'message' && id === 'who') {
    state.askedWho = true; state.lastLines = [line('阿凯 · 消息', '桥南那间。韩烈攒的桌，我也打。', 'The place south of the bridge. Han arranged it. I’m playing too.')];
  } else if (id === 'terms') state.phase = 'terms';
  else if (id === 'decline' || phase === 'buy-in' && id === 'cancel' && state.route === 'new') {
    state.route = 'old'; state.phase = 'old-room'; state.lastLines = [];
  } else if (phase === 'terms' && id === 'visit') { state.route = 'new'; state.phase = 'buy-in'; }
  else if (phase === 'old-room' && id === 'ask-mo') {
    state.askedMo = true; state.lastLines = [line('莫叔', '那边的事，你问他。我今天没去。', 'Ask him about that room. I haven’t been there today.')];
    state.facts.push(line('莫叔', '他说今天没去新牌室，没有说明阿凯为什么催你。', 'He said he had not been there today. He did not explain why Kai was urging you to go.'));
  } else if (phase === 'old-room' && id === 'old-table') state.phase = 'buy-in';
  else if (phase === 'old-room' && id === 'head-home' || phase === 'buy-in' && id === 'cancel') leaveRoom(state);
  else if (phase === 'buy-in' && id === 'buy') {
    const buy = SECOND_TABLES[state.route!].buyIn;
    if (state.wallet < buy || state.ledger.some(e => e.id === 'buy-in')) return false;
    state.wallet -= buy;
    state.ledger.push({ id: 'buy-in', delta: -buy, balance: state.wallet, text: state.route === 'new' ? '新牌室买入' : '旧牌室买入', en: state.route === 'new' ? 'New room buy-in' : 'Old room buy-in' });
    state.phase = 'playing'; state.atTableStart = true; state.lastLines = []; effect = 'open-table';
  } else if (phase === 'settled') leaveRoom(state);
  else if (phase === 'outside') {
    state.questioned = id === 'ask-record'; state.phase = 'complete';
    state.lastLines = state.questioned ? [
      line('你', state.route === 'new' ? '你那笔账，跟我来有关系？' : '什么叫这次不算？', state.route === 'new' ? 'Does that debt have something to do with me coming?' : 'What do you mean it doesn’t count?'),
      line('阿凯', state.route === 'new' ? '这儿先别说。回头我找你。' : '一两句说不清。见面说。',
        state.route === 'new' ? 'Not here. I’ll find you later.' : 'It’s a long story. Let’s talk in person.'),
      line('你', '行。下次先说这个。', 'Okay. That’s the first thing we talk about.')]
      : [line('', '你没有再问。那句话还留在脑子里。', 'You leave it for now. His words stay with you.')];
  }
  state.revision++;
  return effect;
}
/** A closing stack, never a projected pot, is the only cash-out source. */
export function settleSecondNight(state: SecondNightState, closing: number, hands: number, reason: NonNullable<SecondNightState['result']>['reason']): boolean {
  if (state.phase !== 'playing' || state.result || !state.route || !Number.isSafeInteger(closing) || closing < 0
    || closing > SECOND_TABLES[state.route].buyIn * (SECOND_TABLES[state.route].npcs.length + 1)
    || !Number.isSafeInteger(hands) || hands < 1 || state.ledger.some(e => e.id === 'cash-out')) return false;
  state.wallet += closing;
  state.ledger.push({ id: 'cash-out', delta: closing, balance: state.wallet, text: '离桌回收', en: 'Table cash-out' });
  state.result = { hands, closing, net: closing - SECOND_TABLES[state.route].buyIn, reason };
  state.phase = 'settled'; state.revision++; state.atTableStart = false;
  return true;
}
