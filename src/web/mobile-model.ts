import type { WebTable } from './protocol.js';

export type MobileSheet = 'setup' | 'night-setup' | 'journey' | 'raise' | 'all-in' | 'abilities' | 'notes' | 'profile' | 'receipt' | null;
export interface MobileUiState {
  sheet: MobileSheet; seat: number | null; amount: number | null; decision: string | null;
  tableId: string | null; scene: string; line: number; exactAmount: boolean; reviewedResult: string;
}
export function newMobileUi(): MobileUiState {
  return { sheet: null, seat: null, amount: null, decision: null, tableId: null, scene: '', line: 0, exactAmount: false, reviewedResult: '' };
}
export function mobileRaise(table: WebTable) {
  if (table.packet.kind !== 'decision') return null;
  const packet = table.packet, range = packet.actionPanel.commands.find(command => command.kind === 'raise-range');
  if (!range || range.kind !== 'raise-range') return null;
  const hero = table.view.seats.find(seat => seat.seatIndex === 0)!;
  const call = packet.observation.legalActions.call?.pay ?? 0;
  const clamp = (value: number) => Math.max(range.minimum, Math.min(range.maximum, Math.round(value)));
  const choices = table.view.street === 'preflop'
    ? [{ amount: range.minimum, label: '最小', en: 'Min' }, ...[3, 4].map(bb => ({ amount: clamp(bb * table.view.bigBlind), label: `${bb}BB`, en: `${bb}BB` }))]
    : [{ amount: range.minimum, label: '最小', en: 'Min' }, ...[.5, 1].map(fraction => ({
      amount: clamp(hero.committedStreet + call + fraction * (table.view.potTotal + call)),
      label: fraction === 1 ? '底池' : '半池', en: fraction === 1 ? 'Pot' : '½ pot',
    }))];
  const allIn = packet.actionPanel.commands.some(c => c.kind === 'fixed' && c.intent.type === 'allIn')
    && range.maximum === hero.stack + hero.committedStreet;
  choices.push({ amount: range.maximum, label: allIn ? '全下' : '最大', en: allIn ? 'All-in' : 'Max' });
  return { minimum: range.minimum, maximum: range.maximum, allIn, choices: choices.filter((choice, i) => choices.findIndex(c => c.amount === choice.amount) === i) };
}
export function normalizeMobileUi(ui: MobileUiState, table: WebTable | null): void {
  const decision = table?.packet.kind === 'decision' ? table.packet.decisionKey : null;
  if (ui.tableId !== (table?.id ?? null) || ui.decision !== decision) {
    ui.amount = table ? mobileRaise(table)?.minimum ?? null : null;
    ui.exactAmount = false;
    if (ui.sheet === 'raise' || ui.sheet === 'all-in') ui.sheet = null;
  }
  if (ui.tableId !== (table?.id ?? null) && ui.sheet !== 'setup' && ui.sheet !== 'night-setup') ui.sheet = null;
  ui.decision = decision; ui.tableId = table?.id ?? null;
  const story=table?.campaign??table?.secondNight??table?.firstNight;
  const scene = table&&story ? `${table.id}:${story.phase}:${story.revision}` : '';
  if (ui.scene !== scene) { ui.scene = scene; ui.line = 0; }
}
export function validMobileRaise(table: WebTable, ui: MobileUiState): number | null {
  const range = mobileRaise(table);
  return range && table.packet.kind === 'decision' && ui.tableId === table.id && ui.decision === table.packet.decisionKey
    && Number.isSafeInteger(ui.amount) && ui.amount! >= range.minimum && ui.amount! <= range.maximum ? ui.amount : null;
}
