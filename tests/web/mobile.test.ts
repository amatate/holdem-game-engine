import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/game/proxy-detection.js',()=>({loadProxyDetector:()=>()=>false}));
import { openLocalTable } from '../../src/web/table-session.js';
import { tableCommand, tableContinue, chapterChoice } from '../../src/web/table-actions.js';
import { newMobileUi, normalizeMobileUi, mobileRaise, validMobileRaise } from '../../src/web/mobile-model.js';
import { renderMobileHome, renderMobileTable } from '../../src/web/mobile-render.js';
import { buildPlaybackFrames } from '../../src/web/playback.js';
import type { Bootstrap } from '../../src/web/protocol.js';

const setup={count:4,mode:'classic' as const,difficulty:'standard' as const,social:true,nightAbility:null};
describe('mobile presentation and wager draft',()=>{
  it.each([2,3,4,5,6])('renders all %i seats from the real table without exposing opponents’ cards',async players=>{
    const session=await openLocalTable(players,'classic','free',0,true,`mobile-${players}`,'casual');
    const table=session.table, ui=newMobileUi(); normalizeMobileUi(ui,table);
    const html=renderMobileTable(table,{rosters:{},table},{...setup,count:players},ui);
    expect([...html.matchAll(/<article class="seat /g)]).toHaveLength(players);
    expect(html).toContain(`data-count="${players}"`);expect(html).toContain('mobile-action-dock');
    expect(html).not.toContain('playback-toolbar');expect(html).not.toContain('data-character-info');
    expect(table.view.seats.filter(s=>s.seatIndex!==0).every(s=>s.cards===null)).toBe(true);
    for(const person of table.roster.filter(p=>p.seatIndex!==0))expect(html).toContain(`data-seat-index="${person.seatIndex}"`);
  });
  it('uses the legal total-bet range, submits a real raise, and invalidates the stale draft',async()=>{
    const session=await openLocalTable(2,'classic','free',0,false,'mobile-raise-real','casual');
    const table=session.table;if(table.packet.kind!=='decision')throw new Error('No turn');
    const ui=newMobileUi();normalizeMobileUi(ui,table);ui.sheet='raise';
    const range=mobileRaise(table)!;expect(range.minimum).toBe(4);expect(range.maximum).toBe(100);
    ui.amount=6;expect(validMobileRaise(table,ui)).toBe(6);
    const oldKey=ui.decision;
    const result=await tableCommand(session,{type:'act',decisionKey:table.packet.decisionKey,expectedPacketIndex:table.packet.packetIndex,intent:{type:'raiseTo',amount:6}});
    expect(result.accepted).toBe(true);expect(session.table.view.log.some(l=>l.includes('6'))).toBe(true);
    expect(validMobileRaise(session.table,ui)).toBeNull();normalizeMobileUi(ui,session.table);
    expect(ui.decision).not.toBe(oldKey);expect(ui.sheet).toBeNull();
  });
  it('does not offer inactive raises, or accept out-of-range and fractional draft amounts',async()=>{
    const session=await openLocalTable(2,'classic','free',0,false,'mobile-invalid','casual');
    const ui=newMobileUi();normalizeMobileUi(ui,session.table);
    for(const amount of [NaN,Infinity,-1,1,1000,5.5]){ui.amount=amount;expect(validMobileRaise(session.table,ui)).toBeNull();}
    ui.amount=mobileRaise(session.table)!.minimum;ui.tableId='old-table';expect(validMobileRaise(session.table,ui)).toBeNull();
  });
  it('keeps scene reading separate from poker and renders only the current dialogue line',async()=>{
    const session=await openLocalTable(2,'classic','first-night',0,true,'mobile-scene','casual');
    const ui=newMobileUi();normalizeMobileUi(ui,session.table);
    const state={rosters:{},table:session.table};
    let html=renderMobileTable(session.table,state,setup,ui);
    expect(html).toContain('mobile-scene-next');expect(html).not.toContain('data-choice="sit"');expect(html).not.toContain('mobile-arena');
    ui.line=2;html=renderMobileTable(session.table,state,setup,ui);
    expect(html).toContain('data-choice="sit"');expect(session.firstNight?.phase).toBe('intro');
  });
  it('does not show future settlements, ability information or character notes during playback',async()=>{
    const session=await openLocalTable(2,'ability-lab','free',0,true,'mobile-frames','casual');
    const table=session.table, frames=buildPlaybackFrames(null,table.packet.viewerEventsSinceLastPacket,table.roster);
    const frame=frames[0]!;expect(frame).toBeDefined();
    const ui=newMobileUi();normalizeMobileUi(ui,table);ui.sheet='abilities';
    const html=renderMobileTable(table,{rosters:{},table},{...setup,mode:'ability-lab'},ui,{frame,step:1,total:frames.length});
    expect(html).not.toContain('mobile-sheet-backdrop');expect(html).not.toContain('private-intel');expect(html).not.toContain('mobile-result-mini');
    expect(html).toContain('data-action="mobile-skip"');
  });
  it('keeps both save slots reachable from the game home',()=>{
    const summary={id:'save',savedAt:new Date().toISOString(),hand:2,heroStack:90,players:2,mode:'classic' as const,experience:'first-night' as const,lesson:null,ended:false};
    const state:Bootstrap={table:null,rosters:{},chapterSave:{enabled:true,saved:summary,error:null},save:{enabled:true,saved:{...summary,id:'free',experience:'free'},error:null}};
    const html=renderMobileHome(state,setup,newMobileUi());expect(html).toContain('data-action="night-restore"');expect(html).toContain('data-action="restore"');expect(html).toContain('mobile-home-room');
  });
  it('shows the real settled hand before entering a between-table scene',async()=>{
    const session=await openLocalTable(2,'classic','first-night',0,true,'mobile-result-before-story','casual');
    await chapterChoice(session,'sit',0);
    for(let n=0;n<50&&session.firstNight?.phase==='playing';n++){
      const p=session.table.packet;
      if(p.kind==='decision')await tableCommand(session,{type:'act',decisionKey:p.decisionKey,expectedPacketIndex:p.packetIndex,intent:{type:p.observation.legalActions.fold?'fold':'check'}});
      else if(p.kind==='hand-result')await tableContinue(session,p.packetIndex);
    }
    expect(session.table.packet.kind).toBe('hand-result');expect(session.firstNight?.phase).toBe('waiting');
    const table=session.table,ui=newMobileUi();normalizeMobileUi(ui,table);
    const state={rosters:{},table};
    expect(renderMobileTable(table,state,setup,ui)).toContain('data-action="mobile-to-scene"');
    ui.reviewedResult=`${table.id}:${table.packet.packetIndex}`;
    const html=renderMobileTable(table,state,setup,ui);expect(html).toContain('mobile-dialogue-box');expect(html).not.toContain('mobile-arena');
  });
});
