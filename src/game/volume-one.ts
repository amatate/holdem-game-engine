import type { StoryState, StoryNode, StoryChoice, StoryLocation } from './story-campaign.js';
import type { NightLine } from './first-night.js';
import { VOLUME_TEXT } from './volume-one-text.js';

type Script = { section:string; lines:(s:StoryState)=>NightLine[]; choices:(s:StoryState)=>StoryChoice[]; task?:string };
const scripts:Record<string,Script>={};
const line=(text:string):NightLine=>{
  const m=text.match(/^\*\*([^*]+)：\*\*(.*)$/s);
  return {who:m?.[1]??'',text:(m?.[2]??text).replace(/[“”]/g,(x)=>x),en:m?.[2]??text};
};
const plain=(...texts:string[])=>texts.map(line);
function seg(section:string,...ranges:(number|[number,number])[]):NightLine[]{
  return ranges.flatMap(r=>typeof r==='number'?[r]:Array.from({length:r[1]-r[0]+1},(_,i)=>i+r[0]))
    .map(i=>{const text=VOLUME_TEXT[section]?.blocks[i];if(!text)throw new Error(`Missing ${section}:${i}`);return line(text);});
}
const f=(s:StoryState,key:string)=>s.flags[key]===true;
const attended=(s:StoryState)=>s.source.route==='new';
const hasMoney=(s:StoryState)=>attended(s)&&!f(s,'no-money');
const next=(to:string,text='继续',set?:Record<string,boolean>):StoryChoice=>({id:to,text,en:text,to,...(set?{set}:{})});
const table=(id:string,text:string):StoryChoice=>({id,text,en:text,table:id});
const fact=(c:StoryChoice,id:string,source:string,text:string):StoryChoice=>({...c,fact:{id,source,text,en:text}});
function node(id:string,section:string,lines:NightLine[]|((s:StoryState)=>NightLine[]),choices:StoryChoice[]|((s:StoryState)=>StoryChoice[]),task?:string){
  scripts[id]={section,lines:typeof lines==='function'?lines:()=>lines,choices:typeof choices==='function'?choices:()=>choices,...(task?{task}:{})};
}
const continueTo=(id:string,section:string,lines:NightLine[]|((s:StoryState)=>NightLine[]),to:string)=>node(id,section,lines,[next(to)]);

node('v-door','N1.1',seg('N1.1',[0,8]),[next('v-where','“阿凯去哪了？”'),next('v-beginner','“我可能得问不少。”'),next('v-sit','坐下，看看屋子')]);
continueTo('v-where','N1.1',seg('N1.1',[10,13]),'v-mo');
continueTo('v-beginner','N1.1',seg('N1.1',[15,18]),'v-mo');
continueTo('v-sit','N1.1',seg('N1.1',20,21),'v-mo');
node('v-mo','N1.2',seg('N1.2',[0,4]),[table('v-mo','拿记分筹码，和莫叔打两手'),next('v-arrival','先旁观，等阿凯',{'skip-mo':true})],'先熟悉怎么行动，也可以不打');
continueTo('v-mo-result','N1.2',s=>{const net=s.results.find(r=>r.id==='v-mo')?.net??0;return seg('N1.2',net>0?[7,10]:net<0?[12,13]:[16,17]);},'v-arrival');
continueTo('v-arrival','N1.2',seg('N1.2',[18,23]),'v-four-intro');
node('v-four-intro','N1.3',s=>[...seg('N1.3',0,1),...plain(f(s,'skip-mo')?'**阿凯：**“我朋友。刚来，你少欺负人。”':VOLUME_TEXT['N1.3']!.blocks[2]!),...seg('N1.3',3,4)],[next('v-normal','“正常打，不会的我问。”'),next('v-slow','“会一点，别催我。”')]);
continueTo('v-normal','N1.3',seg('N1.3',[6,9]),'v-four');
continueTo('v-slow','N1.3',seg('N1.3',[11,13]),'v-four');
node('v-four','N1.3',plain('桌上用的是不兑钱的记分筹码。你、阿凯、林岚和莫叔坐好，想停就在一手结算后说。'),[table('v-four','四个人打几手'),next('v-rest','不入桌，陪他们坐会儿')]);
node('v-rest','N1.4',seg('N1.4',[0,3]),[table('v-duel','再和林岚打几手'),next('v-clear','不打，帮忙收桌'),next('v-early','今天先走')]);
continueTo('v-duel-result','N1.4',seg('N1.4',[6,9]),'v-food-offer');
continueTo('v-clear','N1.4',seg('N1.4',[11,13]),'v-food-offer');
continueTo('v-early','N1.4',seg('N1.4',[15,17]),'v-invitation');
node('v-food-offer','N1.4b',seg('N1.4b',[1,3]),[next('v-food','一起下楼'),next('v-photo','不吃了，准备走')]);
node('v-food','N1.4b',seg('N1.4b',4),[next('v-noodles','接一点面'),next('v-water','吃过了，陪他们坐坐')]);
continueTo('v-noodles','N1.4b',[...plain('莫叔要的小碗端来并不小，他找老板另拿一个空碗。'),...seg('N1.4b',[7,10]),...seg('N1.4b',16)],'v-photo');
continueTo('v-water','N1.4b',[...seg('N1.4b',[12,16])],'v-photo');
node('v-photo','N1.5',seg('N1.5',[1,4]),[next('v-photo-yes','一起拍',{'photo':true}),next('v-photo-take','不入镜，帮忙拍',{'photo-taken':true}),next('v-photo-no','不拍，先下楼')]);
continueTo('v-photo-yes','N1.5',seg('N1.5',6,7,14),'v-invitation');
continueTo('v-photo-take','N1.5',seg('N1.5',9,14),'v-invitation');
continueTo('v-photo-no','N1.5',seg('N1.5',[11,14]),'v-invitation');
node('v-invitation','N1.6',seg('N1.6',[0,2]),[next('v-who','都有谁？'),next('v-stakes','打多大？'),next('v-weekend','周六再决定',{'wallet-open':true})]);
continueTo('v-who','N1.6',seg('N1.6',5),'v-invitation-terms');
continueTo('v-stakes','N1.6',seg('N1.6',7),'v-invitation-terms');
node('v-invitation-terms','N1.6',seg('N1.6',[8,10]),[next('v-weekend','到周六再决定',{'wallet-open':true}),next('v-stakes','问清买入和盲注'),next('v-who','问问都有谁')]);
node('v-weekend','N2.1',seg('N2.1',1),[next('v-to-bridge','去南桥，先看条件'),next('v-to-old','不去南桥，回旧牌室'),next('v-not-tonight','今晚都不打')],'手头600，是否入桌由你决定');
continueTo('v-to-bridge','N2.1',seg('N2.1',[3,5]),'v-bridge');
continueTo('v-to-old','N2.1',seg('N2.1',8,9),'v-old-door');
continueTo('v-not-tonight','N2.1',seg('N2.1',[12,16]),'v-missed');
node('v-bridge','N2.2',seg('N2.2',[0,5]),[table('v-new','买入300，盲注2/5，最多8手'),next('v-watch','只看看，不买入'),next('v-bridge-leave','离开，不买入')]);
node('v-bridge-leave','N2.2',seg('N2.2',[19,21]),[next('v-old-door','回旧牌室'),next('v-missed','回家')]);
continueTo('v-watch','N2.2',[...seg('N2.2',[11,16]),...seg('N2.3',[1,4])],'v-missed');
continueTo('v-new-result','N2.3',s=>{const net=s.source.net??0;return [...seg('N2.3',[1,4]),...seg('N2.3',net>0?[8,12]:net<0?14:17)];},'v-stair');
node('v-old-door','N2.4',seg('N2.4',[0,2]),[next('v-old-small','想打小一点'),next('v-old-ask','问阿凯为什么催得急',{'asked-mo':true})]);
continueTo('v-old-small','N2.4',seg('N2.4',4,5),'v-old-table');
continueTo('v-old-ask','N2.4',seg('N2.4',[7,13]),'v-old-table');
node('v-old-table','N2.4',plain('一百买入，一和二的盲注，最多六手。也可以只坐着。'),[table('v-old','买入100，打一桌'),next('v-box','今晚不打')]);
node('v-box','N2.4',seg('N2.4',15,16),[next('v-box-help','帮他捏着盒角',{'helped-cheng':true}),next('v-missed','该走了')]);
continueTo('v-box-help','N2.4',plain('程墨贴完，把胶带往口袋里一塞，认真说了声：“谢谢。”'),'v-missed');
node('v-stair','N2.5',seg('N2.5',[1,4]),[next('v-stair-ask','“他给你划什么？”',{'questioned':true}),next('v-stair-leave','先不问，自己回去')]);
continueTo('v-stair-ask','N2.5',seg('N2.5',[6,10]),'v-shop-offer');
continueTo('v-stair-leave','N2.5',seg('N2.5',13),'v-shop-offer');
node('v-missed','N2.6',seg('N2.6',1,2),[next('v-shop-offer','明晚去店里问'),next('v-end-leave','不再联系',{'left-early':true})]);
node('v-shop-offer','N3.1',seg('N3.1',0,1),s=>[next('v-wait-shop','等他交完车'),next('v-ten-minutes','说明只留十分钟'),...(s.visited.includes('v-bridge')?[next('v-su-before','问苏蔓能否一起听')]:[])]);
continueTo('v-wait-shop','N3.1',seg('N3.1',[3,7]),'v-kai-question');
continueTo('v-ten-minutes','N3.1',seg('N3.1',[9,11]),'v-kai-question');
continueTo('v-su-before','N3.1',plain('苏蔓回复：“今晚不行。那天我只看到你们在桌上，账我不知道。如果需要，我可以把我看到的单独说清。”'),'v-wait-shop');
node('v-kai-question','N3.2',s=>[...seg('N3.2',0),...seg('N3.2',attended(s)?[2,4]:[15,19])],s=>attended(s)?[next('v-kai-amount','直接问金额',{'kai-known':true}),next('v-kai-hide','先问为什么瞒着',{'kai-known':true})]:[fact(next('v-kai-common','听他继续说',{'kai-known':true}),'kai-deal','阿凯当面说明','带新人入座换三千减账；你未入座，此次未生效。')]);
continueTo('v-kai-amount','N3.2',seg('N3.2',6,8,9),'v-kai-common');
continueTo('v-kai-hide','N3.2',[...seg('N3.2',[11,13]),...plain('**阿凯：**“带新人坐下来，给我减三千。你坐下就算，不看输赢。”')],'v-kai-common');
node('v-kai-common','N3.2',seg('N3.2',[21,25]),[fact(next('v-first-question','问第一晚是不是也为了这个'),'kai-deal','阿凯当面说明','入座换三千减账，输赢不影响交易。'),next('v-this-time','先只谈周六')]);
continueTo('v-first-question','N3.3',seg('N3.3',[1,5]),'v-kai-reason');
continueTo('v-this-time','N3.3',seg('N3.3',[7,9]),'v-kai-reason');
continueTo('v-kai-reason','N3.3',s=>[...seg('N3.3',11),...(attended(s)?(s.source.net??0)>0?seg('N3.3',14,15):(s.source.net??0)<0?seg('N3.3',18,19):[]:seg('N3.3',22,23)),...seg('N3.3',25)],'v-record-offer');
node('v-record-offer','N3.4',plain('阿凯把手机放在手边，问你要不要看相关消息。'),[next('v-kai-record','查看相关原消息'),next('v-kai-oral','不看手机，保留他的当面说法')]);
node('v-kai-record','N3.4',s=>[...seg('N3.4',[1,4]),...plain(attended(s)?'记录末尾：韩烈确认三千已减，阿凯回复“收到”。':'记录末尾：“人没来，减免不做。”阿凯回复“好”。'),...seg('N3.4',6,7)],s=>[fact(next(attended(s)?'v-money':'v-garage-offer','保留这段完整记录',{'kai-record':true}),'kai-record','阿凯出示的原消息',attended(s)?'已见到入座减三千的约定及已生效确认。':'已见到约定及未入座、不减账的确认。'),next(attended(s)?'v-money':'v-garage-offer','只看，不留副本')]);
node('v-kai-oral','N3.4',seg('N3.4',10,11),s=>[next(attended(s)?'v-money':'v-garage-offer')]);
node('v-money','N3.5',seg('N3.5',[1,5]),[
  {...next('v-paid','收150，剩余2850仍待兑现',{'money-promise':true}),payment:'kai-installment'},
  next('v-unpaid','暂不收，保留三千承诺',{'money-promise':true}),next('v-no-money','拒绝金钱安排，只要求不替我答应邀约',{'no-money':true})]);
continueTo('v-paid','N3.5',seg('N3.5',[7,11]),'v-garage-offer');
continueTo('v-unpaid','N3.5',seg('N3.5',[14,16]),'v-garage-offer');
continueTo('v-no-money','N3.5',seg('N3.5',[19,22]),'v-garage-offer');
node('v-garage-offer','N3.6',s=>[...(!attended(s)?seg('N3.6',[1,3]):[]),...seg('N3.6',6,7)],[table('v-garage','买入50，最多四手'),next('v-kai-close','不打，等他交完车'),next('v-end-leave','就此不再来往',{'left-garage':true})]);
node('v-kai-close','N3.6',seg('N3.6',11,20,21),[next('v-mo-door','去问莫叔'),next('v-han-first','先找韩烈核对'),next('v-end-leave','不再追，结束来往',{'left-garage':true})]);
continueTo('v-han-first','N4.5',seg('N4.5',[1,8]),'v-han-first-question');
node('v-han-first-question','N4.5',seg('N4.5',[11,15]),[fact(next('v-mo-door','核对过阿凯这一笔，再去问莫叔',{'han-known':true}),'han-deal','韩烈本人核对','韩烈确认入座换减账的约定，金额三千。')]);
node('v-mo-door','N4.1',s=>f(s,'han-known')?seg('N4.1',12,13):seg('N4.1',[1,3]),[next('v-mo-open','请他先说自己知道什么'),next('v-mo-direct','直接说明三千那笔')]);
continueTo('v-mo-open','N4.1',seg('N4.1',5,6),'v-mo-explain');
continueTo('v-mo-direct','N4.1',seg('N4.1',8,9),'v-mo-explain');
node('v-mo-explain','N4.2',s=>[...seg('N4.2',0),...seg('N4.2',s.source.askedMo?[2,5]:7),...seg('N4.2',[8,15])],[fact(next('v-mo-bill','问八百用在哪里',{'mo-known':true}),'mo-said','莫叔当面说明','知道引荐惯例，收韩烈每月800补贴，选择没有说清。'),next('v-mo-company','先记下他的说法',{'mo-known':true})]);
node('v-mo-bill','N4.3',seg('N4.3',[0,6]),[fact(next('v-mo-copy','经同意保留相关两笔',{'mo-bill':true}),'mo-bill','莫叔出示的缴费与转账','核对韩烈向莫叔支付的800月补贴；只留相关两笔。'),next('v-mo-oral','不留副本，只记下说明')]);
continueTo('v-mo-copy','N4.3',seg('N4.3',8,9),'v-mo-company');
continueTo('v-mo-oral','N4.3',seg('N4.3',12,13),'v-mo-company');
node('v-mo-company','N4.4',seg('N4.4',[0,3]),[next('v-zhou-hears','当着老周继续问',{'zhou-heard':true}),next('v-mo-private','请莫叔到楼梯口说'),next('v-room-offer','今晚先到这里')]);
continueTo('v-zhou-hears','N4.4',seg('N4.4',[5,7]),'v-room-offer');
continueTo('v-mo-private','N4.4',plain('楼梯口有人向上看，你和莫叔往旁边让。莫叔问：“你想我怎么办？”','**你：**“下次有人来，先把话说在前面。我今晚没办法替所有人定这屋散不散。”'),'v-room-offer');
node('v-room-offer','N4.4',plain('韩烈也从楼下上来。莫叔伸手去拿牌，又看了看你，等你自己说。'),[table('v-room','买入100，最多六手'),next('v-han-later','先找韩烈核对'),next('v-lin-message','不打，先走')]);
continueTo('v-han-later','N4.5',seg('N4.5',[1,8],[11,15]),'v-han-check');
node('v-han-check','N4.5',plain('韩烈把相关记录打开。'),s=>[
  fact(next('v-lin-message','只核对阿凯的约定',{'han-known':true}),'han-deal','韩烈本人核对',attended(s)?'入座减三千已经生效。':'没有入座，这次没有减账。'),
  fact(next('v-lin-message','同时核对与旧牌室的补贴',{'han-known':true,'mo-known':true,'mo-bill':true}),'han-subsidy','韩烈本人出示的相关账目','核对每月800补贴，与玩家某手输赢无直接扣款关系。')]);
node('v-lin-message','N4.6',s=>plain(f(s,'photo')?'林岚发来第一夜重拍的合照，问你要不要原图。':f(s,'photo-taken')?'林岚问你，那张你帮忙拍的原图，要不要一份。':'林岚发来消息：“阿凯那事，你还在问吗？”'),[next('v-lin-help','请她一起核对有关原记录',{'lin-help':true}),next('v-lin-alone','不请她介入')]);
continueTo('v-lin-help','N4.6',seg('N4.6',2,3),'v-witness-offer');
continueTo('v-lin-alone','N4.6',seg('N4.6',6,7),'v-witness-offer');
node('v-witness-offer','N4.6',plain('周四见面前，你可以问一位普通熟人是否愿意在周六听自己见过的那一段。'),s=>[
  ...(s.visited.includes('v-box')?[next('v-cheng-invite','问程墨是否有空',{'cheng-asked':true})]:[]),
  ...(f(s,'zhou-heard')?[next('v-zhou-invite','请老周来听自己见过的部分',{'zhou-invited':true})]:[]),next('v-print','不额外请人')]);
continueTo('v-cheng-invite','N4.6',s=>plain(f(s,'helped-cheng')?'程墨：“我能早点收工。时间发我。先说，我不知道的真答不上来。”':'程墨：“周六早班，晚上能来半小时。你把时间说准点。”'),'v-cheng-confirm');
node('v-cheng-confirm','N4.6',plain('你说明时间，只请他确认自己听过的内容。'),[next('v-print','约定好',{'cheng-invited':true})]);
continueTo('v-zhou-invite','N4.6',plain('老周：“我就听见那天屋里说的那些。行，来一下，一小时后得走。”'),'v-print');
continueTo('v-print','N5.1',seg('N5.1',[0,3]),'v-lin-files');
node('v-lin-files','N5.1',s=>[...plain('你们到旁边还开着的快餐店坐下。'),...seg('N5.1',f(s,'lin-help')?[6,10]:[12,14])],[next('v-lin-missing','问她留下了什么',{'lin-cut':true,'lin-met':true})]);
node('v-lin-missing','N5.2',seg('N5.2',[0,5]),[
  next('v-lin-why','为什么要挑给我看'),next('v-lin-what','问那份能证明什么'),next('v-lin-independent','收下这一份，剩下自己核对')]);
continueTo('v-lin-why','N5.2',seg('N5.2',[7,9]),'v-lin-chair');
continueTo('v-lin-what','N5.2',seg('N5.2',11,12),'v-lin-chair');
node('v-lin-chair','N5.3',seg('N5.3',[1,4]),s=>f(s,'lin-help')?[
  next('v-lin-hurt','“我还以为这次有人站我旁边。”'),next('v-lin-original-offer','请她履行交付原文的承诺'),next('v-lin-independent','不依靠她，独立核对')]:[
  next('v-lin-original-offer','询问她是否愿意转交'),next('v-lin-independent','“你护他，我自己查。”'),next('v-lin-keep','不再追索这一份')]);
continueTo('v-lin-hurt','N5.3',plain('**你：**“偏他你可以先说。我还以为这次有人站我旁边。”',...VOLUME_TEXT['N5.3']!.blocks.slice(7,9)),'v-lin-original-offer');
node('v-lin-original-offer','N5.4',plain('**林岚：**“原话里有他信我才说的东西。我发出去，他会知道是我。”'),[
  next('v-lin-authorize','请她先和莫叔确认，只转交相关前后文'),next('v-lin-independent','不等她转交，直接找当事人'),next('v-lin-keep','让她明确说不能给，就到这里')]);
continueTo('v-lin-authorize','N5.4',s=>[...plain('林岚给莫叔打电话，没有先让你出去。',f(s,'lin-help')?'**林岚：**“我答应过给有关原记录，又挑了一份。现在想把剩下相关的给他看。”':'**林岚：**“他问我能不能把相关往来给他看。只这两件，不是全部聊天。”'),...plain('莫叔在另一头沉默一阵，说可以。林岚打开相关前后文。')],'v-original');
node('v-original','N5.4',seg('N5.4',[5,10],14,15,16,17),[fact(next('v-verify-offer','保留经同意转交的相关原文',{'lin-original':true,'mo-vouch':true}),'mo-vouch','林岚提供的原始往来','莫叔曾让阿凯以他的熟人身份为南桥那桌作保；并不只是被动沉默。')]);
node('v-lin-independent','N5.4',seg('N5.4',21,22,24),[next('v-independent-han','直接向韩烈核对'),next('v-su-offer','先保留不完整的信息')]);
node('v-independent-han','N5.4',seg('N5.4',27,28),[fact(next('v-verify-offer','核对相关前后文',{'mo-vouch':true,'han-known':true,'mo-known':true}),'mo-vouch','韩烈出示的相关往来','莫叔曾让阿凯以他的熟人身份为南桥那桌作保。')]);
continueTo('v-lin-keep','N5.4',seg('N5.4',32,33),'v-su-offer');
node('v-verify-offer','N5.5',plain('你已看见莫叔曾替那桌作保的相关记录。可以再问他，也可以先不追。'),[next('v-mo-vouch','当面请他补全说法'),next('v-su-offer','先不去')]);
node('v-mo-vouch','N5.5',seg('N5.5',[1,3],5),[next('v-mo-full','只要求他补全说过的话'),next('v-mo-saturday','请他周六当面说明'),next('v-mo-source','不交出转交人的身份')]);
continueTo('v-mo-full','N5.5',seg('N5.5',[7,10]),'v-su-offer');
continueTo('v-mo-saturday','N5.5',seg('N5.5',[12,14]),'v-su-offer');
continueTo('v-mo-source','N5.5',plain('你没有转发材料。莫叔说愿意把他自己的相关消息打开，你请他保留到周六当面说明。'),'v-su-offer');
node('v-su-offer','N5.5',plain('苏蔓那晚也在。你可以请阿凯提供她的联系方式，先问她是否方便答一个具体问题，也可以不再请人介入。'),[next('v-su-witness','问她当晚看见什么'),next('v-cheng-table','不问，去旧牌室取东西')]);
node('v-su-witness','N5.5',s=>[...seg('N5.5',21),...seg('N5.5',attended(s)?22:24),...seg('N5.5',25,26)],s=>[
  fact(next('v-su-invite','问她能否到场',{'su-witness':true}),'su-witness','苏蔓的有限见闻',attended(s)?'听见阿凯与韩烈谈“那笔”，当时不知道金额和约定。':'听见未入座不算；当时不知道金额和约定。'),
  fact(next('v-su-home','征得同意保留原话，不再占她时间',{'su-witness':true,'su-authorized':true}),'su-witness','苏蔓的有限见闻','只确认自己听到的那一句，不证明金额及其他人的安排。')]);
node('v-su-invite','N5.5',seg('N5.5',28),[next('v-su-home','保留她同意使用的原话',{'su-authorized':true})]);
continueTo('v-su-home','N5.5',seg('N5.5',30,31),'v-cheng-table');
node('v-cheng-table','N5.6',seg('N5.6',0,1),[table('v-lin','买入50，最多四手'),next('v-cheng-sit','不打，只坐一会儿'),next('v-cheng-finish','今晚先走')]);
continueTo('v-cheng-sit','N5.6',seg('N5.6',[9,11]),'v-cheng-finish');
continueTo('v-cheng-finish','N5.6',s=>[...(s.results.some(r=>r.id==='v-lin')?seg('N5.6',[4,7]):[]),...seg('N5.6',[15,18])],'v-invite-meeting');
node('v-invite-meeting','N5.7',seg('N5.7',1),[
  next('v-meeting-invite','约阿凯、莫叔和韩烈，先不打牌',{'meeting':true}),next('v-private-kai','只谈与阿凯的安排'),next('v-end-leave','不再去旧牌室',{'left-old':true})]);
node('v-meeting-invite','N5.7',plain('你分别发出邀请，说明先不打牌。莫叔提前开门，韩烈晚半小时到，阿凯答应了。'),s=>f(s,'lin-met')?[
  next('v-meeting','也请林岚到场，以当事人身份',{'lin-invited':true}),next('v-meeting','不额外邀请林岚')]:[next('v-meeting')]);
continueTo('v-meeting','N6.1',s=>[...seg('N6.1',0,1),...plain('莫叔把牌盒留在柜子里。'),...seg('N6.1',[3,5]),...(f(s,'lin-invited')?plain('林岚自己搬一把椅子坐在窗边，手机放在包里。'):[]),...(f(s,'zhou-invited')?plain('老周放下橘子，说一小时后得走。“答应来，就来一下。”'):[]),...(f(s,'cheng-invited')?plain('程墨带来纸盒，放在柜子边。'):[])],'v-meeting-kai');
node('v-meeting-kai','N6.2',s=>[...seg('N6.2',1,2),...plain(attended(s)?'韩烈核对：入座减三千已经生效。':'韩烈核对：未入座，这次没有减账。'),...seg('N6.2',[4,7])],[next('v-meeting-first','问第一夜的时间'),next('v-meeting-mo','第一夜留给自己判断')]);
continueTo('v-meeting-first','N6.2',plain('阿凯把约定的日期对出来。第一夜在前，减账提议在后。'),'v-meeting-mo');
node('v-meeting-mo','N6.2',s=>[...(f(s,'mo-known')?seg('N6.2',12,13):plain('你没有核对过补贴。这次先只谈自己已经问过的内容。')),...(f(s,'mo-vouch')?seg('N6.2',16,17):[]),...(f(s,'lin-invited')&&f(s,'lin-cut')?seg('N6.2',f(s,'lin-help')?22:24):[])],s=>f(s,'mo-known')?[next('v-subsidy','让他们说清往后的补贴'),next('v-group-end','不讨论往后经营')]:[next('v-group-end')]);
node('v-subsidy','N6.3',[...seg('N6.3',[1,3]),...plain('屋里没有人接话。'),...seg('N6.3',[5,7])],[next('v-subsidy-why','“一开始你说是帮他。”',{'subsidy-stopped':true}),next('v-subsidy-plan','让莫叔说下一步',{'subsidy-stopped':true})]);
continueTo('v-subsidy-why','N6.3',seg('N6.3',9),'v-subsidy-plan');
continueTo('v-subsidy-plan','N6.3',seg('N6.3',12,13),'v-group-end');
node('v-group-end','N6.3',plain('事情说到了这里。没有人要求你替房租补那八百。'),[
  next('v-end-account','暂时不再参加旧牌室'),next('v-end-stay','愿意继续来，只答应下周帮忙收一次柜子'),next('v-private-kai','和阿凯再单独谈一会儿')]);
node('v-private-kai','N6.4',s=>[...seg('N6.4',1),...seg('N6.4',!attended(s)?9:f(s,'no-money')?7:f(s,'kai-paid')?3:5),...seg('N6.4',11)],[next('v-end-conditions','可以再问我，但条件先说清'),next('v-end-personal','停止私人邀约，钱款安排另说'),next('v-end-leave','不再联系',{'left-garage':true})]);
node('v-end-leave','K1',s=>[...seg('K1',1),...seg('K1',f(s,'left-early')?3:f(s,'left-garage')?[6,7]:[10,11]),...(f(s,'photo')?plain('第一夜那张合照仍在手机里。你没有删除。'):[])],[{id:'finish',text:'保存结尾',en:'Save ending',end:true}]);
node('v-end-personal','K2',s=>[...seg('K2',0),...seg('K2',hasMoney(s)?[2,3]:5),...seg('K2',8)],[{id:'finish',text:'保存结尾',en:'Save ending',end:true}]);
node('v-end-conditions','K3',seg('K3',[1,4]),[next('v-end-conditions-room','愿意再来旧牌室'),next('v-end-conditions-outside','只在外面见')]);
node('v-end-conditions-room','K3',seg('K3',7,8),[{id:'finish',text:'保存结尾',en:'Save ending',end:true}]);
node('v-end-conditions-outside','K3',seg('K3',10,11),[{id:'finish',text:'保存结尾',en:'Save ending',end:true}]);
node('v-end-account','K4',s=>[...plain('人走的时候没有排成一队向你道歉。韩烈先下楼赶回餐馆。'),...plain(f(s,'subsidy-stopped')?'莫叔把撤下的开桌纸折起来。下个月八百停了，房租不会因为他承认得完整就少一块。':'开桌纸还贴着。你只结束了自己查清的部分。'),...(f(s,'lin-invited')?plain(f(s,'photo')?'林岚陪你走到楼梯口，问你还要不要照片原图。':'林岚陪你走到楼梯口，问以后还介不介意她发消息。'):[]),...seg('K4',hasMoney(s)?10:12,[13,16])],[{id:'finish',text:'保存结尾',en:'Save ending',end:true}]);
node('v-end-stay','K5',s=>[...seg('K5',1),...(f(s,'cheng-invited')?plain('程墨说也想来，但得先换排班，今晚不答应。'):[]),...seg('K5',4),...plain(f(s,'subsidy-stopped')?'下一次来，那把椅子稳了。房间少开了一天，墙上贴了准确的日期和结束时间。':'下一次来，那把椅子稳了。房间照常开，账的问题仍未解决。'),...seg('K5',7),...plain('**你：**“这个不是只给我看的。”'),...seg('K5',9,10,12)],[{id:'finish',text:'保存结尾',en:'Save ending',end:true}]);

export function startVolume():StoryState{
  return {edition:2,format:1,scene:'v-door',cursor:0,revision:0,phase:'scene',wallet:0,ledger:[],facts:[],history:[{scene:'v-door',night:1,title:'楼梯口',en:'Upstairs',lines:scripts['v-door']!.lines({} as StoryState).slice(0,1)}],flags:{},visited:['v-door'],activeTable:null,atTableStart:false,results:[],source:{route:'old',questioned:false,askedMo:false,net:null,wallet:0}};
}
export function volumeNode(s:StoryState):StoryNode{
  const script=scripts[s.scene];if(!script)throw new Error(`Unknown volume scene ${s.scene}`);
  const night=script.section.startsWith('K')?Math.max(2,...s.history.map(h=>h.night)):Number(script.section[1]);
  const location:StoryLocation=night===3?'garage':['v-han-first','v-han-later','v-bridge','v-watch','v-new-result','v-stair'].includes(s.scene)?'new':s.scene.includes('message')||s.scene==='v-weekend'?'phone':'old';
  return {night,title:VOLUME_TEXT[script.section]!.title,en:VOLUME_TEXT[script.section]!.title,location,lines:script.lines(s),choices:script.choices(s),task:script.task??(script.section.startsWith('K')?'这一卷停在这里，钱款与记录保留':'把眼前的话听完，再决定怎么做'),taskEn:'Read the conversation, then choose. Volume One is currently in Chinese.'};
}
export const volumeSceneIds=()=>Object.keys(scripts);
