import type { CharacterId } from '../agents/characters.js';
import type { NightLine } from './first-night.js';
import type { SecondNightState } from './second-night.js';
import { volumeNode } from './volume-one.js';
import { storyNode } from './story-content.js';
import { volumeTwoNode, VOLUME_TWO_TABLES, VOLUME_TWO_CHAPTERS } from './volume-two.js';

export interface StoryMoney { id: string; delta: number; balance: number; text: string; en: string }
export interface StoryFact { id: string; source: string; text: string; en: string }
export interface StoryHistory { scene: string; night: number; title: string; en: string; lines: NightLine[]; choice?: string; choiceEn?: string }
export interface StoryTableConfig { id: string; buyIn: number; smallBlind: number; bigBlind: number; hands: number; npcs: CharacterId[]; location: StoryLocation; returnTo: string; practice?: boolean }
export type StoryLocation = 'garage' | 'old' | 'new' | 'phone';
export const STORY_TABLES: Record<string, StoryTableConfig> = {
  ...VOLUME_TWO_TABLES,
  'v-mo':{id:'v-mo',buyIn:100,smallBlind:1,bigBlind:2,hands:4,npcs:['calling-station'],location:'old',returnTo:'v-mo-result',practice:true},
  'v-four':{id:'v-four',buyIn:100,smallBlind:1,bigBlind:2,hands:6,npcs:['hunter','maniac','calling-station'],location:'old',returnTo:'v-rest',practice:true},
  'v-duel':{id:'v-duel',buyIn:100,smallBlind:1,bigBlind:2,hands:6,npcs:['hunter'],location:'old',returnTo:'v-duel-result',practice:true},
  'v-new':{id:'v-new',buyIn:300,smallBlind:2,bigBlind:5,hands:8,npcs:['maniac','value-bettor','trapper'],location:'new',returnTo:'v-new-result'},
  'v-old':{id:'v-old',buyIn:100,smallBlind:1,bigBlind:2,hands:6,npcs:['calling-station','small-ball'],location:'old',returnTo:'v-box'},
  'v-garage':{id:'v-garage',buyIn:50,smallBlind:1,bigBlind:2,hands:4,npcs:['maniac'],location:'garage',returnTo:'v-kai-close'},
  'v-room':{id:'v-room',buyIn:100,smallBlind:1,bigBlind:2,hands:6,npcs:['calling-station','value-bettor','rock'],location:'old',returnTo:'v-lin-message'},
  'v-lin':{id:'v-lin',buyIn:50,smallBlind:1,bigBlind:2,hands:4,npcs:['hunter','small-ball'],location:'old',returnTo:'v-cheng-finish'},
  garage: { id: 'garage', buyIn: 50, smallBlind:1, bigBlind:2, hands: 4, npcs: ['maniac'], location: 'garage', returnTo: 'n3-close' },
  room: { id: 'room', buyIn: 100, smallBlind:1, bigBlind:2, hands: 6, npcs: ['calling-station', 'value-bettor', 'rock'], location: 'old', returnTo: 'n4-next' },
  lin: { id: 'lin', buyIn: 50, smallBlind:1, bigBlind:2, hands: 4, npcs: ['hunter', 'small-ball'], location: 'old', returnTo: 'n5-next' },
};
export interface StoryState {
  edition?: 2; format: 1; scene: string; cursor: number; revision: number; phase: 'scene' | 'playing' | 'settled' | 'complete';
  wallet: number; ledger: StoryMoney[]; facts: StoryFact[]; history: StoryHistory[];
  flags: Record<string, boolean>; visited: string[]; activeTable: string | null; atTableStart: boolean;
  results: { id: string; night: number; hands: number; closing: number; net: number; reason: string }[];
  source: { route: 'new' | 'old'; questioned: boolean; askedMo: boolean; net: number | null; wallet: number };
}
export interface StoryChoice {
  id: string; text: string; en: string; to?: string; set?: Record<string, boolean>;
  fact?: StoryFact; table?: string; payment?: 'kai-installment'; end?: boolean;
}
export interface StoryNode {
  night: number; title: string; en: string; task: string; taskEn: string; location: StoryLocation;
  lines: NightLine[]; choices: StoryChoice[];
}
export interface StoryView {
  edition?: 2; phase: StoryState['phase']; scene: string; revision: number; night: number; title: string; titleEn: string;
  line: NightLine | null; cursor: number; lineCount: number; location: StoryLocation; wallet: number;
  task: string; taskEn: string; goal: string; goalEn: string;
  choices: { id: string; text: string; en: string; enabled: boolean; reason: string; reasonEn: string; terms?: StoryTableConfig }[];
  ledger: StoryMoney[]; facts: StoryFact[]; history: StoryHistory[];
  chapters: { night: number; title: string; en: string; status: 'current' | 'visited' | 'locked' }[];
  relationships: { name: string; text: string; en: string }[];
  table: StoryTableConfig | null; atTableStart: boolean; results: StoryState['results'];
}
export const currentStoryNode = (state: StoryState): StoryNode => state.edition === 2
  ? state.scene.startsWith('w-') ? volumeTwoNode(state) : volumeNode(state)
  : storyNode(state);
const TITLES = [
  { night: 1, title: '二楼，门开着', en: 'The door is open' },
  { night: 2, title: '赴约之后', en: 'After the invitation' },
  { night: 3, title: '卷帘门下面', en: 'Under the shutter' },
  { night: 4, title: '谁付的电费', en: 'Who pays for the lights' },
  { night: 5, title: '少掉的那一页', en: 'The missing page' },
  { night: 6, title: '最后怎么坐', en: 'Where we sit now' },
];
function enter(state: StoryState, id: string): void {
  state.scene = id; state.cursor = 0; state.phase = 'scene';
  const node = currentStoryNode(state);
  state.visited.push(id);
  state.history.push({ scene: id, night: node.night, title: node.title, en: node.en, lines: node.lines.slice(0,1) });
}
export function startStory(second: SecondNightState): StoryState {
  if (second.phase !== 'complete' || !second.route || !Number.isSafeInteger(second.wallet) || second.wallet < 0
    || second.ledger.reduce((n,e)=>n+e.delta,0)!==second.wallet) throw new Error('Second Night must be settled');
  let balance=0;
  for(const entry of second.ledger){
    balance+=entry.delta;
    if(!Number.isSafeInteger(entry.delta)||balance<0||entry.balance!==balance)throw new Error('Invalid opening ledger');
  }
  const state: StoryState = { format:1,scene:'n3-door',cursor:0,revision:0,phase:'scene',wallet:second.wallet,
    ledger:second.ledger.map(e=>({...e,id:'second:'+e.id})),
    facts:second.facts.map((f,i)=>({id:'second:'+i,source:f.who,text:f.text,en:f.en})),
    history:[{scene:'second-night-ending',night:2,title:'第二夜 · 散场',en:'Second Night · Before leaving',
      lines:structuredClone(second.lastLines),choice:second.questioned?'当时追问了那句话':'当时先没有追问',choiceEn:second.questioned?'Asked about it that night':'Left the question for later'}],
    flags:{},visited:[],activeTable:null,atTableStart:false,results:[],
    source:{route:second.route,questioned:second.questioned,askedMo:second.askedMo,net:second.result?.net??null,wallet:second.wallet} };
  enter(state,'n3-door'); return state;
}
export function storyView(state: StoryState): StoryView {
  const node=currentStoryNode(state), last=state.cursor>=node.lines.length-1;
  const table=state.activeTable?STORY_TABLES[state.activeTable]!:null;
  const complete=state.phase==='complete';
  const sequel=state.edition===2 && state.scene.startsWith('w-');
  const choices=state.phase==='settled' ? [{id:'collect',text:'收好，接着说',en:'Put it away and carry on'}]
    : state.phase==='scene'&&last?node.choices:[];
  return {
    ...(state.edition===2?{edition:2 as const}:{}),phase:state.phase,scene:state.scene,revision:state.revision,night:node.night,title:node.title,titleEn:node.en,
    line:state.phase==='scene'||complete?node.lines[state.cursor]??null:null,cursor:state.cursor,lineCount:node.lines.length,
    location:table?.location??node.location,wallet:state.wallet,
    task:state.phase==='playing'?'打完这一桌，或在结算后离桌':state.phase==='settled'?'收好这桌的筹码':node.task,
    taskEn:state.phase==='playing'?'Play this table, or leave after a settled hand':state.phase==='settled'?'Take your chips off the table':node.taskEn,
    goal:sequel?(complete?'这一卷已经结束，去留和损失都留在记录里。':'决定旧牌室搬走以后，自己还愿意坐在哪张桌边。'):state.edition===2&&!state.flags['kai-known']?(node.night===1?'认识这一桌人，想停就停':'决定是否赴约，入桌前问清条件'):complete?'这一段已经结束。你的选择与账目都留着。':state.flags['mo-known']?'决定这些关系以后怎么办':'核对阿凯那笔减账是怎么来的',
    goalEn:sequel?(complete?'This volume is complete. Your decisions and losses are recorded.':'Decide where you want to sit after the old room closes.'):state.edition===2&&!state.flags['kai-known']?'Meet the people and decide whether to play':complete?'This part is over. Your choices and accounts are kept.':state.flags['mo-known']?'Decide what to do with these relationships':'Find out why Kai’s debt was reduced',
    choices:choices.map(c=>{const cost='table'in c&&c.table&&!STORY_TABLES[c.table]!.practice?STORY_TABLES[c.table]!.buyIn:0;return{
      id:c.id,text:c.text,en:c.en,enabled:state.wallet>=cost,reason:state.wallet<cost?'手头金额不足，可以不打，继续交谈':'',
      reasonEn:state.wallet<cost?'Not enough money. You can keep talking without playing.':'',
      ...('table'in c&&c.table?{terms:{...STORY_TABLES[c.table]!}}:{})};}),
    ledger:structuredClone(state.ledger),facts:structuredClone(state.facts),history:structuredClone(state.history),
    chapters:(sequel?[...TITLES,...VOLUME_TWO_CHAPTERS]:state.edition===2?TITLES:TITLES.filter(c=>c.night>1)).map(c=>({...c,status:c.night===node.night?'current':state.history.some(h=>h.night===c.night)?'visited':'locked'})),
    relationships:sequel?volumeTwoRelationships(state):state.edition===2?[
      {name:'阿凯',text:state.flags['no-money']?'不建立返款安排 · 不得替你答应邀约':state.flags['kai-paid']?'实收150 · 其余2850尚未兑现':state.flags['money-promise']?'三千承诺尚未兑现':state.flags['kai-known']?(state.source.route==='new'?'已承认引荐交易':'引荐未生效 · 催促与隐瞒已说明'):'刚认识，还没谈过那笔账',en:'See the conversation record'},
      {name:'莫叔',text:state.flags['mo-vouch']?'核对到他曾为南桥那桌作保':state.flags['mo-known']?'已说明800补贴与沉默':'尚未核对其他往来',en:'See the conversation record'},
      {name:'林岚',text:state.flags['lin-original']?'交出相关原始往来':state.flags['lin-cut']?(state.flags['lin-help']?'答应完整核对，后来保留一份':'未作完整交付承诺，选择保留一份'):state.flags['lin-help']?'答应一起完整核对':'尚未请她协助',en:'See the conversation record'},
    ]:[
      {name:'阿凯',text:state.flags['kai-paid']?'承认隐瞒 · 已付 150，余款未付':state.flags['kai-known']?'承认引荐交易 · 关系由你决定':'有一笔账等他说明',
        en:state.flags['kai-paid']?'Admitted it · Paid 150; the rest remains unpaid':state.flags['kai-known']?'Admitted the referral deal · You decide where you stand':'Still owes you an explanation'},
      {name:'莫叔',text:state.flags['mo-known']?'已说明补贴与当时的沉默':'尚未核对他知道多少',en:state.flags['mo-known']?'Explained the subsidy and his silence':'What he knew is still unclear'},
      {name:'林岚',text:state.flags['lin-original']?'交出了原始记录':state.flags['lin-cut']?'承认保留了莫叔那部分':state.flags['lin-help']?'答应帮你核对完整记录':'尚未请她协助核对',
        en:state.flags['lin-original']?'Provided the original record':state.flags['lin-cut']?'Admitted withholding Mo’s part':state.flags['lin-help']?'Promised to check the full record':'You have not asked her to help check the records'},
    ],table,atTableStart:state.atTableStart,results:structuredClone(state.results),
  };
}
export interface StoryInput { operation: 'start' | 'next' | 'choose' | 'leave-table'; revision: number; choice?: string }
/** Only accepted commands change cursor, evidence, money or chapter. */
export function advanceStory(state: StoryState, input: StoryInput): 'stay' | 'open-table' | false {
  if(input.revision!==state.revision)return false;
  if(state.edition===2 && state.phase==='complete' && state.scene.startsWith('v-end-')){
    if(input.operation!=='choose'||input.choice!=='continue-volume-two')return false;
    enter(state,'w-door');state.revision++;return 'stay';
  }
  if(state.phase==='settled' && input.operation==='choose' && input.choice==='retry-table'){
    return retryStoryTable(state);
  }
  if(state.phase==='settled'){
    if(input.operation!=='choose'||input.choice!=='collect'||!state.activeTable)return false;
    const target=STORY_TABLES[state.activeTable]!.returnTo;state.activeTable=null;enter(state,target);state.revision++;return 'stay';
  }
  if(state.phase!=='scene')return false;
  const node=currentStoryNode(state), history=state.history.at(-1)!;
  if(input.operation==='next'){
    if(state.cursor>=node.lines.length-1)return false;
    state.cursor++;history.lines.push(node.lines[state.cursor]!);state.revision++;return 'stay';
  }
  if(input.operation!=='choose'||state.cursor<node.lines.length-1)return false;
  const c=node.choices.find(c=>c.id===input.choice);
  if(!c)return false;
  if(c.table&&(!STORY_TABLES[c.table]!.practice&&state.wallet<STORY_TABLES[c.table]!.buyIn||state.ledger.some(e=>e.id==='buy:'+c.table)))return false;
  if(c.payment&&(state.source.route!=='new'||state.flags['kai-paid']||state.edition===2&&state.flags['no-money']))return false;
  history.choice=c.text;history.choiceEn=c.en;
  if(c.set)Object.assign(state.flags,c.set);
  if(state.edition===2 && c.set?.['wallet-open'] && !state.ledger.length){state.wallet=600;state.source.wallet=600;state.ledger.push({id:'opening',delta:600,balance:600,text:'随身资金',en:'Opening wallet'});}
  if(state.edition===2&&c.table==='v-new')state.source.route='new';
  if(state.edition===2&&c.set?.['asked-mo'])state.source.askedMo=true;
  if(state.edition===2&&c.set?.['questioned'])state.source.questioned=true;
  if(c.fact&&!state.facts.some(f=>f.id===c.fact!.id))state.facts.push({...c.fact});
  if(c.payment){
    state.wallet+=150;state.flags['kai-paid']=true;
    state.ledger.push({id:'kai:installment:1',delta:150,balance:state.wallet,text:'阿凯当面交付的第一笔补偿',en:'Kai’s first cash installment'});
  }
  if(c.table){
    const t=STORY_TABLES[c.table]!;
    if(!t.practice){state.wallet-=t.buyIn;state.ledger.push({id:'buy:'+t.id,delta:-t.buyIn,balance:state.wallet,text:`第 ${node.night} 夜买入`,en:`Night ${node.night} buy-in`});
    }
    state.activeTable=t.id;state.phase='playing';state.atTableStart=true;state.revision++;return 'open-table';
  }
  if(c.to)enter(state,c.to);
  if(c.end)state.phase='complete';
  state.revision++;return 'stay';
}
export function settleStoryTable(state: StoryState, closing: number, hands: number, reason: string): boolean {
  if(state.phase!=='playing'||!state.activeTable)return false;
  const t=STORY_TABLES[state.activeTable]!;
  if(!Number.isSafeInteger(closing)||closing<0||closing>t.buyIn*(t.npcs.length+1)||!Number.isSafeInteger(hands)||hands<1
    ||state.results.some(r=>r.id===t.id))return false;
  if(!t.practice){state.wallet+=closing;state.ledger.push({id:'cash:'+t.id,delta:closing,balance:state.wallet,text:`第 ${currentStoryNode(state).night} 夜离桌回收`,en:`Night ${currentStoryNode(state).night} cash-out`});
  }
  if(state.edition===2 && t.id==='v-new'){state.source.net=closing-t.buyIn;}
  state.results.push({id:t.id,night:currentStoryNode(state).night,hands,closing,net:closing-t.buyIn,reason});
  state.atTableStart=false;state.phase='settled';state.revision++;return true;
}

/** Explicit rehearsal: undo only the just-settled losing table, never previous choices.
 * The engine's table seed is unchanged. A retry is not a source of money or a reroll.
 * No snapshot is added on normal play, so old story journals keep identical state.
 */
function retryStoryTable(state: StoryState): 'stay' | false {
  if(state.edition!==2 || state.phase!=='settled' || !state.activeTable)return false;
  const table=STORY_TABLES[state.activeTable];
  const result=state.results.at(-1), history=state.history.at(-1);
  if(!table || !result || result.id!==table.id || result.net>=0 || !history || history.scene!==state.scene)return false;
  const choice=currentStoryNode(state).choices.find(c=>c.table===table.id);
  // A retry can only undo a pure table entry, not an unrelated choice or payment.
  if(!choice || choice.set || choice.fact || choice.payment || history.choice!==choice.text)return false;
  if(!table.practice){
    const buy=state.ledger.at(-2),cash=state.ledger.at(-1);
    if(!buy || !cash || buy.id!==`buy:${table.id}` || cash.id!==`cash:${table.id}`
      || buy.delta!==-table.buyIn || cash.delta!==result.closing || cash.balance!==state.wallet)return false;
    const before=buy.balance+table.buyIn;
    if(!Number.isSafeInteger(before) || before<0 || before!==state.wallet-result.net)return false;
    state.ledger.splice(-2,2);
    state.wallet=before;
  }
  state.results.pop();
  if(table.id==='v-new'){state.source.route='old';state.source.net=null;}
  delete history.choice;delete history.choiceEn;
  state.activeTable=null;state.atTableStart=false;state.phase='scene';state.revision++;
  return 'stay';
}

/** Only completed conversations and accepted facts can update the journal. */
function volumeTwoRelationships(state: StoryState): StoryView['relationships'] {
  const seen=(scene:string)=>state.history.some(h=>h.scene===scene&&h.choice!==undefined);
  const fact=(id:string)=>state.facts.some(f=>f.id===id);
  const f=(key:string)=>state.flags[key]===true;
  const unpaid=state.source.route==='new'&&f('money-promise')&&!f('no-money')
    ? `；未付${f('kai-paid')?2850:3000}，本卷没有新到款`
    : f('no-money')?'；没有建立返款安排':'';
  const kai=seen('w-kai-after')?'已谈过这次失约；是否接受修风扇由程墨决定'
    :fact('w-kai-absence')?'承认提前知道不能帮搬，却没有提前说明'
    :fact('w-pickup')?'周日有送货班，不能按他一定会来安排'
    :seen('w-garage')?'这次为取钥匙见面，没有自动恢复旧来往'
    :'这一卷尚未单独见面';
  const mo=seen('w-after-rain')?'旧屋钥匙已交，旧桌已运走'
    :fact('w-table-sale')?'核对到他已出售旧桌；不等于所有人一起迁入南桥'
    :seen('w-room')||seen('w-street')?'旧屋到期不续，正在清物'
    :'还没有谈过这次清物';
  const lin=seen('w-lin-after')?'承认越界，也保留三个月器材储存的交换；关系未自动恢复'
    :f('w-corrected')?(fact('w-lin-deal')?'集体移址说法已更正；她与南桥的交换仍保留':'公开配文已更正；尚未谈她私下的安排')
    :fact('w-lin-deal')?'已说明拍摄换三个月器材储存；集体移址说法未经所有人同意'
    :seen('w-lin-door')?'已承认配文出自自己，尚未说完安排'
    :fact('w-poster')?'看见工作室署名的公开海报，尚未核对她的安排'
    :'这一卷尚未核对她的安排';
  const cheng=seen('w-small-door')?'周六只借两个小时的小间；下一次仍需另约'
    :f('w-broke-cart')&&seen('w-eleven-door')?'这次搬箱承诺落空；下次不再先把你算进去'
    :seen('w-ask-what')?'小间周六七点到九点可用，不是永久的新牌室'
    :seen('w-after-rain')?(f('w-saved-boxes')?'两盒物品送到了小间，相片仍有水损':f('w-box-damaged')?'盒子抢救较晚，相片和记分本有损伤':'自己提前离店抢救物品，少算的工时没有退回')
    :f('w-promised-cart')?'约好周日五点，只帮搬两只蓝胶带盒子'
    :seen('w-cart-no')?'你未承诺搬箱；他另作安排'
    :seen('w-crates')?'要保留两盒私人物品，没有开新牌室'
    :'还没有谈接下来怎么安排';
  return [
    {name:'阿凯',text:kai+unpaid,en:'See the completed conversation and money ledger.'},
    {name:'莫叔',text:mo,en:'See the completed conversation.'},
    {name:'林岚',text:lin,en:'See the completed conversation.'},
    {name:'程墨',text:cheng,en:'See the completed conversation.'},
  ];
}
