/**
 * Contract proof (wr-data-plugin-upgrade): a Basewave table loads from the built-in samples and
 * emits through the contract output shape Fluxwave consumes — an out-port of kind `data:table`
 * carrying the `{ name, fields, rows }` table — matching waverider src/contract/types.ts.
 * Unit test, no network: the waverider types are mirrored structurally below.
 */

import { describe, expect, it } from 'vitest';
import {
  checkBasewaveTable,
  emitTableContract,
  parseContract,
  serializeContract,
  TABLE_OUT_PORT,
  type BasewaveContract,
} from './basewaveTable';
import { checkReferenceTable, type ReferenceTable } from './referenceTable';
import { getSampleTable, SAMPLE_TABLES } from './sampleData';
import type { FieldType } from '../store/schema';

// Structural mirror of waverider src/contract/types.ts (a separate repo, so the shapes are
// inlined here): the data plugin's out-port is a Port of kind 'data:table', direction 'out',
// and a Fluxwave 'data:table' in-port consumes the ReferenceTable payload on the wire.
type PortKind = 'data:table' | 'data:record' | 'event' | 'audio' | 'ui-slot';
type PortDirection = 'in' | 'out';
interface Port {
  id: string;
  name: string;
  kind: PortKind;
  direction: PortDirection;
}

const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date', 'enum', 'ref'];
const NAME = /^[a-z][a-zA-Z0-9]*$/;

describe('the Basewave out-port matches the waverider contract', () => {
  it('is a Port of kind data:table, direction out (compile-time + runtime)', () => {
    // compile-time: TABLE_OUT_PORT must satisfy the mirrored Port interface
    const port: Port = TABLE_OUT_PORT;
    expect(port).toEqual({ id: 'rows', name: 'Rows', kind: 'data:table', direction: 'out' });
    expect(port.kind).toBe('data:table');
    expect(port.direction).toBe('out');
  });
});

describe('every built-in sample emits through the contract output shape', () => {
  it('ships at least the three example sets: recipes, budget envelopes, chores', () => {
    expect(SAMPLE_TABLES.map((s) => s.id).sort()).toEqual(['budget', 'chores', 'recipes']);
    for (const s of SAMPLE_TABLES) {
      expect(s.label).toMatch(/^[A-Z]/); // Title Case labels
      expect(s.table.rows.length).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(SAMPLE_TABLES.map((s) => [s.id, s.label] as const))('%s: loads and emits a clean contract', (id) => {
    const table = getSampleTable(id);
    expect(table).toBeDefined();
    expect(checkBasewaveTable(table!)).toEqual([]); // the editor accepts it as-is

    const { port, payload } = emitTableContract(table!);
    expect(port).toBe(TABLE_OUT_PORT);

    // the payload is the ReferenceTable shape Fluxwave consumes as module data
    const ref: ReferenceTable = { fields: payload.fields, rows: payload.rows };
    expect(checkReferenceTable(ref)).toEqual([]);

    // contract-level shape: name rule, field names/types, rows keyed by field name
    expect(NAME.test(payload.name)).toBe(true);
    expect(payload.name).toBe(table!.name);
    expect(payload.fields.length).toBe(table!.columns.length);
    for (const [i, f] of payload.fields.entries()) {
      expect(NAME.test(f.name)).toBe(true);
      expect(f.name).toBe(table!.columns[i].name);
      expect(FIELD_TYPES).toContain(f.type);
      expect(f.optional).toBe(true);
    }
    const fieldNames = new Set(payload.fields.map((f) => f.name));
    for (const row of payload.rows) {
      for (const key of Object.keys(row)) expect(fieldNames.has(key)).toBe(true);
    }
    expect(payload.rows.length).toBe(table!.rows.length);
  });

  it.each(SAMPLE_TABLES.map((s) => [s.id] as const))('%s: the emitted payload survives a JSON round trip', (id) => {
    const { payload } = emitTableContract(getSampleTable(id)!);
    const json = serializeContract(payload); // the copy-as-code output
    expect(() => JSON.parse(json)).not.toThrow();
    expect(parseContract(json)).toEqual(payload);
  });

  it('recipes: the exact contract output Fluxwave would receive', () => {
    const { payload } = emitTableContract(getSampleTable('recipes')!);
    const expected: BasewaveContract = {
      name: 'recipes',
      fields: [
        { name: 'title', type: 'string', optional: true },
        { name: 'servings', type: 'number', optional: true },
        { name: 'prepMinutes', type: 'number', optional: true },
        { name: 'vegetarian', type: 'boolean', optional: true },
        { name: 'addedOn', type: 'date', optional: true },
      ],
      rows: [
        { title: 'Chickpea Curry', servings: 4, prepMinutes: 35, vegetarian: true, addedOn: '2026-09-14' },
        { title: 'Lemon Pasta', servings: 2, prepMinutes: 20, vegetarian: true, addedOn: '2026-10-02' },
        { title: 'Beef Stir Fry', servings: 3, prepMinutes: 25, vegetarian: false, addedOn: '2026-10-19' },
        { title: 'Tomato Soup', servings: 6, prepMinutes: 40, vegetarian: true, addedOn: '2026-11-01' },
      ],
    };
    expect(payload).toEqual(expected);
    expect(checkReferenceTable({ fields: expected.fields, rows: expected.rows })).toEqual([]);
  });
});
