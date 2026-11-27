/**
 * Device persistence for Basewave tables (ui-1127 part 3, product logic): tables autosave to
 * the device (localStorage) and a reload restores them. Every storage access is wrapped in
 * try/catch. When device storage is unavailable or throws (private mode), the module falls back
 * to memory for the session and reports persistent: false, which the editor surfaces as a
 * "Not Saved on This Device" note.
 *
 * The stored payload is one JSON record under TABLES_STORAGE_KEY: the saved tables plus the id
 * of the table that was open last, so a reload reopens it. Load never throws: corrupt JSON or a
 * corrupt entry is dropped (and overwritten on the next save) instead of breaking the app.
 */

import { COLUMN_TYPES, type BasewaveTable, type ColumnType } from '../../engine/src';

export const TABLES_STORAGE_KEY = 'basewave.tables.v1';
const PROBE_KEY = 'basewave.tables.probe';

/** A table as stored on the device: the editor table plus bookkeeping. */
export interface StoredTable {
  id: string;
  name: string;
  updatedAt: string;
  table: BasewaveTable;
}

export interface TableStorage {
  /** False when device storage is unavailable or a write failed; data then lives in memory only. */
  readonly persistent: boolean;
  /** Every saved table, sanitized on load. Never throws. */
  loadAll(): StoredTable[];
  get(id: string): StoredTable | undefined;
  /** The table that was open last, so a reload restores it. */
  getLastOpen(): StoredTable | undefined;
  /** Upsert a table and mark it last open. Returns the stored id and whether the write reached the device. */
  save(table: BasewaveTable, id?: string): { id: string; persistent: boolean };
  /** Delete a saved table from the device. */
  remove(id: string): void;
  /** Set (or clear) which table reopens on reload. The table itself stays saved. */
  setLastOpen(id: string | null): void;
}

export interface TableStorageOptions {
  /** Defaults to the browser's localStorage, or null when even reading the global throws. */
  storage?: Storage | null;
  now?: () => Date;
  newId?: () => string;
}

interface StoragePayload {
  version: 1;
  lastOpenId: string | null;
  tables: StoredTable[];
}

const emptyPayload = (): StoragePayload => ({ version: 1, lastOpenId: null, tables: [] });

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const isColumnType = (v: unknown): v is ColumnType =>
  typeof v === 'string' && (COLUMN_TYPES as readonly string[]).includes(v);

/** Structural check only (not the contract name rule): a user-typed name like "My Table" must
 *  survive a reload, so any string name is kept. */
function isValidTable(v: unknown): v is BasewaveTable {
  if (!isRecord(v)) return false;
  if (typeof v.name !== 'string') return false;
  if (!Array.isArray(v.columns) || !Array.isArray(v.rows)) return false;
  if (v.idSeq !== undefined && typeof v.idSeq !== 'number') return false;
  for (const col of v.columns) {
    if (!isRecord(col)) return false;
    if (typeof col.id !== 'string' || typeof col.name !== 'string' || !isColumnType(col.type)) return false;
  }
  for (const row of v.rows) {
    if (!isRecord(row)) return false;
  }
  return true;
}

function isStoredTable(v: unknown): v is StoredTable {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.updatedAt === 'string' &&
    isValidTable(v.table)
  );
}

/** Drop anything corrupt from a parsed payload: a wrong top-level shape becomes empty, and each
 *  table entry must validate (first one wins on a duplicate id). */
function sanitizePayload(parsed: unknown): StoragePayload {
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.tables)) return emptyPayload();
  const tables: StoredTable[] = [];
  const seen = new Set<string>();
  for (const entry of parsed.tables) {
    if (!isStoredTable(entry) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    tables.push(entry);
  }
  const lastOpenId =
    typeof parsed.lastOpenId === 'string' && seen.has(parsed.lastOpenId) ? parsed.lastOpenId : null;
  return { version: 1, lastOpenId, tables };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const defaultNewId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // fall through to the random id below
  }
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

/** Open the table storage. `storage` defaults to localStorage; tests pass a fake or null. */
export function openTableStorage(opts: TableStorageOptions = {}): TableStorage {
  const storage = opts.storage === undefined ? safeLocalStorage() : opts.storage;
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? defaultNewId;

  // Probe once: private mode and locked-down iframes throw on setItem.
  let deviceOk = false;
  if (storage) {
    try {
      storage.setItem(PROBE_KEY, '1');
      storage.removeItem(PROBE_KEY);
      deviceOk = true;
    } catch {
      deviceOk = false;
    }
  }

  const readDevice = (): StoragePayload => {
    if (!storage) return emptyPayload();
    try {
      const raw = storage.getItem(TABLES_STORAGE_KEY);
      if (raw === null || raw === undefined) return emptyPayload();
      return sanitizePayload(JSON.parse(raw));
    } catch {
      // Unreadable or corrupt JSON: start empty; the next save overwrites it.
      return emptyPayload();
    }
  };

  let payload = readDevice();

  const writeThrough = (): boolean => {
    if (!storage || !deviceOk) return false;
    try {
      storage.setItem(TABLES_STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch {
      // Quota or private mode kicked in mid-session: keep serving from memory.
      deviceOk = false;
      return false;
    }
  };

  const cloneStored = (t: StoredTable | undefined): StoredTable | undefined =>
    t ? structuredClone(t) : undefined;

  return {
    get persistent() {
      return deviceOk;
    },
    loadAll() {
      return payload.tables.map((t) => structuredClone(t));
    },
    get(id) {
      return cloneStored(payload.tables.find((t) => t.id === id));
    },
    getLastOpen() {
      return cloneStored(payload.tables.find((t) => t.id === payload.lastOpenId));
    },
    save(table, id) {
      const tid = id ?? newId();
      const entry: StoredTable = {
        id: tid,
        name: table.name,
        updatedAt: now().toISOString(),
        table: structuredClone(table),
      };
      const at = payload.tables.findIndex((t) => t.id === tid);
      if (at >= 0) payload.tables[at] = entry;
      else payload.tables.push(entry);
      payload.lastOpenId = tid;
      const ok = writeThrough();
      return { id: tid, persistent: ok };
    },
    remove(id) {
      payload.tables = payload.tables.filter((t) => t.id !== id);
      if (payload.lastOpenId === id) {
        payload.lastOpenId = payload.tables.length > 0 ? payload.tables[payload.tables.length - 1].id : null;
      }
      writeThrough();
    },
    setLastOpen(id) {
      payload.lastOpenId = id;
      writeThrough();
    },
  };
}
