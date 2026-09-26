import type { WebTable } from './protocol.js';
import type { LivingView, MemoryNotice, TableLine } from '../game/living-table.js';

type Escape = (value: unknown) => string;

export function renderEntrances(): string {
  return `<section class="entrance-strip" aria-label="选择游玩方式">
    <article class="entrance lesson-entrance"><p class="eyebrow">第一次来牌桌？</p><h2>莫叔教你打三手</h2><p>从跟注、过牌到自己做决定。没有基础也能入座。</p><button class="button button-primary" data-action="tutorial-start">开始新手教学 →</button><small>三关 · 配合练习的对手 · 可随时退出</small></article>
    <article class="entrance story-entrance"><p class="eyebrow">独立剧情 · 短序章</p><h2>留一张椅子</h2><p>林岚看动作，阿凯要面子，莫叔留台阶。旧牌室里，还有一段没说完的往事。</p><button class="button button-secondary" data-action="living-start">走进「留一张椅子」 →</button><small>固定四人 · 最多六手 · 自带人物互动 · 使用下方选定的规则</small></article>
  </section><div class="free-table-heading"><h2>或，自由开一桌</h2><p>2–6 人 · 可开启人物记忆与闲聊 · 不限六手</p></div>`;
}

export function renderGuide(table: WebTable, h: Escape): string {
  const lesson = table.tutorial;
  if (!lesson) return '';
  return `<section class="lesson-note" aria-label="新手教学提示"><div class="lesson-top"><span class="lesson-index">${lesson.lesson + 1}<small>/ 3</small></span><div><p class="eyebrow">莫叔的桌边课 · ${lesson.complete ? '教学完成' : lesson.atResult ? '课后问题' : '实战练习'}</p><h2>${h(lesson.title)}</h2></div><button class="text-button" data-action="home">返回主页</button></div>
    <p class="lesson-objective">${h(lesson.objective)}</p><p class="coach-hint">${h(lesson.hint)}</p>
    ${lesson.atResult ? `<div class="lesson-question"><h3>${h(lesson.question)}</h3>${!lesson.solved ? `<div class="reply-choices">${lesson.answers.map((answer) => `<button class="button button-secondary" data-action="lesson-answer" data-answer="${h(answer.id)}">${h(answer.text)}</button>`).join('')}</div>` : ''}<p role="status">${h(lesson.feedback)}</p></div>` : '<p class="lesson-action-note">在牌桌下的行动条亲手试一试。前两关按提示练习；第三关自由选择。</p>'}
    <details class="rules-pocket" data-panel="rules"><summary>随手查：怎么比牌？术语是什么意思？</summary><p>你有两张底牌，桌上最多五张公共牌。用其中最佳五张比大小，底牌可用零、一或两张。</p><p>牌型从小到大：高牌 → 一对 → 两对 → 三条 → 顺子 → 同花 → 葫芦 → 四条 → 同花顺。</p><p>同牌型再比组成牌的点数和踢脚牌，最佳五张同值才平分。花色不分大小，A 在 A2345 顺子中可以作最小牌。</p><p>跟注：补齐差额。过牌：当前无需补钱，留在牌局。弃牌：放弃本手底池资格。下注／加注：提高本轮总额。全下：只投入自己剩余筹码。</p><p>小盲／大盲是每手自动投入，按钮 D 每手移动。四轮是翻牌前、翻牌、转牌、河牌，每轮下注重新从零计算。</p><p>短码全下只能赢自己有资格争夺的主池；其他人额外的对等投入进入边池。没有人跟上的部分会退回。</p></details>
    <div class="lesson-footer"><button class="text-button" data-action="lesson-restart">重试本关</button>${lesson.complete ? '<button class="button button-primary" data-action="practice-start">学完了，开一桌经典德州 →</button>' : lesson.solved ? '<button class="button button-primary" data-action="lesson-next">进入下一关 →</button>' : ''}</div>
  </section>`;
}

export function renderStory(table: WebTable, h: Escape): string {
  const living = table.living;
  if (!living || living.story === false || table.experience !== 'living') return '';
  const prompt = living.prompt;
  return `<section class="story-note" aria-label="桌边故事"><div class="story-heading"><p class="eyebrow">${h(living.chapter)} · ${Math.min(living.hand, living.limit ?? 6)} / ${living.limit} 手</p></div>
    <p class="protagonist">${h(living.protagonist)}</p>
    ${prompt ? `<div class="story-prompt"><h2>${h(prompt.title)}</h2><p>${h(prompt.text)}</p><div class="reply-choices">${prompt.choices.map((choice) => `<button class="button button-secondary" data-action="reply" data-prompt="${h(prompt.id)}" data-choice="${h(choice.id)}">${h(choice.text)}</button>`).join('')}</div><small>${living.ended ? '回应不影响结算，也可以直接回到主页。' : '回应不等于下注，也可以直接继续打牌。'}</small></div>` : ''}
    ${living.ended ? `<div class="story-ending"><h2>这一夜，先到这里</h2><p>${h(living.ending)}</p><p>结算账单仍保留最后一手真实结果。序章不是整场锦标赛，剩余筹码没有重新分配。</p><button class="button button-primary" data-action="home">回到主页 →</button></div>` : ''}
  </section>`;
}

function memoryCard(notice: MemoryNotice, h: Escape): string {
  return `<article class="memory-notice" data-memory-id="${notice.id}"><div><span class="memory-label">${notice.kind && notice.kind !== 'action' ? '关键交锋' : '记住了你'}</span><strong>${h(notice.title)}</strong><small>第 ${notice.hand} 手</small></div><p>${h(notice.fact)}</p><p class="memory-inference"><span class="note-label">${notice.kind && notice.kind !== 'action' ? '边界' : '推测'}</span>${h(notice.inference)}</p></article>`;
}

function talkLine(line: TableLine, h: Escape): string {
  const observed = line.kind === 'observation';
  return `<p class="pulse-line ${observed ? 'pulse-observation' : ''}"><small class="line-kind">${observed ? '观察' : '发言'}</small><strong>${h(line.speaker)}</strong><span>${observed ? h(line.text) : `“${h(line.text)}”`}</span><small>第 ${line.hand} 手</small></p>`;
}

/** Only render feedback already visible on the current timeline, not final NPC notes. */
export function renderPulse(living: Pick<LivingView, 'lines' | 'memories' | 'recap'> | null | undefined, h: Escape,
  muted = false, playback = false): string {
  if (!living) return '';
  // An older local server can still serve these rebuilt static files on another port.
  // Keep its current table readable; new social tables require the updated server.
  const memories = living.memories ?? [];
  const visibleLines = living.lines.filter((line) => !muted || line.kind === 'observation');
  const line = visibleLines.at(-1);
  const memory = memories.at(-1);
  return `<section class="table-pulse" aria-label="桌边动态"><div class="pulse-heading"><h2>桌边动态</h2><span>${playback ? '随行动发生' : '人物记忆已开启 · 最近八手'}</span>${!playback ? `<button class="text-button" data-action="toggle-talk" aria-pressed="${muted}">${muted ? '展开闲聊' : '收起闲聊'}</button>` : ''}</div>
    ${muted ? '<p class="muted-talk">闲聊已收起；观察、记忆和牌局不受影响。</p>' : ''}${line ? talkLine(line, h) : ''}
    ${memory ? memoryCard(memory, h) : !playback ? '<p class="memory-empty">等你第一次行动，会在这里留下“谁记住了你”的公开依据。</p>' : ''}
    ${!playback && living.recap ? `<div class="encounter-recap" aria-label="本手交锋回顾"><strong>本手交锋 · 第 ${living.recap.hand} 手</strong><p>${h(living.recap.text)}</p></div>` : ''}
    ${!playback ? `<details class="pulse-history" data-panel="pulse-history"><summary>回看桌边记录 · ${memories.length} 条记忆 / ${visibleLines.length} 条${muted ? '观察' : '发言与观察'}</summary><p class="aside-note">发言是人物说的话；观察是已发生的可见动作，不是读心。重开牌桌或重启服务会清除。</p>${memories.slice().reverse().map((notice) => memoryCard(notice, h)).join('')}<div aria-label="桌边短句">${visibleLines.slice().reverse().map((item) => talkLine(item, h)).join('')}</div></details>` : ''}
  </section>`;
}

export function renderObservations(table: WebTable, h: Escape): string {
  if (!table.living) return '';
  return `<section class="observations" aria-label="本场人物观察"><h2>认得这一桌的人</h2><p class="aside-note">记公开动作，不猜看不见的牌。近期八手窗口；推测不是答案。</p>${table.living.notes.map((person) => `<details class="character-note" data-panel="character-${person.seatIndex}"><summary>${h(person.name)}<small>${h(person.relationship)}</small></summary><p>${h(person.about)}</p><p class="character-mood">${h(person.mood)}</p><p><span class="note-label">事实</span>${h(person.fact)}</p><p><span class="note-label">推测</span>${h(person.inference)}</p></details>`).join('')}</section>`;
}
