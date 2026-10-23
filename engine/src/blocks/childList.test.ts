import { describe, expect, it } from 'vitest';
import type { FieldDef } from '../store/schema';
import { checkChildList, groupChildren, orderChildren, type ChildList } from './childList';

const fields: FieldDef[] = [
  { name: 'order', type: 'number' },
  { name: 'name', type: 'string' },
  { name: 'qty', type: 'number', optional: true },
  { name: 'section', type: 'string', optional: true },
];

const list: ChildList = { parent: 'recipe', fields, position: 'order', sectionHeader: 'section' };

describe('checkChildList', () => {
  it('accepts a parent, a required position, an optional header, and no rows', () => {
    expect(checkChildList(list)).toEqual([]);
    expect(checkChildList({ ...list, sectionHeader: undefined }, [])).toEqual([]);
  });

  it('rejects a bad parent, a bad position, and a header that is not an optional string', () => {
    expect(checkChildList({ ...list, parent: 'Recipe' })[0]).toMatch(/parent must match/);
    expect(checkChildList({ ...list, parent: '' })[0]).toMatch(/parent must match/);
    expect(checkChildList({ ...list, position: 'name' })).toContain(
      'position "name" must be a required number field',
    );
    expect(checkChildList({ ...list, position: 'missing' })).toContain(
      'position "missing" must be a required number field',
    );
    expect(checkChildList({
      ...list,
      fields: fields.map((f) => (f.name === 'order' ? { ...f, optional: true } : f)),
    })).toContain('position "order" must be a required number field');
    expect(checkChildList({ ...list, sectionHeader: '' })).toContain('sectionHeader needs a field name');
    expect(checkChildList({ ...list, sectionHeader: 'order' })).toContain(
      'sectionHeader cannot be the position field',
    );
    expect(checkChildList({ ...list, sectionHeader: 'name' })).toContain(
      'sectionHeader "name" must be an optional string field',
    );
    expect(checkChildList({ ...list, sectionHeader: 'nope' })).toContain(
      'sectionHeader "nope" must be an optional string field',
    );
  });

  it('checks rows, and a header may omit other required fields', () => {
    expect(checkChildList(list, [
      { order: 0, section: 'Sauce' },
      { order: 1, name: 'Butter' },
      { order: 2, name: 'Flour', qty: 2, section: '   ' },
    ])).toEqual([]);
    const errors = checkChildList(list, [
      null as unknown as Record<string, unknown>,
      { order: 1 },
      { order: '1', name: 'Butter', extra: true },
      { name: 'Butter' },
    ]);
    expect(errors).toContain('row 0: must be an object');
    expect(errors).toContain('row 1: missing required field "name"');
    expect(errors).toContain('row 2 field "order": must be a finite number');
    expect(errors).toContain('row 2: "extra" is not a declared field');
    expect(errors).toContain('row 3: missing required field "order"');
  });

  it('rejects a non-list of rows and a non-list of fields', () => {
    expect(checkChildList(list, 'nope' as unknown as [])).toEqual(['rows must be a list']);
    expect(checkChildList({ ...list, fields: 'nope' as unknown as FieldDef[] }).join('\n')).toMatch(/fields must be a list/);
  });
});

describe('orderChildren and groupChildren', () => {
  const rows = [
    { order: 2, name: 'Flour' },
    { order: 1, section: 'Sauce' },
    { order: 1, name: 'Butter' },
    { order: 0, name: 'Salt' },
    { order: 3, section: 'To finish' },
  ];

  it('sorts a copy by position and keeps ties in input order', () => {
    const ordered = orderChildren(list, rows);
    expect(ordered?.map((r) => r.name ?? r.section)).toEqual(['Salt', 'Sauce', 'Butter', 'Flour', 'To finish']);
    ordered![0].name = 'changed';
    expect(rows[3].name).toBe('Salt');
  });

  it('opens sections from header rows, including an empty trailing section and a leading group', () => {
    expect(groupChildren(list, rows)).toEqual([
      { header: null, items: [{ order: 0, name: 'Salt' }] },
      { header: 'Sauce', items: [{ order: 1, name: 'Butter' }, { order: 2, name: 'Flour' }] },
      { header: 'To finish', items: [] },
    ]);
  });

  it('does not treat a blank header as a section, and without one field everything is one group', () => {
    const plain = { parent: 'recipe', fields, position: 'order' } satisfies ChildList;
    const items = [
      { order: 2, name: 'Flour' },
      { order: 1, name: 'Butter', section: '   ' },
    ];
    expect(groupChildren(plain, items)).toEqual([
      {
        header: null,
        items: [
          { order: 1, name: 'Butter', section: '   ' },
          { order: 2, name: 'Flour' },
        ],
      },
    ]);
    expect(groupChildren(list, [{ order: 1, name: 'Butter', section: '   ' }])).toEqual([
      { header: null, items: [{ order: 1, name: 'Butter', section: '   ' }] },
    ]);
    expect(groupChildren(list, [])).toEqual([]);
  });

  it('returns null when the list or a row fails, and does not throw', () => {
    expect(orderChildren(list, [{ order: 1 }])).toBeNull();
    expect(groupChildren({ ...list, parent: '' }, [])).toBeNull();
    expect(orderChildren(list, [])).toEqual([]);
  });
});
