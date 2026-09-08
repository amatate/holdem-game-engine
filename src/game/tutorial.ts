import type { ActionIntent } from '../core/legal-actions.js';
import type { Participant } from './participant.js';
import type { TurnPacket } from './turn-packet.js';

export interface TutorialState { lesson: number; revision: number; solved: boolean; feedback: string; complete: boolean }
export interface TutorialView extends TutorialState {
  title: string; objective: string; hint: string; recommended: ActionIntent | null;
  question: string; answers: { id: string; text: string }[]; atResult: boolean;
}
const LESSONS = [
  { title: '看牌、跟注与过牌', objective: '打完一手，认识两张底牌、五张公共牌和四轮下注。',
    question: '桌中央的公共牌，谁可以用于组成牌型？', answers: ['所有仍未弃牌的玩家', '只有最后加注的人', '只有庄家'], correct: '0',
    explanation: '公共牌由所有未弃牌玩家共享；每人用自己的两张底牌和五张公共牌，选出最佳五张。' },
  { title: '加注与止损', objective: '亲手加注一次，再面对反加选择弃牌。放弃一手也是正常决策。',
    question: '本轮已经投入 2，选择“加注到 10”，这次还要投入多少？', answers: ['10', '12', '8'], correct: '2',
    explanation: '再投入 8。加注到 10 指本轮总额为 10，不是再加 10；弃牌后之前投入的筹码留在底池。' },
  { title: '自己打一手', objective: '所有合法按钮都能使用。自己决定，结束后看实际结算。',
    question: '两张底牌加五张公共牌，比牌时最终使用几张？', answers: ['必须使用两张底牌', '最佳五张，底牌可以用零、一或两张', '七张一起算大小'], correct: '1',
    explanation: '选最佳五张。先比牌型，同牌型再比组成牌的点数和踢脚牌；最佳五张完全同值才平分，花色不分大小。' },
];

export function newTutorial(lesson = 0): TutorialState {
  if (!Number.isSafeInteger(lesson) || lesson < 0 || lesson >= LESSONS.length) throw new Error('Invalid tutorial lesson');
  return { lesson, revision: 0, solved: false, feedback: '', complete: false };
}

export function tutorialView(state: TutorialState, packet: Readonly<TurnPacket>): TutorialView {
  const lesson = LESSONS[state.lesson]!;
  let recommended: ActionIntent | null = null;
  let hint = state.lesson === 0 ? '请看下方结算：谁获得底池、组成了哪五张牌。输赢由真实发牌决定。'
    : state.lesson === 1 ? '你只损失本手已投入的筹码，剩余筹码保留。弃牌不是输掉整场。' : '本手结算已列出。注意“赢得底池”包含自己的投入，“净结果”才是本手盈亏。';
  if (packet.kind === 'decision') {
    const observation = packet.observation;
    const legal = observation.legalActions;
    if (state.lesson === 0) {
      recommended = legal.check ? { type: 'check' } : { type: 'call' };
      hint = observation.street === 'preflop'
        ? `底部两张是只有你知道的底牌。你已付小盲，先点“跟注”，再付 ${legal.call?.pay ?? 0}，补齐对手的大盲。盲注是自动投入，不代表强牌。`
        : `${({ flop: '翻牌一次发三张', turn: '转牌再发一张', river: '河牌最后发一张' } as const)[observation.street]}。现在没人下注，可以免费“过牌”；过牌不是弃牌，你仍有资格赢。`;
    } else if (state.lesson === 1) {
      const raised = observation.actionHistory.some((event) => event.type === 'playerActed' && event.seatIndex === 0 && (event.kind === 'raise' || event.kind === 'bet'));
      if (!raised && legal.raiseTo) {
        recommended = { type: 'raiseTo', amount: legal.raiseTo.min };
        hint = `把“加注到”设为 ${legal.raiseTo.min} 并确认。你本轮已投入 ${observation.seats[0]!.committedStreet}，这次再付 ${legal.raiseTo.min - observation.seats[0]!.committedStreet}。这是总额，不是额外再加。`;
      } else {
        recommended = { type: 'fold' };
        hint = `莫叔反加了：继续需要再跟 ${legal.call?.pay ?? 0}。这关练习“弃牌”止损。教学对手按脚本配合，不代表正常牌局遇到反加都该弃牌。`;
      }
    } else {
      hint = legal.call ? `现在跟注需要付 ${legal.call.pay}。可以跟注、加注或弃牌，先想想愿意为这手牌承担多少风险。全下只投入你剩下的筹码，不会借钱。`
        : '现在可以免费过牌，也可以主动下注。暂时不要把一次输赢当成决策对错；看清金额，再按按钮。';
    }
  }
  if (packet.kind === 'hand-result') {
    const hero = packet.handResult.seats.find((seat) => seat.seatIndex === 0)!;
    const categories: Record<string, string> = { 'high-card': '高牌', 'one-pair': '一对', 'two-pair': '两对', 'three-of-a-kind': '三条',
      straight: '顺子', flush: '同花', 'full-house': '葫芦', 'four-of-a-kind': '四条', 'straight-flush': '同花顺' };
    const shown = packet.handResult.seats.filter((seat) => seat.category).map((seat) =>
      `${seat.seatIndex === 0 ? '你' : '莫叔'}：${categories[seat.category!]}`).join('；');
    const winners = [...new Set(packet.handResult.pots.flatMap((pot) => pot.winnerSeatIndexes))]
      .map((seat) => seat === 0 ? '你' : '莫叔').join('、');
    hint += ` ${shown ? `${shown}。` : ''}获得底池：${winners}。你本手获得 ${hero.potWon}，退回 ${hero.returned}，投入 ${hero.invested}，净结果 ${hero.net > 0 ? '+' : ''}${hero.net}。`;
  }
  return { ...state, title: lesson.title, objective: lesson.objective, hint, recommended,
    question: lesson.question, answers: lesson.answers.map((text, index) => ({ id: String(index), text })), atResult: packet.kind !== 'decision' };
}

export function tutorialAllows(state: TutorialState, packet: Readonly<TurnPacket>, intent: unknown): boolean {
  if (state.complete || packet.kind !== 'decision' || !intent || typeof intent !== 'object') return false;
  const recommended = tutorialView(state, packet).recommended;
  const action = intent as ActionIntent;
  return !recommended || (action.type === recommended.type && (recommended.type !== 'raiseTo'
    || (action.type === 'raiseTo' && action.amount === recommended.amount)));
}

export function answerTutorial(state: TutorialState, packet: Readonly<TurnPacket>, answer: string): boolean {
  const lesson = LESSONS[state.lesson]!;
  if (packet.kind === 'decision' || state.solved || !lesson.answers[Number(answer)] || !['0', '1', '2'].includes(answer)) return false;
  state.solved = answer === lesson.correct;
  state.feedback = `${state.solved ? '答对了。' : '再想一想。'}${lesson.explanation}`;
  state.complete = state.solved && state.lesson === 2;
  state.revision++;
  return true;
}

export function tutorialCoach(lesson: number, playerId: string): Participant {
  return { playerId, async decide({ observation }) {
    const legal = observation.legalActions;
    if (lesson === 1 && legal.raiseTo) return { action: { type: 'raiseTo', amount: legal.raiseTo.min } };
    if (lesson === 2 && observation.street === 'flop' && legal.check && legal.raiseTo) {
      return { action: { type: 'raiseTo', amount: legal.raiseTo.min } };
    }
    return { action: legal.check ? { type: 'check' } : legal.call ? { type: 'call' } : { type: 'fold' } };
  } };
}
