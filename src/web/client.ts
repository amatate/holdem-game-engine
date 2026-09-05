import type { Bootstrap, WebTable } from './protocol.js';
import { renderLobby, renderTable } from './render.js';
import { installTableReadTool, type TableToolContext } from './agent-tools.js';
import type { ActionIntent } from '../core/legal-actions.js';

const app = document.querySelector<HTMLElement>('#app')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
let state: Bootstrap = { rosters: {}, table: null };
let count = 4;
let busy = false;
let choosingTable = false;
const toolLifecycle = installTableReadTool(
  (document as Document & { modelContext?: TableToolContext }).modelContext,
  () => choosingTable ? null : state.table,
);
window.addEventListener('pagehide', () => toolLifecycle.abort(), { once: true });

function draw(): void {
  app.innerHTML = state.table && !choosingTable ? renderTable(state.table) : renderLobby(state.rosters, count);
  lock(busy);
}
function lock(value: boolean): void {
  busy = value;
  app.setAttribute('aria-busy', String(value));
  for (const element of app.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select')) {
    element.disabled = value;
  }
  connection.textContent = value ? '正在处理牌局…' : '本地牌桌';
}
function message(text: string): void { notice.textContent = text; notice.hidden = text.length === 0; }

async function synchronize(): Promise<void> {
  const response = await fetch('/api/bootstrap');
  if (!response.ok) throw new Error('无法连接本地牌桌，请确认服务仍在运行。');
  state = await response.json() as Bootstrap;
}

async function mutate(path: string, body: unknown): Promise<void> {
  if (busy) return;
  lock(true); message('');
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json() as { table?: WebTable; error?: string };
    if (result.table) { state.table = result.table; choosingTable = false; }
    if (!response.ok) {
      if (response.status === 401) { state.table = null; choosingTable = false; }
      message(result.error ?? '操作未完成，请同步牌桌后重试。');
    }
  } catch {
    // Never automatically replay a wager after an uncertain network result.
    try { await synchronize(); choosingTable = false; message('连接曾中断，已同步实际牌局；没有重复提交操作。'); }
    catch { message('连接中断。恢复服务后点击右上角“同步牌桌”，不要重复下注。'); }
  } finally { lock(false); draw(); }
}

async function act(intent: ActionIntent): Promise<void> {
  const table = state.table;
  if (!table || table.packet.kind !== 'decision' || choosingTable) return;
  await mutate('/api/action', { tableId: table.id, command: { type: 'act',
    decisionKey: table.packet.decisionKey, expectedPacketIndex: table.packet.packetIndex, intent } });
}

app.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.id === 'players') { count = Number(target.value); draw(); }
});
app.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
  if (!button || busy) return;
  switch (button.dataset.action) {
    case 'start': void mutate('/api/table', { players: count }); break;
    case 'new':
      if (state.table?.packet.kind !== 'game-result' && !window.confirm('离开当前牌桌并重新选人数？点击“入座发牌”后，旧牌局将结束。')) return;
      choosingTable = true; message(''); draw(); break;
    case 'continue':
      if (state.table) void mutate('/api/continue', { tableId: state.table.id, expectedPacketIndex: state.table.packet.packetIndex });
      break;
    case 'act': {
      const type = button.dataset.intent;
      if (type === 'fold' || type === 'check' || type === 'call' || type === 'allIn') void act({ type });
      break;
    }
  }
});
app.addEventListener('submit', (event) => {
  if (!(event.target instanceof HTMLFormElement) || event.target.id !== 'raise-form') return;
  event.preventDefault();
  const value = Number(new FormData(event.target).get('amount'));
  if (Number.isSafeInteger(value)) void act({ type: 'raiseTo', amount: value });
});
document.querySelector('#sync')!.addEventListener('click', () => {
  if (busy) return;
  lock(true);
  void synchronize().then(() => { choosingTable = false; message('已同步当前牌桌。'); })
    .catch((error: Error) => message(error.message)).finally(() => { lock(false); draw(); });
});

void synchronize().then(draw).catch((error: Error) => { app.textContent = '牌桌暂时无法载入。请确认本地服务仍在运行，再点击“同步牌桌”。'; message(error.message); });
