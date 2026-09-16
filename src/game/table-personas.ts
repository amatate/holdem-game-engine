import { CHARACTERS, type CharacterId } from '../agents/characters.js';

/** Written voices, not hidden strategy traces. Every line must fit publicly visible events. */
const VOICES: Record<CharacterId, { about: string; hello: string; raise: string; fold: string; call: string; win: string; loss: string }> = {
  hunter: {
    about: '习惯把筹码排齐。想看懂别人，不愿轻易承认自己看错。',
    hello: '我看的是人，不只看结果。慢慢打，我们有时间认识。',
    raise: '这个价我看见了。牌还没翻完，先不急着给你下判断。',
    fold: '这次你收手了。我记下动作，不替你猜底牌。',
    call: '你愿意继续看。好，我也再看一轮。',
    win: '先把这一手收好，下一手重新算。', loss: '这次判断偏了。下一手我会重新看。',
  },
  maniac: {
    about: '嘴上只说输赢，其实更在意这一桌有没有人把他当回事。',
    hello: '那就认真打。别因为我话多，就以为我没在看。',
    raise: '敢把价提起来，好。这一桌有点意思了。', fold: '这次先收？行，下一手别忘了我还在。',
    call: '跟上来了？好，继续。', win: '看见没？这一手总该算我打得认真了。', loss: '这手认了。别把我当成只会乱推的。',
  },
  'calling-station': {
    about: '总给人留台阶。提到旧牌局时，却常常停顿。',
    hello: '先坐。只有练习筹码，想清楚再推，不用急。',
    raise: '价提上来了。大家看清楚，再决定跟不跟。', fold: '不想跟就收牌，下一手还是你的位子。',
    call: '跟上了，那就一起看后面的牌。', win: '收下了。来，手先放松，下一把再说。', loss: '没关系，我还记得刚才怎么打的。',
  },
  rock: {
    about: '话不多，筹码总收在手边。决定了才把它们推出去。',
    hello: '坐稳，别急。看几手再说。', raise: '你提价了。我想一下。', fold: '收得住，也是一种打牌。',
    call: '嗯，继续看。', win: '这一手收下。', loss: '这笔记住了，下一手。',
  },
  'small-ball': {
    about: '喜欢一小步一小步试探，聊起天来也不把话说满。',
    hello: '先试几步，熟了再聊。', raise: '你把步子迈大了。这次我得多想一下。', fold: '这一步停在这里，也好。',
    call: '不急，我们往下看。', win: '一点一点，收好这一笔。', loss: '这一步没走好，先退回来。',
  },
  trapper: {
    about: '安静地听完别人说话，偶尔一句反问让桌上慢下来。',
    hello: '你们先聊，我在听。', raise: '现在把价提起来？我看到了。', fold: '你停了。那就留到下一手。',
    call: '好，再看一张。', win: '等到了这一手，收下。', loss: '等不来每一次。这个结果我认。',
  },
  'value-bettor': {
    about: '做事讲分量，不喜欢别人把自己的认真当成逞强。',
    hello: '筹码摆明白，认真打就行。', raise: '这个价有分量。我看清楚了。', fold: '决定收手，就收干净。',
    call: '好，筹码对齐，接着打。', win: '这一笔收好，下一手照样认真。', loss: '这笔输了，算数。',
  },
};

export interface TablePerson { seatIndex: number; characterId: CharacterId }
export function tablePerson(person: TablePerson) {
  return { ...person, name: CHARACTERS[person.characterId].displayName, ...VOICES[person.characterId] };
}
