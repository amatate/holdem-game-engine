import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/game/proxy-detection.js', () => ({ loadProxyDetector: () => () => false }));
import { newSecondNight, chooseSecondNight, secondNightView, settleSecondNight } from '../../src/game/second-night.js';
import { createBrowserApi } from '../../src/web/browser-api.js';
import type { BrowserStore, SaveSlot } from '../../src/web/browser-store.js';
import type { Checkpoint } from '../../src/web/checkpoint-data.js';
import type { WebTable } from '../../src/web/protocol.js';
import { renderTable } from '../../src/web/render.js';
import { renderMobileTable } from '../../src/web/mobile-render.js';
import { newMobileUi } from '../../src/web/mobile-model.js';

class Slots implements BrowserStore {
  values = new Map<string, Checkpoint>();
  async read(slot?: SaveSlot) { return structuredClone(this.values.get(slot ?? 'settled') ?? null); }
  async write(value: Checkpoint, expected: string | null, slot?: SaveSlot) {
    if ((this.values.get(slot ?? 'settled')?.summary.id ?? null) !== expected) throw new Error('Conflict');
    this.values.set(slot ?? 'settled', structuredClone(value));
  }
}
type Api = ReturnType<typeof createBrowserApi>;
const post = (api: Api, path: string, body: unknown) => api(path, JSON.stringify(body));
async function choose(api: Api, t: WebTable, choice: string) {
  const r=await post(api,'/api/second-night',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,revision:t.secondNight!.revision,choice});
  expect(r.status,r.body.error).toBe(200);return r.body.table!;
}
async function finishHand(api: Api, t: WebTable) {
  for(let i=0;i<40&&t.packet.kind==='decision';i++){
    const p=t.packet;
    const r=await post(api,'/api/action',{tableId:t.id,command:{type:'act',decisionKey:p.decisionKey,expectedPacketIndex:p.packetIndex,intent:{type:p.observation.legalActions.fold?'fold':'check'}}});
    expect(r.status,r.body.error).toBe(200);t=r.body.table!;
  }
  expect(t.packet.kind).toBe('hand-result');return t;
}
beforeEach(()=>{let n=0;vi.spyOn(crypto,'randomUUID').mockImplementation(()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`);});
afterEach(()=>vi.restoreAllMocks());

describe('Second Night wallet and goals',()=>{
  it.each([0,145,400])('cash-outs %s once, preserves balance and rejects late choices',closing=>{
    const s=newSecondNight();
    expect(chooseSecondNight(s,'buy',0)).toBe(false);
    chooseSecondNight(s,'decline',s.revision);chooseSecondNight(s,'old-table',s.revision);
    const rev=s.revision;
    expect(chooseSecondNight(s,'buy',rev)).toBe('open-table');
    expect(s.wallet).toBe(500);expect(chooseSecondNight(s,'buy',rev)).toBe(false);
    const valid=closing<=300;
    expect(settleSecondNight(s,closing,1,'left')).toBe(valid);
    if(!valid)return;
    expect(s.wallet).toBe(500+closing);expect(s.result?.net).toBe(closing-100);
    expect(settleSecondNight(s,closing,1,'left')).toBe(false);
    expect(s.ledger.reduce((sum,e)=>sum+e.delta,0)).toBe(s.wallet);
  });
  it('declines without a buy-in, keeps 600 and records only witnessed facts',()=>{
    const s=newSecondNight();
    chooseSecondNight(s,'decline',0);chooseSecondNight(s,'ask-mo',s.revision);chooseSecondNight(s,'head-home',s.revision);
    expect(s.wallet).toBe(600);expect(s.ledger).toHaveLength(1);expect(s.result).toBeNull();
    expect(secondNightView(s).goal).toContain('核对');
    chooseSecondNight(s,'later',s.revision);expect(s.phase).toBe('complete');
    expect(s.facts).toHaveLength(2);
  });
  it.each(['new','old'] as const)('uses the real %s table, returns its closing stack and replays all money',async route=>{
    const slots=new Slots(),api=createBrowserApi(slots,'second-v1');
    // A pre-existing First Night record remains byte-for-byte independent.
    await post(api,'/api/table',{experience:'first-night'});
    const first=structuredClone(slots.values.get('chapter'));
    let t=(await post(api,'/api/table',{experience:'second-night',difficulty:'casual'})).body.table!;
    expect(t.secondNight?.wallet).toBe(600);expect(renderTable(t)).not.toContain('aria-label="德州牌桌"');
    const initial=slots.values.get('journey')!;
    const load=await post(createBrowserApi(slots,'second-v1'),'/api/resume',{slot:'journey',checkpointId:initial.summary.id});
    expect(load.status,load.body.error).toBe(200);
    if(route==='new'){t=await choose(api,t,'terms');t=await choose(api,t,'visit');}
    else{t=await choose(api,t,'decline');t=await choose(api,t,'old-table');}
    const buy=route==='new'?300:100,oldId=t.id;
    t=await choose(api,t,'buy');
    expect(t.id).not.toBe(oldId);expect(t.secondNight?.wallet).toBe(600-buy);
    expect(t.roster).toHaveLength(route==='new'?4:3);
    expect(t.view.bigBlind).toBe(route==='new'?5:2);
    expect(t.view.seats.reduce((sum,s)=>sum+s.stack+s.committedHand,0)).toBe(buy*t.roster.length);
    const started=slots.values.get('journey')!;
    const restored=await post(createBrowserApi(slots,'second-v1'),'/api/resume',{slot:'journey',checkpointId:started.summary.id});
    expect(restored.status,restored.body.error).toBe(200);expect(restored.body.table?.secondNight).toEqual(t.secondNight);
    t=await finishHand(api,t);
    const stack=t.view.seats.find(s=>s.seatIndex===0)!.stack;
    if(t.secondNight?.phase==='playing')t=await choose(api,t,'leave-table');
    expect(t.secondNight?.wallet).toBe(600-buy+stack);expect(t.secondNight?.ledger.filter(e=>e.id==='cash-out')).toHaveLength(1);
    expect(renderTable(t)).not.toContain('data-action="continue"');
    expect((await post(api,'/api/continue',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex})).status).toBe(409);
    const mobile=renderMobileTable(t,{rosters:{},table:t},{count:4,mode:'classic',difficulty:'standard',social:true,nightAbility:null},newMobileUi());
    expect(mobile).toContain('mobile-to-scene');expect(mobile).not.toContain('你那笔，明天');
    t=await choose(api,t,'after-table');t=await choose(api,t,'ask-record');
    expect(t.secondNight?.phase).toBe('complete');expect(slots.values.get('chapter')).toEqual(first);
    const saved=slots.values.get('journey')!;
    expect(saved.summary.ended).toBe(true);
    const replay=await post(createBrowserApi(slots,'second-v1'),'/api/resume',{slot:'journey',checkpointId:saved.summary.id});
    expect(replay.status,replay.body.error).toBe(200);expect(replay.body.table?.secondNight).toEqual(t.secondNight);
    expect((await post(createBrowserApi(slots,'second-v1'),'/api/resume',{slot:'chapter',checkpointId:saved.summary.id})).status).toBe(409);
  });
  it.each(['new','old'] as const)('finishes a full capped %s table and never cashes out twice',async route=>{
    const api=createBrowserApi(new Slots(),'second-v1');
    let t=(await post(api,'/api/table',{experience:'second-night',difficulty:'casual'})).body.table!;
    if(route==='new'){t=await choose(api,t,'terms');t=await choose(api,t,'visit');}
    else{t=await choose(api,t,'decline');t=await choose(api,t,'old-table');}
    t=await choose(api,t,'buy');
    for(let n=0;n<8&&t.secondNight?.phase==='playing';n++){
      t=await finishHand(api,t);
      if(t.secondNight?.phase!=='playing')break;
      const r=await post(api,'/api/continue',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex});expect(r.status).toBe(200);t=r.body.table!;
    }
    expect(t.secondNight?.phase).toBe('settled');expect(t.secondNight?.result?.hands).toBeLessThanOrEqual(route==='new'?8:6);
    expect(t.secondNight?.ledger.filter(e=>e.id==='cash-out')).toHaveLength(1);
  });
  it('rejects ability mode, wagering before buying, stale choices and wrong packet indices',async()=>{
    const api=createBrowserApi(new Slots(),'second-v1');
    expect((await post(api,'/api/table',{experience:'second-night',mode:'ability-lab'})).status).toBe(400);
    let t=(await post(api,'/api/table',{experience:'second-night'})).body.table!;
    if(t.packet.kind!=='decision')throw new Error('Need decision');
    expect((await post(api,'/api/action',{tableId:t.id,command:{type:'act',decisionKey:t.packet.decisionKey,expectedPacketIndex:t.packet.packetIndex,intent:{type:'fold'}}})).status).toBe(409);
    const stale={tableId:t.id,expectedPacketIndex:t.packet.packetIndex,revision:t.secondNight!.revision,choice:'terms'};
    t=await choose(api,t,'terms');
    expect((await post(api,'/api/second-night',stale)).status).toBe(409);
    expect((await post(api,'/api/second-night',{...stale,revision:t.secondNight!.revision,expectedPacketIndex:999,choice:'visit'})).status).toBe(409);
    expect(t.secondNight?.wallet).toBe(600);
  });
});
