import { describe, expect, it, vi } from 'vitest';
import { memoryBackend } from './backend';
import { validateSchema, type KitSchema } from './schema';
import { createStore, StoreError } from './store';

const schema: KitSchema = {
  entities: [
    { name: 'food', scope: 'user', fields: [{ name: 'name', type: 'string' }, { name: 'kcal', type: 'number' }] },
    {
      name: 'meal',
      scope: 'user',
      softDelete: true,
      fields: [
        { name: 'food', type: 'ref', to: 'food' },
        { name: 'kind', type: 'enum', enum: ['breakfast', 'lunch', 'dinner'] },
        { name: 'eatenAt', type: 'date' },
        { name: 'note', type: 'string', optional: true },
      ],
    },
    { name: 'goal', scope: 'user', fields: [{ name: 'kcal', type: 'number' }, { name: 'active', type: 'boolean' }] },
  ],
};

async function setup(backend = memoryBackend()) {
  let n = 0;
  const store = createStore(schema, { backend, newId: () => `id${++n}`, now: () => new Date('2026-10-04T12:00:00Z') });
  await store.load();
  return store;
}

describe('validateSchema', () => {
  it('accepts the 3-entity schema', () => {
    expect(validateSchema(schema)).toEqual([]);
  });

  it('reports bad names, duplicates, reserved fields, bad refs and empty enums', () => {
    const errors = validateSchema({
      entities: [
        { name: 'Bad', scope: 'user', fields: [] },
        { name: 'a', scope: 'user', fields: [{ name: 'id', type: 'string' }, { name: 'x', type: 'enum' }] },
        { name: 'a', scope: 'user', fields: [{ name: 'r', type: 'ref', to: 'nope' }] },
      ],
    });
    expect(errors).toHaveLength(5);
  });

  it('allows household scope only when signed in', () => {
    const s: KitSchema = { entities: [{ name: 'chore', scope: 'household', fields: [] }] };
    expect(validateSchema(s)).toEqual(['entity "chore": household scope needs sign-in']);
    expect(validateSchema(s, { signedIn: true })).toEqual([]);
    expect(() => createStore(s, { backend: memoryBackend() })).toThrow(StoreError);
  });
});

describe('createStore', () => {
  it('creates, lists, updates and hard-deletes rows', async () => {
    const store = await setup();
    const oats = await store.create('food', { name: 'Oats', kcal: 300 });
    expect(oats).toMatchObject({ id: 'id1', name: 'Oats', createdAt: '2026-10-04T12:00:00.000Z' });
    await store.update('food', oats.id, { kcal: 320 });
    expect(store.get('food', oats.id)?.kcal).toBe(320);
    await store.delete('food', oats.id);
    expect(store.list('food')).toEqual([]);
  });

  it('soft-deletes when the entity says so, and keeps the row in the backend', async () => {
    const backend = memoryBackend();
    const store = await setup(backend);
    const food = await store.create('food', { name: 'Rice', kcal: 200 });
    const meal = await store.create('meal', { food: food.id, kind: 'lunch', eatenAt: '2026-10-04T12:00:00Z' });
    await store.delete('meal', meal.id);
    expect(store.list('meal')).toEqual([]);
    expect(store.get('meal', meal.id)).toBeUndefined();
    expect((await backend.all('meal'))[0].deletedAt).toBe('2026-10-04T12:00:00.000Z');
  });

  it('rejects writes that break the schema', async () => {
    const store = await setup();
    await expect(store.create('food', { name: 'Oats' })).rejects.toThrow('"kcal" is required');
    await expect(store.create('food', { name: 'Oats', kcal: '3' })).rejects.toThrow('must be a finite number');
    await expect(store.create('food', { name: 'Oats', kcal: 3, extra: 1 })).rejects.toThrow('not a field');
    await expect(store.create('meal', { food: 'missing', kind: 'lunch', eatenAt: '2026-10-04' })).rejects.toThrow(
      'points to a missing food',
    );
    await expect(store.create('meal', { food: 'x', kind: 'brunch', eatenAt: 'soon' })).rejects.toThrow(
      'must be one of breakfast, lunch, dinner',
    );
    const goal = await store.create('goal', { kcal: 2000, active: true });
    await expect(store.update('goal', goal.id, { id: 'other' })).rejects.toThrow('cannot set id');
    await expect(store.update('goal', 'nope', { kcal: 1 })).rejects.toThrow('no row');
  });

  it('accepts null for optional fields only', async () => {
    const store = await setup();
    const f = await store.create('food', { name: 'Egg', kcal: 70 });
    const m = await store.create('meal', { food: f.id, kind: 'breakfast', eatenAt: '2026-10-04', note: null });
    expect(m.note).toBeNull();
    await expect(store.update('food', f.id, { kcal: null })).rejects.toThrow('must be a finite number');
  });

  it('requires load() before use', () => {
    const store = createStore(schema, { backend: memoryBackend() });
    expect(() => store.list('food')).toThrow('call load() first');
    expect(store.getData('food')).toBeUndefined();
  });

  it('reloads saved rows from the backend', async () => {
    const backend = memoryBackend();
    await (await setup(backend)).create('goal', { kcal: 1800, active: false });
    const again = await setup(backend);
    expect(again.list('goal')).toHaveLength(1);
  });
});

describe('generated surfaces', () => {
  it('gives one array path and three actions per entity', async () => {
    const store = await setup();
    expect(store.dataSurface()).toEqual([
      { path: 'food', label: 'Food', kind: 'array' },
      { path: 'meal', label: 'Meal', kind: 'array' },
      { path: 'goal', label: 'Goal', kind: 'array' },
    ]);
    expect(store.actionSurface().map((a) => a.name)).toEqual([
      'food.create', 'food.update', 'food.delete',
      'meal.create', 'meal.update', 'meal.delete',
      'goal.create', 'goal.update', 'goal.delete',
    ]);
  });

  it('runs actions through dispatch and notifies subscribers', async () => {
    const store = await setup();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    const row = (await store.dispatch('goal.create', { kcal: 2000, active: true })) as { id: string };
    await store.dispatch('goal.update', { id: row.id, kcal: 2100 });
    expect(store.getData('goal')).toMatchObject([{ kcal: 2100 }]);
    await store.dispatch('goal.delete', { id: row.id });
    expect(store.getData('goal')).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    await expect(store.dispatch('goal.archive', {})).rejects.toThrow('unknown action');
  });
});
