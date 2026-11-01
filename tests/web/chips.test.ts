import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chipPieces, chipStacks, renderChipPile, chipFace, chipOffset } from '../../src/web/chips.js';

describe('denomination-aware chip piles', () => {
  it.each([
    [1, [1]], [2, [1, 1]], [20, [5, 5, 5, 5]],
    [37, [25, 5, 5, 1, 1]], [137, [100, 25, 5, 5, 1, 1]],
    [200, [100, 100]], [599, [500, 25, 25, 25, 5, 5, 5, 5, 1, 1, 1, 1]],
  ])('%i is exact change, not a repeated decorative token', (amount, expected) => {
    const pieces = chipPieces(amount as number);
    expect(pieces.map(piece => piece.denomination)).toEqual(expected);
    expect(pieces.every(piece => piece.units === 1)).toBe(true);
  });
  it('conserves every integer amount through 10000 and bounds huge amounts', () => {
    for (let amount = 0; amount <= 10000; amount++) {
      expect(chipPieces(amount).reduce((sum, piece) => sum + piece.denomination * piece.units, 0)).toBe(amount);
    }
    for (const amount of [999999999, 999999999999, Number.MAX_SAFE_INTEGER]) {
      const pieces = chipPieces(amount);
      expect(pieces.reduce((sum, piece) => sum + BigInt(piece.denomination) * BigInt(piece.units), 0n)).toBe(BigInt(amount));
      expect(pieces.length).toBeLessThan(80);
      expect(chipStacks(amount).every(stack => stack.pieces.length <= 6)).toBe(true);
    }
    expect(renderChipPile(Number.MAX_SAFE_INTEGER)).toContain('chip-bundle');
  });
  it('rejects invalid display amounts without massive loops or injected markup', () => {
    for (const amount of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(chipPieces(amount)).toEqual([]);
      expect(renderChipPile(amount)).not.toContain('chip-disc');
    }
    expect(chipFace(7)).toBe('');
    expect(chipFace(5, -1)).toBe('');
  });
  it('has distinct heights, denominations and grouping with no inline styles or raster dependency', () => {
    const small = renderChipPile(2), medium = renderChipPile(20), mixed = renderChipPile(137);
    expect(small.match(/class="chip-disc /g)).toHaveLength(2);
    expect(medium).toContain('data-height="4"');
    expect(mixed).toContain('data-columns="4"');
    expect(mixed.match(/class="chip-disc /g)).toHaveLength(6);
    expect(mixed).not.toMatch(/style=|chip-art|<img/);
    const pieces = chipPieces(137);
    expect(new Set(pieces.map(piece => chipOffset(piece, pieces, 30).x)).size).toBe(4);
    expect(chipOffset(pieces[3]!, pieces, 30).y).toBeLessThan(chipOffset(pieces[2]!, pieces, 30).y);
  });
  it('ships the new stylesheet and module in both local and Pages hosts without weakening CSP', () => {
    for (const path of ['src/web/index.html', 'src/web/server.ts', 'scripts/build-pages.mjs', 'scripts/preview-pages.mjs']) {
      expect(readFileSync(new URL('../../' + path, import.meta.url), 'utf8')).toContain('chips.css');
    }
    expect(readFileSync(new URL('../../src/web/server.ts', import.meta.url), 'utf8')).toContain("'/chips.js'");
    const css = readFileSync(new URL('../../src/web/chips.css', import.meta.url), 'utf8');
    expect(css).toContain('.bet-chip[data-chip-collecting] { visibility:hidden; }');
    for (const theme of ['night', 'lantern', 'blue-hour', 'jade', 'ghost']) expect(css).toContain(`[data-card-back="${theme}"]`);
    expect(readFileSync(new URL('../../scripts/build-pages.mjs', import.meta.url), 'utf8')).not.toContain('unsafe-inline');
  });
});
