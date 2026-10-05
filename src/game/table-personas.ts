import { CHARACTERS, type CharacterId } from '../agents/characters.js';

export type VoiceMoment = 'hello' | 'raise' | 'fold' | 'call' | 'win' | 'loss';
interface Voice { about: string; lines: Record<VoiceMoment, readonly [string, ...string[]]> }

/** Character writing lives in docs/character-bible-v1.md. Public reactions only. */
const VOICES: Record<CharacterId, Voice> = {
  'hunter': {
    about: '自由摄影师。平时话不多，熟了会冷不丁开个玩笑。别跟着阿凯叫她“猎手”，她嫌夸张。',
    lines: {
      hello: ['林岚。叫名字就行，别跟他们喊外号。'],
      raise: ['加这么多啊。', '你这一下，倒不犹豫。'],
      fold: ['不看了？行。', '收得挺干脆。'],
      call: ['还想看啊。', '行，那接着。'],
      win: ['这回算我运气好。', '嗯。这一手收下。'],
      loss: ['行，这手没打好。', '我得缓一下。'],
    },
  },
  'maniac': {
    about: '在附近修车店工作，常常第一个到。嘴快，爱接话，输了也会拿自己开涮。',
    lines: {
      hello: ['来来来，正好缺个人。'],
      raise: ['哎哟，这下热闹了。', '好家伙，你也不客气啊。'],
      fold: ['这就撤啦？行，下把见。', '不陪了是吧。行。'],
      call: ['还真跟啊。', '嘿，还挺热闹。'],
      win: ['嘿，这把归我。', '总算让我逮着一回。'],
      loss: ['……行，你们先别笑。', '白忙活了。'],
    },
  },
  'calling-station': {
    about: '照看这间旧牌室，以前修过钟表。谁来了都能坐坐；轮到自己打牌，却总舍不得少看一张。',
    lines: {
      hello: ['杯子在边上，自己倒。坐吧。'],
      raise: ['哟，下这么大。', '一下热闹起来了。'],
      fold: ['行，喝口水。', '歇一手也好，椅子又不跑。'],
      call: ['你也舍不得扔，是吧。', '都想看后头那张啊。'],
      win: ['呵呵，收下了。', '还真轮到我了。'],
      loss: ['唉，又少一摞。', '没留住。下把再看吧。'],
    },
  },
  'rock': {
    about: '开公交的老周，来得早，话很少。看着不爱搭理人，谁的杯子要倒了，他倒先伸手。',
    lines: {
      hello: ['人齐了？那开始吧。'],
      raise: ['嚯。', '这注不小。'],
      fold: ['嗯。'],
      call: ['还看啊。'],
      win: ['收了。', '行。'],
      loss: ['没事，接着来。', '输了。下一手。'],
    },
  },
  'small-ball': {
    about: '在桌游店上班，很会接住别人的玩笑。嘴上说“就一点”，丢了一小摞筹码又真心疼。',
    lines: {
      hello: ['我刚下班，先让我坐会儿。'],
      raise: ['好嘛，又贵了。', '这下可不便宜。'],
      fold: ['省下了。', '先停这儿，也行。'],
      call: ['你也想看后面啊。', '还真舍得啊。'],
      win: ['够我高兴一会儿了。', '这一点也挺好。'],
      loss: ['我那点筹码啊……', '得，又少一点。'],
    },
  },
  'trapper': {
    about: '轮班护士，难得有个不用赶时间的晚上。看着不好接近，熟了才知道她也会逗人。',
    lines: {
      hello: ['你们聊，我歇一会儿。'],
      raise: ['嗯？还加？', '哦？忽然这么热闹。'],
      fold: ['好，留点悬念。', '不陪了？好吧。'],
      call: ['你也不急。', '那就再坐会儿。'],
      win: ['谢谢啦。', '那我收下了。'],
      loss: ['好吧，这回没我的份。', '唉，白坐这么久。'],
    },
  },
  'value-bettor': {
    about: '在后厨做事，讨厌一句话绕三圈。打牌出手重，输了倒不赖账，只是不太会说安慰话。',
    lines: {
      hello: ['韩烈。叫老韩也行。'],
      raise: ['好家伙，下这么多。', '这注够大的。'],
      fold: ['行，干脆。'],
      call: ['够痛快。'],
      win: ['舒服。', '这把打得痛快。'],
      loss: ['行，这把认了。', '输了就是输了。'],
    },
  },
};

export interface TablePerson { seatIndex: number; characterId: CharacterId }
export function tablePerson(person: TablePerson) {
  const voice = VOICES[person.characterId];
  return { ...person, name: CHARACTERS[person.characterId].displayName, about: voice.about,
    hello: voice.lines.hello[0], raise: voice.lines.raise[0], fold: voice.lines.fold[0],
    call: voice.lines.call[0], win: voice.lines.win[0], loss: voice.lines.loss[0] };
}

/** Counts are presentation-only; never consume engine or policy RNG. */
export function characterLine(characterId: CharacterId, moment: VoiceMoment, occurrence: number): string {
  const lines = VOICES[characterId].lines[moment];
  return lines[occurrence % lines.length]!;
}
