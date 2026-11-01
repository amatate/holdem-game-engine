import { describe, expect, it } from 'vitest';
import { createLocalServer } from '../../src/web/server.js';
import type { Checkpoint, CheckpointStore } from '../../src/web/checkpoint-data.js';
import type { WebTable, Bootstrap } from '../../src/web/protocol.js';

describe('First Night local server persistence',()=>{
  it('restarts at a chapter boundary and retains the separate ordinary checkpoint',async()=>{
    const saves=new Map<string,Checkpoint>();
    const store:CheckpointStore={async read(key){return structuredClone(saves.get(key)??null);},async write(key,value){saves.set(key,structuredClone(value));}};
    let server=createLocalServer({checkpointStore:store}),cookie='',origin='';
    const start=async()=>{
      await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      const address=server.address();if(!address||typeof address==='string')throw new Error('No port');origin=`http://127.0.0.1:${address.port}`;
    };
    const close=async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));};
    const post=async(path:string,body:unknown)=>{
      const r=await fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
      const next=r.headers.get('set-cookie');if(next)cookie=next.split(';')[0]!;
      return {status:r.status,body:await r.json() as {table:WebTable,error?:string}};
    };
    await start();
    try{
      let t=(await post('/api/table',{players:2})).body.table;
      for(let i=0;i<40&&t.packet.kind==='decision';i++){
        const p=t.packet; const r=await post('/api/action',{tableId:t.id,command:{type:'act',decisionKey:p.decisionKey,expectedPacketIndex:p.packetIndex,intent:{type:p.observation.legalActions.fold?'fold':'check'}}});
        expect(r.status,r.body.error).toBe(200);t=r.body.table;
      }
      expect(saves.size).toBe(1);const free=structuredClone([...saves.values()][0]!);
      const opened=await post('/api/table',{experience:'first-night'});expect(opened.status).toBe(200);t=opened.body.table;
      expect(saves.size).toBe(2);expect([...saves.values()].find(s=>s.setup.experience==='free')).toEqual(free);
      const chosen=await post('/api/first-night',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,revision:t.firstNight!.revision,choice:'where'});
      expect(chosen.status,chosen.body.error).toBe(200);t=chosen.body.table;
      const saved=[...saves.values()].find(s=>s.setup.experience==='first-night')!;
      // The production cookie is port-scoped; keep its token while emulating a restart on a new test port.
      const token=cookie.slice(cookie.indexOf('=')+1);
      await close(); server=createLocalServer({checkpointStore:store});await start();
      cookie=`holdem_session_${new URL(origin).port}=${token}`;
      const bootstrap=await fetch(origin+'/api/bootstrap',{headers:{cookie}});
      const boot=await bootstrap.json() as Bootstrap;
      expect(boot.chapterSave?.saved?.id).toBe(saved.summary.id);expect(boot.save?.saved?.id).toBe(free.summary.id);
      const restored=await post('/api/resume',{slot:'chapter',checkpointId:saved.summary.id});
      expect(restored.status,restored.body.error).toBe(200);expect(restored.body.table.firstNight).toEqual(t.firstNight);
    }finally{if(server.listening)await close();}
  });
});
