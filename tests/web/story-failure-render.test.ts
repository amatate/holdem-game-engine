import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderCampaignScene, canContinueVolume } from '../../src/web/story-render.js';
import type { WebTable } from '../../src/web/protocol.js';
const fixtures = JSON.parse(await readFile(new URL('../fixtures/volume-one-release.json',import.meta.url),'utf8')) as Record<string,{campaign:NonNullable<WebTable['campaign']>}>;
const h=(v:unknown)=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// These scenes only depend on the public campaign projection, never on private cards.
const table=(key:string)=>({campaign:structuredClone(fixtures[key]!.campaign)} as WebTable);
describe('Story failure and continuation controls',()=>{
  it('offers sequel continuation on a saved Volume One ending on mobile and desktop',()=>{
    const t=table('complete');expect(canContinueVolume(t)).toBe(true);
    for(const mobile of [true,false]){
      const html=renderCampaignScene(t,h,mobile);
      expect(html).toContain('data-choice="continue-volume-two"');expect(html).toContain('散桌以后');
      expect(html).toContain('data-action="home"');
    }
    t.campaign!.scene='w-ending-own';expect(canContinueVolume(t)).toBe(false);
    expect(renderCampaignScene(t,h,true)).not.toContain('data-choice="continue-volume-two"');
  });
  it('presents a loss with both continuation and explicit rollback without touching the snapshot',()=>{
    const t=table('practiceLoss'),before=structuredClone(t);
    const html=renderCampaignScene(t,h,true);
    expect(html).toContain('这桌使用记分筹码，钱包没有扣款');
    expect(html).toContain('data-choice="collect"');expect(html).toContain('data-choice="retry-table"');
    expect(html).toContain('同一发牌顺序');expect(html).toContain('之前的剧情选择保留');
    expect(t).toEqual(before);
  });
  it('shows actual cash loss and remaining money, including bankruptcy',()=>{
    const t=table('practiceLoss'),s=t.campaign!;s.night=8;s.wallet=0;s.table!.practice=false;
    s.results.at(-1)!.closing=0;s.results.at(-1)!.net=-100;
    const html=renderCampaignScene(t,h,true);
    expect(html).toContain('桌上筹码输完了，故事还在继续');expect(html).toContain('不下注的路线');expect(html).toContain('-100');
    expect(html).not.toContain('这桌使用记分筹码');
  });
  it('does not offer rollback for winning tables or legacy campaigns',()=>{
    const t=table('practiceLoss');t.campaign!.results.at(-1)!.net=10;
    expect(renderCampaignScene(t,h,true)).not.toContain('data-choice="retry-table"');
    t.campaign!.results.at(-1)!.net=-10;delete t.campaign!.edition;
    expect(renderCampaignScene(t,h,true)).not.toContain('data-choice="retry-table"');
  });
});
