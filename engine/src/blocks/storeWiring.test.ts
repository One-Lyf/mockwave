import { describe, expect, it } from 'vitest';
import { memoryBackend } from '../store/backend';
import type { FieldDef } from '../store/schema';
import { createStore } from '../store/store';
import { checkChildList, childListEntity, groupChildren, orderChildren, type ChildList } from './childList';
import { groupPeriodBucket, periodBucketEntity, type PeriodBucket } from './periodBucket';
import { checkStoredSettings, readSettings, settingsEntity, type SettingsBlock } from './settings';

// The three data blocks read rows that live in KitStore entities. These tests write through a real
// store and read the store's own rows back, which carry id, createdAt and updatedAt.

let n = 0;
const opts = () => ({ backend: memoryBackend(), newId: () => `r${++n}`, now: () => new Date('2026-10-23T21:00:00Z') });

describe('PeriodBucket in a KitStore entity', () => {
  const bucket: PeriodBucket = {
    period: 'day',
    itemSchema: [
      { name: 'when', type: 'date' },
      { name: 'grams', type: 'number' },
    ],
  };

  it('gives an entity the store accepts, and groups the rows the store returns', async () => {
    const entity = periodBucketEntity('intake', bucket)!;
    expect(entity).toEqual({ name: 'intake', scope: 'user', fields: bucket.itemSchema });
    const store = createStore({ entities: [entity] }, opts());
    await store.load();
    await store.dispatch('intake.create', { when: '2026-10-23', grams: 10 });
    await store.dispatch('intake.create', { when: '2026-10-22T23:30:00Z', grams: 5 });
    await store.dispatch('intake.create', { when: '2026-10-23', grams: 7 });
    const groups = groupPeriodBucket(bucket, store.list('intake'))!;
    expect(groups.map((g) => [g.period, g.items.map((i) => i.grams)])).toEqual([
      ['2026-10-22', [5]],
      ['2026-10-23', [10, 7]],
    ]);
    expect(typeof groups[1].items[0].id).toBe('string');
    expect(groups[1].items[0].createdAt).toBe('2026-10-23T21:00:00.000Z');
  });

  it('still rejects a field nobody declared, and returns no entity for a bad bucket', () => {
    expect(groupPeriodBucket(bucket, [{ when: '2026-10-23', grams: 1, id: 'a', extra: 1 }])).toBeNull();
    expect(periodBucketEntity('intake', { period: 'week' as 'day', itemSchema: bucket.itemSchema })).toBeNull();
  });

  it('household needs sign-in, enforced by the store', () => {
    const entity = periodBucketEntity('intake', bucket, 'household')!;
    expect(() => createStore({ entities: [entity] }, opts())).toThrow(/household scope needs sign-in/);
    expect(() => createStore({ entities: [entity] }, { ...opts(), signedIn: true })).not.toThrow();
  });
});

describe('ChildList in a KitStore entity', () => {
  const list: ChildList = {
    parent: 'trip',
    fields: [
      { name: 'trip', type: 'ref', to: 'trip' },
      { name: 'label', type: 'string' },
      { name: 'position', type: 'number' },
      { name: 'section', type: 'string', optional: true },
    ],
    position: 'position',
    sectionHeader: 'section',
  };

  it('gives an entity the store accepts beside its parent, and orders the rows the store returns', async () => {
    const entity = childListEntity('stop', list)!;
    const store = createStore({ entities: [{ name: 'trip', scope: 'user', fields: [{ name: 'title', type: 'string' }] }, entity] }, opts());
    await store.load();
    const trip = (await store.dispatch('trip.create', { title: 'Coast' })) as { id: string };
    await store.dispatch('stop.create', { trip: trip.id, label: 'Lunch', position: 3 });
    await store.dispatch('stop.create', { trip: trip.id, label: 'Day 1', position: 0, section: 'Day 1' });
    await store.dispatch('stop.create', { trip: trip.id, label: 'Pier', position: 1 });
    const rows = store.list('stop');
    expect(orderChildren(list, rows)!.map((r) => r.label)).toEqual(['Day 1', 'Pier', 'Lunch']);
    const groups = groupChildren(list, rows)!;
    expect(groups.map((g) => [g.header, g.items.map((r) => r.label)])).toEqual([['Day 1', ['Pier', 'Lunch']]]);
    expect(typeof groups[0].items[0].id).toBe('string');
  });

  it('stores a header row that omits label, as the block allows', async () => {
    const entity = childListEntity('stop', list)!;
    expect(entity.fields.map((f) => [f.name, !!f.optional])).toEqual([
      ['trip', false],
      ['label', true],
      ['position', false],
      ['section', true],
    ]);
    expect(list.fields[1].optional).toBeUndefined();
    const store = createStore({ entities: [{ name: 'trip', scope: 'user', fields: [] }, entity] }, opts());
    await store.load();
    const trip = (await store.dispatch('trip.create', {})) as { id: string };
    const header = { trip: trip.id, position: 0, section: 'Day 1' };
    expect(checkChildList(list, [header])).toEqual([]);
    await store.dispatch('stop.create', header);
    await store.dispatch('stop.create', { trip: trip.id, label: 'Pier', position: 1 });
    const rows = store.list('stop');
    expect(rows).toHaveLength(2);
    expect(groupChildren(list, rows, trip.id)!.map((g) => [g.header, g.items.map((r) => r.label)])).toEqual([
      ['Day 1', ['Pier']],
    ]);
    // An item row still needs its label when read back, and every row still needs its parent.
    await store.dispatch('stop.create', { trip: trip.id, position: 2 });
    expect(groupChildren(list, store.list('stop'), trip.id)).toBeNull();
    await expect(store.dispatch('stop.create', { position: 3, section: 'Day 2' })).rejects.toThrow();
  });

  it('children of two parents never interleave', async () => {
    const entity = childListEntity('stop', list)!;
    const store = createStore({ entities: [{ name: 'trip', scope: 'user', fields: [] }, entity] }, opts());
    await store.load();
    const a = (await store.dispatch('trip.create', {})) as { id: string };
    const b = (await store.dispatch('trip.create', {})) as { id: string };
    await store.dispatch('stop.create', { trip: a.id, position: 0, section: 'A header' });
    await store.dispatch('stop.create', { trip: a.id, label: 'A-stop', position: 1 });
    await store.dispatch('stop.create', { trip: b.id, label: 'B-stop', position: 0.5 });
    const rows = store.list('stop');
    expect(groupChildren(list, rows, a.id)!.map((g) => [g.header, g.items.map((r) => r.label)])).toEqual([
      ['A header', ['A-stop']],
    ]);
    expect(groupChildren(list, rows, b.id)!.map((g) => [g.header, g.items.map((r) => r.label)])).toEqual([
      [null, ['B-stop']],
    ]);
    expect(orderChildren(list, rows, b.id)!.map((r) => r.label)).toEqual(['B-stop']);
    // Without a parent id, rows of two parents are refused rather than mixed.
    expect(groupChildren(list, rows)).toBeNull();
    expect(orderChildren(list, rows)).toBeNull();
  });

  it('the store refuses a child whose parent is missing, and a bad list has no entity', async () => {
    const store = createStore({ entities: [{ name: 'trip', scope: 'user', fields: [] }, childListEntity('stop', list)!] }, opts());
    await store.load();
    await expect(store.dispatch('stop.create', { trip: 'nope', label: 'X', position: 0 })).rejects.toThrow(/missing trip/);
    expect(childListEntity('stop', { ...list, position: 'label' })).toBeNull();
  });
});

describe('Settings in a KitStore entity', () => {
  const fields: FieldDef[] = [
    { name: 'units', type: 'enum', enum: ['metric', 'imperial'] },
    { name: 'goal', type: 'number' },
    { name: 'note', type: 'string', optional: true },
  ];
  const block: SettingsBlock = { fields, defaults: { units: 'metric', goal: 2000 }, scope: 'user' };

  it('gives an entity with every field optional, and reads the row the store returns over the defaults', async () => {
    const entity = settingsEntity('prefs', block)!;
    expect(entity.scope).toBe('user');
    expect(entity.fields.every((f) => f.optional)).toBe(true);
    expect(block.fields[0].optional).toBeUndefined();
    const store = createStore({ entities: [entity] }, opts());
    await store.load();
    expect(readSettings(block, store.list('prefs')[0])).toEqual({ units: 'metric', goal: 2000 });
    const row = (await store.dispatch('prefs.create', { goal: 1800 })) as { id: string };
    const stored = store.list('prefs')[0];
    expect(checkStoredSettings(block, stored)).toEqual([]);
    expect(readSettings(block, stored)).toEqual({ units: 'metric', goal: 1800 });
    await store.dispatch('prefs.update', { id: row.id, goal: null, note: 'hi' });
    expect(readSettings(block, store.list('prefs')[0])).toEqual({ units: 'metric', goal: 2000, note: 'hi' });
  });

  it('a stored value of the wrong type still fails, and a stray key still fails', () => {
    expect(readSettings(block, { id: 'a', goal: 'lots' })).toBeNull();
    expect(readSettings(block, { id: 'a', colour: 'red' })).toBeNull();
  });

  it('household needs sign-in; device has no store entity', () => {
    expect(settingsEntity('prefs', { ...block, scope: 'household' })).toBeNull();
    expect(settingsEntity('prefs', { ...block, scope: 'household' }, { signedIn: true })!.scope).toBe('household');
    expect(settingsEntity('prefs', { ...block, scope: 'device' })).toBeNull();
  });
});
