import { TableMemory, type ActionEvidence } from '../agents/table-memory.js';
import type { PublicGameEvent, PublicActionEvent } from '../core/public-events.js';

export interface TableLine { id: number; hand: number; speaker: string; text: string }
export interface CharacterNote {
  seatIndex: number; name: string; about: string; mood: string; relationship: string;
  fact: string; inference: string;
}
export interface StoryPrompt { id: string; title: string; text: string; choices: { id: string; text: string }[] }
export interface LivingView {
  revision: number; hand: number; limit: number; ended: boolean; chapter: string;
  protagonist: string; lines: TableLine[]; notes: CharacterNote[]; prompt: StoryPrompt | null;
  ending: string | null;
}

const PEOPLE = [
  { seatIndex: 1, name: '林岚', about: '习惯把筹码排齐。想看懂别人，不愿轻易承认自己看错。' },
  { seatIndex: 2, name: '阿凯', about: '嘴上只说输赢，其实更在意这一桌有没有人把他当回事。' },
  { seatIndex: 3, name: '莫叔', about: '今晚的东道主，总给人留台阶。提到旧牌局时，却常常停顿。' },
];
const CHOICES = [
  { id: 'quiet', text: '先听，不追问' },
  { id: 'warm', text: '给对方留个台阶' },
  { id: 'direct', text: '把疑问直接说出来' },
];

function inference(stats: ActionEvidence): string {
  if (stats.hands < 3) return '暂不判断：至少观察三手，再看这些动作是否反复出现。';
  const confidence = stats.hands < 6 ? '初步推测，样本较少' : '倾向观察，不是读牌';
  if (stats.aggressiveHands / stats.hands >= 0.6) return `${confidence}：近期主动施压较多，不代表这次一定有强牌。`;
  if (stats.folds / stats.hands >= 0.6) return `${confidence}：近期常退出底池，原因可能是起手牌、位置或下注压力。`;
  if (stats.calls > stats.raises * 2) return `${confidence}：近期更常用跟注继续，仍不能确定其手牌。`;
  return `${confidence}：还没有稳定而明显的模式。`;
}

/** White-listed public event consumer. Never accepts TurnPacket/observations/private ability state. */
export class LivingTable {
  readonly memory = new TableMemory();
  #revision = 0;
  #hand = 0;
  #packet = -1;
  #actions: PublicActionEvent[] = [];
  #lines: TableLine[] = [];
  #nextLine = 1;
  #counts = 0;
  #cooldowns = new Map<string, number>();
  #moods = new Map<number, number>();
  #relations = new Map<number, number>();
  #stacks = [100, 100, 100, 100];
  #lastResult = new Map<number, string>();
  #choices: string[] = [];
  #replied = new Set<string>();
  #stage: 'opening' | 'middle' | 'ending' = 'opening';
  #ended = false;
  #out = new Set<number>();

  mood(seat: number): number { return this.#moods.get(seat) ?? 0; }

  #say(speaker: string, text: string, key: string, important = false): void {
    if (!important && (this.#counts >= 2 || this.#hand - (this.#cooldowns.get(key) ?? -10) < 2)) return;
    this.#lines.push({ id: this.#nextLine++, hand: this.#hand, speaker, text });
    this.#lines = this.#lines.slice(-16);
    this.#cooldowns.set(key, this.#hand);
    if (!important) this.#counts++;
  }

  ingest(packetIndex: number, events: readonly PublicGameEvent[]): void {
    if (packetIndex <= this.#packet) return;
    this.#packet = packetIndex;
    for (const event of events) {
      switch (event.type) {
        case 'handStarted': {
          this.#hand = event.handNumber; this.#actions = []; this.#counts = 0;
          for (const [seat, mood] of this.#moods) this.#moods.set(seat, mood * 0.5);
          if (this.#hand === 1) {
            this.#say('莫叔', '先坐。今晚不谈输赢以外的债，只用这盒练习筹码。', 'hello', true);
            this.#say('阿凯', '那也得认真打。林岚，可别又说只是随便玩玩。', 'hello-kai', true);
            this.#say('林岚', '我看的是人，不只看结果。', 'hello-lan', true);
          }
          break;
        }
        case 'blindPosted': this.#actions.push(event); break;
        case 'playerActed': {
          this.#actions.push(event);
          const aggression = event.kind === 'bet' || event.kind === 'raise';
          if (event.seatIndex === 0 && aggression) {
            const stats = this.memory.evidence(0, this.#hand);
            if (!this.#out.has(1)) this.#say('林岚', stats.hands >= 3 && stats.aggressiveHands >= 2
              ? `前面 ${stats.hands} 手，你有 ${stats.aggressiveHands} 手主动加过价。我记着，但还不能下结论。`
              : '这个价我看见了。牌还没翻完，先不急着给你下判断。', 'hero-raise');
          }
          if (event.seatIndex === 2 && aggression && !this.#out.has(3)) {
            this.#say('莫叔', '阿凯，筹码推慢一点，人家看得清。', 'kai-raise');
            this.#say('阿凯', '知道了。我是想让这一桌认真一点。', 'kai-answer');
          }
          if (event.seatIndex === 0 && event.kind === 'fold' && !this.#out.has(3)) {
            this.#say('莫叔', '不想跟就收牌，下一手还是你的位子。', 'hero-fold');
          }
          break;
        }
        case 'handEvaluated': {
          const labels: Record<string, string> = { 'high-card': '高牌', 'one-pair': '一对', 'two-pair': '两对',
            'three-of-a-kind': '三条', straight: '顺子', flush: '同花', 'full-house': '葫芦', 'four-of-a-kind': '四条', 'straight-flush': '同花顺' };
          // handEvaluated is projected only when that seat's cards are public.
          this.#lastResult.set(event.seatIndex, `第 ${this.#hand} 手公开摊牌：${labels[event.category]}。`);
          break;
        }
        case 'playerEliminated': this.#out.add(event.seatIndex); break;
        case 'handCompleted': {
          for (const seat of event.finalStacks) {
            const net = seat.stack - (this.#stacks[seat.seatIndex] ?? 100);
            if (Math.abs(net) >= 20 && seat.seatIndex > 0) {
              this.#moods.set(seat.seatIndex, Math.sign(net));
              const name = PEOPLE.find((person) => person.seatIndex === seat.seatIndex)?.name ?? '莫叔';
              const lines = seat.seatIndex === 1 ? ['这次判断偏了。下一手我会重新看。', '先把这一手收好，下一手重新算。']
                : seat.seatIndex === 2 ? ['这手认了。别把我当成只会乱推的。', '看见没？这一手总该算我打得认真了。']
                : ['没关系，我还记得刚才怎么打的。', '收下了。来，手先放松，下一把再说。'];
              this.#say(name, lines[net > 0 ? 1 : 0]!, `result-${seat.seatIndex}`);
            }
            this.#stacks[seat.seatIndex] = seat.stack;
          }
          if (this.#hand >= 3) this.#stage = 'middle';
          if (this.#hand >= 6 || this.#stacks[0] === 0 || event.finalStacks.filter((seat) => seat.stack > 0).length <= 1) {
            this.#stage = 'ending'; this.#ended = true;
          }
          break;
        }
        case 'gameCompleted': this.#stage = 'ending'; this.#ended = true; break;
        // In particular: ownHoleCardsDealt, peek/read/swap and private traces are not consumed.
      }
    }
    this.memory.observe(this.#hand, this.#actions);
    this.#revision++;
  }

  reply(promptId: string, choice: string, revision: number): boolean {
    const prompt = this.view().prompt;
    if (revision !== this.#revision || !prompt || prompt.id !== promptId || !CHOICES.some((item) => item.id === choice)) return false;
    this.#replied.add(prompt.id); this.#choices.push(choice);
    this.#say('你', CHOICES.find((item) => item.id === choice)!.text, `reply-${prompt.id}`, true);
    const seat = this.#stage === 'opening' ? 3 : this.#stage === 'middle' ? 1 : 2;
    this.#relations.set(seat, (this.#relations.get(seat) ?? 0) + (choice === 'warm' ? 1 : choice === 'direct' ? -1 : 0));
    const answer = this.#stage === 'opening'
      ? choice === 'warm' ? '莫叔轻轻点头：“你肯来，就很好。先认识这一桌。”' : choice === 'direct' ? '莫叔停了一下：“那一夜的事，等熟一点再说。”' : '莫叔把水放在你手边，没有再催你说话。'
      : this.#stage === 'middle' ? choice === 'warm' ? '林岚把旧记分纸推近一点：“那一夜，有人收起了赢来的筹码。”'
        : choice === 'direct' ? '林岚抬眼：“你问得很快。但‘没拿走筹码’不等于‘输了’。”' : '林岚把纸折回去：“有些局，不是分完筹码就算结束。”'
      : choice === 'warm' ? '阿凯收起玩笑：“下次你来，我把那晚后半段讲给你听。”'
        : choice === 'direct' ? '阿凯没有躲开：“行，下次不绕弯。你也别只盯着输赢。”' : '阿凯替你留了张椅子：“下次见。你不说话的时候，我也知道你在听。”';
    this.#say('桌边', answer, `answer-${prompt.id}`, true); this.#revision++;
    return true;
  }

  view(): LivingView {
    const titles = { opening: '序章 · 留一张椅子', middle: '桌边 · 一张旧记分纸', ending: '离桌 · 还会再见' };
    const texts = {
      opening: '你应邀来到莫叔的旧牌室。灯只亮着这一桌。你是谁，还不用急着说明；先决定怎么与他们相处。',
      middle: '第三手过去，莫叔杯底压着的旧记分纸露出一角。林岚说：“那晚最后离桌的人，并没有拿走筹码。”',
      ending: '莫叔合上筹码盒：“今天就到这里。那晚最后离桌的人，没有拿走筹码。”这次见面不是资格赛；无论输赢，这条线索都为你留下。',
    };
    const last = this.#choices.at(-1);
    return { revision: this.#revision, hand: this.#hand, limit: 6, ended: this.#ended, chapter: titles[this.#stage],
      protagonist: last === 'warm' ? '你这次选择了给人留台阶' : last === 'direct' ? '你这次选择了直接追问' : last === 'quiet' ? '你这次选择了先听' : '你的态度，还由你决定',
      lines: this.#lines.map((line) => ({ ...line })),
      notes: PEOPLE.map((person) => {
        const stats = this.memory.evidence(person.seatIndex);
        return { ...person, mood: this.#out.has(person.seatIndex) ? '已收起筹码，留在桌边' : this.mood(person.seatIndex) > 0.2 ? '刚赢下一笔，语气松了些'
          : this.mood(person.seatIndex) < -0.2 ? '刚输掉一笔，话收住了些' : '暂时平静',
        relationship: (this.#relations.get(person.seatIndex) ?? 0) > 0 ? '愿意多说一点' : (this.#relations.get(person.seatIndex) ?? 0) < 0 ? '对你的追问更谨慎' : '还在相互认识',
        fact: `近 ${stats.hands} 手可见行动：下注／加注 ${stats.raises} 次，跟注 ${stats.calls} 次，弃牌 ${stats.folds} 次。${this.#lastResult.get(person.seatIndex) ?? ''}`,
        inference: inference(stats) };
      }),
      prompt: this.#replied.has(this.#stage) ? null : { id: this.#stage, title: titles[this.#stage], text: texts[this.#stage], choices: CHOICES.map((choice) => ({ ...choice })) },
      ending: this.#ended ? (this.#choices.includes('warm') ? '你带走的不是答案，而是下一次来访的邀请。' : this.#choices.includes('direct') ? '这桌人记住了你的问题。旧牌局的答案，留在下一次见面。' : '你记下了停顿、语气和那张旧纸。椅子还为你留着。') : null,
    };
  }
}
