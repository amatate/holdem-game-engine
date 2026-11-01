import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/game/proxy-detection.js',()=>({loadProxyDetector:()=>()=>false}));
import { startVolume, volumeNode, volumeSceneIds } from '../../src/game/volume-one.js';
import { advanceStory, settleStoryTable, storyView, type StoryState } from '../../src/game/story-campaign.js';
import { createBrowserApi } from '../../src/web/browser-api.js';
import type { BrowserStore, SaveSlot } from '../../src/web/browser-store.js';
import type { Checkpoint } from '../../src/web/checkpoint-data.js';
import type { WebTable } from '../../src/web/protocol.js';
function read(s:StoryState){let guard=0;while(s.cursor<volumeNode(s).lines.length-1){expect(advanceStory(s,{operation:'next',revision:s.revision})).toBe('stay');if(guard++>100)throw Error('long scene');}}
function pick(s:StoryState,id:string){read(s);expect(advanceStory(s,{operation:'choose',revision:s.revision,choice:id}),s.scene+':'+id).not.toBe(false);}
function path(s:StoryState,...ids:string[]){for(const id of ids)pick(s,id);}
const defaultChoices:Record<string,string>={
 'v-door':'v-sit','v-sit':'v-mo','v-mo':'v-arrival','v-arrival':'v-four-intro','v-four-intro':'v-normal','v-normal':'v-four','v-four':'v-rest','v-rest':'v-clear','v-clear':'v-food-offer','v-food-offer':'v-photo','v-photo':'v-photo-no','v-photo-no':'v-invitation','v-invitation':'v-weekend','v-weekend':'v-not-tonight','v-not-tonight':'v-missed','v-missed':'v-shop-offer','v-shop-offer':'v-wait-shop','v-wait-shop':'v-kai-question','v-kai-question':'v-kai-common','v-kai-common':'v-first-question','v-first-question':'v-kai-reason','v-kai-reason':'v-record-offer','v-record-offer':'v-kai-record','v-kai-record':'v-garage-offer','v-garage-offer':'v-kai-close','v-kai-close':'v-mo-door','v-mo-door':'v-mo-open','v-mo-open':'v-mo-explain','v-mo-explain':'v-mo-bill','v-mo-bill':'v-mo-copy','v-mo-copy':'v-mo-company','v-mo-company':'v-room-offer','v-room-offer':'v-lin-message','v-lin-message':'v-lin-help','v-lin-help':'v-witness-offer','v-witness-offer':'v-print','v-print':'v-lin-files','v-lin-files':'v-lin-missing','v-lin-missing':'v-lin-why','v-lin-why':'v-lin-chair','v-lin-chair':'v-lin-hurt','v-lin-hurt':'v-lin-original-offer','v-lin-original-offer':'v-lin-authorize','v-lin-authorize':'v-original','v-original':'v-verify-offer','v-verify-offer':'v-su-offer','v-su-offer':'v-cheng-table','v-cheng-table':'v-cheng-finish','v-cheng-finish':'v-invite-meeting','v-invite-meeting':'v-meeting-invite','v-meeting-invite':'v-meeting','v-meeting':'v-meeting-kai','v-meeting-kai':'v-meeting-mo','v-meeting-mo':'v-subsidy','v-subsidy':'v-subsidy-plan','v-subsidy-plan':'v-group-end','v-group-end':'v-end-account','v-end-account':'finish'};
function walk(s:StoryState,to:string,overrides:Record<string,string>={}){for(let i=0;i<150&&s.scene!==to&&s.phase!=='complete';i++){const id=overrides[s.scene]??defaultChoices[s.scene];if(!id)throw Error(s.scene);pick(s,id);}expect(s.scene).toBe(to);}
class Store implements BrowserStore{slots=new Map<string,Checkpoint>();async read(slot?:SaveSlot){return structuredClone(this.slots.get(slot??'settled')??null);}async write(s:Checkpoint,id:string|null,slot?:SaveSlot){expect(this.slots.get(slot??'settled')?.summary.id??null).toBe(id);this.slots.set(slot??'settled',structuredClone(s));}}
describe('Volume One approved story integration',()=>{
 it('all compiled scenes resolve without author-only instructions or missing paragraphs',()=>{
  for(const id of volumeSceneIds())for(const enabled of [false,true]){
   const s=startVolume();s.scene=id;s.source.route=enabled?'new':'old';s.flags=Object.fromEntries(['lin-help','mo-known','mo-vouch','lin-met','lin-invited','zhou-invited','cheng-invited','lin-cut','subsidy-stopped','photo','money-promise','kai-known'].map(k=>[k,enabled]));
   const n=volumeNode(s);expect(n.lines.length,id).toBeGreaterThan(0);
   for(const l of n.lines){expect(l.text,id).not.toMatch(/→|本稿|本卷结束|不播放上段|\*\*|^【|^如果你实际入座/);expect(l.who,id).not.toMatch(/选择|若|如果/);}
   for(const c of n.choices)if(c.to)expect(volumeSceneIds(),id).toContain(c.to);
  }
 });
 it('warm first night does not reveal future transactions and practice chips never enter the wallet',()=>{
  const s=startVolume();expect(storyView(s).goal).not.toContain('减账');expect(s.wallet).toBe(0);
  path(s,'v-sit','v-mo');pick(s,'v-mo');expect(s.phase).toBe('playing');expect(s.wallet).toBe(0);expect(s.ledger).toHaveLength(0);
  expect(settleStoryTable(s,160,2,'left')).toBe(true);expect(s.wallet).toBe(0);expect(settleStoryTable(s,160,2,'left')).toBe(false);
  pick(s,'collect');expect(s.scene).toBe('v-mo-result');
 });
 it('declining all wagers can reach the full group ending without inventing compensation or photos',()=>{
  const s=startVolume();walk(s,'v-end-account');pick(s,'finish');expect(s.phase).toBe('complete');expect(s.wallet).toBe(600);
  expect(s.flags['kai-paid']).not.toBe(true);expect(s.ledger).toHaveLength(1);expect(s.flags['subsidy-stopped']).toBe(true);
  expect(s.history.flatMap(h=>h.lines).map(l=>l.text).join('')).not.toContain('林岚发来第一夜重拍的合照');
 });
 for(const arrangement of ['v-paid','v-unpaid','v-no-money'])it(`actual buy-in and ${arrangement} preserve cash versus promises`,()=>{
  const s=startVolume();walk(s,'v-weekend');path(s,'v-to-bridge','v-bridge');pick(s,'v-new');expect(s.wallet).toBe(300);
  expect(settleStoryTable(s,200,2,'left')).toBe(true);pick(s,'collect');expect(s.wallet).toBe(500);
  path(s,'v-stair','v-stair-ask','v-shop-offer','v-ten-minutes','v-kai-question','v-kai-amount','v-kai-common','v-first-question','v-kai-reason','v-record-offer','v-kai-record','v-money');
  read(s);const revision=s.revision;pick(s,arrangement);expect(s.wallet).toBe(arrangement==='v-paid'?650:500);
  expect(advanceStory(s,{operation:'choose',revision,choice:arrangement})).toBe(false);
  expect(s.ledger.reduce((a,e)=>a+e.delta,0)).toBe(s.wallet);
  if(arrangement==='v-no-money')expect(storyView(s).relationships[0]?.text).not.toMatch(/2850|三千承诺/);
 });
 it('Lin has only the promise the player actually requested, and an independent source can reveal Mo’s role',()=>{
  const s=startVolume();walk(s,'v-lin-message');path(s,'v-lin-alone','v-witness-offer','v-print','v-lin-files','v-lin-missing','v-lin-why','v-lin-chair','v-lin-independent','v-independent-han','v-verify-offer');
  expect(s.flags['lin-help']).not.toBe(true);expect(s.flags['lin-original']).not.toBe(true);expect(s.flags['mo-vouch']).toBe(true);
  expect(s.history.flatMap(h=>h.lines).map(l=>l.text).join('')).not.toContain('这句话是我答应过头了');
 });
 it('supports every ending and leaves uninvestigated facts unknown',()=>{
  for(const ending of ['v-end-leave','v-end-personal','v-end-conditions-room','v-end-conditions-outside','v-end-account','v-end-stay']){
   const s=startVolume();walk(s,'v-invite-meeting');
   if(['v-end-account','v-end-stay'].includes(ending)){walk(s,'v-group-end');pick(s,ending);}
   else if(ending==='v-end-leave')pick(s,ending);
   else {pick(s,'v-private-kai');if(ending==='v-end-personal')pick(s,ending);else path(s,'v-end-conditions',ending);}
   pick(s,'finish');expect(s.phase,ending).toBe('complete');expect(s.wallet).toBe(600);
  }
  const s=startVolume();walk(s,'v-missed');pick(s,'v-end-leave');read(s);expect(s.facts).toHaveLength(0);expect(s.history.at(-1)?.lines.map(l=>l.text).join('')).not.toContain('三千');
 });
 it('resumes a fresh edition mid-conversation via browser journal replay',async()=>{
  const store=new Store();let api=createBrowserApi(store,'volume-test');
  const post=(path:string,body:unknown)=>api(path,JSON.stringify(body));
  let r=await post('/api/table',{experience:'second-night',mode:'classic',storyEdition:2});expect(r.status,r.body.error).toBe(200);
  let t=r.body.table!;expect(t.campaign?.night).toBe(1);
  r=await post('/api/story',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,input:{operation:'next',revision:0}});expect(r.status,r.body.error).toBe(200);t=r.body.table!;
  api=createBrowserApi(store,'volume-test');r=await post('/api/resume',{slot:'journey',checkpointId:store.slots.get('journey')!.summary.id});expect(r.status,r.body.error).toBe(200);
  expect(r.body.table?.campaign).toEqual(t.campaign);
 });
 it('opens and settles an actual practice table through the shared browser API, then replays it exactly',async()=>{
  const store=new Store();let api=createBrowserApi(store,'table-replay');
  const post=(path:string,body:unknown)=>api(path,JSON.stringify(body));
  let response=await post('/api/table',{experience:'second-night',mode:'classic',storyEdition:2});let t=response.body.table!;
  async function command(choice?:string){
   while(t.campaign!.phase==='scene'&&t.campaign!.cursor<t.campaign!.lineCount-1){response=await post('/api/story',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,input:{operation:'next',revision:t.campaign!.revision}});expect(response.status,response.body.error).toBe(200);t=response.body.table!;}
   response=await post('/api/story',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,input:{operation:'choose',revision:t.campaign!.revision,choice}});expect(response.status,response.body.error).toBe(200);t=response.body.table!;
  }
  for(const id of ['v-sit','v-mo','v-mo'])await command(id);
  expect(t.campaign?.phase).toBe('playing');expect(t.roster).toHaveLength(2);
  for(let i=0;i<50&&t.packet.kind==='decision';i++){
   const p=t.packet;response=await post('/api/action',{tableId:t.id,command:{type:'act',decisionKey:p.decisionKey,expectedPacketIndex:p.packetIndex,intent:{type:p.observation.legalActions.fold?'fold':'check'}}});expect(response.status,response.body.error).toBe(200);t=response.body.table!;
  }
  expect(t.packet.kind).toBe('hand-result');
  if(t.campaign?.phase==='playing'){response=await post('/api/story',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,input:{operation:'leave-table',revision:t.campaign!.revision}});expect(response.status,response.body.error).toBe(200);t=response.body.table!;}
  expect(t.campaign?.wallet).toBe(0);await command('collect');expect(t.campaign?.scene).toBe('v-mo-result');
  const expected=t.campaign;api=createBrowserApi(store,'table-replay');response=await post('/api/resume',{slot:'journey',checkpointId:store.slots.get('journey')!.summary.id});expect(response.status,response.body.error).toBe(200);expect(response.body.table?.campaign).toEqual(expected);
 });

});
