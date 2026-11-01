import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createLocalServer } from '../../src/web/server.js';
import type { Checkpoint, CheckpointStore } from '../../src/web/checkpoint-data.js';
import type { WebTable, Bootstrap } from '../../src/web/protocol.js';
const fixtures=JSON.parse(await readFile(new URL('../fixtures/second-night-v1.json',import.meta.url),'utf8')) as {attended:{checkpoint:Checkpoint}};
describe('story mode Node persistence',()=>{
  it('migrates known v1 progress without changing money, then restarts at the exact dialogue line',async()=>{
    const token='00000000-0000-4000-8000-000000000099',saves=new Map<string,Checkpoint>([[token+':second-night',structuredClone(fixtures.attended.checkpoint)]]);
    const store:CheckpointStore={async read(k){return structuredClone(saves.get(k)??null);},async write(k,v){saves.set(k,structuredClone(v));}};
    let server=createLocalServer({checkpointStore:store}),origin='',cookie='';
    const start=async()=>{
      await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      const a=server.address();if(!a||typeof a==='string')throw new Error('No address');origin=`http://127.0.0.1:${a.port}`;cookie=`holdem_session_${a.port}=${token}`;
    };
    const close=async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));};
    const post=async(path:string,body:unknown)=>{
      const r=await fetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
      return {status:r.status,body:await r.json() as {table:WebTable;error?:string}};
    };
    await start();
    try{
      const bootstrap=await(await fetch(origin+'/api/bootstrap',{headers:{cookie}})).json() as Bootstrap;
      expect(bootstrap.journeySave?.error).toBeNull();expect(bootstrap.journeySave?.saved?.id).toBe(fixtures.attended.checkpoint.summary.id);
      let r=await post('/api/resume',{slot:'journey',checkpointId:fixtures.attended.checkpoint.summary.id});expect(r.status,r.body.error).toBe(200);
      let t=r.body.table;expect(t.secondNight?.wallet).toBe(300);
      r=await post('/api/story',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,input:{operation:'start',revision:t.secondNight!.revision}});
      expect(r.status,r.body.error).toBe(200);t=r.body.table;
      for(let n=0;n<2;n++){
        r=await post('/api/story',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,input:{operation:'next',revision:t.campaign!.revision}});
        expect(r.status,r.body.error).toBe(200);t=r.body.table;
      }
      const expected=t.campaign,saved=structuredClone(saves.get(token+':second-night')!);
      expect(saved.summary.wallet).toBe(300);expect(saved.summary.ended).toBe(false);
      const stale=await post('/api/story',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,input:{operation:'next',revision:0}});expect(stale.status).toBe(409);
      await close();server=createLocalServer({checkpointStore:store});await start();
      r=await post('/api/resume',{slot:'journey',checkpointId:saved.summary.id});
      expect(r.status,r.body.error).toBe(200);expect(r.body.table.campaign).toEqual(expected);
      expect(r.body.table.campaign?.cursor).toBe(2);expect(r.body.table.campaign?.wallet).toBe(300);
    }finally{if(server.listening)await close();}
  });
});
