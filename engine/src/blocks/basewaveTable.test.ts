import { describe, expect, it } from 'vitest';
import {
  COLUMN_TYPES,
  checkBasewaveTable,
  contractToTable,
  parseContract,
  parseTable,
  serializeTable,
  tableToContract,
  tableToDataSurface,
  type BasewaveTable,
} from './basewaveTable';
import { checkReferenceTable } from './referenceTable';
import { blankTable, getSampleTable, SAMPLE_TABLES } from './sampleData';

const allTypes: BasewaveTable = {
  name: 'items',
  columns: [
    { name: 'label', type: 'text' },
    { name: 'count', type: 'number' },
    { name: 'active', type: 'boolean' },
    { name: 'on', type: 'date' },
  ],
  rows: [
    { label: 'One', count: 1, active: true, on: '2026-11-01' },
    { label: 'Two', count: 2.5, active: false, on: '2026-11-02' },
    { label: 'Blank cells allowed' }, // every column is optional in the contract
  ],
};

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
    expect(contract.rows).toEqual(allTypes.rows);
    // the contract is the ReferenceTable shape Fluxwave consumes as module data
    expect(checkReferenceTable(contract)).toEqual([]);
  });

  it('maps every editor column type to a contract field type', () => {
    const table: BasewaveTable = {
      name: 't',
      columns: COLUMN_TYPES.map((type, i) => ({ name: `c${i}`, type })),
      rows: [],
    };
    expect(tableToContract(table).fields.map((f) => f.type)).toEqual(['string', 'number', 'boolean', 'date']);
  });

  it('returns a copy: editing the contract never reaches the table rows', () => {
    const contract = tableToContract(allTypes);
    (contract.rows[0] as Record<string, unknown>).label = 'Changed';
    expect(allTypes.rows[0].label).toBe('One');
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
    expect(parsed.rows).toEqual(allTypes.rows);
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
        { name: 'id', type: 'text' },
        { name: 'label', type: 'text' },
        { name: 'label', type: 'text' },
        { name: 'count', type: 'number' },
      ],
      rows: [{ label: 'x', count: 'not a number' }],
    };
    const errors = checkBasewaveTable(bad).join('\n');
    expect(errors).toMatch(/table name must match/);
    expect(errors).toMatch(/field "id": reserved name/);
    expect(errors).toMatch(/field "label": duplicate name/);
    expect(errors).toMatch(/"count": must be a finite number/);
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
