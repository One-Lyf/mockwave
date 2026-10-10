import { describe, expect, it } from 'vitest';
import { foodsCard, goalRing, kindRows, todaySummary } from './kitdemo';

describe('goalRing (Daily Goal card math)', () => {
  it('nothing eaten: an empty ring with the whole goal left', () => {
    expect(goalRing(0, { kcal: 2000 })).toEqual({ pct: 0, hasGoal: true, met: false, left: 2000, over: 0 });
  });

  it('partial: the fraction of the goal eaten and the remainder left', () => {
    const r = goalRing(570, { kcal: 2000 });
    expect(r.pct).toBeCloseTo(0.285);
    expect(r.hasGoal).toBe(true);
    expect(r.met).toBe(false);
    expect(r.left).toBe(1430);
    expect(r.over).toBe(0);
  });

  it('over goal: the ring clamps at full and counts the excess', () => {
    expect(goalRing(2430, { kcal: 2000 })).toEqual({ pct: 1, hasGoal: true, met: true, left: 0, over: 430 });
  });

  it('exactly at the goal: full ring, met, nothing left and nothing over', () => {
    expect(goalRing(2000, { kcal: 2000 })).toEqual({ pct: 1, hasGoal: true, met: true, left: 0, over: 0 });
  });

  it('no goal: an empty ring with no left/over math', () => {
    expect(goalRing(570, null)).toEqual({ pct: 0, hasGoal: false, met: false, left: 0, over: 0 });
  });

  it('a zero or negative goal counts as no goal, never a divide-by-zero', () => {
    expect(goalRing(100, { kcal: 0 })).toEqual({ pct: 0, hasGoal: false, met: false, left: 0, over: 0 });
    expect(goalRing(100, { kcal: -5 })).toEqual({ pct: 0, hasGoal: false, met: false, left: 0, over: 0 });
  });

  it('a negative or non-finite eaten clamps to an empty ring', () => {
    expect(goalRing(-50, { kcal: 2000 })).toEqual({ pct: 0, hasGoal: true, met: false, left: 2000, over: 0 });
    expect(goalRing(Number.NaN, { kcal: 2000 })).toEqual({ pct: 0, hasGoal: true, met: false, left: 2000, over: 0 });
  });
});

describe('foodsCard (Foods summary line)', () => {
  it('empty: No Foods Yet and no names', () => {
    expect(foodsCard([])).toEqual({ count: 0, heading: 'No Foods Yet', names: '', empty: true });
  });

  it('one food: a singular heading', () => {
    expect(foodsCard([{ name: 'Oatmeal' }])).toEqual({ count: 1, heading: '1 Food', names: 'Oatmeal', empty: false });
  });

  it('many: a plural count with the names in screen order', () => {
    const card = foodsCard([{ name: 'Oatmeal' }, { name: 'Banana' }, { name: 'Chicken Salad' }, { name: 'Greek Yogurt' }]);
    expect(card.count).toBe(4);
    expect(card.heading).toBe('4 Foods');
    expect(card.names).toBe('Banana, Chicken Salad, Greek Yogurt, Oatmeal');
    expect(card.empty).toBe(false);
  });

  it('lists the names in the same order as the Foods screen', () => {
    expect(foodsCard([{ name: 'Banana' }, { name: 'Oatmeal' }]).names).toBe('Banana, Oatmeal');
  });
});

describe('kindRows (Today\'s Meals empty states)', () => {
  const foods = [{ id: 'f1', name: 'Oatmeal', kcal: 150 }];

  it('no meals today: every kind is an empty Nothing Yet row', () => {
    const rows = kindRows(todaySummary({ meals: [], foods, goals: [] }, '2026-10-10'));
    expect(rows.map((r) => [r.kind, r.empty, r.meals])).toEqual([
      ['breakfast', true, []],
      ['lunch', true, []],
      ['dinner', true, []],
    ]);
  });

  it('flags only the kinds with nothing logged', () => {
    const summary = todaySummary(
      { meals: [{ id: 'm1', food: 'f1', kind: 'lunch', eatenAt: '2026-10-10T12:00:00' }], foods, goals: [] },
      '2026-10-10',
    );
    expect(kindRows(summary).map((r) => [r.kind, r.empty])).toEqual([
      ['breakfast', true],
      ['lunch', false],
      ['dinner', true],
    ]);
  });

  it('meals from another day do not fill a kind', () => {
    const summary = todaySummary(
      { meals: [{ id: 'm1', food: 'f1', kind: 'breakfast', eatenAt: '2026-10-09T08:00:00' }], foods, goals: [] },
      '2026-10-10',
    );
    expect(kindRows(summary).every((r) => r.empty)).toBe(true);
  });
});
