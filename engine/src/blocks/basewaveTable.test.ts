import { describe, expect, it } from 'vitest';
import {
  addColumn,
  COLUMN_TYPES,
  checkBasewaveTable,
  coerceValue,
  contractToTable,
  isInvalidCell,
  newColumnId,
  parseContract,
  parseTable,
  removeColumn,
  renameColumn,
  serializeTable,
  setCell,
  setColumnType,
  tableToContract,
  tableToDataSurface,
  type BasewaveTable,
} from './basewaveTable';
import { checkReferenceTable } from './referenceTable';
import { blankTable, getSampleTable, SAMPLE_TABLES } from './sampleData';

const allTypes: BasewaveTable = {
  name: 'items',
  columns: [
    { id: 'c0', name: 'label', type: 'text' },
    { id: 'c1', name: 'count', type: 'number' },
    { id: 'c2', name: 'active', type: 'boolean' },
    { id: 'c3', name: 'on', type: 'date' },
  ],
  // row values are keyed by the stable column id, never by the name
  rows: [
    { c0: 'One', c1: 1, c2: true, c3: '2026-11-01' },
    { c0: 'Two', c1: 2.5, c2: false, c3: '2026-11-02' },
    { c0: 'Blank cells allowed' }, // every column is optional in the contract
  ],
};

/** The contract rows, keyed by column name. */
const allTypesContractRows = [
  { label: 'One', count: 1, active: true, on: '2026-11-01' },
  { label: 'Two', count: 2.5, active: false, on: '2026-11-02' },
  { label: 'Blank cells allowed' },
];

describe('tableToContract', () => {
  it('carries the column schema (name + type) with the rows', () => {
    const contract = tableToContract(allTypes);
    expect(contract.name).toBe('items');
    expect(contract.fields).toEqual([
      { name: 'label', type: 'string', optional: true },
      { name: 'count', type: 'number', optional: true },
      { name: 'active', type: 'boolean', optional: true },
      { name: 'on', type: 'date', optional: true },
    ]);
    expect(contract.rows).toEqual(allTypesContractRows);
    // the contract is the ReferenceTable shape Fluxwave consumes as module data
    expect(checkReferenceTable(contract)).toEqual([]);
  });

  it('maps every editor column type to a contract field type', () => {
    const table: BasewaveTable = {
      name: 't',
      columns: COLUMN_TYPES.map((type, i) => ({ id: `c${i}`, name: `f${i}`, type })),
      rows: [],
    };
    expect(tableToContract(table).fields.map((f) => f.type)).toEqual(['string', 'number', 'boolean', 'date']);
  });

  it('returns a copy: editing the contract never reaches the table rows', () => {
    const contract = tableToContract(allTypes);
    (contract.rows[0] as Record<string, unknown>).label = 'Changed';
    expect(allTypes.rows[0].c0).toBe('One');
  });
});

describe('serialize + round trip', () => {
  it('serializes a Basewave table to the contract and round-trips', () => {
    const json = serializeTable(allTypes);
    const parsed = JSON.parse(json);
    // the serialized contract carries schema (name + type) with the rows
    expect(parsed.name).toBe('items');
    expect(parsed.fields.map((f: { name: string; type: string }) => [f.name, f.type])).toEqual([
      ['label', 'string'],
      ['count', 'number'],
      ['active', 'boolean'],
      ['on', 'date'],
    ]);
    expect(parsed.rows).toEqual(allTypesContractRows);
    expect(parseTable(json)).toEqual(allTypes);
  });

  it('round-trips through the contract in both directions', () => {
    const contract = tableToContract(allTypes);
    expect(contractToTable(contract.name, contract)).toEqual(allTypes);
    expect(parseTable(serializeTable(allTypes))).toEqual(contractToTable(contract.name, contract));
  });

  it('round-trips every built-in sample data set', () => {
    expect(SAMPLE_TABLES.length).toBe(3);
    for (const sample of SAMPLE_TABLES) {
      const table = getSampleTable(sample.id)!;
      expect(checkBasewaveTable(table)).toEqual([]);
      expect(parseTable(serializeTable(table))).toEqual(table);
      expect(checkReferenceTable(tableToContract(table))).toEqual([]);
    }
  });

  it('round-trips a blank table', () => {
    const table = blankTable();
    expect(parseTable(serializeTable(table))).toEqual(table);
  });

  it('rejects JSON that is not a contract', () => {
    expect(() => parseContract('not json')).toThrow();
    expect(() => parseContract('"just a string"')).toThrow();
    expect(() => parseContract('{"name":"Bad Name","fields":[],"rows":[]}')).toThrow();
    expect(() => parseContract('{"name":"ok","fields":[{"name":"a"}],"rows":[]}')).toThrow();
    expect(() => parseContract('{"name":"ok","fields":[],"rows":{}}')).toThrow();
  });

  it('refuses a contract with a field type the editor cannot represent', () => {
    const json = JSON.stringify({
      name: 't',
      fields: [{ name: 'level', type: 'enum', enum: ['a'] }],
      rows: [],
    });
    expect(() => parseTable(json)).toThrow(/cannot represent/);
  });
});

describe('checkBasewaveTable', () => {
  it('accepts a clean table', () => {
    expect(checkBasewaveTable(allTypes)).toEqual([]);
  });

  it('flags a bad table name, reserved/duplicate columns and mistyped cells', () => {
    const bad: BasewaveTable = {
      name: 'Bad Name',
      columns: [
        { id: 'c0', name: 'id', type: 'text' },
        { id: 'c1', name: 'label', type: 'text' },
        { id: 'c2', name: 'label', type: 'text' },
        { id: 'c3', name: 'count', type: 'number' },
      ],
      rows: [{ c1: 'x', c3: 'not a number' }],
    };
    const errors = checkBasewaveTable(bad).join('\n');
    expect(errors).toMatch(/table name must match/);
    expect(errors).toMatch(/field "id": reserved name/);
    expect(errors).toMatch(/field "label": duplicate name/);
    // the mistyped cell is reported per cell, with the row numbered from 1 like the cell labels
    expect(errors).toMatch(/Row 1, column count: not a valid Number value/);
  });
});

describe('renameColumn: stable column ids keep the data', () => {
  it('clearing the title header and typing "name" keeps all 4 titles', () => {
    let table = getSampleTable('recipes')!;
    const ci = table.columns.findIndex((c) => c.name === 'title');
    const id = table.columns[ci].id;
    // clear the header, then retype character by character, as the input fires per keystroke
    for (const draft of ['', 'n', 'na', 'nam', 'name']) {
      table = renameColumn(table, ci, draft);
    }
    expect(table.columns[ci].name).toBe('name');
    expect(table.rows.map((r) => r[id])).toEqual(['Chickpea Curry', 'Lemon Pasta', 'Beef Stir Fry', 'Tomato Soup']);
    // the values surface under the new name in the output, and the table checks clean
    expect(tableToContract(table).rows.map((r) => r.name)).toEqual([
      'Chickpea Curry',
      'Lemon Pasta',
      'Beef Stir Fry',
      'Tomato Soup',
    ]);
    expect(checkBasewaveTable(table)).toEqual([]);
  });

  it('an empty or partial rename flags the alert but never drops the values', () => {
    let table = getSampleTable('recipes')!;
    const ci = table.columns.findIndex((c) => c.name === 'title');
    table = renameColumn(table, ci, '');
    expect(checkBasewaveTable(table).some((e) => e.includes('name must match'))).toBe(true);
    expect(table.rows.every((r) => r[table.columns[ci].id] !== undefined)).toBe(true);
  });

  it('renaming onto a duplicate name alerts and overwrites nothing; renaming away restores a clean table', () => {
    let table = getSampleTable('recipes')!;
    const si = table.columns.findIndex((c) => c.name === 'servings');
    const pi = table.columns.findIndex((c) => c.name === 'prepMinutes');
    const servingsId = table.columns[si].id;
    const prepId = table.columns[pi].id;

    table = renameColumn(table, si, 'prepMinutes'); // duplicate of the existing column
    expect(checkBasewaveTable(table).some((e) => e.includes('duplicate name'))).toBe(true);
    // both columns kept their own values, keyed by their own ids
    expect(table.rows.map((r) => r[servingsId])).toEqual([4, 2, 3, 6]);
    expect(table.rows.map((r) => r[prepId])).toEqual([35, 20, 25, 40]);

    table = renameColumn(table, si, 'servingsX');
    expect(checkBasewaveTable(table)).toEqual([]);
    const rows = tableToContract(table).rows;
    expect(rows.map((r) => r.servingsX)).toEqual([4, 2, 3, 6]);
    // the original prepMinutes values are intact
    expect(rows.map((r) => r.prepMinutes)).toEqual([35, 20, 25, 40]);
  });
});

describe('setColumnType never rewrites a raw value (Hand ruling: lossless type round trips)', () => {
  it('Text to Number on the 4 text titles keeps all 4 raw values flagged invalid', () => {
    const table = getSampleTable('recipes')!;
    const ci = table.columns.findIndex((c) => c.name === 'title');
    const id = table.columns[ci].id;
    const next = setColumnType(table, ci, 'number');
    // nothing is wiped or converted: every raw title stays in the row, keyed by the column id
    expect(next.rows.map((r) => r[id])).toEqual(['Chickpea Curry', 'Lemon Pasta', 'Beef Stir Fry', 'Tomato Soup']);
    expect(next.rows.every((r) => isInvalidCell(r[id], 'number'))).toBe(true);
    // the banner counts one error per invalid cell, rows numbered from 1, which disables Copy
    const errors = checkBasewaveTable(next);
    expect(errors).toHaveLength(4);
    expect(errors).toEqual([
      'Row 1, column title: not a valid Number value',
      'Row 2, column title: not a valid Number value',
      'Row 3, column title: not a valid Number value',
      'Row 4, column title: not a valid Number value',
    ]);
    // invalid cells stay out of the contract output
    expect(tableToContract(next).rows.map((r) => r.title)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('switching back to the original type restores every value exactly', () => {
    const table = getSampleTable('recipes')!;
    const ci = table.columns.findIndex((c) => c.name === 'title');
    const id = table.columns[ci].id;
    const before = table.rows.map((r) => r[id]);
    let next = setColumnType(table, ci, 'number');
    next = setColumnType(next, ci, 'text');
    expect(next.rows.map((r) => r[id])).toEqual(before);
    expect(next.rows.every((r) => !isInvalidCell(r[id], 'text'))).toBe(true);
    expect(checkBasewaveTable(next)).toEqual([]);
  });

  it('Number to Text to Number is a lossless round trip (raw stays numeric, output follows the type)', () => {
    const table = getSampleTable('recipes')!;
    const si = table.columns.findIndex((c) => c.name === 'servings');
    const id = table.columns[si].id;
    let next = setColumnType(table, si, 'text');
    expect(next.rows.map((r) => r[id])).toEqual([4, 2, 3, 6]); // raw untouched
    expect(tableToContract(next).rows.map((r) => r.servings)).toEqual(['4', '2', '3', '6']); // typed output
    expect(checkBasewaveTable(next)).toEqual([]);
    next = setColumnType(next, si, 'number');
    expect(next.rows.map((r) => r[id])).toEqual([4, 2, 3, 6]);
    expect(tableToContract(next).rows.map((r) => r.servings)).toEqual([4, 2, 3, 6]);
    expect(checkBasewaveTable(next)).toEqual([]);
  });

  it('Number to Date keeps the raw numbers flagged invalid instead of wiping them', () => {
    const table = getSampleTable('recipes')!;
    const si = table.columns.findIndex((c) => c.name === 'servings');
    const id = table.columns[si].id;
    const next = setColumnType(table, si, 'date');
    expect(next.rows.map((r) => r[id])).toEqual([4, 2, 3, 6]);
    expect(checkBasewaveTable(next)).toHaveLength(4);
    const back = setColumnType(next, si, 'number');
    expect(back.rows.map((r) => r[id])).toEqual([4, 2, 3, 6]);
    expect(checkBasewaveTable(back)).toEqual([]);
  });

  it('a mixed column keeps every raw value; only the non-convertible cells are flagged', () => {
    const table: BasewaveTable = {
      name: 'mixed',
      columns: [{ id: 'c0', name: 'val', type: 'text' }],
      rows: [{ c0: '4' }, { c0: 'abc' }, { c0: '2.5' }, { c0: 'xyz' }, {}],
    };
    const next = setColumnType(table, 0, 'number');
    expect(next.rows.map((r) => r.c0)).toEqual(['4', 'abc', '2.5', 'xyz', undefined]);
    // exactly the two non-convertible cells are flagged, so the Copy button stays disabled
    const errors = checkBasewaveTable(next);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBe('Row 2, column val: not a valid Number value');
    expect(errors[1]).toBe('Row 4, column val: not a valid Number value');
    // the contract carries only the valid typed values
    expect(tableToContract(next).rows).toEqual([{ val: 4 }, {}, { val: 2.5 }, {}, {}]);
    // switching back to Text restores the raw values exactly
    const back = setColumnType(next, 0, 'text');
    expect(back.rows.map((r) => r.c0)).toEqual(['4', 'abc', '2.5', 'xyz', undefined]);
    expect(checkBasewaveTable(back)).toEqual([]);
  });

  it('Boolean to Number derives 1/0 without touching the raw booleans, and back restores them', () => {
    const table = getSampleTable('recipes')!;
    const vi = table.columns.findIndex((c) => c.name === 'vegetarian');
    const id = table.columns[vi].id;
    let next = setColumnType(table, vi, 'number');
    expect(next.rows.map((r) => r[id])).toEqual([true, true, false, true]); // raw untouched
    expect(next.rows.every((r) => !isInvalidCell(r[id], 'number'))).toBe(true); // true/false derive 1/0
    expect(tableToContract(next).rows.map((r) => r.vegetarian)).toEqual([1, 1, 0, 1]);
    expect(checkBasewaveTable(next)).toEqual([]);
    next = setColumnType(next, vi, 'boolean');
    expect(next.rows).toEqual(table.rows);
    expect(tableToContract(next).rows.map((r) => r.vegetarian)).toEqual([true, true, false, true]);
    expect(checkBasewaveTable(next)).toEqual([]);
  });
});

describe('lossless type round trips (KJ #20 round 4)', () => {
  it('every sample table, every column, every type pair A -> B -> A keeps the raw rows identical', () => {
    for (const sample of SAMPLE_TABLES) {
      const start = getSampleTable(sample.id)!;
      for (let ci = 0; ci < start.columns.length; ci++) {
        for (const a of COLUMN_TYPES) {
          for (const b of COLUMN_TYPES) {
            let t = setColumnType(start, ci, a);
            t = setColumnType(t, ci, b);
            t = setColumnType(t, ci, a);
            expect(t.rows).toEqual(start.rows);
            expect(t.columns[ci].type).toBe(a);
          }
        }
      }
    }
  });

  it('Boolean <-> Number on the vegetarian column is exact in both directions', () => {
    const table = getSampleTable('recipes')!;
    const vi = table.columns.findIndex((c) => c.name === 'vegetarian');
    const id = table.columns[vi].id;
    const asNumber = setColumnType(setColumnType(table, vi, 'number'), vi, 'boolean');
    expect(asNumber.rows).toEqual(table.rows);
    expect(asNumber.rows.every((r) => !isInvalidCell(r[id], 'boolean'))).toBe(true);
    expect(checkBasewaveTable(asNumber)).toEqual([]);
    // Number -> Boolean -> Number on a 1/0 column
    const oneZero: BasewaveTable = {
      name: 'flags',
      columns: [{ id: 'c0', name: 'flag', type: 'number' }],
      rows: [{ c0: 1 }, { c0: 0 }, { c0: 1 }],
    };
    const asBool = setColumnType(oneZero, 0, 'boolean');
    expect(asBool.rows.map((r) => r.c0)).toEqual([1, 0, 1]); // raw untouched
    expect(tableToContract(asBool).rows.map((r) => r.flag)).toEqual([true, false, true]); // 1/0 accepted
    expect(checkBasewaveTable(asBool)).toEqual([]);
    const back = setColumnType(setColumnType(asBool, 0, 'number'), 0, 'boolean');
    expect(back.rows).toEqual(oneZero.rows);
    expect(checkBasewaveTable(back)).toEqual([]);
  });

  it('edge strings 007, 1e3, " 42 ", whitespace-only and empty survive every type round trip', () => {
    const start: BasewaveTable = {
      name: 'edges',
      columns: [{ id: 'c0', name: 'val', type: 'text' }],
      rows: [{ c0: '007' }, { c0: '1e3' }, { c0: ' 42 ' }, { c0: '   ' }, { c0: '' }, {}],
    };
    for (const a of COLUMN_TYPES) {
      for (const b of COLUMN_TYPES) {
        let t = setColumnType(start, 0, a);
        t = setColumnType(t, 0, b);
        t = setColumnType(t, 0, a);
        expect(t.rows).toEqual(start.rows);
      }
    }
    // as Number: 007 and " 42 " are valid plain decimals now; only 1e3 is invalid (kept raw, never
    // rewritten); blank cells stay blank
    const asNumber = setColumnType(start, 0, 'number');
    expect(asNumber.rows.map((r) => isInvalidCell(r.c0, 'number'))).toEqual([false, true, false, false, false, false]);
    expect(asNumber.rows.map((r) => r.c0)).toEqual(['007', '1e3', ' 42 ', '   ', '', undefined]);
    expect(tableToContract(asNumber).rows).toEqual([{ val: 7 }, {}, { val: 42 }, {}, {}, {}]);
    expect(setColumnType(asNumber, 0, 'text').rows).toEqual(start.rows);
    // as Boolean the same edge strings are invalid but kept; blank stays blank
    const asBool = setColumnType(start, 0, 'boolean');
    expect(asBool.rows.map((r) => isInvalidCell(r.c0, 'boolean'))).toEqual([true, true, true, false, false, false]);
    expect(setColumnType(asBool, 0, 'text').rows).toEqual(start.rows);
    // back to Text the table is clean again and the raw values are byte-identical (only truly empty
    // cells stay out of the contract; a whitespace-only cell is valid Text and appears as-is)
    const back = setColumnType(setColumnType(start, 0, 'number'), 0, 'text');
    expect(back.rows).toEqual(start.rows);
    expect(checkBasewaveTable(back)).toEqual([]);
    expect(tableToContract(back).rows.map((r) => r.val)).toEqual(['007', '1e3', ' 42 ', '   ', undefined, undefined]);
  });

  it('editing a cell sets a new raw value; the typed value and invalid flag derive from it', () => {
    let table = getSampleTable('recipes')!;
    const si = table.columns.findIndex((c) => c.name === 'servings');
    table = setCell(table, 0, si, '1e3');
    expect(table.rows[0][table.columns[si].id]).toBe('1e3'); // raw entered text
    expect(isInvalidCell('1e3', 'number')).toBe(true);
    expect(checkBasewaveTable(table)).toEqual(['Row 1, column servings: not a valid Number value']);
    // the invalid cell stays out of the contract output; the other cells still carry typed values
    expect(tableToContract(table).rows[0]).toEqual({ title: 'Chickpea Curry', prepMinutes: 35, vegetarian: true, addedOn: '2026-09-14' });
    // switching the type away and back never rewrites the raw edit
    table = setColumnType(setColumnType(table, si, 'text'), si, 'number');
    expect(table.rows[0][table.columns[si].id]).toBe('1e3');
  });
});

describe('valid input must not read as an error (KJ nits on #20)', () => {
  it('Number accepts any plain decimal; only non-decimal spellings are flagged invalid', () => {
    const table: BasewaveTable = {
      name: 'nums',
      columns: [{ id: 'c0', name: 'val', type: 'number' }],
      rows: [
        { c0: '320.50' }, { c0: '-0' }, { c0: '1.0' }, { c0: '007' }, { c0: ' 42 ' },
        { c0: '1e3' }, { c0: '0x10' }, { c0: 'Infinity' }, { c0: 'NaN' }, { c0: '' }, {},
      ],
    };
    // valid decimals are not errors; the raw strings are never rewritten
    expect(table.rows.map((r) => isInvalidCell(r.c0, 'number'))).toEqual([
      false, false, false, false, false, true, true, true, true, false, false,
    ]);
    expect(table.rows.map((r) => r.c0)).toEqual([
      '320.50', '-0', '1.0', '007', ' 42 ', '1e3', '0x10', 'Infinity', 'NaN', '', undefined,
    ]);
    // the contract carries the typed Number(trimmed) of each valid cell only
    expect(tableToContract(table).rows).toEqual([
      { val: 320.5 }, { val: -0 }, { val: 1 }, { val: 7 }, { val: 42 },
      {}, {}, {}, {}, {}, {},
    ]);
    expect(checkBasewaveTable(table)).toEqual([
      'Row 6, column val: not a valid Number value',
      'Row 7, column val: not a valid Number value',
      'Row 8, column val: not a valid Number value',
      'Row 9, column val: not a valid Number value',
    ]);
  });

  it('Text keeps a whitespace-only value as-is in the contract; only a truly empty cell is blank', () => {
    const table: BasewaveTable = {
      name: 'txt',
      columns: [{ id: 'c0', name: 'val', type: 'text' }],
      rows: [{ c0: '   ' }, { c0: '' }, { c0: ' x ' }, {}],
    };
    expect(table.rows.every((r) => !isInvalidCell(r.c0, 'text'))).toBe(true);
    expect(checkBasewaveTable(table)).toEqual([]);
    expect(tableToContract(table).rows).toEqual([{ val: '   ' }, {}, { val: ' x ' }, {}]);
  });

  it('Date accepts only real YYYY-MM-DD calendar dates, optionally with a time', () => {
    const valid = [
      '2026-11-01', '2024-02-29', '2026-11-01T10:30', '2026-11-01T10:30:45',
      '2026-11-01T10:30:45Z', '2026-11-01T23:59:59-08:00', '2026-11-01T00:00+05:30',
    ];
    const invalid = [
      '2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-11-00',
      '2026-2-3', '2026/11/01', '2026-11-01 10:30', '2026-11-01T25:00', '2026-11-01T10:60',
      'not a date', 20261101,
    ];
    for (const v of valid) expect(coerceValue('date', v)).toBe(v);
    for (const v of invalid) expect(coerceValue('date', v)).toBeUndefined();
  });

  it('the new edge values survive every A -> B -> A type round trip raw-identical', () => {
    const start: BasewaveTable = {
      name: 'edges2',
      columns: [{ id: 'c0', name: 'val', type: 'text' }],
      rows: [
        { c0: '320.50' }, { c0: '-0' }, { c0: '1.0' }, { c0: ' 42 ' },
        { c0: '2026-02-30' }, { c0: '2026-11-01T10:30:45Z' }, { c0: '0x10' }, { c0: 'NaN' },
        { c0: '   ' }, { c0: '' }, {},
      ],
    };
    for (const a of COLUMN_TYPES) {
      for (const b of COLUMN_TYPES) {
        let t = setColumnType(start, 0, a);
        t = setColumnType(t, 0, b);
        t = setColumnType(t, 0, a);
        expect(t.rows).toEqual(start.rows);
        expect(t.columns[0].type).toBe(a);
      }
    }
  });
});

describe('cell validator and contract check agree (KJ REJECT on #21)', () => {
  // Raw values across every column type: the KJ cases (+99:99, +24:00, a 400-digit decimal),
  // the earlier edge strings, and valid + invalid dates and numbers.
  const RAW_VALUES: unknown[] = [
    '320.50', '-0', '1.0', '007', ' 42 ', 42, -2.5, 0, '1'.repeat(308),
    '9'.repeat(400), '-' + '9'.repeat(400), '1e3', '0x10', 'Infinity', 'NaN', 'abc', '', '   ', undefined, null,
    '2026-11-01', '2024-02-29', '2026-11-01T10:30', '2026-11-01T10:30:45',
    '2026-11-01T10:30:45Z', '2026-11-01T23:59:59-08:00', '2026-11-01T00:00+05:30',
    '2026-01-01T10:00+23:59',
    '2026-01-01T10:00+99:99', '2026-01-01T10:00+24:00', '2026-02-30', '2025-02-29',
    '2026-13-01', '2026-11-00', '2026-2-3', '2026/11/01', '2026-11-01 10:30',
    '2026-11-01T25:00', '2026-11-01T10:60', 'not a date', 20261101,
    true, false, 1, 0, 'true', 'FALSE', '1', '0', 2, 'yes', 'hello',
  ];

  it('the KJ cases are invalid cells: bounded date offset, finite number', () => {
    expect(isInvalidCell('2026-01-01T10:00+99:99', 'date')).toBe(true);
    expect(isInvalidCell('2026-01-01T10:00+24:00', 'date')).toBe(true);
    expect(isInvalidCell('2026-01-01T10:00+23:59', 'date')).toBe(false);
    expect(isInvalidCell('9'.repeat(400), 'number')).toBe(true);
    expect(isInvalidCell('-' + '9'.repeat(400), 'number')).toBe(true);
    expect(isInvalidCell('1'.repeat(308), 'number')).toBe(false);
    expect(coerceValue('date', '2026-01-01T10:00+99:99')).toBeUndefined();
    expect(coerceValue('number', '9'.repeat(400))).toBeUndefined();
  });

  it('iff: some cell flagged invalid exactly when checkBasewaveTable rejects, per type per value', () => {
    for (const type of COLUMN_TYPES) {
      for (const value of RAW_VALUES) {
        const table: BasewaveTable = {
          name: 't',
          columns: [{ id: 'c0', name: 'val', type }],
          rows: [{ c0: value }],
        };
        const cellFlagged = table.rows.some((row) =>
          table.columns.some((col) => isInvalidCell(row[col.id], col.type)),
        );
        const errors = checkBasewaveTable(table);
        const rejected = errors.length > 0;
        if (cellFlagged !== rejected) {
          throw new Error(
            `iff broken: type=${type} value=${JSON.stringify(value) ?? String(value)} cellFlagged=${cellFlagged} errors=${JSON.stringify(errors)}`,
          );
        }
        // no case may have a contract rejection without a flagged cell: when no cell is
        // invalid, the contract output itself must pass the contract check clean
        if (!cellFlagged) expect(checkReferenceTable(tableToContract(table))).toEqual([]);
      }
    }
  });

  it('iff at table level: one table spanning every column type with every raw value', () => {
    const table: BasewaveTable = {
      name: 'probe',
      columns: COLUMN_TYPES.map((type, i) => ({ id: `c${i}`, name: `v${i}`, type })),
      rows: RAW_VALUES.map((v) => ({ c0: v, c1: v, c2: v, c3: v })),
    };
    const cellFlagged = table.rows.some((row) =>
      table.columns.some((col) => isInvalidCell(row[col.id], col.type)),
    );
    expect(cellFlagged).toBe(true);
    expect(checkBasewaveTable(table).length > 0).toBe(cellFlagged);
    // and a clean table has neither a flagged cell nor a contract rejection
    const clean: BasewaveTable = {
      name: 'clean',
      columns: COLUMN_TYPES.map((type, i) => ({ id: `c${i}`, name: `v${i}`, type })),
      rows: [{ c0: 'hello', c1: '42', c2: 'true', c3: '2026-11-01' }],
    };
    const cleanFlagged = clean.rows.some((row) =>
      clean.columns.some((col) => isInvalidCell(row[col.id], col.type)),
    );
    expect(cleanFlagged).toBe(false);
    expect(checkBasewaveTable(clean)).toEqual([]);
    expect(checkReferenceTable(tableToContract(clean))).toEqual([]);
  });
});

describe('newColumnId never re-issues an id', () => {
  it('stays unique across add/remove/add cycles', () => {
    let t = blankTable(); // c0
    t = addColumn(t); // c1
    t = addColumn(t); // c2
    const removed = t.columns[2].id;
    t = removeColumn(t, 2);
    t = addColumn(t);
    const ids = t.columns.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // never a duplicate live id
    expect(ids).not.toContain(removed); // and never re-issued after a removal
    expect(newColumnId(t)).toBe('c4');
    t = removeColumn(t, 1);
    t = addColumn(t);
    expect(t.columns.map((c) => c.id)).toEqual(['c0', 'c3', 'c4']);
  });
});

describe('cell and column helpers key by id', () => {
  it('setCell writes by column id and removeColumn drops only that column', () => {
    let table = getSampleTable('recipes')!;
    const si = table.columns.findIndex((c) => c.name === 'servings');
    table = setCell(table, 0, si, 9);
    expect(table.rows[0][table.columns[si].id]).toBe(9);
    table = removeColumn(table, si);
    expect(table.columns.some((c) => c.name === 'servings')).toBe(false);
    expect(table.rows.every((r) => !('c1' in r))).toBe(true);
    expect(tableToContract(table).rows.map((r) => r.title)).toEqual([
      'Chickpea Curry',
      'Lemon Pasta',
      'Beef Stir Fry',
      'Tomato Soup',
    ]);
    expect(checkBasewaveTable(table)).toEqual([]);
  });

  it('coerceValue derives the typed value, blanking what the type cannot represent', () => {
    expect(coerceValue('number', 'abc')).toBeUndefined();
    expect(coerceValue('number', '')).toBeUndefined();
    expect(coerceValue('number', '2.5')).toBe(2.5);
    expect(coerceValue('number', '42')).toBe(42);
    // any plain decimal is a valid number, typed as Number(trimmed); the raw string is kept as entered
    expect(coerceValue('number', '007')).toBe(7);
    expect(coerceValue('number', '320.50')).toBe(320.5);
    expect(coerceValue('number', '-0')).toBe(-0);
    expect(coerceValue('number', '1.0')).toBe(1);
    expect(coerceValue('number', ' 42 ')).toBe(42);
    // exponent, hex, non-finite spellings and blank are not numbers
    expect(coerceValue('number', '1e3')).toBeUndefined();
    expect(coerceValue('number', '0x10')).toBeUndefined();
    expect(coerceValue('number', 'Infinity')).toBeUndefined();
    expect(coerceValue('number', 'NaN')).toBeUndefined();
    expect(coerceValue('number', true)).toBe(1);
    expect(coerceValue('number', false)).toBe(0);
    expect(coerceValue('boolean', 'Chickpea Curry')).toBeUndefined();
    expect(coerceValue('boolean', 'true')).toBe(true);
    // Boolean accepts true/false, 1/0 and "true"/"false" case-insensitively
    expect(coerceValue('boolean', true)).toBe(true);
    expect(coerceValue('boolean', false)).toBe(false);
    expect(coerceValue('boolean', 1)).toBe(true);
    expect(coerceValue('boolean', 0)).toBe(false);
    expect(coerceValue('boolean', 'TRUE')).toBe(true);
    expect(coerceValue('boolean', 'False')).toBe(false);
    expect(coerceValue('boolean', '1')).toBe(true);
    expect(coerceValue('boolean', '0')).toBe(false);
    expect(coerceValue('boolean', 2)).toBeUndefined();
    expect(coerceValue('date', 'not a date')).toBeUndefined();
    expect(coerceValue('date', '2026-11-01')).toBe('2026-11-01');
    expect(coerceValue('date', '2026-11-01T10:30')).toBe('2026-11-01T10:30');
    expect(coerceValue('date', '2026-11-01T10:30:45Z')).toBe('2026-11-01T10:30:45Z');
    expect(coerceValue('date', '2026-11-01T10:30:45+05:30')).toBe('2026-11-01T10:30:45+05:30');
    // only a real calendar date: 2026-02-30 and a non-leap 2025-02-29 are not dates
    expect(coerceValue('date', '2026-02-30')).toBeUndefined();
    expect(coerceValue('date', '2025-02-29')).toBeUndefined();
    expect(coerceValue('date', '2024-02-29')).toBe('2024-02-29');
    expect(coerceValue('date', '2026-13-01')).toBeUndefined();
    expect(coerceValue('date', '2026-2-3')).toBeUndefined();
    expect(coerceValue('text', 4)).toBe('4');
    // a whitespace-only value is a valid Text value, kept as-is
    expect(coerceValue('text', '   ')).toBe('   ');
  });
});

describe('tableToDataSurface', () => {
  it('feeds the table through the Fluxwave DataField-shaped surface', () => {
    const surface = tableToDataSurface(allTypes);
    expect(surface[0]).toEqual({ path: 'items', label: 'Items', kind: 'array', writable: true });
    expect(surface.slice(1)).toEqual([
      { path: 'items.label', label: 'Label', kind: 'string', writable: true },
      { path: 'items.count', label: 'Count', kind: 'number', writable: true },
      { path: 'items.active', label: 'Active', kind: 'boolean', writable: true },
      { path: 'items.on', label: 'On', kind: 'string', writable: true },
    ]);
  });
});
