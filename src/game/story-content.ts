import type { NightLine } from './first-night.js';
import type { StoryState, StoryNode, StoryChoice, StoryLocation, StoryFact } from './story-campaign.js';

const L=(who:string,text:string,en:string):NightLine=>({who,text,en});
const C=(id:string,text:string,en:string,to:string,extra:Partial<StoryChoice>={}):StoryChoice=>({id,text,en,to,...extra});
const F=(id:string,source:string,text:string,en:string):StoryFact=>({id,source,text,en});
function N(night:number,title:string,en:string,location:StoryLocation,lines:NightLine[],choices:StoryChoice[],task='把眼前这件事说清楚',taskEn='Finish this conversation'):StoryNode{
  const tasks:Record<string,[string,string]>={
    '不是桌上的输赢':['问清阿凯原本能得到什么','Ask what Kai stood to gain'],
    '他没说完的话':['听他说明为什么隐瞒','Hear why he kept it from you'],
    '手机转过来':['核对原消息，保留完整上下文','Check the original messages in context'],
    '口袋里的钱':['决定是否收下第一笔补偿','Decide whether to accept the first installment'],
    '只记这一笔':['记下实收金额与剩余承诺','Record what was paid and what remains'],
    '把门拉下来':['决定是否去找莫叔核对','Decide whether to check with Mo'],
    '没倒出来的水':['问清莫叔知道什么、收过什么','Ask what Mo knew and what he received'],
    '一张缴费单':['对照缴费单和相关转账','Compare the bill and transfers'],
    '照片和记录':['查看林岚实际给出的材料','Look at what Lin actually provided'],
    '少掉的那一页':['问清她保留的部分','Ask about the part she held back'],
    '不再裁掉':['保留原始往来，继续核对','Keep the original exchange and check it'],
  };
  if(task==='把眼前这件事说清楚'&&tasks[title]) [task,taskEn]=tasks[title]!;
  return {night,title,en,location,lines,choices,task,taskEn};
}
/** Authored scenes. No node may assume evidence or a promise the player did not witness. */
export function storyNode(s:StoryState):StoryNode{
  const attended=s.source.route==='new', lost=(s.source.net??0)<0;
  const installment=attended?(s.flags['kai-paid']?2850:3000):0;
  const kaiFact=F('kai-deal','阿凯当面说明',attended?'阿凯承认：带你入座换取三千减账，与牌局输赢无关。':'阿凯承认答应带新人换三千减账；你没有赴约，这笔减免未生效。',
    attended?'Kai admitted that bringing you earned a 3,000 debt reduction, regardless of the poker result.':'Kai agreed to bring a newcomer for a 3,000 debt reduction. Your declined visit earned him nothing.');
  switch(s.scene){
    case 'n3-door':return N(3,'卷帘门下面','Under the shutter','garage',[
      L('','卷帘门只拉下来一半。阿凯蹲在一辆车旁，听见脚步，往外看了一眼。','The shutter is halfway down. Kai crouches by a car and looks up at your footsteps.'),
      L('阿凯','从边上进，别碰那块板。刚喷的。','Come around the side. Don’t touch that panel. Fresh paint.'),
      L('','他找了块干净点的布，擦掉手上的油。布揉到一半，停了。','He finds a cleaner rag and wipes his hands. Halfway through folding it, he stops.'),
      L('你',s.source.questioned?'你说见面说。现在能说了？':'那晚有句话，我一直没问你。',s.source.questioned?'You said we’d talk in person. Can we talk now?':'There’s something from that night I haven’t asked you.'),
      L('阿凯','……你坐。椅子上那个盒子挪一下就行。','…Sit down. Just move that box off the chair.'),
    ],[C('ask','把第二夜那句话提出来','Bring up what happened on Second Night','n3-question')],'找阿凯问那笔账','Ask Kai about the debt');
    case 'n3-question':return N(3,'不是桌上的输赢','Away from the cards','garage',[
      L('你',attended?'韩烈说给你划掉的，是哪笔？':'“你没来，这次就不算了。”你原本想发给谁？',attended?'What debt was Han going to cross off?':'“You didn’t come, so it doesn’t count.” Who was that meant for?'),
      L('阿凯',attended?(lost?'我没让他们动你的牌。你输的那几手——':'你那晚打得也不差，我真觉得你能打。'):'没发错。我那会儿脑子乱，顺手就给你发了。',
        attended?(lost?'I didn’t have them fix your cards. The hands you lost—':'You played fine that night. I really thought you could handle it.'):'It was meant for you. I wasn’t thinking straight when I sent it.'),
      L('你',attended?'我问的是你的账。':'我没去，你那边少了什么？',attended?'I’m asking about your debt.':'What did you lose by me not coming?'),
      L('','修车架上有水滴下来。他把接水的盆往里踢了一点。','Water drips from the lift. He nudges the catch tray farther underneath.'),
      L('阿凯','韩烈说，带个没去过的人来，旧账给我减三千。','Han said if I brought someone who hadn’t played there before, he’d take three thousand off my debt.'),
      L('你','我输不输都算？','Whether I won or lost?'),
      L('阿凯',attended?'坐下就算。你坐下了。':'坐下就算。你没来，那天就没给我减。',attended?'Sitting down was enough. And you sat down.':'Sitting down was enough. You didn’t come, so he didn’t reduce it.'),
    ],[
      C('record','“把你们说好的那段给我看。”','“Show me what you agreed.”','n3-record',{set:{'kai-known':true},fact:kaiFact}),
      C('explain','“为什么不提前跟我说？”','“Why didn’t you tell me first?”','n3-explain',{set:{'kai-known':true},fact:kaiFact}),
    ]);
    case 'n3-explain':return N(3,'他没说完的话','What he left out','garage',[
      L('阿凯','第一回叫你来，我没想过这个。那时候真就是差个人。','The first time I invited you, none of this was in my head. We really were one player short.'),
      L('你','后来呢？','And later?'),
      L('阿凯','后来我知道能减账。想着……告诉你，你肯定不来了。','Later I knew about the reduction. I thought… if I told you, you wouldn’t come.'),
      L('','这次他没接着往下说。门外有人喊他取车，他说等五分钟。','This time he leaves it there. Someone outside asks for their car. He tells them five minutes.'),
    ],[C('record','“所以更该让我自己决定。记录呢？”','“That was my decision to make. Where’s the record?”','n3-record')]);
    case 'n3-record':return N(3,'手机转过来','He turns the phone around','garage',[
      L('','他把手机解锁，往上翻了很久。屏幕终于转向你，拇指还搭在边框上。','He unlocks his phone and scrolls for a while. When he turns it toward you, his thumb stays against the edge.'),
      L('阿凯 · 记录',attended?'“新客已入座，减免三千。”下面是阿凯回的：“收到。”':'“人没来，减免不做。”阿凯回了一个“好”。',
        attended?'“New player seated. Deduct three thousand.” Below it, Kai replied: “Received.”':'“Player did not come. No deduction.” Kai replied: “Okay.”'),
      L('你','前面那句也留着。别只截结果。','Keep the earlier message too. Don’t crop it to just the result.'),
      L('阿凯','行。我发原来的。','Okay. I’ll send the original.'),
    ],[C('keep','留下一份完整记录','Keep the complete exchange',attended?'n3-money':'n3-table',{set:{'kai-known':true,'kai-record':true},fact:F('kai-record','阿凯出示的原消息',attended?'已看到约定与“新客已入座，减免三千”的原消息。':'已看到约定与“人没来，减免不做”的原消息。',
      attended?'Saw the original agreement and the message confirming a 3,000 deduction.':'Saw the original agreement and the message cancelling the deduction.')})]);
    case 'n3-money':return N(3,'口袋里的钱','What is in his pocket','garage',[
      L('','阿凯从工作服里掏出一叠钱，数了两遍。','Kai takes some notes from his work jacket and counts them twice.'),
      L('阿凯','一百五。现在就这么多。剩下的我慢慢补。','A hundred and fifty. That’s what I have right now. I’ll make up the rest.'),
      L('你','你减掉的是三千。','You got three thousand taken off.'),
      L('阿凯','我知道。这个先给你，别当我已经还完。','I know. Take this first. It doesn’t mean I’ve paid it all.'),
    ],[
      C('take','收下 150，记作第一笔；继续核对','Take 150 as a first installment; keep checking','n3-paid',{payment:'kai-installment'}),
      C('refuse','“钱先放着。事情还没说完。”','“Keep it for now. We’re not finished talking.”','n3-table'),
    ]);
    case 'n3-paid':return N(3,'只记这一笔','Only this installment','garage',[
      L('','你把一百五收好。阿凯拿起手机，敲了几下，又递给你看。','You put away the hundred and fifty. Kai types on his phone and shows you.'),
      L('阿凯 · 记录','“三千，先付一百五，还差二千八百五。”这样写？','“Three thousand. Paid one hundred and fifty. Two thousand eight hundred and fifty left.” Like that?'),
      L('你','金额对。别加“这事算了”。','The numbers are right. Don’t add “we’re even.”'),
      L('阿凯','没加。','I didn’t.'),
    ],[C('put-away','把这条也留着','Keep that message too','n3-table',{fact:F('installment','阿凯当面交付与消息','已收到现金 150。阿凯承诺的其余 2850 尚未收到。','Received 150 in cash. The remaining 2,850 Kai promised has not been paid.')})]);
    case 'n3-table':return N(3,'店里快收了','Almost closing','garage',[
      L('','阿凯把一张折叠桌上的零件移进盒子，摸到下面一副牌，又放回去。','Kai clears some parts off a folding table, finds a deck underneath and puts it back.'),
      L('阿凯','还坐会儿吗？五十，最多四手。你不想打就算。','Staying a while? Fifty each, four hands at most. Fine if you don’t feel like it.'),
      L('','门外那人又喊了一声。这回他起身把车钥匙拿了出去。','The customer calls again. This time Kai gets up to hand over the keys.'),
    ],[
      {id:'play',text:'买入 50，和阿凯打几手',en:'Buy in for 50 and play Kai',table:'garage'},
      C('skip','不买入，等他交完车就走','Keep your money and wait for him to finish','n3-close'),
    ],'决定要不要再坐一会儿','Decide whether to stay for a few hands');
    case 'n3-close':return N(3,'把门拉下来','Pulling down the shutter','garage',[
      L('',s.results.some(r=>r.id==='garage')?'桌上的钱已经数清。阿凯把折叠桌推回墙边。':'他把牌和零件盒一起收好，没再问你打不打。',
        s.results.some(r=>r.id==='garage')?'The table money is counted. Kai folds the table against the wall.':'He puts away the cards with the parts box and does not ask again.'),
      L('阿凯','莫叔知道那边怎么招人。钱多少，我没跟他说。','Mo knows how that room gets new players. I didn’t tell him the amount.'),
      L('你','这句话，我会去问他。','I’m going to ask him about that.'),
      L('阿凯','……嗯。','…Yeah.'),
    ],[
      C('mo','下一晚，去莫叔的牌室','Go to Mo’s the next evening','n4-door',{fact:F('kai-mo','阿凯的说法，待向莫叔核对','阿凯称莫叔知道新牌室如何招人，但不知道减账金额。','Kai says Mo knew the referral practice, but not the amount. This still needs checking with Mo.')}),
      C('leave','先不追了，结束这段来往','Stop here and leave these relationships behind','end-leave'),
    ]);
    case 'n4-door':return N(4,'水刚烧开','The kettle has just boiled','old',[
      L('','二楼的灯还亮着。莫叔在洗杯子，看见你，把水开小了一点。','The upstairs light is on. Mo is washing cups. When he sees you, he turns down the tap.'),
      L('莫叔','阿凯找过你了？','Kai talked to you?'),
      L('你',s.flags['kai-record']?'我看了他和韩烈的消息。':'他跟我说了三千那件事。',s.flags['kai-record']?'I saw his messages with Han.':'He told me about the three thousand.'),
      L('莫叔','先坐。水马上好。','Sit down. Water’s nearly ready.'),
      L('你',s.source.askedMo?'上回我问你，你让我去问阿凯。你自己知道多少？':'他让我问你，那边是怎么招人的。',s.source.askedMo?'Last time you told me to ask Kai. What did you know yourself?':'He said I should ask you how that room gets its players.'),
    ],[C('ask','等他回答，不岔开话题','Wait for his answer','n4-explain')],'问莫叔当时知道什么','Ask what Mo knew');
    case 'n4-explain':return N(4,'没倒出来的水','The water he hasn’t poured','old',[
      L('','水壶跳了。莫叔拔掉插头，手却还握着壶柄。','The kettle clicks off. Mo unplugs it but keeps his hand around the handle.'),
      L('莫叔','带新面孔过去，能给带人的人减账。这我知道。','Bring a new face over, and the person bringing them can get a debt reduction. I knew that.'),
      L('你','知道为什么不说？','Why didn’t you say so?'),
      L('莫叔','我想着，你要去总归自己会问。','I thought you’d ask for yourself if you went.'),
      L('你','我问的是打多大。你们拿我这趟算什么，我怎么问？','I asked about the stakes. How was I meant to ask what you were getting out of me coming?'),
      L('','他把壶放回底座。杯子还是空的。','He puts the kettle back on its base. The cup is still empty.'),
      L('莫叔','这屋每个月还差八百。韩烈给我填着。我不想跟那边闹翻。','This room comes up eight hundred short every month. Han covers it. I didn’t want to fall out with him.'),
      L('莫叔','你第一回来的时候，阿凯那笔还没谈。后来知道你要去，我没把话说清。','Kai’s deal wasn’t arranged the first night you came. Later, when I knew where you were going, I kept quiet.'),
    ],[
      C('see','“这八百，能让我看看吗？”','“Can I see the record of that eight hundred?”','n4-bill',{set:{'mo-known':true},fact:F('mo-said','莫叔当面说明','莫叔承认知道引荐惯例，并因每月 800 的场地补贴选择沉默；他说第一夜尚无阿凯这笔交易。','Mo admitted knowing the referral practice and keeping quiet because of an 800 monthly room subsidy. He said Kai’s deal had not existed on First Night.')}),
      C('enough','“我先记下你说的。”','“I’ll keep what you’ve said for now.”','n4-table',{set:{'mo-known':true},fact:F('mo-said','莫叔当面说明','莫叔自述每月接受韩烈 800 场地补贴，知道带新人减账的惯例。尚未查看凭据。','Mo said Han pays an 800 monthly room subsidy and that he knew about referral debt reductions. No document checked yet.')}),
    ]);
    case 'n4-bill':return N(4,'一张缴费单','A utility bill','old',[
      L('','莫叔翻出缴费单，又打开手机里的转账。两笔日期差了一天。','Mo finds a utility bill and opens the transfer record on his phone. The dates are a day apart.'),
      L('莫叔','这笔，八百。不是从你们那晚输的钱里扣的。上个月也有。','This one. Eight hundred. It wasn’t taken from what you lost that night. There’s one from last month too.'),
      L('你','我问的是你收了谁的钱，不是让你替他算清白。','I asked whose money you took. I didn’t ask you to clear him.'),
      L('','莫叔把手机放在桌上。这回没有扣过去。','Mo lays the phone on the table. This time, face up.'),
    ],[C('copy','经他同意，留一份这两笔的记录','With his agreement, keep the two entries','n4-table',{fact:F('mo-bill','莫叔出示的缴费单与转账','核对到韩烈向莫叔支付的每月 800 补贴；只保留相关两笔记录。','Checked the 800 subsidy from Han to Mo against the bill and transfers. Kept only the relevant two entries.')})]);
    case 'n4-table':return N(4,'人还会来','People still come','old',[
      L('','楼下响起脚步。老周拎着一袋橘子进来，放到窗台边。韩烈跟在后面。','Footsteps on the stairs. Zhou puts a bag of tangerines on the sill. Han comes in behind him.'),
      L('老周','还开不开？不开我就回去了。','Are we playing? If not, I’ll head home.'),
      L('莫叔','开。你们要坐就坐。','We are. Sit if you want.'),
      L('','莫叔伸手去拿牌，看了你一眼，又等着。','Mo reaches for the deck, glances at you and waits.'),
    ],[
      {id:'play',text:'买入 100，照常打一桌',en:'Buy in for 100 and play',table:'room'},
      C('watch','不买入，坐到他们收桌','Keep your money and stay until they finish','n4-next'),
    ],'决定今晚是否入桌','Decide whether to buy in tonight');
    case 'n4-next':return N(4,'楼梯口的消息','A message at the stairs','old',[
      L('',s.results.some(r=>r.id==='room')?'本桌已经按实际筹码结清。你拿起外套，走到楼梯口。':'你拿起外套。老周剥了个橘子，问你要不要，你摇摇头。',
        s.results.some(r=>r.id==='room')?'The table is settled. You take your coat and step toward the stairs.':'You pick up your coat. Zhou offers you a tangerine. You shake your head.'),
      L('','手机里有林岚发来的照片，是上回大家围着桌子的那张。她问要不要原图。','Lin has sent a photo from the last gathering. She asks whether you want the original.'),
    ],[
      C('help','顺便请林岚帮忙核对完整记录','Ask Lin to help check the complete records','n5-door',{set:{'lin-help':true}}),
      C('alone','照片先收下，账自己去核对','Keep the photo; check the accounts yourself','n5-door'),
    ],'决定要不要请林岚帮忙','Decide whether to ask Lin for help');
    case 'n5-door':return N(5,'照片和记录','The photo and the records','old',s.flags['lin-help']?[
      L('林岚 · 消息','行。阿凯那笔和这屋的往来，我一起核对，能拿到的原记录都给你。','Okay. I’ll check Kai’s deal and the room’s payments. I’ll send you all the original records I can get.'),
      L('','见面时，林岚把相机包放到空椅子上，递来手机。只有阿凯那一笔。','When you meet, Lin puts her camera bag on a spare chair and hands you her phone. Only Kai’s entry is there.'),
      L('你','这份怎么只剩阿凯？','Why is Kai’s the only part here?'),
      L('林岚','那一笔够你跟他谈。','That entry is enough to talk to him.'),
    ]:[
      L('','你在牌室等韩烈。林岚进来取相机包，看见你手机上阿凯的消息。','You wait for Han at the card room. Lin comes to collect her camera bag and sees Kai’s messages on your phone.'),
      L('林岚','莫叔说你在核对那笔账。那几份我也看过。','Mo said you’re checking the accounts. I’ve seen those records too.'),
      L('你','你那里有完整的？','Do you have the complete set?'),
      L('林岚','有。我只想给你阿凯那部分。','Yes. I only want to give you Kai’s part.'),
    ],[C('ask','“莫叔那部分，你看过了？”','“You’ve seen Mo’s part?”','n5-cut')],'看看记录里少了什么','See what is missing from the record');
    case 'n5-cut':return N(5,'少掉的那一页','The missing page','old',[
      L('林岚','看过。','I have.'),
      L('你',s.flags['lin-help']?'你说能拿到的原记录都给我。':'所以不是没找到，是不愿意给。',s.flags['lin-help']?'You said you’d send every original record you could get.':'So you found it. You just don’t want to give it to me.'),
      L('','林岚把相机带绕了两圈，松开，放下。','Lin winds the camera strap twice around her hand, then lets it go.'),
      L('林岚','我很早就来这儿。那会儿没人约我，莫叔每次都给我留位置。','I’ve been coming here a long time. Back then nobody invited me. Mo always kept a seat for me.'),
      L('林岚','这屋散了，我也没有别的地方能这样坐着。','If this room goes, I don’t have another place like it.'),
      L('你',s.flags['lin-help']?'你可以不答应帮我。答应了，不能替我挑哪部分该知道。':'那你直接说不愿意。别说只有这一份。',s.flags['lin-help']?'You could have said no. You agreed to help. You don’t get to choose which parts I should know.':'Then say you don’t want to. Don’t tell me this is all there is.'),
    ],[
      C('original','请她把原始往来一起交出来','Ask for the original exchange','n5-original',{set:{'lin-cut':true}}),
      C('han','不用她转交，直接找韩烈核对','Check with Han directly','n5-han',{set:{'lin-cut':true}}),
    ]);
    case 'n5-original':return N(5,'不再裁掉','No more cropping','old',[
      L('','林岚点开原消息，停在发送键上。过了一会儿，你的手机响了。','Lin opens the original exchange. Her finger rests above Send. After a while, your phone chimes.'),
      L('林岚','都在了。你先看，哪儿对不上再问。','It’s all there now. Read it. Ask me if something doesn’t match.'),
      L('你','我会自己核对。','I will check it myself.'),
      L('林岚','嗯。','Okay.'),
    ],[C('keep','收下原始记录','Keep the original records','n5-table',{set:{'lin-original':true},fact:F('lin-original','林岚提供的原始往来','收到含阿凯引荐与莫叔补贴部分的原始往来；林岚承认此前保留了后者。','Received the original exchange covering Kai’s referral and Mo’s subsidy. Lin acknowledged withholding the latter.')})]);
    case 'n5-han':return hanRecord(s,'n5-table');
    case 'n6-record':return hanRecord(s,'n6-choice');
    case 'n5-table':return N(5,'程墨洗好了牌','Cheng has shuffled','old',[
      L('','程墨在另一边洗牌，洗了两遍。见你们停下来，才问。','Cheng shuffles at the other end of the table. Twice. Only when you stop talking does he ask.'),
      L('程墨','还打吗？我就待四手，明天早班。','Playing? I can stay for four hands. Early shift tomorrow.'),
      L('林岚','你自己说。','Your call.'),
    ],[
      {id:'play',text:'买入 50，和林岚、程墨打几手',en:'Buy in for 50 with Lin and Cheng',table:'lin'},
      C('skip','今晚不打，把记录收好','Skip the game and put away the records','n5-next'),
    ],'决定要不要入桌','Decide whether to sit down');
    case 'n5-next':return N(5,'放回口袋之前','Before putting the phone away','old',[
      L('','你把几份记录按日期排好，原消息也留在旁边。桌角那杯水早凉了。','You sort the records by date, keeping the original messages beside them. The water at the corner of the table has gone cold.'),
      L('','莫叔从里面出来，问明晚要不要留门。你让他先别关。','Mo comes out and asks whether to leave the door open tomorrow. You tell him to keep it open.'),
    ],[C('next','下一晚，把剩下的话说完','Return tomorrow to finish the conversation','n6-choice')],'想清楚接下来要怎么处理','Decide what to do next');
    case 'n6-choice':return N(6,'最后怎么坐','Where we sit now','old',[
      L('','桌上没有发牌。莫叔放了四个杯子，阿凯坐得离门最近。','No cards have been dealt. Mo sets out four cups. Kai sits closest to the door.'),
      L('阿凯',attended?(s.flags['kai-paid']?'还差二千八百五。我没忘。':'那三千，我还没拿出来。'):'那笔没有减。我跟韩烈的约定，消息里有。',attended?(s.flags['kai-paid']?'Two thousand eight hundred and fifty left. I haven’t forgotten.':'I haven’t come up with the three thousand yet.'):'The deduction never happened. My agreement with Han is in the messages.'),
      L('莫叔','你想先说哪件？','What do you want to start with?'),
    ],[
      ...(!s.flags['han-checked']?[C('verify','先请韩烈核对相关两笔记录','Ask Han to verify the relevant entries first','n6-record')]:[]),
      C('account','把记录放到桌上，当面一起对账','Put the records on the table and account for them together','end-account'),
      C('personal','只谈自己的往来，然后离开','Settle your own arrangements, then leave','end-personal'),
      C('leave','该问的已经问了，不再坐这张桌','Leave this table behind','end-leave'),
    ],'决定以后怎样与他们来往','Decide where these relationships go');
    case 'end-account':return N(6,'灯还亮着','The light is still on','old',[
      L('','你把自己保留的记录放到桌上。没有的部分，就当着他们的面问。','You lay out the records you kept. For the missing parts, you ask them face to face.'),
      L('莫叔','那八百，是我收的。知道带人能减账，还没告诉你，也是我。','I took the eight hundred. I knew about the referral reductions and didn’t tell you. That was me too.'),
      L('阿凯',attended?'我拿你入座这件事，给自己减了三千。没提前说。':'我答应过带你来换三千减账。你没来，没有减。我没有提前告诉你那个约定。',attended?'I used you sitting down to get three thousand off my debt. I didn’t tell you first.':'I agreed to bring you for a three-thousand reduction. You didn’t come, so it wasn’t applied. I never told you about the agreement.'),
      L('林岚',s.flags['lin-help']?'我答应把完整的给你。后来想护着莫叔，少给了一部分。':'我看过完整的记录，也说过不想把莫叔那部分给你。',s.flags['lin-help']?'I promised you the full set. Then I held some back to protect Mo.':'I saw the full set and told you I didn’t want to give you Mo’s part.'),
      L('','韩烈听完，说往后这屋的八百他不出了。莫叔点点头，把下周那张约局纸取了下来。','After listening, Han says he will stop the eight-hundred subsidy. Mo nods and takes down next week’s game notice.'),
      L('莫叔','下周先不开。我把这边的数算算。','No game next week. I need to work out the costs.'),
      L('',attended?`阿凯把还没补上的 ${installment} 写在纸边。写到日期时，停住了。`:'那份没有生效的约定也摊在桌上。阿凯一直没碰面前那杯水。',
        attended?`Kai writes the unpaid ${installment} at the edge of the paper. He stops when he gets to the date.`:'The agreement that never took effect lies on the table too. Kai has not touched the water in front of him.'),
    ],[{id:'finish',text:'记下这一晚，结束这段故事',en:'Keep this night in the record and finish',end:true}],'把各自承担的事记清楚','Keep a clear account of who did what');
    case 'end-personal':return N(6,'各自的数','Each person’s account','old',[
      L('你',attended?'阿凯，剩下的钱按实际给的记。没给的就留着。':'我没赴约，不收一笔没发生过的补偿。但以后别再替我答应。',attended?'Kai, we record what you actually pay. Anything unpaid stays unpaid.':'I didn’t attend. I won’t take compensation for something that didn’t happen. Don’t agree on my behalf again.'),
      L('阿凯','行。','Okay.'),
      L('','莫叔把外套递给你。你接过来，没有再坐下。','Mo hands you your coat. You take it and do not sit down again.'),
      L('林岚','照片我还是发原图。你要不要回，都随你。','I’ll still send the original photo. Reply if you want to.'),
      L('','楼下的店已经关门。手机亮了一下，你走到路口才看。','The shops downstairs are shut. Your phone lights up. You wait until the corner to look.'),
    ],[{id:'finish',text:'带着自己的记录离开',en:'Leave with your own record',end:true}],'保留实际金额与尚未兑现的约定','Keep the actual balance and outstanding promises');
    case 'end-leave':return N(s.flags['mo-known']?6:3,'不再上楼','Not going upstairs again',s.flags['mo-known']?'old':'garage',[
      L('你','以后约局，先不用叫我了。','Leave me out of the next game.'),
      L('阿凯','……好。','…Okay.'),
      L('',s.flags['mo-known']?'你把外套拉好，从熟悉的楼梯下去。莫叔没追出来。':'阿凯替你把卷帘门抬高了一点。你弯腰出去，他在后面说了声慢点。',
        s.flags['mo-known']?'You pull on your coat and take the familiar stairs. Mo does not follow.':'Kai lifts the shutter a little higher for you. As you duck under, he tells you to take care.'),
      L('',attended?`还差的 ${installment} 留在最后一条消息里。你把手机锁上，走过路口。`:'你把那几条消息留着，手机放回口袋。走过路口时，它又震了一下。',
        attended?`The unpaid ${installment} remains in the last message. You lock your phone and cross the street.`:'You keep the messages and put the phone in your pocket. As you cross the street, it vibrates once more.'),
    ],[{id:'finish',text:'到这里，先结束',en:'End here',end:true}],'决定暂时不再来往','Choose to step away');
    default:throw new Error('Unknown story scene');
  }
}
function hanRecord(s:StoryState,target:string):StoryNode{
  const attended=s.source.route==='new';
  return N(s.scene==='n6-record'?6:5,'只核对相关的几行','Only the relevant entries','new',[
    L('韩烈','我的账给你看。别人的名字我遮了，不耽误你对这几行。','You can see my record. I covered the other names. You can still check these entries.'),
    L('韩烈 · 记录',attended?'“阿凯：新客到场，旧账减三千，已生效。”':'“阿凯：新客未到，减三千未生效。”',
      attended?'“Kai: newcomer attended; debt reduced by three thousand; applied.”':'“Kai: newcomer did not attend; three-thousand reduction not applied.”'),
    L('韩烈 · 记录','“二楼场地补贴：八百。”月份与莫叔说的一致。','“Upstairs room subsidy: eight hundred.” The month matches Mo’s account.'),
    L('你','你为什么要找没去过的人？','Why do you want people who haven’t played there before?'),
    L('韩烈','熟面孔打久了，谁怎么打都知道。新来的肯坐，我给带他来的人减账。','The regulars know each other’s play. If a newcomer sits down, I reduce the debt of whoever brought them.'),
    L('你','那为什么不让来的人也知道？','Why not tell the newcomer as well?'),
    L('韩烈','我没要求阿凯瞒你。他没说，我也没替他说。','I didn’t tell Kai to hide it. He didn’t tell you, and I didn’t tell you for him.'),
  ],[C('keep','保留这几行，与之前的消息核对','Keep these entries and compare them with the messages',target,{set:{'han-checked':true},
    fact:F('han-record','韩烈本人出示的相关账目',attended?'核对到阿凯三千减账已生效、二楼每月补贴八百；未涉及其他客人资料。':'核对到阿凯引荐减账未生效、二楼每月补贴八百；未涉及其他客人资料。',
      attended?'Verified the applied 3,000 reduction and the 800 room subsidy. No other players’ records were included.':'Verified that the referral deduction was not applied, and the 800 room subsidy. No other players’ records were included.')})],'向记录持有人核对金额','Check the amounts with the record holder');
}
