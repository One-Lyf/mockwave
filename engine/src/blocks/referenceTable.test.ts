import { describe, expect, it } from 'vitest';
import type { FieldDef } from '../store/schema';
import { checkReferenceTable, readReferenceTable, type ReferenceTable } from './referenceTable';

const allTypes: FieldDef[] = [
  { name: 'label', type: 'string' },
  { name: 'met', type: 'number' },
  { name: 'indoor', type: 'boolean' },
  { name: 'since', type: 'date' },
  { name: 'level', type: 'enum', enum: ['light', 'moderate', 'vigorous'] },
  { name: 'activity', type: 'ref', to: 'activity' },
  { name: 'note', type: 'string', optional: true },
];

const goodRow = {
  label: 'Walking',
  met: 3.5,
  indoor: false,
  since: '2024-01-01',
  level: 'moderate',
  activity: 'a1',
};

describe('checkReferenceTable', () => {
  it('accepts empty fields and empty rows', () => {
    expect(checkReferenceTable({ fields: [], rows: [] })).toEqual([]);
  });

  it('passes one good row of each field type', () => {
    expect(checkReferenceTable({ fields: allTypes, rows: [goodRow, { ...goodRow, note: 'brisk' }] })).toEqual([]);
  });

  it('flags a missing required field but allows an omitted optional one', () => {
    const { met: _met, ...noMet } = goodRow;
    const errors = checkReferenceTable({ fields: allTypes, rows: [noMet] });
    expect(errors).toEqual(['row 0: missing required field "met"']);
  });

  it('checks each present cell with checkValue', () => {
    const errors = checkReferenceTable({
      fields: allTypes,
      rows: [{ ...goodRow, met: 'high', indoor: 'no', since: 'not a date', level: 'extreme', activity: 7 }],
    });
    expect(errors).toHaveLength(5);
    expect(errors.join('\n')).toMatch(/"met": must be a finite number/);
    expect(errors.join('\n')).toMatch(/"level": must be one of/);
  });

  it('flags an enum with no values before checking cells', () => {
    const errors = checkReferenceTable({
      fields: [{ name: 'level', type: 'enum', enum: [] }],
      rows: [{ level: 'light' }],
    });
    expect(errors).toEqual(['field "level": enum needs values']);
  });

  it('flags an unknown type', () => {
    const fields = [{ name: 'x', type: 'blob' }] as unknown as FieldDef[];
    expect(checkReferenceTable({ fields, rows: [] })).toEqual(['field "x": unknown type "blob"']);
  });

  it('requires a non-empty ref target but not an entity in this table', () => {
    expect(checkReferenceTable({ fields: [{ name: 'a', type: 'ref' }], rows: [] })).toEqual([
      'field "a": ref needs a target in "to"',
    ]);
    expect(checkReferenceTable({ fields: [{ name: 'a', type: 'ref', to: '' }], rows: [] })).toHaveLength(1);
    expect(checkReferenceTable({ fields: [{ name: 'a', type: 'ref', to: 'elsewhere' }], rows: [{ a: 'x' }] })).toEqual([]);
  });

  it('flags system, duplicate and badly formed field names', () => {
    const errors = checkReferenceTable({
      fields: [
        { name: 'id', type: 'string' },
        { name: 'ownerId', type: 'string' },
        { name: 'label', type: 'string' },
        { name: 'label', type: 'string' },
        { name: 'Bad Name', type: 'string' },
      ],
      rows: [],
    });
    expect(errors).toContain('field "id": reserved name');
    expect(errors).toContain('field "ownerId": reserved name');
    expect(errors).toContain('field "label": duplicate name');
    expect(errors.some((e) => e.startsWith('field "Bad Name": name must match'))).toBe(true);
  });

  it('flags a row key that is not a declared field', () => {
    const errors = checkReferenceTable({ fields: [{ name: 'label', type: 'string' }], rows: [{ label: 'a', extra: 1 }] });
    expect(errors).toEqual(['row 0: "extra" is not a declared field']);
  });
});

describe('readReferenceTable', () => {
  const table: ReferenceTable = { fields: allTypes, rows: [{ ...goodRow }] };

  it('returns a copy of the rows when the table is clean', () => {
    expect(readReferenceTable(table)).toEqual(table.rows);
  });

  it('returns null when the check finds problems', () => {
    expect(readReferenceTable({ fields: [{ name: 'id', type: 'string' }], rows: [] })).toBeNull();
  });

  it('never lets changes to the copy reach the shipped rows', () => {
    const rows = readReferenceTable(table)!;
    rows[0].label = 'Changed';
    rows.push({ ...goodRow });
    const again = readReferenceTable(table)!;
    again[0].met = 99;
    expect(table.rows).toEqual([goodRow]);
    expect(table.rows).toHaveLength(1);
  });
});
