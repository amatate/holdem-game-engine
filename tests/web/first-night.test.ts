import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/game/proxy-detection.js', () => ({ loadProxyDetector: () => () => false }));
import { createBrowserApi } from '../../src/web/browser-api.js';
import type { BrowserStore } from '../../src/web/browser-store.js';
import type { Checkpoint } from '../../src/web/checkpoint-data.js';
import type { WebTable } from '../../src/web/protocol.js';
import { renderTable, renderLobby } from '../../src/web/render.js';
import { rosterFor } from '../../src/web/table-session.js';

class Slots implements BrowserStore {
  values = new Map<string, Checkpoint>();
  async read(slot = 'settled') { return structuredClone(this.values.get(slot) ?? null); }
  async write(value: Checkpoint, expected: string | null, slot = 'settled') {
    if ((this.values.get(slot)?.summary.id ?? null) !== expected) throw new Error('Conflict');
    this.values.set(slot, structuredClone(value));
  }
}
type Api = ReturnType<typeof createBrowserApi>;
const post = (api: Api, path: string, body: unknown) => api(path, JSON.stringify(body));
const choose = async (api: Api, table: WebTable, choice: string) => {
  const r = await post(api, '/api/first-night', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex, revision: table.firstNight!.revision, choice });
  expect(r.status, r.body.error).toBe(200); return r.body.table!;
};
function command(table: WebTable, ability?: 'peek' | 'read' | 'swap') {
  if (table.packet.kind !== 'decision') throw new Error('Need decision');
  const p = table.packet;
  const selection = ability ? p.abilities?.availableCommands.find(c => c.ability === ability) : null;
  return { tableId: table.id, command: selection ? { type: 'useAbility', ...selection, decisionKey: p.decisionKey, expectedPacketIndex: p.packetIndex }
    : { type: 'act', intent: { type: p.observation.legalActions.fold ? 'fold' : 'check' }, decisionKey: p.decisionKey, expectedPacketIndex: p.packetIndex } };
}
async function finishHand(api: Api, table: WebTable) {
  for (let n = 0; n < 40 && table.packet.kind === 'decision'; n++) {
    const r = await post(api, '/api/action', command(table)); expect(r.status, r.body.error).toBe(200); table = r.body.table!;
  }
  expect(table.packet.kind).toBe('hand-result'); return table;
}
async function finishTable(api: Api, table: WebTable) {
  const nets: number[] = [];
  for (let n = 0; n < 6 && table.firstNight?.phase === 'playing'; n++) {
    table = await finishHand(api, table);
    if (table.packet.kind === 'hand-result') nets.push(table.packet.handResult.seats.find(s => s.seatIndex === 0)!.net);
    if (table.firstNight?.phase !== 'playing') break;
    const r = await post(api, '/api/continue', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex });
    expect(r.status, r.body.error).toBe(200); table = r.body.table!;
  }
  const score = table.firstNight!.scores.at(-1)!;
  expect(score.net).toBe(nets.reduce((a,b) => a+b, 0));
  expect(score.hands).toBeLessThanOrEqual(table.firstNight!.limit);
  expect(table.view.smallBlind).toBe(1); expect(table.view.bigBlind).toBe(2);
  return table;
}
beforeEach(() => {
  let n = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`);
});
afterEach(() => vi.restoreAllMocks());

describe('First Night playable chapter', () => {
  it('plays real capped tables, permits declining the duel, and ends without inventing a third result', async () => {
    const slots = new Slots(), api = createBrowserApi(slots, 'night-v1');
    let t = (await post(api, '/api/table', { experience: 'first-night' })).body.table!;
    expect(t.roster.map(p => p.characterId)).toEqual(['hero','calling-station']);
    expect(t.firstNight?.phase).toBe('intro'); expect(renderTable(t)).not.toContain('aria-label="德州牌桌"');
    expect((await post(api, '/api/action', command(t))).status).toBe(409);
    t = await choose(api,t,'where'); t = await finishTable(api,t);
    expect(t.firstNight?.phase).toBe('waiting'); expect(t.firstNight?.scores[0]?.hands).toBe(4);
    expect(renderTable(t)).not.toContain('data-action="continue"');
    expect((await post(api, '/api/continue', { tableId:t.id, expectedPacketIndex:t.packet.packetIndex })).status).toBe(409);
    const oldId=t.id, oldPacket=t.packet.packetIndex, oldRevision=t.firstNight!.revision;
    t=await choose(api,t,'ask');
    expect((await post(api,'/api/first-night',{tableId:t.id, expectedPacketIndex:t.packet.packetIndex,revision:oldRevision,choice:'ask'})).status).toBe(409);
    t=await choose(api,t,'normal');
    expect(t.id).not.toBe(oldId); expect(t.roster.map(p=>p.characterId)).toEqual(['hero','hunter','maniac','calling-station']);
    expect(t.firstNight?.previousObservations.map(m=>m.characterId)).toEqual(['calling-station']);
    expect(t.firstNight?.previousObservations[0]?.hands).toBeGreaterThan(0);
    expect(t.view.seats.reduce((sum,s)=>sum+s.stack+s.committedHand,0)).toBe(400);
    expect((await post(api,'/api/continue',{tableId:oldId,expectedPacketIndex:oldPacket})).status).toBe(409);
    t=await finishTable(api,t); expect(t.firstNight?.phase).toBe('duel-offer');
    t=await choose(api,t,'leave'); t=await choose(api,t,'next-time');
    expect(t.firstNight?.title).toBe('几天后');
    t=await choose(api,t,'who');
    expect(t.firstNight?.phase).toBe('complete'); expect(t.firstNight?.scores).toHaveLength(2);
    expect(t.firstNight?.invitation).toBe('who'); expect(slots.values.get('chapter')?.summary.ended).toBe(true);
    const restored=await post(createBrowserApi(slots,'night-v1'),'/api/resume',{slot:'chapter',checkpointId:slots.values.get('chapter')!.summary.id});
    expect(restored.status,restored.body.error).toBe(200); expect(restored.body.table?.firstNight).toEqual(t.firstNight);
  });
  it('charges energy only for accepted selected abilities, prevents repeat rests, and restores across all three tables', async () => {
    const slots=new Slots(),api=createBrowserApi(slots,'night-v1');
    let t=(await post(api,'/api/table',{experience:'first-night',mode:'ability-lab',nightAbility:'peek'})).body.table!;
    t=await choose(api,t,'sit');
    const forbidden=await post(api,'/api/action',command(t,'read'));
    expect(forbidden.status).toBe(409); expect(forbidden.body.table?.firstNight?.energy).toBe(3);
    const peek=command(t,'peek'); t=(await post(api,'/api/action',peek)).body.table!;
    expect(t.firstNight?.energy).toBe(1);
    expect((await post(api,'/api/action',peek)).body.table?.firstNight?.energy).toBe(1);
    t=await finishTable(api,t); t=await choose(api,t,'wait'); expect(t.firstNight?.energy).toBe(2);
    t=await choose(api,t,'slow');
    const atStart=slots.values.get('chapter')!;
    const restored=await post(createBrowserApi(slots,'night-v1'),'/api/resume',{slot:'chapter',checkpointId:atStart.summary.id});
    expect(restored.status,restored.body.error).toBe(200); expect(restored.body.table?.firstNight).toEqual(t.firstNight);
    const peek2=command(t,'peek'); t=(await post(api,'/api/action',peek2)).body.table!;
    expect(t.firstNight?.energy).toBe(0); expect(slots.values.get('chapter')!.summary.id).toBe(atStart.summary.id);
    t=await finishTable(api,t); t=await choose(api,t,'rest'); expect(t.firstNight?.energy).toBe(1);
    expect((await post(api,'/api/first-night',{tableId:t.id,expectedPacketIndex:t.packet.packetIndex,revision:t.firstNight!.revision,choice:'rest'})).status).toBe(409);
    t=await choose(api,t,'duel'); expect(t.roster.map(p=>p.characterId)).toEqual(['hero','hunter']);
    expect(t.firstNight?.previousObservations.map(m=>m.characterId)).toEqual(['hunter']);
    expect((await post(api,'/api/action',command(t,'peek'))).status).toBe(409); expect(t.firstNight?.energy).toBe(1);
    t=await finishTable(api,t); t=await choose(api,t,'bye'); t=await choose(api,t,'stakes');
    expect(t.firstNight?.scores).toHaveLength(3); expect(t.firstNight?.invitation).toBe('stakes');
    const saved=slots.values.get('chapter')!;
    const replayed=await post(createBrowserApi(slots,'night-v1'),'/api/resume',{slot:'chapter',checkpointId:saved.summary.id});
    expect(replayed.status,replayed.body.error).toBe(200); expect(replayed.body.table?.firstNight).toEqual(t.firstNight);
    expect(replayed.body.table?.packet).toEqual(t.packet);
  });
  it('keeps ordinary and chapter slots independent and rejects wrong-slot, old-version and forged saves',async()=>{
    const slots=new Slots(),api=createBrowserApi(slots,'night-v1');
    let free=(await post(api,'/api/table',{players:2})).body.table!; free=await finishHand(api,free);
    const ordinary=structuredClone(slots.values.get('settled')!);
    let t=(await post(api,'/api/table',{experience:'first-night'})).body.table!;
    expect(slots.values.get('settled')).toEqual(ordinary);
    t=await choose(api,t,'beginner'); t=await finishHand(api,t); t=await choose(api,t,'leave-table');
    expect(t.firstNight?.scores).toHaveLength(1); expect(t.firstNight?.scores[0]?.reason).toBe('left');
    const bootstrap=await createBrowserApi(slots,'night-v1')('/api/bootstrap');
    expect(bootstrap.body.save?.saved?.id).toBe(ordinary.summary.id); expect(bootstrap.body.chapterSave?.saved).not.toBeNull();
    const id=slots.values.get('chapter')!.summary.id;
    expect((await post(createBrowserApi(slots,'night-v1'),'/api/resume',{checkpointId:id})).status).toBe(409);
    expect((await post(createBrowserApi(slots,'different'),'/api/resume',{checkpointId:id,slot:'chapter'})).status).toBe(409);
    slots.values.get('chapter')!.digest='0'.repeat(64);
    expect((await post(createBrowserApi(slots,'night-v1'),'/api/resume',{checkpointId:id,slot:'chapter'})).status).not.toBe(200);
    expect(slots.values.get('settled')).toEqual(ordinary);
    expect(renderLobby({2:rosterFor(2)},2,'classic',true,undefined,false,'standard',bootstrap.body.chapterSave)).toContain('night-restore');
  });
  it.each(['read','swap'] as const)('runs the %s route with the real ability command and a single-table charge',async ability=>{
    const slots=new Slots(),api=createBrowserApi(slots,'night-v1');
    let t=(await post(api,'/api/table',{experience:'first-night',mode:'ability-lab',nightAbility:ability})).body.table!;
    t=await choose(api,t,'sit'); const use=command(t,ability);
    const accepted=await post(api,'/api/action',use); expect(accepted.status,accepted.body.error).toBe(200);t=accepted.body.table!;
    expect(t.firstNight?.energy).toBe(ability==='read'?2:1);
    expect((await post(api,'/api/action',use)).status).toBe(409);
    expect(renderTable(t)).toContain('每桌最多一次');
  });
});
