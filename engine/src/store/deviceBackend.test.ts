import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { deviceBackend } from './deviceBackend';
import { createStore } from './store';
import type { KitSchema } from './schema';

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, createdAt: 't', updatedAt: 't', ...extra });

describe('deviceBackend', () => {
  it('keeps rows across reopen', async () => {
    const idb = new IDBFactory();
    const a = deviceBackend('demo', idb);
    await a.open(['food']);
    await a.put('food', row('f1', { name: 'Oats' }));
    a.close?.();
    const b = deviceBackend('demo', idb);
    await b.open(['food']);
    expect(await b.all('food')).toEqual([row('f1', { name: 'Oats' })]);
  });

  it('adds a table when the schema gains an entity, keeping old rows', async () => {
    const idb = new IDBFactory();
    const a = deviceBackend('demo', idb);
    await a.open(['food']);
    await a.put('food', row('f1'));
    a.close?.();
    const b = deviceBackend('demo', idb);
    await b.open(['food', 'meal']);
    await b.put('meal', row('m1'));
    expect(await b.all('food')).toHaveLength(1);
    expect(await b.all('meal')).toHaveLength(1);
  });

  it('removes rows and keeps apps apart', async () => {
    const idb = new IDBFactory();
    const a = deviceBackend('one', idb);
    const b = deviceBackend('two', idb);
    await a.open(['food']);
    await b.open(['food']);
    await a.put('food', row('f1'));
    expect(await b.all('food')).toEqual([]);
    await a.remove('food', 'f1');
    expect(await a.all('food')).toEqual([]);
  });

  it('backs a store end to end', async () => {
    const idb = new IDBFactory();
    const schema: KitSchema = { entities: [{ name: 'goal', scope: 'user', fields: [{ name: 'kcal', type: 'number' }] }] };
    const s1 = createStore(schema, { backend: deviceBackend('demo', idb) });
    await s1.load();
    await s1.create('goal', { kcal: 2000 });
    const s2 = createStore(schema, { backend: deviceBackend('demo', idb) });
    await s2.load();
    expect(s2.list('goal')).toMatchObject([{ kcal: 2000 }]);
  });

  it('fails clearly without IndexedDB', async () => {
    await expect(deviceBackend('x', null as unknown as IDBFactory).open(['a'])).rejects.toThrow('not available');
  });
});
