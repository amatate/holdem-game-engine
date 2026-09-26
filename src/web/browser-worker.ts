import { createBrowserApi } from './browser-api.js';
import { IndexedDbCheckpointStore } from './browser-store.js';
declare const __PAGES_BUILD_ID__: string;
const api = createBrowserApi(new IndexedDbCheckpointStore(`night-table:${new URL('./', location.href).pathname}`), __PAGES_BUILD_ID__);
// Messages carry only JSON text. Do not add an interface for arbitrary agents or callbacks.
addEventListener('message', (event: MessageEvent<{ id: number; path: string; body: string | null }>) => {
  const message = event.data;
  if (!message || !Number.isSafeInteger(message.id) || typeof message.path !== 'string') return;
  void api(message.path, message.body).then((reply) => postMessage({ id: message.id, reply }));
});
