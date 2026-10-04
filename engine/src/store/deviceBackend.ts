/**
 * Device backend: the kit store when the app has no sign-in. One IndexedDB database per app
 * (`mockwave:<appId>`), one object store per entity. A new entity bumps the database version.
 */

import type { Row, StoreBackend } from './backend';

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

function openDb(factory: IDBFactory, name: string, version: number | undefined, entities: string[]) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open(name, version);
    r.onupgradeneeded = () => {
      for (const e of entities) {
        if (!r.result.objectStoreNames.contains(e)) r.result.createObjectStore(e, { keyPath: 'id' });
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error(`deviceBackend: "${name}" is open in another tab`));
  });
}

/** `factory` defaults to the browser's `indexedDB`; tests pass a fake. */
export function deviceBackend(appId: string, factory: IDBFactory = globalThis.indexedDB): StoreBackend {
  const name = `mockwave:${appId}`;
  let db: IDBDatabase | undefined;
  const conn = () => {
    if (!db) throw new Error('deviceBackend: not open');
    return db;
  };

  return {
    async open(entities) {
      if (!factory) throw new Error('deviceBackend: IndexedDB is not available');
      db = await openDb(factory, name, undefined, entities);
      if (entities.some((e) => !db!.objectStoreNames.contains(e))) {
        const next = db.version + 1;
        db.close();
        db = await openDb(factory, name, next, entities);
      }
      // Another tab upgrading the schema: let it, and fail our next call instead of blocking it.
      db.onversionchange = () => {
        db?.close();
        db = undefined;
      };
    },
    async all(entity) {
      return req(conn().transaction(entity).objectStore(entity).getAll()) as Promise<Row[]>;
    },
    async put(entity, row) {
      const tx = conn().transaction(entity, 'readwrite');
      tx.objectStore(entity).put(row);
      await done(tx);
    },
    async remove(entity, id) {
      const tx = conn().transaction(entity, 'readwrite');
      tx.objectStore(entity).delete(id);
      await done(tx);
    },
    close() {
      db?.close();
      db = undefined;
    },
  };
}
