import { describe, expect, it } from 'vitest';
import schemaJson from '../../../stacks/kitdemo/schema.json';
import { memoryBackend } from '../store/backend';
import type { KitSchema } from '../store/schema';
import { formFields, readForm } from './form';
import { chipLabel, createKitdemoStore, localDate, todaySummary } from './kitdemo';

const schema = schemaJson as KitSchema;
const meal = schema.entities.find((e) => e.name === 'meal')!;

describe('formFields (EntityForm contract)', () => {
  it('defaults to every field, required unless the entity marks it optional', () => {
    const f = formFields(meal);
    expect(f.map((x) => [x.field.name, x.required])).toEqual([
      ['food', true],
      ['kind', true],
      ['eatenAt', true],
      ['note', false],
    ]);
  });

  it('may require an Entity-optional field', () => {
    const f = formFields(meal, { require: ['note'] });
    expect(f.find((x) => x.field.name === 'note')!.required).toBe(true);
  });

  it('never skips an Entity-required field', () => {
    expect(() => formFields(meal, { fields: ['food', 'kind'] })).toThrow(/eatenAt/);
  });

  it('may skip an Entity-optional field', () => {
    expect(formFields(meal, { fields: ['food', 'kind', 'eatenAt'] }).map((x) => x.field.name)).toEqual([
      'food',
      'kind',
      'eatenAt',
    ]);
  });

  it('refuses to require an optional field the form leaves out', () => {
    expect(() => formFields(meal, { fields: ['food', 'kind', 'eatenAt'], require: ['note'] })).toThrow(/note/);
  });

  it('refuses to require a field the entity does not have', () => {
    expect(() => formFields(meal, { require: ['nope'] })).toThrow(/nope/);
  });
});

describe('readForm', () => {
  const fields = formFields(meal);

  it('reports every missing required field and omits a blank optional one', () => {
    const r = readForm(fields, { food: '', kind: 'lunch', eatenAt: '', note: '' });
    expect(r.errors).toEqual({ food: 'Required', eatenAt: 'Required' });
  });

  it('builds typed values, leaving a blank optional field out', () => {
    const r = readForm(fields, { food: 'f1', kind: 'lunch', eatenAt: '2026-10-05', note: '' });
    expect(r.errors).toEqual({});
    expect(r.values).toEqual({ food: 'f1', kind: 'lunch', eatenAt: '2026-10-05' });
  });

  it('parses numbers and booleans, and rejects a non-number', () => {
    const food = formFields(schema.entities.find((e) => e.name === 'food')!);
    expect(readForm(food, { name: 'Oatmeal', kcal: '150' }).values).toEqual({ name: 'Oatmeal', kcal: 150 });
    expect(readForm(food, { name: 'Oatmeal', kcal: 'abc' }).errors).toEqual({ kcal: 'Enter a Number' });
    const goal = formFields(schema.entities.find((e) => e.name === 'goal')!);
    expect(readForm(goal, { kcal: '2000', active: true }).values).toEqual({ kcal: 2000, active: true });
    expect(readForm(goal, { kcal: '2000' }).values).toEqual({ kcal: 2000, active: false });
  });

  it('keeps a zero kcal as a value, not as missing', () => {
    const food = formFields(schema.entities.find((e) => e.name === 'food')!);
    expect(readForm(food, { name: 'Water', kcal: '0' }).values).toEqual({ name: 'Water', kcal: 0 });
  });

  it('an optional field made required is enforced', () => {
    const r = readForm(formFields(meal, { require: ['note'] }), { food: 'f', kind: 'lunch', eatenAt: '2026-10-05', note: ' ' });
    expect(r.errors).toEqual({ note: 'Required' });
  });
});

describe('editing a record', () => {
  it('clears an optional field left blank, through the store', async () => {
    const store = createKitdemoStore(null, { device: () => memoryBackend(), stack: () => memoryBackend() }, schema);
    await store.load();
    const food = await store.create('food', { name: 'Oatmeal', kcal: 150 });
    const m = await store.create('meal', { food: food.id, kind: 'lunch', eatenAt: '2026-10-05', note: 'Big bowl' });
    const fields = formFields(meal);
    const edit = { food: food.id, kind: 'lunch', eatenAt: '2026-10-05', note: '  ' };

    const blank = readForm(fields, edit, { clearBlank: true });
    expect(blank.errors).toEqual({});
    await store.update('meal', m.id, blank.values);
    expect(store.get('meal', m.id)!.note ?? null).toBeNull();

    const created = readForm(fields, edit);
    expect('note' in created.values).toBe(false);
  });
});

describe('createKitdemoStore', () => {
  it('uses the device backend with no sign-in and the stack backend when signed in', async () => {
    const calls: string[] = [];
    const backends = {
      device: () => (calls.push('device'), memoryBackend()),
      stack: () => (calls.push('stack'), memoryBackend()),
    };
    await createKitdemoStore(null, backends, schema).load();
    await createKitdemoStore({ name: 'Jeff', accessToken: async () => 't' }, backends, schema).load();
    expect(calls).toEqual(['device', 'stack']);
  });

  it('lets a signed-in app use household scope, and refuses it without sign-in', () => {
    const household = { entities: [{ ...schema.entities[0], scope: 'household' as const }] };
    const backends = { device: () => memoryBackend(), stack: () => memoryBackend() };
    expect(() => createKitdemoStore(null, backends, household)).toThrow(/household/);
    expect(() => createKitdemoStore({ name: 'J', accessToken: async () => 't' }, backends, household)).not.toThrow();
  });
});

describe('chipLabel', () => {
  it('says On This Device with no sign-in, else the account name', () => {
    expect(chipLabel(null)).toBe('On This Device');
    expect(chipLabel({ name: 'Jeff', accessToken: async () => 't' })).toBe('Jeff');
    expect(chipLabel({ name: '  ', accessToken: async () => 't' })).toBe('Signed In');
  });
});

describe('todaySummary', () => {
  const foods = [
    { id: 'f1', name: 'Oatmeal', kcal: 150 },
    { id: 'f2', name: 'Chicken Salad', kcal: 420 },
  ];
  const meals = [
    { id: 'm1', food: 'f1', kind: 'breakfast', eatenAt: '2026-10-05T08:00:00' },
    { id: 'm2', food: 'f2', kind: 'lunch', eatenAt: '2026-10-05T12:30:00' },
    { id: 'm3', food: 'f2', kind: 'dinner', eatenAt: '2026-10-04T19:00:00' },
  ];
  const goal = [{ id: 'g1', kcal: 2000, active: true }];

  it('lists only today per kind, sums kcal, and shows the active goal', () => {
    const s = todaySummary({ meals, foods, goals: goal }, '2026-10-05');
    expect(s.byKind.breakfast.map((m) => m.food?.name)).toEqual(['Oatmeal']);
    expect(s.byKind.lunch.map((m) => m.food?.name)).toEqual(['Chicken Salad']);
    expect(s.byKind.dinner).toEqual([]);
    expect(s.eaten).toBe(570);
    expect(s.goal).toEqual({ kcal: 2000 });
  });

  it('counts two meals of one kind and ignores a meal whose food is gone', () => {
    const s = todaySummary(
      { meals: [...meals, { id: 'm4', food: 'f1', kind: 'breakfast', eatenAt: '2026-10-05T09:00:00' }, { id: 'm5', food: 'gone', kind: 'lunch', eatenAt: '2026-10-05T13:00:00' }], foods, goals: goal },
      '2026-10-05',
    );
    expect(s.byKind.breakfast).toHaveLength(2);
    expect(s.eaten).toBe(720);
    expect(s.byKind.lunch.find((m) => m.id === 'm5')!.food).toBeUndefined();
  });

  it('uses the newest active goal and none when no goal is active', () => {
    expect(todaySummary({ meals: [], foods, goals: [{ id: 'a', kcal: 1, active: false }] }, '2026-10-05').goal).toBeNull();
    expect(
      todaySummary({ meals: [], foods, goals: [{ id: 'a', kcal: 1, active: true, createdAt: '2026-01-01' }, { id: 'b', kcal: 2, active: true, createdAt: '2026-02-01' }] }, '2026-10-05').goal,
    ).toEqual({ kcal: 2 });
  });
});

describe('localDate', () => {
  it('gives the local calendar day, not the UTC one', () => {
    expect(localDate(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05');
    expect(localDate(new Date(2026, 9, 5, 0, 5))).toBe('2026-10-05');
  });
});
