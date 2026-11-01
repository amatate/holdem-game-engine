import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/game/proxy-detection.js',()=>({loadProxyDetector:()=>()=>false}));
import { readFile } from 'node:fs/promises';
import { startStory, advanceStory, storyView, settleStoryTable, type StoryState } from '../../src/game/story-campaign.js';
import type { SecondNightState } from '../../src/game/second-night.js';
import { createBrowserApi } from '../../src/web/browser-api.js';
import type { BrowserStore, SaveSlot } from '../../src/web/browser-store.js';
import type { Checkpoint } from '../../src/web/checkpoint-data.js';
import type { WebTable } from '../../src/web/protocol.js';
import { renderMobileTable } from '../../src/web/mobile-render.js';
import { renderTable } from '../../src/web/render.js';
import { newMobileUi } from '../../src/web/mobile-model.js';

const fixtures=JSON.parse(await readFile(new URL('../fixtures/second-night-v1.json',import.meta.url),'utf8')) as {
  versions:{node:string;pages:string};attended:{checkpoint:Checkpoint;expected:SecondNightState};declined:{checkpoint:Checkpoint;expected:SecondNightState};
};
function read(s:StoryState){for(let n=0;n<30;n++){const v=storyView(s);if(v.cursor>=v.lineCount-1)return;expect(advanceStory(s,{operation:'next',revision:s.revision})).toBe('stay');}throw new Error('Dialogue loop');}
function choose(s:StoryState,id:string){read(s);const r=advanceStory(s,{operation:'choose',revision:s.revision,choice:id});expect(r).not.toBe(false);return r;}
function nextChoice(s:StoryState,ending:string,help:boolean):string {
  const map:Record<string,string>={'n3-door':'ask','n3-question':'record','n3-record':'keep','n3-explain':'record','n3-money':'take','n3-paid':'put-away',
    'n3-table':'skip','n3-close':'mo','n4-door':'ask','n4-explain':'see','n4-bill':'copy','n4-table':'watch','n4-next':help?'help':'alone',
    'n5-door':'ask','n5-cut':help?'original':'han','n5-original':'keep','n5-han':'keep','n5-table':'skip','n5-next':'next','n6-choice':ending};
  return map[s.scene]??'finish';
}
class Slots implements BrowserStore{
  values=new Map<string,Checkpoint>();
  async read(slot?:SaveSlot){return structuredClone(this.values.get(slot??'settled')??null);}
  async write(value:Checkpoint,expected:string|null,slot?:SaveSlot){
    if((this.values.get(slot??'settled')?.summary.id??null)!==expected)throw new Error('Conflict');
    this.values.set(slot??'settled',structuredClone(value));
  }
}
type Api=ReturnType<typeof createBrowserApi>;
const post=(api:Api,path:string,body:unknown)=>api(path,JSON.stringify(body));
async function command(api:Api,t:WebTable,operation:'start'|'next'|'choose'|'leave-table',choice?:string){
  const r=await post(api,'/api/story',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,input:{operation,choice,
    revision:operation==='start'?t.secondNight!.revision:t.campaign!.revision}});
  expect(r.status,r.body.error).toBe(200);return r.body.table!;
}
async function apiRead(api:Api,t:WebTable){
  for(let n=0;n<30&&t.campaign?.phase==='scene'&&t.campaign.cursor<t.campaign.lineCount-1;n++)t=await command(api,t,'next');
  return t;
}
describe('story campaign with real Second Night provenance',()=>{
  for(const route of ['attended','declined'] as const)for(const help of [true,false])for(const ending of ['account','personal','leave']){
    it(`${route}, Lin help ${help}, ${ending}: preserves the actual wallet and only visited evidence`,()=>{
      const s=startStory(fixtures[route].expected),original=s.wallet;
      expect(original).toBe(route==='attended'?300:600);
      expect(storyView(s).history.at(-1)?.lines).toHaveLength(1);
      expect(storyView(s).facts.some(f=>f.id==='mo-bill')).toBe(false);
      for(let n=0;n<40&&s.phase!=='complete';n++)choose(s,nextChoice(s,ending,help));
      expect(s.phase).toBe('complete');expect(s.wallet).toBe(original+(route==='attended'?150:0));
      expect(s.ledger.reduce((sum,e)=>sum+e.delta,0)).toBe(s.wallet);
      expect(new Set(s.ledger.map(e=>e.id)).size).toBe(s.ledger.length);
      expect(s.facts.some(f=>f.id==='mo-bill')).toBe(true);
      expect(s.flags['lin-help']??false).toBe(help);
      expect(s.flags['lin-original']??false).toBe(help);
      const text=s.history.flatMap(h=>h.lines).map(l=>l.text).join('');
      expect(text.includes('你没来，那天就没给我减')).toBe(route==='declined');
      if(!help)expect(text).not.toContain('你说能拿到的原记录都给我');
      expect(advanceStory(s,{operation:'choose',revision:s.revision,choice:'finish'})).toBe(false);
    });
  }
  it('rejects choices before the final line, stale input, and duplicate cash-out',()=>{
    const s=startStory(fixtures.attended.expected),snapshot=structuredClone(s);
    expect(advanceStory(s,{operation:'choose',revision:0,choice:'ask'})).toBe(false);expect(s).toEqual(snapshot);
    expect(advanceStory(s,{operation:'next',revision:9})).toBe(false);
    for(let i=0;i<10&&s.scene!=='n3-table';i++)choose(s,nextChoice(s,'account',true));
    const before=s.wallet;expect(choose(s,'play')).toBe('open-table');expect(s.wallet).toBe(before-50);
    expect(settleStoryTable(s,75,2,'left')).toBe(true);expect(s.wallet).toBe(before+25);
    expect(settleStoryTable(s,75,2,'left')).toBe(false);
    expect(advanceStory(s,{operation:'choose',revision:s.revision,choice:'collect'})).toBe('stay');
    expect(s.scene).toBe('n3-close');expect(s.results[0]?.net).toBe(25);
  });
  it('does not force wagering when money is insufficient and does not invent compensation on a declined visit',()=>{
    const source=structuredClone(fixtures.declined.expected);source.wallet=0;source.ledger=[{id:'opening',delta:0,balance:0,text:'测试余额',en:'Test balance'}];
    const s=startStory(source);
    for(let n=0;n<10&&s.scene!=='n3-table';n++)choose(s,nextChoice(s,'leave',false));
    read(s);expect(storyView(s).choices.find(c=>c.id==='play')?.enabled).toBe(false);
    const snap=structuredClone(s);expect(advanceStory(s,{operation:'choose',revision:s.revision,choice:'play'})).toBe(false);expect(s).toEqual(snap);
    choose(s,'skip');choose(s,'leave');choose(s,'finish');expect(s.phase).toBe('complete');expect(s.wallet).toBe(0);
    expect(s.ledger.some(e=>e.id==='kai:installment:1')).toBe(false);
  });
  it.each(['node','pages'] as const)('restores the exact old %s version, carries a non-default wallet, and resumes mid-dialogue',async host=>{
    const slots=new Slots(),old=structuredClone(fixtures.attended.checkpoint);old.engine=fixtures.versions[host];slots.values.set('journey',old);
    let api=createBrowserApi(slots,'campaign-v1');
    const loaded=await post(api,'/api/resume',{slot:'journey',checkpointId:old.summary.id});expect(loaded.status,loaded.body.error).toBe(200);
    let t=loaded.body.table!;expect(t.secondNight?.wallet).toBe(300);
    t=await command(api,t,'start');expect(t.campaign?.wallet).toBe(300);
    t=await command(api,t,'next');t=await command(api,t,'next');const current=t.campaign!;
    api=createBrowserApi(slots,'campaign-v1');
    const restored=await post(api,'/api/resume',{slot:'journey',checkpointId:slots.values.get('journey')!.summary.id});
    expect(restored.status,restored.body.error).toBe(200);expect(restored.body.table?.campaign).toEqual(current);
    expect(current.cursor).toBe(2);
    expect((await post(createBrowserApi(slots,'wrong-version'),'/api/resume',{slot:'journey',checkpointId:slots.values.get('journey')!.summary.id})).status).toBe(409);
  });
  it('plays a real third-night table, cashes out once, finishes later chapters, and replays the ending',async()=>{
    const slots=new Slots();slots.values.set('journey',structuredClone(fixtures.attended.checkpoint));const api=createBrowserApi(slots,'campaign-v1');
    let t=(await post(api,'/api/resume',{slot:'journey',checkpointId:fixtures.attended.checkpoint.summary.id})).body.table!;
    t=await command(api,t,'start');
    for(let n=0;n<40&&t.campaign!.phase!=='complete';n++){
      t=await apiRead(api,t);
      if(['n3-table','n4-table','n5-table'].includes(t.campaign!.scene)){
        const scene=t.campaign!.scene,cost=scene==='n4-table'?100:50;
        const wallet=t.campaign!.wallet;t=await command(api,t,'choose','play');
        expect(t.roster.length).toBe(scene==='n3-table'?2:scene==='n4-table'?4:3);expect(t.campaign?.wallet).toBe(wallet-cost);
        for(let i=0;i<40&&t.packet.kind==='decision';i++){
          const p=t.packet;const r=await post(api,'/api/action',{tableId:t.id,command:{type:'act',decisionKey:p.decisionKey,expectedPacketIndex:p.packetIndex,intent:{type:p.observation.legalActions.fold?'fold':'check'}}});
          expect(r.status,r.body.error).toBe(200);t=r.body.table!;
        }
        if(t.campaign?.phase==='playing')t=await command(api,t,'leave-table');
        const closing=t.view.seats.find(s=>s.seatIndex===0)!.stack;
        expect(t.campaign?.wallet).toBe(wallet-cost+closing);
        const html=renderMobileTable(t,{table:t,rosters:{}},{count:2,mode:'classic',difficulty:'standard',social:true,nightAbility:null},newMobileUi());
        expect(html).toContain('mobile-to-scene');
        t=await command(api,t,'choose','collect');continue;
      }
      const state={scene:t.campaign!.scene} as StoryState;
      t=await command(api,t,'choose',nextChoice(state,'account',true));
    }
    expect(t.campaign?.phase).toBe('complete');expect(slots.values.get('journey')?.summary.storyNight).toBe(6);
    for(const id of ['garage','room','lin'])expect(t.campaign?.ledger.filter(e=>e.id==='cash:'+id)).toHaveLength(1);
    expect(renderTable(t)).not.toContain('data-action="continue"');
    const saved=slots.values.get('journey')!,reload=await post(createBrowserApi(slots,'campaign-v1'),'/api/resume',{slot:'journey',checkpointId:saved.summary.id});
    expect(reload.status,reload.body.error).toBe(200);expect(reload.body.table?.campaign).toEqual(t.campaign);
  });
  it('keeps corrupt and unknown old records untouched',async()=>{
    const slots=new Slots(),old=structuredClone(fixtures.attended.checkpoint);slots.values.set('journey',old);
    old.digest='0'.repeat(64);
    expect((await post(createBrowserApi(slots,'campaign-v1'),'/api/resume',{slot:'journey',checkpointId:old.summary.id})).status).not.toBe(200);
    expect(slots.values.get('journey')).toEqual(old);old.engine='unknown-old';
    expect((await post(createBrowserApi(slots,'campaign-v1'),'/api/resume',{slot:'journey',checkpointId:old.summary.id})).status).toBe(409);
  });
});
