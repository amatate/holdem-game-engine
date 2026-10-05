import { TableMemory, type ActionEvidence } from '../agents/table-memory.js';
import type { PublicGameEvent, PublicActionEvent } from '../core/public-events.js';
import type { Street } from '../core/state.js';
import { tablePerson, characterLine, type VoiceMoment, type TablePerson } from './table-personas.js';

export interface EventAnchor { packetIndex: number; eventIndex: number }
export interface TableLine extends EventAnchor {
  id: number; hand: number; speaker: string; seatIndex: number | null; text: string;
  kind?: 'speech' | 'observation';
}
export interface MemoryNotice extends EventAnchor {
  id: number; hand: number; seatIndex: number; speaker: string; title: string; fact: string; inference: string;
  kind?: 'action' | 'pressure' | 'showdown' | 'big-pot';
}
export interface CharacterNote {
  seatIndex: number; name: string; about: string; mood: string; relationship: string;
  fact: string; inference: string;
}
export interface StoryPrompt { id: string; title: string; text: string; choices: { id: string; text: string }[] }
export interface LivingView {
  revision: number; hand: number; limit: number | null; ended: boolean; story: boolean; chapter: string;
  protagonist: string; lines: TableLine[]; notes: CharacterNote[]; prompt: StoryPrompt | null;
  ending: string | null; memories: MemoryNotice[];
  recap?: { hand: number; text: string } | null;
}

const STORY_PEOPLE: TablePerson[] = [
  { seatIndex: 1, characterId: 'hunter' }, { seatIndex: 2, characterId: 'maniac' }, { seatIndex: 3, characterId: 'calling-station' },
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
  // NPC decisions may already have filled memory with a later prefix of this packet.
  // Expression evidence advances separately so a reaction can never quote future actions.
  readonly #visibleMemory = new TableMemory();
  readonly #people: ReturnType<typeof tablePerson>[];
  readonly #story: boolean;
  #revision = 0;
  #hand = 0;
  #packet = -1;
  #eventIndex = -1;
  #actions: PublicActionEvent[] = [];
  #lines: TableLine[] = [];
  #nextLine = 1;
  #memories: MemoryNotice[] = [];
  #nextMemory = 1;
  #counts = 0;
  #observed = new Set<string>();
  #street: Street = 'preflop';
  #streetRaises = 0;
  #keyKinds = new Set<string>();
  #recap: { hand: number; text: string } | null = null;
  #bigBlind = 2;
  #paid = new Map<number, number>();
  #shown = new Set<number>();
  #cooldowns = new Map<string, number>();
  #voiceCounts = new Map<string, number>();
  #moods = new Map<number, number>();
  #relations = new Map<number, number>();
  #stacks = [100, 100, 100, 100];
  #lastResult = new Map<number, string>();
  #choices: string[] = [];
  #replied = new Set<string>();
  #stage: 'opening' | 'middle' | 'ending' = 'opening';
  #ended = false;
  #out = new Set<number>();

  constructor(options: { story?: boolean; people?: readonly TablePerson[] } = {}) {
    this.#story = options.story ?? true;
    this.#people = (options.people ?? STORY_PEOPLE).map(tablePerson);
  }

  mood(seat: number): number { return this.#moods.get(seat) ?? 0; }

  #say(speaker: string, text: string, key: string, important = false): boolean {
    if (!important && (this.#counts >= 2 || this.#hand - (this.#cooldowns.get(key) ?? -10) < 2)) return false;
    this.#lines.push({ id: this.#nextLine++, hand: this.#hand, speaker, text, kind: 'speech',
      seatIndex: this.#people.find((person) => person.name === speaker)?.seatIndex ?? null,
      packetIndex: this.#packet, eventIndex: this.#eventIndex });
    this.#lines = this.#lines.slice(-32);
    this.#cooldowns.set(key, this.#hand);
    if (!important) this.#counts++;
    return true;
  }

  #speak(person: ReturnType<typeof tablePerson>, moment: VoiceMoment, key: string, important = false): void {
    const voiceKey = `${person.characterId}:${moment}`;
    const count = this.#voiceCounts.get(voiceKey) ?? 0;
    if (this.#say(person.name, characterLine(person.characterId, moment, count), key, important)) {
      this.#voiceCounts.set(voiceKey, count + 1);
    }
  }

  #observeAction(event: Extract<PublicGameEvent, { type: 'playerActed' }>): void {
    const person = this.#people.find((person) => person.seatIndex === event.seatIndex);
    if (!person || this.#out.has(person.seatIndex) || this.#observed.size >= 2) return;
    const raises = this.#actions.filter((action) => action.type === 'playerActed' && action.seatIndex === person.seatIndex && (action.kind === 'raise' || action.kind === 'bet')).length;
    const aggression = event.kind === 'raise' || event.kind === 'bet';
    const pressure = aggression && (this.#streetRaises >= 2 || raises >= 2);
    const pot = [...this.#paid.values()].reduce((sum, paid) => sum + paid, 0);
    const bigPotDecision = pot >= this.#bigBlind * 20 && (event.paid >= this.#bigBlind * 2
      || (event.kind === 'fold' && (this.#paid.get(person.seatIndex) ?? 0) >= this.#bigBlind * 5));
    const important = event.allIn || pressure || event.paid >= this.#bigBlind * 10 || bigPotDecision;
    // Keep the second slot for a meaningful encounter. Routine preflop actions do
    // not spend either slot; one quieter postflop gesture can establish presence.
    // Decisions use only this public prefix, never future events or replacement.
    if (!important && (this.#street === 'preflop' || this.#observed.size >= 1)) return;
    const key = `${person.seatIndex}-${event.allIn ? 'all-in' : pressure ? 'pressure' : important ? 'commitment' : 'action'}`;
    if (this.#observed.has(key)) return;
    this.#observed.add(key);
    const text = event.kind === 'check' ? '轻敲桌面，过牌。'
      : event.kind === 'fold' ? '把牌扣下，退出这一手的争夺。'
      : event.allIn ? `把剩余 ${event.paid} 筹码全部推入，本轮到 ${event.betTo}。`
      : event.kind === 'call' ? `补入 ${event.paid} 筹码跟注，本轮到 ${event.betTo}。`
      : `${raises > 1 ? `本手第 ${raises} 次提高价格，` : '把筹码推入桌面，'}本轮${event.kind === 'bet' ? '下注' : '加注'}到 ${event.betTo}。`;
    this.#lines.push({ id: this.#nextLine++, hand: this.#hand, kind: 'observation', speaker: person.name,
      seatIndex: person.seatIndex, text, packetIndex: this.#packet, eventIndex: this.#eventIndex });
    this.#lines = this.#lines.slice(-32);
  }

  #keyMemory(kind: 'pressure' | 'showdown' | 'big-pot', title: string, fact: string): void {
    // At most one significant encounter beyond the first-action fact in each hand.
    if (this.#keyKinds.size) return;
    const active = this.#people.filter((person) => !this.#out.has(person.seatIndex));
    // The memory is public and shared. Rotate the visible witness instead of
    // implying that only the hunter notices; use a different witness for key facts.
    const person = active[this.#hand % active.length];
    if (!person) return;
    this.#keyKinds.add(kind);
    this.#memories.push({ id: this.#nextMemory++, hand: this.#hand, kind, seatIndex: person.seatIndex, speaker: person.name,
      title: `${person.name}记住了${title}`, fact, inference: '这是公开交锋，不代表知道你的意图或下一手的牌。',
      packetIndex: this.#packet, eventIndex: this.#eventIndex });
    this.#memories = this.#memories.slice(-16);
  }

  #remember(event: Extract<PublicGameEvent, { type: 'playerActed' }>): void {
    if (event.seatIndex !== 0 || this.#memories.some((notice) => notice.hand === this.#hand && notice.kind === 'action')) return;
    const active = this.#people.filter((person) => !this.#out.has(person.seatIndex));
    const observer = active[(this.#hand - 1) % active.length];
    if (!observer) return;
    const labels = { fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注' };
    const stats = this.#visibleMemory.evidence(0);
    const action = labels[event.kind];
    const detail = event.kind === 'fold' || event.kind === 'check' ? action
      : `${action}，实际投入 ${event.paid}，本轮到 ${event.betTo}${event.allIn ? '（全下）' : ''}`;
    this.#memories.push({ id: this.#nextMemory++, hand: this.#hand, kind: 'action', seatIndex: observer.seatIndex, speaker: observer.name,
      title: `${observer.name}记下了你的${action}`,
      fact: `第 ${this.#hand} 手，你${detail}。近 ${stats.hands} 手，你有 ${stats.aggressiveHands} 手主动下注／加注、${stats.folds} 次弃牌。`,
      inference: inference(stats), packetIndex: this.#packet, eventIndex: this.#eventIndex });
    this.#memories = this.#memories.slice(-16);
  }

  ingest(packetIndex: number, events: readonly PublicGameEvent[]): void {
    if (packetIndex <= this.#packet) return;
    this.#packet = packetIndex;
    for (const [eventIndex, event] of events.entries()) {
      this.#eventIndex = eventIndex;
      switch (event.type) {
        case 'gameStarted': this.#stacks = Array(event.maxSeats).fill(event.startingStack); break;
        case 'handStarted': {
          this.#hand = event.handNumber; this.#actions = []; this.#counts = 0;
          this.#street = 'preflop'; this.#streetRaises = 0;
          this.#bigBlind = event.bigBlind; this.#observed.clear(); this.#keyKinds.clear(); this.#shown.clear(); this.#paid.clear(); this.#recap = null;
          this.#visibleMemory.observe(this.#hand, []);
          this.#memories = this.#memories.filter((notice) => notice.hand >= this.#hand - 7);
          for (const [seat, mood] of this.#moods) this.#moods.set(seat, mood * 0.5);
          if (this.#hand === 1 && this.#story) {
            this.#say('莫叔', '杯子在边上，自己倒。坐吧。', 'hello', true);
            this.#say('阿凯', '莫叔，又拿你那盒旧筹码啊？', 'hello-kai', true);
            this.#say('林岚', '能用就行。你那枚别转了，听着晕。', 'hello-lan', true);
          } else if (this.#hand === 1) {
            const host = this.#people[0];
            if (host) this.#speak(host, 'hello', 'hello', true);
          }
          break;
        }
        case 'blindPosted':
          this.#actions.push(event); this.#visibleMemory.observe(this.#hand, this.#actions);
          this.#paid.set(event.seatIndex, (this.#paid.get(event.seatIndex) ?? 0) + event.amount); break;
        case 'uncalledBetReturned': this.#paid.set(event.seatIndex, (this.#paid.get(event.seatIndex) ?? 0) - event.amount); break;
        case 'holeCardsRevealed': this.#shown.add(event.seatIndex); break;
        case 'bettingRoundStarted': this.#street = event.street; this.#streetRaises = 0; break;
        case 'playerActed': {
          this.#actions.push(event);
          if (event.kind === 'bet' || event.kind === 'raise') this.#streetRaises++;
          this.#paid.set(event.seatIndex, (this.#paid.get(event.seatIndex) ?? 0) + event.paid);
          this.#visibleMemory.observe(this.#hand, this.#actions);
          this.#remember(event);
          this.#observeAction(event);
          const aggression = event.kind === 'bet' || event.kind === 'raise';
          const active = this.#people.filter((person) => !this.#out.has(person.seatIndex));
          const lan = active.find((person) => person.characterId === 'hunter');
          const mo = active.find((person) => person.characterId === 'calling-station');
          const kai = active.find((person) => person.characterId === 'maniac');
          if (event.seatIndex === 0 && aggression && active.length) {
            const raises = this.#actions.filter((action) => action.type === 'playerActed' && action.seatIndex === 0 && (action.kind === 'bet' || action.kind === 'raise')).length;
            if (raises >= 2) this.#keyMemory('pressure', '这次连续施压', `第 ${this.#hand} 手，你第 ${raises} 次主动下注／加注，本轮到 ${event.betTo}。`);
            const observer = lan ?? active[0]!;
            // Evidence stays in the notebook. Chatter is a reaction, not a statistics report.
            this.#speak(observer, 'raise', 'hero-raise');
          }
          if (kai && mo && event.seatIndex === kai.seatIndex && aggression) {
            this.#say('莫叔', '阿凯，慢点推，筹码快滚到我这儿了。', 'kai-raise');
            this.#say('阿凯', '没滚过去就还不算你的啊，莫叔。', 'kai-answer');
          }
          if (event.seatIndex === 0 && event.kind === 'fold' && active.length
            && (this.#paid.get(0) ?? 0) >= this.#bigBlind * 3) {
            const observer = mo ?? active[0]!;
            this.#speak(observer, 'fold', 'hero-fold');
          }
          if (event.seatIndex === 0 && event.kind === 'call' && active.length && event.paid >= this.#bigBlind * 5) {
            const observer = active[(this.#hand - 1) % active.length]!;
            this.#speak(observer, 'call', 'hero-call');
          }
          break;
        }
        case 'handEvaluated': {
          const labels: Record<string, string> = { 'high-card': '高牌', 'one-pair': '一对', 'two-pair': '两对',
            'three-of-a-kind': '三条', straight: '顺子', flush: '同花', 'full-house': '葫芦', 'four-of-a-kind': '四条', 'straight-flush': '同花顺' };
          // handEvaluated is projected only when that seat's cards are public.
          if (this.#shown.has(event.seatIndex)) {
            this.#lastResult.set(event.seatIndex, `第 ${this.#hand} 手公开摊牌：${labels[event.category]}。`);
            this.memory.recordShowdown(this.#hand, event.seatIndex, event.category);
            if (event.seatIndex === 0 && this.#actions.some((action) => action.type === 'playerActed' && action.seatIndex === 0 && (action.kind === 'bet' || action.kind === 'raise'))) {
              this.#keyMemory('showdown', '这次公开摊牌', `第 ${this.#hand} 手，你曾主动下注／加注，最后公开牌型是${labels[event.category]}。不能仅凭结果断定先前的下注意图。`);
            }
          }
          break;
        }
        case 'playerEliminated': this.#out.add(event.seatIndex); break;
        case 'handCompleted': {
          let reacted = false;
          const rival = this.#people.filter((person) => (this.#paid.get(person.seatIndex) ?? 0) > 0)
            .sort((a, b) => (this.#paid.get(b.seatIndex) ?? 0) - (this.#paid.get(a.seatIndex) ?? 0))[0];
          const heroNet = (event.finalStacks.find((seat) => seat.seatIndex === 0)?.stack ?? this.#stacks[0]!) - this.#stacks[0]!;
          const invested = this.#paid.get(0) ?? 0;
          const exchange = rival ? `你本手实际投入 ${invested}，${rival.name}实际投入 ${this.#paid.get(rival.seatIndex)}（均已扣除未跟注退回）。` : `你本手实际投入 ${invested}（已扣除退回）。`;
          this.#recap = { hand: this.#hand, text: `${exchange}你本手${heroNet > 0 ? `净赢 ${heroNet}` : heroNet < 0 ? `净输 ${-heroNet}` : '持平'}。只复述公开结果，不推断未亮底牌。` };
          if (rival && invested >= this.#bigBlind * 10 && (this.#paid.get(rival.seatIndex) ?? 0) >= this.#bigBlind * 10) {
            this.#keyMemory('big-pot', '这次大底池交锋', `第 ${this.#hand} 手：${this.#recap.text}`);
          }
          for (const seat of event.finalStacks) {
            const net = seat.stack - (this.#stacks[seat.seatIndex] ?? 100);
            this.memory.recordOutcome(this.#hand, seat.seatIndex, net, this.#bigBlind);
            if (Math.abs(net) >= this.#bigBlind * 10 && seat.seatIndex > 0) {
              this.#moods.set(seat.seatIndex, Math.sign(net));
              const person = this.#people.find((person) => person.seatIndex === seat.seatIndex);
              // A single result reaction has its own slot; incidental banter cannot swallow it.
              if (person && !reacted) {
                this.#speak(person, net > 0 ? 'win' : 'loss', `result-${seat.seatIndex}`, true);
                reacted = true;
              }
            }
            this.#stacks[seat.seatIndex] = seat.stack;
          }
          if (this.#story && this.#hand >= 3) this.#stage = 'middle';
          if (this.#story && (this.#hand >= 6 || this.#stacks[0] === 0 || event.finalStacks.filter((seat) => seat.stack > 0).length <= 1)) {
            this.#stage = 'ending'; this.#ended = true;
          }
          break;
        }
        case 'gameCompleted': if (this.#story) { this.#stage = 'ending'; this.#ended = true; } break;
        // In particular: ownHoleCardsDealt, peek/read/swap and private traces are not consumed.
      }
    }
    this.#eventIndex = -1;
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
      ? choice === 'warm' ? '莫叔点点头：“来都来了，先打两手。”' : choice === 'direct' ? '莫叔停了一下：“你是来问那晚的事啊……先坐。”' : '莫叔把水放在你手边，没有再催你说话。'
      : this.#stage === 'middle' ? choice === 'warm' ? '林岚把旧记分纸推近一点：“这张我一直没扔。你慢慢看。”'
        : choice === 'direct' ? '林岚抬眼：“我只说他没拿筹码。怎么回事，我也没弄明白。”' : '林岚把纸留在桌上：“先放这儿。你想问了再说。”'
      : choice === 'warm' ? '阿凯收起玩笑：“说好了啊，下次别放我鸽子。那晚还有点事，下回讲。”'
        : choice === 'direct' ? '阿凯点头：“行，下回把我知道的都告诉你。”' : '阿凯拍了拍椅背：“下次还坐这儿？我给你占着。”';
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
    return { revision: this.#revision, hand: this.#hand, limit: this.#story ? 6 : null, ended: this.#ended,
      story: this.#story, chapter: this.#story ? titles[this.#stage] : '自由牌桌 · 人物互动',
      protagonist: last === 'warm' ? '你这次选择了给人留台阶' : last === 'direct' ? '你这次选择了直接追问' : last === 'quiet' ? '你这次选择了先听' : '你的态度，还由你决定',
      lines: this.#lines.map((line) => ({ ...line })),
      memories: this.#memories.map((notice) => ({ ...notice })),
      recap: this.#recap ? { ...this.#recap } : null,
      notes: this.#people.map((person) => {
        const stats = this.#visibleMemory.evidence(person.seatIndex);
        return { seatIndex: person.seatIndex, name: person.name, about: person.about,
        mood: this.#out.has(person.seatIndex) ? '已收起筹码，留在桌边' : this.mood(person.seatIndex) > 0.2 ? '刚赢下一笔，语气松了些'
          : this.mood(person.seatIndex) < -0.2 ? '刚输掉一笔，话收住了些' : '暂时平静',
        relationship: (this.#relations.get(person.seatIndex) ?? 0) > 0 ? '愿意多说一点' : (this.#relations.get(person.seatIndex) ?? 0) < 0 ? '对你的追问更谨慎' : '还在相互认识',
        fact: `近 ${stats.hands} 手可见行动：下注／加注 ${stats.raises} 次，跟注 ${stats.calls} 次，弃牌 ${stats.folds} 次。${this.#lastResult.get(person.seatIndex) ?? ''}`,
        inference: inference(stats) };
      }),
      prompt: !this.#story || this.#replied.has(this.#stage) ? null : { id: this.#stage, title: titles[this.#stage], text: texts[this.#stage], choices: CHOICES.map((choice) => ({ ...choice })) },
      ending: this.#ended ? (this.#choices.includes('warm') ? '你带走的不是答案，而是下一次来访的邀请。' : this.#choices.includes('direct') ? '这桌人记住了你的问题。旧牌局的答案，留在下一次见面。' : '你记下了停顿、语气和那张旧纸。椅子还为你留着。') : null,
    };
  }
}
