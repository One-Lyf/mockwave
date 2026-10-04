/**
 * Where a kit store keeps its rows. The device backend (IndexedDB) is the store when the app
 * has no sign-in; the per-app stack backend (K1 step 2) takes over when it has one.
 */

export interface Row {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  [field: string]: unknown;
}

export interface StoreBackend {
  /** Prepares one table per entity; called once before any read or write. */
  open(entities: string[]): Promise<void>;
  /** Every row of an entity, soft-deleted ones included. */
  all(entity: string): Promise<Row[]>;
  /** Inserts or replaces a row by id. */
  put(entity: string, row: Row): Promise<void>;
  remove(entity: string, id: string): Promise<void>;
  close?(): void;
}

/** Keeps rows in memory; for tests and previews. */
export function memoryBackend(): StoreBackend {
  const tables = new Map<string, Map<string, Row>>();
  const table = (entity: string) => {
    const t = tables.get(entity);
    if (!t) throw new Error(`memoryBackend: unknown entity "${entity}"`);
    return t;
  };
  return {
    async open(entities) {
      for (const e of entities) if (!tables.has(e)) tables.set(e, new Map());
    },
    async all(entity) {
      return [...table(entity).values()].map((r) => ({ ...r }));
    },
    async put(entity, row) {
      table(entity).set(row.id, { ...row });
    },
    async remove(entity, id) {
      table(entity).delete(id);
    },
  };
}
