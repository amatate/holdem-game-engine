import { validCheckpoint, type Checkpoint } from './checkpoint-data.js';

export type SaveSlot = 'chapter' | 'journey';
export interface BrowserStore {
  read(slot?: SaveSlot): Promise<unknown>;
  write(checkpoint: Checkpoint, expectedId: string | null, slot?: SaveSlot): Promise<void>;
}
/** Dedicated database per project path. One settled checkpoint; no cloud upload. */
export class IndexedDbCheckpointStore implements BrowserStore {
  constructor(private readonly name: string) {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('checkpoints'); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Storage blocked'));
    });
  }
  async read(slot?: SaveSlot): Promise<unknown> {
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('checkpoints', 'readonly');
        const request = tx.objectStore('checkpoints').get(slot ?? 'settled');
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }
  async write(checkpoint: Checkpoint, expectedId: string | null, slot?: SaveSlot): Promise<void> {
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('checkpoints', 'readwrite'), store = tx.objectStore('checkpoints');
        const request = store.get(slot ?? 'settled');
        request.onsuccess = () => {
          const current: unknown = request.result;
          // Never silently overwrite corrupt, old-version or another tab's save.
          if (current != null && (!validCheckpoint(current) || current.summary.id !== expectedId)) { tx.abort(); return; }
          if (current == null && expectedId !== null) { tx.abort(); return; }
          store.put(checkpoint, slot ?? 'settled');
        };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(new Error('Storage changed or unavailable'));
      });
    } finally { db.close(); }
  }
}
