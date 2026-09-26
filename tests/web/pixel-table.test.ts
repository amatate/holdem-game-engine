import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { PublicGameEvent } from '../../src/core/public-events.js';
import type { SeatIdentity } from '../../src/web/protocol.js';
import { buildPlaybackFrames } from '../../src/web/playback.js';
import { renderPlaybackFrame } from '../../src/web/render.js';

const roster: SeatIdentity[] = [
  { seatIndex:0, playerId:'你', name:'你', nickname:'玩家', style:'', characterId:'hero' },
  { seatIndex:1, playerId:'林岚', name:'林岚', nickname:'猎手', style:'', characterId:'hunter' },
];
const events: PublicGameEvent[] = [
  { type:'gameStarted', maxSeats:2, startingStack:100 },
  { type:'handStarted', handNumber:1, smallBlind:1, bigBlind:2 },
  { type:'positionsAssigned', buttonPosition:0, smallBlindSeat:0, bigBlindSeat:1 },
  { type:'playerActed', seatIndex:1, kind:'raise', paid:10, betTo:10, allIn:false },
  { type:'potAwarded', potId:'pot-0', winners:[1], amounts:[10], oddChipRecipients:[] },
];
describe('pixel table public presentation', () => {
  it('switches expressions only for visible speech and public awards', () => {
    const frames = buildPlaybackFrames(null, events, roster);
    const raised = frames.find(frame => frame.event.type === 'playerActed')!;
    const normal = renderPlaybackFrame(raised, roster, 1, 3);
    expect(normal).toContain('portrait-neutral');
    expect(normal).not.toContain('portrait-win');
    expect(normal).not.toContain('portrait-speaking');
    expect(normal).not.toContain('data-intent=');
    expect(normal).toContain('aria-label="未公开的底牌"');
    const line = { id:1, hand:1, speaker:'林岚', seatIndex:1, packetIndex:0, eventIndex:3, kind:'speech' as const, text:'继续。' };
    expect(renderPlaybackFrame({ ...raised, line }, roster, 1, 3)).toContain('portrait-speaking');
    expect(renderPlaybackFrame({ ...raised, line:{ ...line, kind:'observation' } }, roster, 1, 3)).toContain('portrait-neutral');
    const award = frames.find(frame => frame.event.type === 'potAwarded')!;
    expect(renderPlaybackFrame(award, roster, 3, 3)).toContain('portrait-win');
  });
  it('maps only allowlisted character identities to assets and keeps fallback names', () => {
    const frame = buildPlaybackFrames(null, events, roster)[0]!;
    const unsafe = [roster[0]!, { ...roster[1]!, characterId:'../../private', name:'<script>x</script>' }];
    const html = renderPlaybackFrame(frame, unsafe, 1, 3);
    expect(html).toContain('portrait-fallback');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('portrait-atlas');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('ability-panel');
  });
});

/** Read-only PNG validation: alpha is checked, not inferred just from an RGBA header. */
function atlasAlpha(name: string) {
  const bytes = readFileSync(new URL('../../src/web/art/' + name + '-v1.png', import.meta.url));
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  expect(bytes[24]).toBe(8); expect(bytes[25]).toBe(6); expect(bytes[28]).toBe(0);
  const chunks: Buffer[] = [];
  for(let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if(bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * 4;
  let previous = new Uint8Array(stride), transparent = 0, nearOpaque = 0;
  const paeth = (a:number,b:number,c:number) => {
    const p = a + b - c, da = Math.abs(p-a), db = Math.abs(p-b), dc = Math.abs(p-c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for(let y = 0; y < height; y++) {
    const row = new Uint8Array(stride), start = y * (stride + 1), filter = raw[start]!;
    for(let x = 0; x < stride; x++) {
      const left = x >= 4 ? row[x-4]! : 0, up = previous[x]!, corner = x >= 4 ? previous[x-4]! : 0;
      const add = [0,left,up,Math.floor((left+up)/2),paeth(left,up,corner)][filter];
      if(add === undefined) throw new Error('Unknown PNG filter');
      row[x] = (raw[start+1+x]! + add) & 255;
      // The generated foreground uses alpha 252–253; require >=98% opacity,
      // alongside genuine alpha-zero background, rather than a specific encoder value.
      if(x % 4 === 3) { if(row[x] === 0) transparent++; if(row[x]! >= 250) nearOpaque++; }
    }
    previous = row;
  }
  return { width, height, transparent, nearOpaque };
}
it.each(['hunter','maniac','calling-station'])('%s has three equal atlas cells and real transparency', name => {
  const atlas = atlasAlpha(name);
  expect(atlas.width).toBe(1536); expect(atlas.height).toBe(1024);
  expect(atlas.width % 3).toBe(0);
  expect(atlas.transparent).toBeGreaterThan(atlas.width * atlas.height * .05);
  expect(atlas.nearOpaque).toBeGreaterThan(atlas.width * atlas.height * .2);
});
