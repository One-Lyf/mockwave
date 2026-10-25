import { describe, expect, it } from 'vitest';
import type { FieldDef } from '../store/schema';
import { checkPeriodBucket, groupPeriodBucket, periodKey, type PeriodBucket } from './periodBucket';

const schema: FieldDef[] = [
  { name: 'on', type: 'date' },
  { name: 'amount', type: 'number' },
  { name: 'note', type: 'string', optional: true },
];

const bucket: PeriodBucket = { period: 'day', itemSchema: schema };

describe('checkPeriodBucket', () => {
  it('accepts a day or month bucket with one required date field and no items', () => {
    expect(checkPeriodBucket(bucket)).toEqual([]);
    expect(checkPeriodBucket({ period: 'month', itemSchema: schema })).toEqual([]);
    expect(checkPeriodBucket(bucket, [])).toEqual([]);
  });

  it('rejects a missing period, a non-list schema, and anything but one required date', () => {
    expect(checkPeriodBucket({ period: 'week' } as unknown as PeriodBucket)).toEqual([
      'period must be "day" or "month"',
      'fields must be a list',
      'period bucket needs one required date field',
    ]);
    expect(checkPeriodBucket({ period: 'day', itemSchema: [] })).toEqual([
      'period bucket needs one required date field',
    ]);
    expect(checkPeriodBucket({
      period: 'day',
      itemSchema: [{ name: 'on', type: 'date', optional: true }, { name: 'also', type: 'date' }],
    })).toEqual(['period bucket needs one required date field']);
  });

  it('uses the shared field rules', () => {
    const errors = checkPeriodBucket({
      period: 'day',
      itemSchema: [
        { name: 'id', type: 'date' },
        { name: 'on', type: 'date' },
        { name: 'on', type: 'date' },
        { name: 'level', type: 'enum', enum: [] },
        { name: 'Bad', type: 'string' },
      ],
    });
    expect(errors).toContain('field "id": reserved name');
    expect(errors).toContain('field "on": duplicate name');
    expect(errors).toContain('field "level": enum needs values');
    expect(errors.some((e) => e.startsWith('field "Bad"'))).toBe(true);
  });

  it('checks items, and a date must be the calendar day written on it', () => {
    expect(checkPeriodBucket(bucket, [{ on: '2024-01-15', amount: 2 }])).toEqual([]);
    expect(checkPeriodBucket(bucket, [{ on: '2024-01-15T23:00:00.000Z', amount: 2 }])).toEqual([]);
    const errors = checkPeriodBucket(bucket, [
      null as unknown as Record<string, unknown>,
      { on: '2024-02-31', amount: 1, extra: true },
      { amount: 1 },
      { on: 'January 15, 2024', amount: 1 },
      { on: '2024-01-15', amount: 'x' },
    ]);
    expect(errors[0]).toBe('item 0: must be an object');
    expect(errors).toContain('item 1: "extra" is not a declared field');
    expect(errors).toContain('item 1 field "on": must be a YYYY-MM-DD date');
    expect(errors).toContain('item 2: missing required field "on"');
    expect(errors).toContain('item 3 field "on": must be a YYYY-MM-DD date');
    expect(errors).toContain('item 4 field "amount": must be a finite number');
  });

  it('rejects a non-list of items', () => {
    expect(checkPeriodBucket(bucket, 'nope' as unknown as [])).toEqual(['items must be a list']);
  });
});

describe('periodKey', () => {
  it('keeps the written calendar day and does not apply a zone', () => {
    expect(periodKey('day', '2024-01-15T23:00:00.000Z')).toBe('2024-01-15');
    expect(periodKey('day', '2024-01-15T01:00:00-05:00')).toBe('2024-01-15');
    expect(periodKey('month', '2024-01-15T23:00:00.000Z')).toBe('2024-01');
    expect(periodKey('day', '2024-02-31')).toBeNull();
    expect(periodKey('day', '2024-01-15')).toBe('2024-01-15');
  });
});

describe('groupPeriodBucket', () => {
  it('groups a copy by day or month, sorted, with input order inside a bucket', () => {
    const items = [
      { on: '2024-02-01', amount: 2 },
      { on: '2024-01-31T23:00:00.000Z', amount: 1 },
      { on: '2024-01-02', amount: 3 },
    ];
    const day = groupPeriodBucket(bucket, items);
    expect(day).toEqual([
      { period: '2024-01-02', items: [{ on: '2024-01-02', amount: 3 }] },
      { period: '2024-01-31', items: [{ on: '2024-01-31T23:00:00.000Z', amount: 1 }] },
      { period: '2024-02-01', items: [{ on: '2024-02-01', amount: 2 }] },
    ]);
    const month = groupPeriodBucket({ period: 'month', itemSchema: schema }, items);
    expect(month).toEqual([
      {
        period: '2024-01',
        items: [
          { on: '2024-01-31T23:00:00.000Z', amount: 1 },
          { on: '2024-01-02', amount: 3 },
        ],
      },
      { period: '2024-02', items: [{ on: '2024-02-01', amount: 2 }] },
    ]);
    day![0].items[0].amount = 99;
    expect(items[2].amount).toBe(3);
    expect(groupPeriodBucket(bucket, [])).toEqual([]);
  });

  it('returns null for a bad item and does not throw', () => {
    expect(groupPeriodBucket(bucket, [{ on: '2024-02-31', amount: 1 }])).toBeNull();
    expect(groupPeriodBucket({ period: 'day', itemSchema: [] }, [])).toBeNull();
  });
});
