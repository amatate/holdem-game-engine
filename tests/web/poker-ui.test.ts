import { describe, expect, it } from 'vitest';
import { createStandardDeck, parseCard } from '../../src/core/cards.js';
import type { HandCategory } from '../../src/core/hand-evaluator.js';
import { cardFace, orderedBestFive } from '../../src/web/poker-cards.js';
import { renderPlaybackFrame, renderTable } from '../../src/web/render.js';
import { translateText } from '../../src/web/i18n.js';
import { pokerUiTable } from '../fixtures/poker-ui.js';

describe('legible poker cards and honest settlement', () => {
  it.each(createStandardDeck())('renders $code once, with a crisp pip and correct suit color', card => {
    for (const small of [true, false]) {
      const html = cardFace(card, small);
      expect(html.match(/class="card-rank"/g)).toHaveLength(1);
      expect(html.match(/class="card-pip"/g)).toHaveLength(1);
      expect(html).not.toContain('card-corner');
      expect(html.includes('card-red')).toBe(card.suit === 'h' || card.suit === 'd');
      if (card.rank === 10) expect(html).toContain('>10</span>');
      expect(html).toContain('aria-hidden="true" focusable="false"');
    }
  });
  it('never puts a value or source marker on a hidden card', () => {
    expect(cardFace(null, true, true)).toBe('<span class="card poker-card card-back card-small" role="img" aria-label="未公开的底牌"></span>');
  });
  it.each([
    ['three-of-a-kind', 'Ks Jh 8c Js Jc', 'Jh Js Jc Ks 8c'],
    ['two-pair', 'Ks Jh 8c Kh 8s', 'Ks Kh 8c 8s Jh'],
    ['full-house', 'Ah Jc Ad Jh Js', 'Jc Jh Js Ah Ad'],
    ['four-of-a-kind', 'Ac 2h 2s 2c 2d', '2h 2s 2c 2d Ac'],
    ['one-pair', 'Ks 3c Ac 3h Qs', '3c 3h Ac Ks Qs'],
    ['straight', 'As 3h 5c 2d 4s', '5c 4s 3h 2d As'],
    ['straight-flush', 'Ah 3h 5h 2h 4h', '5h 4h 3h 2h Ah'],
    ['straight', 'As Th Qc Jd Ks', 'As Ks Qc Jd Th'],
    ['flush', '2h Qh 7h Ah Th', 'Ah Qh Th 7h 2h'],
    ['high-card', '2h Qc 7h As Td', 'As Qc Td 7h 2h'],
  ])('groups %s without mutating or substituting the actual chosen five', (category, input, output) => {
    const cards = Object.freeze(input.split(' ').map(parseCard));
    expect(orderedBestFive(cards, category as HandCategory).map(card => card.code).join(' ')).toBe(output);
    expect(cards.map(card => card.code).join(' ')).toBe(input);
  });
  it('ends the all-in label only after settlement and distinguishes net from gross', () => {
    const table = pokerUiTable();
    const before = JSON.stringify(table);
    const html = renderTable(table);
    const hero = html.split('data-seat="0"')[1]!.split('</article>')[0]!;
    expect(hero).toContain('本手已结束');
    expect(hero).toContain('净赢 101');
    expect(hero).not.toContain('已全下');
    expect(html).toContain('你 获得 201');
    expect(html).toContain('<dt>底池收入</dt><dd>201</dd>');
    expect(html).toContain('<dt>结算筹码</dt><dd>201</dd>');
    const receipt = html.split('data-result-seat="0"')[1]!.split('</article>')[0]!;
    expect(receipt.match(/card-from-hole/g)).toHaveLength(2);
    expect(receipt.indexOf('aria-label="J♥"')).toBeLessThan(receipt.indexOf('aria-label="K♠"'));
    const hidden = html.split('data-result-seat="1"')[1]!.split('</article>')[0]!;
    expect(hidden).toContain('未亮牌');
    expect(hidden).not.toContain('poker-card');
    expect(JSON.stringify(table)).toBe(before);
    const frame = { view:table.view, previousBoardCount:5, holdMs:500, event:{ type:'showdownStarted' as const, revealOrder:[0,2] } };
    expect(renderPlaybackFrame(frame, table.roster, 1, 2)).toContain('已全下');
  });
  it('does not celebrate a net loss just because the NPC collected a side pot', () => {
    const table = pokerUiTable();
    if (table.packet.kind !== 'hand-result') throw new Error('Expected result');
    table.packet = { ...table.packet, handResult:{ ...table.packet.handResult,
      seats:table.packet.handResult.seats.map(seat => seat.seatIndex === 2 ? { ...seat, potWon:50, net:-50, finalStack:50 } : seat) } };
    table.view.seats[2]!.stack = 50;
    const npc = renderTable(table).split('data-seat="2"')[1]!.split('</article>')[0]!;
    expect(npc).toContain('portrait-neutral');
    expect(npc).not.toContain('portrait-win');
    expect(npc).toContain('净输 50');
  });
  it('does not call an odd-chip award an equal split', () => {
    const table = pokerUiTable();
    if (table.packet.kind !== 'hand-result') throw new Error('Expected result');
    table.packet = { ...table.packet, handResult:{ ...table.packet.handResult,
      pots:[{ ...table.packet.handResult.pots[0]!, winnerSeatIndexes:[0,2], awards:[101,100] }] } };
    const html = renderTable(table);
    expect(html).toContain('（分池，含零头筹码）');
    expect(html).not.toContain('（平分）');
  });
  it('keeps all new settlement copy bilingual', () => {
    const html = renderTable(pokerUiTable(6));
    const texts = [...html.matchAll(/>([^<>]*)</g), ...html.matchAll(/(?:aria-label|title|alt)="([^"]*)"/g)].map(match => match[1]!);
    expect(texts.map(text => translateText(text, 'en')).filter(text => /[\p{Script=Han}]/u.test(text))).toEqual([]);
  });
});
