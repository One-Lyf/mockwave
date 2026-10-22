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
    await expect(store.update('goal', goal.id, { kcal: undefined })).rejects.toThrow('"kcal" is required');
    expect(store.get('goal', goal.id)?.kcal).toBe(2000);
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
    await expect(store.dispatch('create', {})).rejects.toThrow('unknown action "create"');
  });
});

describe('declared actions', () => {
  const withActions: KitSchema = {
    entities: [
      {
        name: 'goal',
        scope: 'user',
        softDelete: true,
        fields: [{ name: 'kcal', type: 'number' }, { name: 'active', type: 'boolean' }, { name: 'note', type: 'string', optional: true }],
        actions: [
          { name: 'retire', label: 'Retire Goal', description: 'Stops counting toward today', sensitive: true, set: { active: false } },
          { name: 'clearNote', label: 'Clear Note', set: { note: null } },
        ],
      },
    ],
  };
  const open = async () => {
    const store = createStore(withActions, { backend: memoryBackend(), newId: () => 'g1' });
    await store.load();
    return store;
  };

  it('adds them to the action surface after the generated ones, carrying sensitive', async () => {
    const store = await open();
    expect(store.actionSurface()).toEqual([
      { name: 'goal.create', label: 'Add Goal' },
      { name: 'goal.update', label: 'Edit Goal' },
      { name: 'goal.delete', label: 'Delete Goal' },
      { name: 'goal.retire', label: 'Retire Goal', description: 'Stops counting toward today', sensitive: true },
      { name: 'goal.clearNote', label: 'Clear Note' },
    ]);
  });

  it('writes the fixed values onto the row named by id, and notifies', async () => {
    const store = await open();
    await store.dispatch('goal.create', { kcal: 2000, active: true, note: 'x' });
    const listener = vi.fn();
    store.subscribe(listener);
    await store.dispatch('goal.retire', { id: 'g1' });
    await store.dispatch('goal.clearNote', { id: 'g1' });
    expect(store.get('goal', 'g1')).toMatchObject({ kcal: 2000, active: false, note: null });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('fails on a missing or deleted row, and on an undeclared action', async () => {
    const store = await open();
    await expect(store.dispatch('goal.retire', { id: 'nope' })).rejects.toThrow('no row "nope"');
    await expect(store.dispatch('goal.retire', {})).rejects.toThrow('no row');
    await store.dispatch('goal.create', { kcal: 1, active: true });
    await store.dispatch('goal.delete', { id: 'g1' });
    await expect(store.dispatch('goal.retire', { id: 'g1' })).rejects.toThrow('no row');
    await expect(store.dispatch('goal.explode', { id: 'g1' })).rejects.toThrow('unknown action');
  });

  it('rejects bad declarations when the schema is checked', () => {
    const bad = (actions: NonNullable<KitSchema['entities'][0]['actions']>) =>
      validateSchema({ entities: [{ ...withActions.entities[0], actions }] });
    expect(bad([{ name: 'create', label: 'x', set: { active: true } }])[0]).toContain('clashes');
    expect(bad([{ name: 'a', label: 'x', set: {} }])[0]).toContain('at least one field');
    expect(bad([{ name: 'a', label: 'x', set: { nope: 1 } }])[0]).toContain('unknown field');
    expect(bad([{ name: 'a', label: 'x', set: { kcal: 'high' } }])[0]).toContain('finite number');
    expect(bad([{ name: 'a', label: 'x', set: { kcal: null } }])[0]).toContain('finite number');
    expect(bad([{ name: 'a', label: 'x', set: { active: true } }, { name: 'a', label: 'y', set: { active: false } }])[0]).toContain('duplicate');
    expect(() => createStore({ entities: [{ ...withActions.entities[0], actions: [{ name: 'create', label: 'x', set: { active: true } }] }] }, { backend: memoryBackend() })).toThrow('invalid schema');
  });

  it('refuses a missing label, a non-boolean sensitive, and unknown keys', () => {
    const check = (action: object) =>
      validateSchema({
        entities: [{ ...withActions.entities[0], actions: [action as NonNullable<KitSchema['entities'][0]['actions']>[0]] }],
      });
    const at = 'entity "goal" action "retire"';
    expect(check({ name: 'retire', set: { active: false } })).toEqual([`${at}: label is required`]);
    expect(check({ name: 'retire', label: '  ', set: { active: false } })).toEqual([`${at}: label is required`]);
    // 'no' is truthy, so without this check the surface would mark the action sensitive.
    expect(check({ name: 'retire', label: 'Retire', sensitive: 'no', set: { active: false } })).toEqual([
      `${at}: sensitive must be true or false`,
    ]);
    expect(check({ name: 'retire', label: 'Retire', sensitiv: true, set: { active: false } })).toEqual([
      `${at}: unknown key "sensitiv"`,
    ]);
    expect(check({ name: 'retire', label: 'Retire', sensitive: false, set: { active: false } })).toEqual([]);
    expect(() =>
      createStore(
        {
          entities: [
            {
              ...withActions.entities[0],
              actions: [{ name: 'retire', label: 'Retire', sensitiv: true, set: { active: false } } as NonNullable<KitSchema['entities'][0]['actions']>[0]],
            },
          ],
        },
        { backend: memoryBackend() },
      ),
    ).toThrow('unknown key "sensitiv"');
  });
});
