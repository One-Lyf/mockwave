/**
 * Built-in sample data sets for the Basewave table editor, loadable from the empty state.
 * Each is a valid BasewaveTable: it serializes to a clean contract on load.
 */

import type { BasewaveTable } from './basewaveTable';

export interface SampleTable {
  id: string;
  label: string;
  description: string;
  table: BasewaveTable;
}

export const SAMPLE_TABLES: SampleTable[] = [
  {
    id: 'recipes',
    label: 'Recipes',
    description: 'Dishes with servings, prep time and a date added.',
    table: {
      name: 'recipes',
      columns: [
        { id: 'c0', name: 'title', type: 'text' },
        { id: 'c1', name: 'servings', type: 'number' },
        { id: 'c2', name: 'prepMinutes', type: 'number' },
        { id: 'c3', name: 'vegetarian', type: 'boolean' },
        { id: 'c4', name: 'addedOn', type: 'date' },
      ],
      // row values are keyed by the column id, not the name, so renames never touch them
      rows: [
        { c0: 'Chickpea Curry', c1: 4, c2: 35, c3: true, c4: '2026-09-14' },
        { c0: 'Lemon Pasta', c1: 2, c2: 20, c3: true, c4: '2026-10-02' },
        { c0: 'Beef Stir Fry', c1: 3, c2: 25, c3: false, c4: '2026-10-19' },
        { c0: 'Tomato Soup', c1: 6, c2: 40, c3: true, c4: '2026-11-01' },
      ],
    },
  },
  {
    id: 'budget',
    label: 'Budget Envelopes',
    description: 'Monthly envelope categories with amounts, paid flags and due dates.',
    table: {
      name: 'budget',
      columns: [
        { id: 'c0', name: 'category', type: 'text' },
        { id: 'c1', name: 'amount', type: 'number' },
        { id: 'c2', name: 'paid', type: 'boolean' },
        { id: 'c3', name: 'dueOn', type: 'date' },
      ],
      rows: [
        { c0: 'Rent', c1: 1450, c2: true, c3: '2026-11-01' },
        { c0: 'Groceries', c1: 320.5, c2: false, c3: '2026-11-08' },
        { c0: 'Internet', c1: 65, c2: true, c3: '2026-11-05' },
        { c0: 'Transit', c1: 90, c2: false, c3: '2026-11-12' },
        { c0: 'Savings', c1: 500, c2: false, c3: '2026-11-15' },
      ],
    },
  },
  {
    id: 'chores',
    label: 'Chores',
    description: 'Household chores with done flags, due dates and time estimates.',
    table: {
      name: 'chores',
      columns: [
        { id: 'c0', name: 'chore', type: 'text' },
        { id: 'c1', name: 'done', type: 'boolean' },
        { id: 'c2', name: 'dueOn', type: 'date' },
        { id: 'c3', name: 'minutes', type: 'number' },
      ],
      rows: [
        { c0: 'Take out the trash', c1: true, c2: '2026-11-06', c3: 15 },
        { c0: 'Vacuum the living room', c1: false, c2: '2026-11-08', c3: 30 },
        { c0: 'Laundry and fold', c1: false, c2: '2026-11-09', c3: 45 },
        { c0: 'Mow the lawn', c1: false, c2: '2026-11-11', c3: 60 },
      ],
    },
  },
];

/** A fresh copy of a sample, so editing never mutates the shipped set. */
export function getSampleTable(id: string): BasewaveTable | undefined {
  const sample = SAMPLE_TABLES.find((s) => s.id === id);
  return sample ? structuredClone(sample.table) : undefined;
}

/** The blank table the empty state's "Start Blank Table" loads. */
export function blankTable(): BasewaveTable {
  return { name: 'myTable', columns: [{ id: 'c0', name: 'column1', type: 'text' }], rows: [{}] };
}
