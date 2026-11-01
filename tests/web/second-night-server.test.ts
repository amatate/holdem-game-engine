import { describe, expect, it } from 'vitest';
import { createLocalServer } from '../../src/web/server.js';
import type { Checkpoint, CheckpointStore } from '../../src/web/checkpoint-data.js';
import type { Bootstrap, WebTable } from '../../src/web/protocol.js';
describe('Second Night Node restart',()=>{
  it('replays buy-in and cash-out without duplicating money or touching First Night',async()=>{
    const saves=new Map<string,Checkpoint>();
    const store:CheckpointStore={async read(key){return structuredClone(saves.get(key)??null);},async write(key,value){saves.set(key,structuredClone(value));}};
    let server=createLocalServer({checkpointStore:store}),cookie='',origin='';
    const start=async()=>{
      await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      const address=server.address();if(!address||typeof address==='string')throw new Error('No address');origin=`http://127.0.0.1:${address.port}`;
    };
    const close=async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));};
    const post=async(path:string,body:unknown)=>{
      const r=await fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
      cookie=r.headers.get('set-cookie')?.split(';')[0]??cookie;
      return {status:r.status,body:await r.json() as {table:WebTable,error?:string}};
    };
    const choose=async(t:WebTable,choice:string)=>{
      const r=await post('/api/second-night',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,revision:t.secondNight!.revision,choice});
      expect(r.status,r.body.error).toBe(200);return r.body.table;
    };
    await start();
    try{
      await post('/api/table',{experience:'first-night'});
      const first=structuredClone([...saves.values()].find(s=>s.setup.experience==='first-night'));
      let t=(await post('/api/table',{experience:'second-night',difficulty:'casual'})).body.table;
      t=await choose(t,'terms');t=await choose(t,'visit');t=await choose(t,'buy');
      for(let n=0;n<40&&t.packet.kind==='decision';n++){
        const p=t.packet;
        const r=await post('/api/action',{tableId:t.id,command:{type:'act',decisionKey:p.decisionKey,expectedPacketIndex:p.packetIndex,intent:{type:p.observation.legalActions.fold?'fold':'check'}}});
        expect(r.status,r.body.error).toBe(200);t=r.body.table;
      }
      if(t.secondNight!.phase==='playing')t=await choose(t,'leave-table');
      const saved=[...saves.values()].find(s=>s.setup.experience==='second-night')!;
      const expected=t.secondNight,token=cookie.slice(cookie.indexOf('=')+1);
      await close();server=createLocalServer({checkpointStore:store});await start();
      cookie=`holdem_session_${new URL(origin).port}=${token}`;
      const bootstrap=await (await fetch(origin+'/api/bootstrap',{headers:{cookie}})).json() as Bootstrap;
      expect(bootstrap.journeySave?.saved?.id).toBe(saved.summary.id);expect(bootstrap.chapterSave?.saved?.id).toBe(first!.summary.id);
      const restore=await post('/api/resume',{slot:'journey',checkpointId:saved.summary.id});
      expect(restore.status,restore.body.error).toBe(200);expect(restore.body.table.secondNight).toEqual(expected);
      expect(restore.body.table.secondNight?.ledger.map(e=>e.id)).toEqual(['opening','buy-in','cash-out']);
      expect([...saves.values()].find(s=>s.setup.experience==='first-night')).toEqual(first);
    }finally{if(server.listening)await close();}
  });
});
