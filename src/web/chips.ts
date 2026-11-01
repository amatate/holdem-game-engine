/** Public money presentation only. These are not an inventory used by the rules engine. */
export const CHIP_DENOMINATIONS = [
  1, 5, 25, 100, 500, 1000, 5000, 25000, 100000, 500000,
  1000000, 5000000, 25000000, 100000000, 500000000, 1000000000,
] as const;
export interface ChipPiece { denomination: number; units: number; column: number; layer: number }
export interface ChipStack { denomination: number; count: number; pieces: ChipPiece[] }

/** Exact change, with a bounded number of DOM nodes even for very large stacks.
 * A compressed bundle is explicitly marked ×N, never silently shown as one chip. */
export function chipStacks(amount: number): ChipStack[] {
  if (!Number.isSafeInteger(amount) || amount <= 0) return [];
  let remaining = amount;
  const stacks: ChipStack[] = [];
  for (const denomination of [...CHIP_DENOMINATIONS].reverse()) {
    const count = Math.floor(remaining / denomination);
    if (!count) continue;
    remaining -= count * denomination;
    const visible = Math.min(count, 6), column = stacks.length;
    const pieces = Array.from({ length: visible }, (_, layer) => ({
      denomination, column, layer, units: layer === visible - 1 ? count - visible + 1 : 1,
    }));
    stacks.push({ denomination, count, pieces });
  }
  return stacks;
}

export const chipPieces = (amount: number): ChipPiece[] => chipStacks(amount).flatMap(stack => stack.pieces);
export function chipFace(denomination: number, units = 1): string {
  const index = CHIP_DENOMINATIONS.findIndex(value => value === denomination);
  if (index < 0 || !Number.isSafeInteger(units) || units < 1) return '';
  const label = denomination >= 1e9 ? denomination / 1e9 + 'B'
    : denomination >= 1e6 ? denomination / 1e6 + 'M'
    : denomination >= 1e3 ? denomination / 1e3 + 'k' : String(denomination);
  return `<span class="chip-disc chip-tone-${index % 7}" data-denomination="${denomination}" data-units="${units}"><span class="chip-face-value">${label}</span>${units > 1 ? `<span class="chip-bundle">×${units}</span>` : ''}</span>`;
}

export function renderChipPile(amount: number): string {
  const stacks = chipStacks(amount);
  return `<span class="chip-pile" data-chip-value="${stacks.length ? amount : 0}" data-columns="${Math.min(4, stacks.length)}" aria-hidden="true">${stacks.map(stack =>
    `<span class="chip-stack" data-height="${stack.pieces.length}">${stack.pieces.map(piece =>
      `<span class="chip-unit" data-layer="${piece.layer}">${chipFace(piece.denomination, piece.units)}</span>`).join('')}</span>`).join('')}</span>`;
}

/** Relative centers matching the four-column CSS pile, in units of chip diameter. */
export function chipOffset(piece: ChipPiece, pieces: readonly ChipPiece[], width: number): { x: number; y: number } {
  const columns = Math.min(4, Math.max(...pieces.map(item => item.column)) + 1);
  return { x: ((piece.column % 4) - (columns - 1) / 2) * width * .9,
    y: Math.floor(piece.column / 4) * width * 1.2 - piece.layer * width * .14 };
}
