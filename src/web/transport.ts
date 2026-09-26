export const browserTable = typeof document !== 'undefined' && document.documentElement?.dataset.runtime === 'pages';
interface Reply { status: number; body: unknown }
let worker: Worker | undefined;
let failed = false;
let sequence = 0;
const pending = new Map<number, { resolve: (reply: Reply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function fail(): void {
  failed = true;
  worker?.terminate();
  for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('浏览器引擎未响应，请刷新页面。')); }
  pending.clear();
}
export async function requestTable(path: string, init?: RequestInit): Promise<Pick<Response, 'ok' | 'status' | 'json'>> {
  if (!browserTable) return fetch(path, init);
  if (failed) throw new Error('浏览器引擎已停止，请刷新页面。');
  if (!worker) {
    worker = new Worker(new URL('./browser-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<{ id: number; reply: Reply }>) => {
      const task = pending.get(event.data.id);
      if (!task) return;
      clearTimeout(task.timer); pending.delete(event.data.id); task.resolve(event.data.reply);
    });
    worker.addEventListener('error', fail);
    worker.addEventListener('messageerror', fail);
  }
  const id = ++sequence;
  const reply = await new Promise<Reply>((resolve, reject) => {
    pending.set(id, { resolve, reject, timer: setTimeout(fail, 60_000) });
    worker!.postMessage({ id, path, body: typeof init?.body === 'string' ? init.body : null });
  });
  return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
}
