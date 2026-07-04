import type { RecordingMedia } from "@openvoicing/bundle";

const DB_NAME = "openvoicing";
const STORE_NAME = "session";

export interface StoredFile {
  name: string;
  data: ArrayBuffer;
}

export interface RecordingMeta {
  id: string;
  name: string;
  /**
   * The recording's media source. Absent means a legacy decoded-audio take
   * whose bytes live under the `recording:<id>` key. A `youtube` source plays
   * an external video; its optional paired audio (if any) is still under
   * `recording:<id>` for the waveform/auto-sync.
   */
  media?: RecordingMedia;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = fn(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Session persistence, local-only for now. When the backend lands, this
 * becomes the offline cache in front of it.
 */
export const storage = {
  get<T>(key: string): Promise<T | undefined> {
    return withStore("readonly", (store) => store.get(key) as IDBRequest<T | undefined>);
  },
  set(key: string, value: unknown): Promise<IDBValidKey> {
    return withStore("readwrite", (store) => store.put(value, key));
  },
  delete(key: string): Promise<undefined> {
    return withStore("readwrite", (store) => store.delete(key));
  },
};
