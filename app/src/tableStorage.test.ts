/**
 * Unit tests for the device table storage (ui-1127 part 3): save, load, corrupt data, and
 * storage that throws (private mode) with the memory fallback. Runs under vitest (Node) with
 * fake Storage objects injected, so no browser is needed.
 */

import { describe, expect, it } from 'vitest';
import { openTableStorage, TABLES_STORAGE_KEY, type StoredTable } from './tableStorage';
import type { BasewaveTable } from '../../engine/src';

/** In-memory Storage stand-in. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

/** Every access throws, like localStorage in a locked-down private mode. */
class ThrowingStorage implements Storage {
  get length(): number {
    return 0;
  }
  clear(): void {
    throw new Error('denied');
  }
  getItem(): string | null {
    throw new Error('denied');
  }
  key(): string | null {
    throw new Error('denied');
  }
  removeItem(): void {
    throw new Error('denied');
  }
  setItem(): void {
    throw new Error('denied');
  }
}

/** Probe passes but writing the real payload throws, like a quota error mid-session. */
class QuotaStorage extends MemoryStorage {
  setItem(key: string, value: string): void {
    if (key === TABLES_STORAGE_KEY) throw new Error('QuotaExceededError');
    super.setItem(key, value);
  }
}

const makeTable = (name: string, label = 'alpha'): BasewaveTable => ({
  name,
  columns: [{ id: 'c0', name: 'label', type: 'text' }],
  rows: [{ c0: label }],
});

const stored = (id: string, name: string, label = 'alpha'): StoredTable => ({
  id,
  name,
  updatedAt: '2026-11-27T10:00:00.000Z',
  table: makeTable(name, label),
});

describe('tableStorage save and load', () => {
  it('saves a table and loads it back', () => {
    const s = openTableStorage({ storage: new MemoryStorage() });
    const res = s.save(makeTable('recipes', 'Chickpea Curry'));
    expect(res.persistent).toBe(true);
    const all = s.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(res.id);
    expect(all[0].name).toBe('recipes');
    expect(all[0].table.rows).toEqual([{ c0: 'Chickpea Curry' }]);
    expect(s.get(res.id)?.table.columns[0].name).toBe('label');
  });

  it('persists to the device so a fresh open (reload) restores the last open table', () => {
    const device = new MemoryStorage();
    const first = openTableStorage({ storage: device });
    const res = first.save(makeTable('budget', 'Rent'));
    expect(first.getLastOpen()?.id).toBe(res.id);

    const second = openTableStorage({ storage: device });
    expect(second.persistent).toBe(true);
    expect(second.loadAll()).toHaveLength(1);
    expect(second.getLastOpen()?.table.rows).toEqual([{ c0: 'Rent' }]);
  });

  it('upserts on save with the same id instead of duplicating, bumping updatedAt', () => {
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 10, 27, 10, 0, tick++));
    const s = openTableStorage({ storage: new MemoryStorage(), now });
    const { id } = s.save(makeTable('recipes', 'one'));
    s.save(makeTable('recipes', 'two'), id);
    const all = s.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].table.rows).toEqual([{ c0: 'two' }]);
    expect(all[0].updatedAt).toBe('2026-11-27T10:00:01.000Z');
  });

  it('keeps a free-text table name (no contract name rule on stored tables)', () => {
    const s = openTableStorage({ storage: new MemoryStorage() });
    const { id } = s.save(makeTable('My Groceries'));
    expect(s.get(id)?.table.name).toBe('My Groceries');
  });

  it('stores a snapshot: mutating the table after save does not change the stored copy', () => {
    const s = openTableStorage({ storage: new MemoryStorage() });
    const t = makeTable('recipes');
    const { id } = s.save(t);
    t.rows[0].c0 = 'changed';
    expect(s.get(id)?.table.rows[0].c0).toBe('alpha');
  });

  it('returns copies from loadAll: mutating the result does not change the store', () => {
    const s = openTableStorage({ storage: new MemoryStorage() });
    s.save(makeTable('recipes'));
    const all = s.loadAll();
    all[0].table.rows[0].c0 = 'changed';
    expect(s.loadAll()[0].table.rows[0].c0).toBe('alpha');
  });

  it('remove deletes a saved table and falls lastOpen back to a remaining table', () => {
    const s = openTableStorage({ storage: new MemoryStorage() });
    const a = s.save(makeTable('a')).id;
    const b = s.save(makeTable('b')).id;
    s.remove(a);
    expect(s.loadAll().map((t) => t.id)).toEqual([b]);
    expect(s.getLastOpen()?.id).toBe(b);
    s.remove(b);
    expect(s.loadAll()).toEqual([]);
    expect(s.getLastOpen()).toBeUndefined();
  });

  it('setLastOpen clears the reopen target without deleting the table', () => {
    const s = openTableStorage({ storage: new MemoryStorage() });
    const { id } = s.save(makeTable('recipes'));
    s.setLastOpen(null);
    expect(s.getLastOpen()).toBeUndefined();
    expect(s.get(id)).toBeDefined();
  });
});

describe('tableStorage corrupt data', () => {
  it('returns empty (never throws) when the stored JSON is not parseable', () => {
    const device = new MemoryStorage();
    device.setItem(TABLES_STORAGE_KEY, 'not json {{{');
    const s = openTableStorage({ storage: device });
    expect(s.loadAll()).toEqual([]);
    expect(s.getLastOpen()).toBeUndefined();
    // A save after corruption overwrites the bad payload and is readable again.
    const { id } = s.save(makeTable('recipes'));
    const fresh = openTableStorage({ storage: device });
    expect(fresh.get(id)?.table.name).toBe('recipes');
  });

  it('returns empty for a wrong top-level shape (array, string, other version)', () => {
    for (const raw of ['[1,2]', '"text"', '{"version":2,"tables":[]}', '{"tables":"nope"}']) {
      const device = new MemoryStorage();
      device.setItem(TABLES_STORAGE_KEY, raw);
      expect(openTableStorage({ storage: device }).loadAll()).toEqual([]);
    }
  });

  it('drops corrupt table entries but keeps the valid ones, first wins on duplicate ids', () => {
    const device = new MemoryStorage();
    device.setItem(
      TABLES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        lastOpenId: 'good',
        tables: [
          stored('good', 'recipes'),
          { id: 'bad-type', name: 'x', updatedAt: 'now', table: { name: 'x', columns: [{ id: 'c0', name: 'a', type: 'emoji' }], rows: [] } },
          { id: 'bad-rows', name: 'x', updatedAt: 'now', table: { name: 'x', columns: [], rows: 'nope' } },
          'not an object',
          stored('good', 'duplicate'),
        ],
      }),
    );
    const s = openTableStorage({ storage: device });
    const all = s.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('good');
    expect(all[0].table.rows).toEqual([{ c0: 'alpha' }]);
    expect(s.getLastOpen()?.id).toBe('good');
  });

  it('clears lastOpenId when it points at a corrupt or missing table', () => {
    const device = new MemoryStorage();
    device.setItem(
      TABLES_STORAGE_KEY,
      JSON.stringify({ version: 1, lastOpenId: 'ghost', tables: [stored('good', 'recipes')] }),
    );
    const s = openTableStorage({ storage: device });
    expect(s.getLastOpen()).toBeUndefined();
    expect(s.loadAll()).toHaveLength(1);
  });
});

describe('tableStorage throwing storage (private mode)', () => {
  it('falls back to memory when every storage access throws', () => {
    const s = openTableStorage({ storage: new ThrowingStorage() });
    expect(s.persistent).toBe(false);
    const res = s.save(makeTable('recipes', 'Soup'));
    expect(res.persistent).toBe(false);
    // The session still works: the table is served from memory.
    expect(s.loadAll()).toHaveLength(1);
    expect(s.getLastOpen()?.table.rows).toEqual([{ c0: 'Soup' }]);
    s.remove(res.id);
    expect(s.loadAll()).toEqual([]);
  });

  it('works with no storage object at all', () => {
    const s = openTableStorage({ storage: null });
    expect(s.persistent).toBe(false);
    expect(s.save(makeTable('recipes')).persistent).toBe(false);
    expect(s.loadAll()).toHaveLength(1);
  });

  it('switches to memory when the payload write throws after a passing probe (quota)', () => {
    const s = openTableStorage({ storage: new QuotaStorage() });
    expect(s.persistent).toBe(true);
    const res = s.save(makeTable('recipes'));
    expect(res.persistent).toBe(false);
    expect(s.persistent).toBe(false);
    expect(s.loadAll()).toHaveLength(1);
  });

  it('treats a throwing read as empty data, not an error', () => {
    const device = new (class extends MemoryStorage {
      getItem(): string | null {
        throw new Error('denied');
      }
    })();
    const s = openTableStorage({ storage: device });
    expect(s.loadAll()).toEqual([]);
    expect(s.getLastOpen()).toBeUndefined();
  });
});
