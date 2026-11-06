import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/game/proxy-detection.js',()=>({loadProxyDetector:()=>()=>false}));
import { startVolume } from '../../src/game/volume-one.js';
import { volumeTwoNode, volumeTwoSceneIds, VOLUME_TWO_TABLES } from '../../src/game/volume-two.js';
import { advanceStory, currentStoryNode, settleStoryTable, storyView, type StoryState } from '../../src/game/story-campaign.js';
import { createBrowserApi } from '../../src/web/browser-api.js';
import type { BrowserStore, SaveSlot } from '../../src/web/browser-store.js';
import type { Checkpoint } from '../../src/web/checkpoint-data.js';
import { renderMobileTable } from '../../src/web/mobile-render.js';
import { newMobileUi } from '../../src/web/mobile-model.js';

function read(s:StoryState){
  for(let i=0;s.phase==='scene'&&s.cursor<currentStoryNode(s).lines.length-1;i++){
    if(i>120)throw new Error('Unbounded scene');
    expect(advanceStory(s,{operation:'next',revision:s.revision})).toBe('stay');
  }
}
function pick(s:StoryState,id:string){
  read(s);
  return advanceStory(s,{operation:'choose',revision:s.revision,choice:id});
}
function at(scene:string,wallet=600):StoryState{
  const s=startVolume();s.scene=scene;s.wallet=wallet;s.source.wallet=wallet;
  s.ledger=wallet?[{id:'opening',delta:wallet,balance:wallet,text:'随身资金',en:'Opening wallet'}]:[];
  s.flags={'photo':true};s.visited=[scene];
  const n=currentStoryNode(s);s.history=[{scene,night:n.night,title:n.title,en:n.en,lines:n.lines.slice(0,1)}];
  read(s);return s;
}
function finished(ending='v-end-stay',wallet=600):StoryState{
  const s=at(ending,wallet);expect(pick(s,'finish')).toBe('stay');return s;
}
class Store implements BrowserStore{
  slots=new Map<string,Checkpoint>();
  async read(slot?:SaveSlot){return structuredClone(this.slots.get(slot??'settled')??null);}
  async write(s:Checkpoint,id:string|null,slot?:SaveSlot){
    expect(this.slots.get(slot??'settled')?.summary.id??null).toBe(id);
    this.slots.set(slot??'settled',structuredClone(s));
  }
}

describe('Story continuation and explicit failure recovery',()=>{
  it('continues all first-volume endings without rewriting earlier money, facts or decisions',()=>{
    for(const ending of ['v-end-leave','v-end-personal','v-end-conditions-room','v-end-conditions-outside','v-end-account','v-end-stay']){
      const s=finished(ending,0),before=structuredClone(s);
      expect(pick(s,'continue-volume-two'),ending).toBe('stay');
      expect(s.scene).toBe('w-door');expect(s.phase).toBe('scene');expect(currentStoryNode(s).night).toBe(7);
      expect(s.wallet).toBe(before.wallet);expect(s.ledger).toEqual(before.ledger);expect(s.flags).toEqual(before.flags);expect(s.source).toEqual(before.source);
      expect(s.history.slice(0,-1)).toEqual(before.history);expect(s.facts).toEqual(before.facts);
      expect(storyView(s).chapters.map(c=>c.night)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
      const after=structuredClone(s);
      expect(advanceStory(s,{operation:'choose',revision:before.revision,choice:'continue-volume-two'})).toBe(false);expect(s).toEqual(after);
    }
  });
  it('keeps the original first-volume view shape and chapter list until the player continues',()=>{
    const s=finished();expect(storyView(s).chapters).toHaveLength(6);
    expect(storyView(s).choices).toEqual([]);expect(storyView(s)).not.toHaveProperty('failure');expect(storyView(s)).not.toHaveProperty('continuation');
    expect(pick(s,'finish')).toBe(false);
    expect(pick(s,'continue-volume-two')).toBe('stay');s.phase='complete';
    expect(pick(s,'continue-volume-two')).toBe(false);
  });
  for(const closing of [0,200])it(`retries a losing cash table (${closing} closing) by undoing only that table`,()=>{
    const s=at('v-bridge'),before=structuredClone(s);
    expect(pick(s,'v-new')).toBe('open-table');expect(s.wallet).toBe(300);expect(s.source.route).toBe('new');
    expect(settleStoryTable(s,closing,1,closing===0?'bust':'left')).toBe(true);
    const settledRevision=s.revision;
    expect(pick(s,'retry-table')).toBe('stay');
    const {revision:afterRevision,...restored}=s,{revision:_beforeRevision,...original}=before;
    expect(restored).toEqual(original);expect(afterRevision).toBeGreaterThan(settledRevision);
    expect(advanceStory(s,{operation:'choose',revision:settledRevision,choice:'retry-table'})).toBe(false);
    expect(pick(s,'v-new')).toBe('open-table');expect(settleStoryTable(s,0,1,'bust')).toBe(true);expect(pick(s,'collect')).toBe('stay');
    expect(s.wallet).toBe(300);expect(s.ledger.map(e=>e.id)).toEqual(['opening','buy:v-new','cash:v-new']);expect(s.results).toHaveLength(1);
    expect(s.flags['photo']).toBe(true);expect(s.source.net).toBe(-300);expect(s.source.route).toBe('new');
  });
  it('does not mint money when a practice table is retried, or permit retrying a win',()=>{
    const s=at('v-mo',0),before=structuredClone(s);
    expect(pick(s,'v-mo')).toBe('open-table');expect(settleStoryTable(s,0,1,'bust')).toBe(true);expect(pick(s,'retry-table')).toBe('stay');
    expect(s.wallet).toBe(0);expect(s.ledger).toEqual([]);expect(s.results).toEqual([]);expect(s.history).toEqual(before.history);
    expect(pick(s,'v-mo')).toBe('open-table');expect(settleStoryTable(s,120,1,'left')).toBe(true);
    const won=structuredClone(s);expect(pick(s,'retry-table')).toBe(false);expect(s).toEqual(won);
  });
  it('accepting a loss keeps the real ledger and advances instead of resetting the story',()=>{
    const s=at('v-bridge');expect(pick(s,'v-new')).toBe('open-table');expect(settleStoryTable(s,0,1,'bust')).toBe(true);
    const settled=structuredClone(s);expect(pick(s,'collect')).toBe('stay');
    expect(s.scene).toBe('v-new-result');expect(s.wallet).toBe(300);expect(s.ledger).toEqual(settled.ledger);expect(s.results).toEqual(settled.results);
    expect(pick(s,'retry-table')).toBe(false);
  });
  it('rejects a malformed rollback ledger without partially changing the wallet or history',()=>{
    const s=at('v-bridge');pick(s,'v-new');settleStoryTable(s,0,1,'bust');s.ledger.at(-1)!.balance++;
    const before=structuredClone(s);expect(pick(s,'retry-table')).toBe(false);expect(s).toEqual(before);
  });
  it('resolves every sequel node and table, including loss and zero-wallet variants',()=>{
    const ids=volumeTwoSceneIds();expect(ids.length).toBeGreaterThanOrEqual(40);expect(Object.keys(VOLUME_TWO_TABLES).length).toBeGreaterThanOrEqual(3);
    for(const id of ids)for(const wallet of [0,600]){
      const s=finished(wallet===0?'v-end-leave':'v-end-stay',wallet);pick(s,'continue-volume-two');s.scene=id;
      s.results=Object.values(VOLUME_TWO_TABLES).map(t=>({id:t.id,night:7,hands:1,closing:wallet===0?0:t.buyIn+10,net:wallet===0?-t.buyIn:10,reason:wallet===0?'bust':'left'}));
      const n=volumeTwoNode(s);expect(n.lines.length,id).toBeGreaterThan(0);expect(n.night,id).toBeGreaterThanOrEqual(7);expect(n.night,id).toBeLessThanOrEqual(12);
      for(const l of n.lines){expect(l.text,id).toBeTruthy();expect(l.text,id).not.toContain('undefined');}
      if(wallet===0)expect(n.choices.some(c=>!c.table),`${id} has a non-wagering exit`).toBe(true);
      for(const c of n.choices){if(c.to)expect(ids,`${id} → ${c.to}`).toContain(c.to);if(c.table){expect(VOLUME_TWO_TABLES[c.table],id).toBeDefined();expect(c.set,id).toBeUndefined();expect(c.fact,id).toBeUndefined();}}
    }
    for(const t of Object.values(VOLUME_TWO_TABLES))expect(ids,t.id).toContain(t.returnTo);
  });
  for(const ending of ['w-end-small','w-end-outside','w-end-new'])it(`finishes ${ending} with zero money and no wagers`,()=>{
    const s=finished('v-end-stay',0);expect(pick(s,'continue-volume-two')).toBe('stay');
    for(let step=0;step<100&&s.phase!=='complete';step++){
      const choices=currentStoryNode(s).choices;
      const choice=s.scene==='w-twelve-door'?choices.find(c=>c.id===(ending==='w-end-small'?'w-small-door':ending)):choices.find(c=>!c.table);
      expect(choice,s.scene).toBeDefined();expect(pick(s,choice!.id),s.scene).toBe('stay');
    }
    expect(s.phase).toBe('complete');expect(s.scene).toBe(ending);expect(s.wallet).toBe(0);expect(s.ledger).toEqual([]);expect(s.results).toEqual([]);
    expect([...new Set(s.history.filter(h=>h.night>=7).map(h=>h.night))]).toEqual([7,8,9,10,11,12]);
    expect(storyView(s).relationships.find(r=>r.name==='程墨')?.text).not.toBe('还没有谈接下来怎么安排');
  });
  it('honors no-contact and no-money boundaries through the whole sequel',()=>{
    const s=finished('v-end-leave',0);s.flags['no-money']=true;
    expect(pick(s,'continue-volume-two')).toBe('stay');
    const branch:Record<string,string>={'w-door':'w-street','w-eight-door':'w-cheng-worker','w-nine-door':'w-cheng-poster','w-cart':'w-cart-no','w-ten-rain':'w-rain-call','w-twelve-door':'w-end-outside'};
    for(let step=0;step<100&&s.phase!=='complete';step++){
      const choice=branch[s.scene]??currentStoryNode(s).choices.find(c=>!c.table)!.id;expect(pick(s,choice),s.scene).toBe('stay');
    }
    expect(s.phase).toBe('complete');expect(s.flags['w-contact-kai']).not.toBe(true);expect(s.flags['w-contact-lin']).not.toBe(true);
    expect(s.history.filter(h=>h.night>=7).flatMap(h=>h.lines).filter(l=>l.who==='阿凯'||l.who==='林岚')).toEqual([]);
    expect(s.wallet).toBe(0);expect(s.ledger).toEqual([]);expect(storyView(s).relationships.find(r=>r.name==='阿凯')?.text).toContain('没有建立返款安排');
  });
  it('tracks actual losses and wins at all four sequel tables and never gates their next scene behind cash',()=>{
    const entries:Record<string,string>={'w-friday':'w-friday-offer','w-depot':'w-depot-offer','w-bridge':'w-bridge-offer','w-last':'w-last-offer'};
    for(const table of Object.values(VOLUME_TWO_TABLES))for(const net of [-table.buyIn,0,10]){
      const s=at(entries[table.id]!);s.flags['w-returned']=true;
      const before=structuredClone(s);
      expect(pick(s,table.id),table.id).toBe('open-table');expect(settleStoryTable(s,table.buyIn+net,1,net===-table.buyIn?'bust':'left')).toBe(true);
      if(net<0){
        expect(pick(s,'retry-table')).toBe('stay');expect(s.wallet).toBe(before.wallet);expect(s.ledger).toEqual(before.ledger);expect(s.flags).toEqual(before.flags);expect(s.source).toEqual(before.source);
        expect(pick(s,table.id)).toBe('open-table');expect(settleStoryTable(s,table.buyIn+net,1,'bust')).toBe(true);
      }
      expect(pick(s,'collect')).toBe('stay');expect(s.scene).toBe(table.returnTo);expect(s.wallet).toBe(600+net);
      expect(s.ledger.reduce((sum,e)=>sum+e.delta,0)).toBe(s.wallet);
      const text=currentStoryNode(s).lines.map(l=>l.text).join('');
      if(net<0)expect(text).toContain(`净输${-net}`);if(net>0)expect(text).toContain(`净赢${net}`);
      expect(currentStoryNode(s).choices.some(c=>!c.table)).toBe(true);
    }
  });
  it('keeps a broken promise to Cheng as a consequence, without blaming a player who declined',()=>{
    for(const promised of [true,false]){
      const s=at('w-cart',0);
      for(const id of [promised?'w-cart-yes':'w-cart-no','w-nine-door','w-cheng-poster','w-nine-close','w-ten-rain','w-rain-call','w-after-rain','w-eleven-door']){
        expect(pick(s,id),`${s.scene}: ${id}`).toBe('stay');
      }
      read(s);const text=currentStoryNode(s).lines.map(l=>l.text).join('');
      if(promised)expect(text).toContain('下回先不把你算进去了');
      else expect(text).not.toContain('下回先不把你算进去了');
      expect(text).not.toContain('你答应的两盒，送过来了');
      expect(pick(s,'w-eleven-food')).toBe('stay');
      const relation=storyView(s).relationships.find(r=>r.name==='程墨')!.text;
      expect(relation.includes('下次不再先把你算进去')).toBe(promised);
      expect(s.flags['w-broke-cart']).toBe(promised);
      expect(s.wallet).toBe(0);expect(s.ledger).toEqual([]);
    }
  });
  it('updates people only from completed sequel scenes and preserves unpaid promises',()=>{
    const s=finished();s.source.route='new';s.flags['money-promise']=true;s.flags['kai-paid']=true;
    pick(s,'continue-volume-two');
    expect(storyView(s).relationships.find(r=>r.name==='阿凯')?.text).toContain('未付2850');
    expect(storyView(s).relationships.find(r=>r.name==='林岚')?.text).not.toContain('三个月');
    s.history.push({scene:'w-lin-after',night:11,title:'她没有搬回来',en:'',lines:[]});
    expect(storyView(s).relationships.find(r=>r.name==='林岚')?.text).not.toContain('三个月');
    s.history.at(-1)!.choice='留下更正';
    expect(storyView(s).relationships.find(r=>r.name==='林岚')?.text).toContain('三个月');
    expect(storyView(s).relationships.find(r=>r.name==='阿凯')?.text).toContain('没有新到款');
    expect(s.wallet).toBe(600);expect(s.ledger).toHaveLength(1);
  });
  it('replays an actual loss, explicit retry, and refreshed conversation through the browser API',async()=>{
    const store=new Store();let api=createBrowserApi(store,'retry-browser');
    const post=(path:string,body:unknown)=>api(path,JSON.stringify(body));
    let response=await post('/api/table',{experience:'second-night',mode:'classic',storyEdition:2});expect(response.status).toBe(200);let t=response.body.table!;
    async function choose(choice:string){
      while(t.campaign!.phase==='scene'&&t.campaign!.cursor<t.campaign!.lineCount-1){
        response=await post('/api/story',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,input:{operation:'next',revision:t.campaign!.revision}});expect(response.status,response.body.error).toBe(200);t=response.body.table!;
      }
      response=await post('/api/story',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,input:{operation:'choose',choice,revision:t.campaign!.revision}});expect(response.status,response.body.error).toBe(200);t=response.body.table!;
    }
    for(const c of ['v-sit','v-mo','v-mo'])await choose(c);
    const initialCards=structuredClone(t.view.holeCards);
    for(let i=0;i<50&&t.packet.kind==='decision';i++){
      const p=t.packet;response=await post('/api/action',{tableId:t.id,command:{type:'act',decisionKey:p.decisionKey,expectedPacketIndex:p.packetIndex,intent:{type:p.observation.legalActions.fold?'fold':'check'}}});expect(response.status,response.body.error).toBe(200);t=response.body.table!;
    }
    expect(t.packet.kind).toBe('hand-result');
    if(t.campaign!.phase==='playing'){
      response=await post('/api/story',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,input:{operation:'leave-table',revision:t.campaign!.revision}});expect(response.status,response.body.error).toBe(200);t=response.body.table!;
    }
    expect(t.campaign!.results.at(-1)!.net).toBeLessThan(0);await choose('retry-table');expect(t.campaign!.phase).toBe('scene');expect(t.campaign!.results).toEqual([]);
    const html=renderMobileTable(t,{table:t,rosters:{}},{count:2,mode:'classic',difficulty:'standard',social:true,nightAbility:null},newMobileUi());
    expect(html).toContain('campaign-story');expect(html).not.toContain('mobile-result-mini');
    const expected=structuredClone(t.campaign);api=createBrowserApi(store,'retry-browser');
    response=await post('/api/resume',{slot:'journey',checkpointId:store.slots.get('journey')!.summary.id});expect(response.status,response.body.error).toBe(200);expect(response.body.table?.campaign).toEqual(expected);
    t=response.body.table!;await choose('v-mo');expect(t.view.holeCards).toEqual(initialCards);expect(t.campaign!.wallet).toBe(0);
  });
});
