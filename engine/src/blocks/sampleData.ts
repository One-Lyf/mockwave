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
        { name: 'title', type: 'text' },
        { name: 'servings', type: 'number' },
        { name: 'prepMinutes', type: 'number' },
        { name: 'vegetarian', type: 'boolean' },
        { name: 'addedOn', type: 'date' },
      ],
      rows: [
        { title: 'Chickpea Curry', servings: 4, prepMinutes: 35, vegetarian: true, addedOn: '2026-09-14' },
        { title: 'Lemon Pasta', servings: 2, prepMinutes: 20, vegetarian: true, addedOn: '2026-10-02' },
        { title: 'Beef Stir Fry', servings: 3, prepMinutes: 25, vegetarian: false, addedOn: '2026-10-19' },
        { title: 'Tomato Soup', servings: 6, prepMinutes: 40, vegetarian: true, addedOn: '2026-11-01' },
      ],
    },
  },
  {
    id: 'budget',
    label: 'Budget',
    description: 'Monthly spending categories with amounts and due dates.',
    table: {
      name: 'budget',
      columns: [
        { name: 'category', type: 'text' },
        { name: 'amount', type: 'number' },
        { name: 'paid', type: 'boolean' },
        { name: 'dueOn', type: 'date' },
      ],
      rows: [
        { category: 'Rent', amount: 1450, paid: true, dueOn: '2026-11-01' },
        { category: 'Groceries', amount: 320.5, paid: false, dueOn: '2026-11-08' },
        { category: 'Internet', amount: 65, paid: true, dueOn: '2026-11-05' },
        { category: 'Transit', amount: 90, paid: false, dueOn: '2026-11-12' },
        { category: 'Savings', amount: 500, paid: false, dueOn: '2026-11-15' },
      ],
    },
  },
  {
    id: 'tasks',
    label: 'Tasks',
    description: 'A todo list with done flags, due dates and estimates.',
    table: {
      name: 'tasks',
      columns: [
        { name: 'task', type: 'text' },
        { name: 'done', type: 'boolean' },
        { name: 'dueOn', type: 'date' },
        { name: 'minutes', type: 'number' },
      ],
      rows: [
        { task: 'Review Basewave PR', done: false, dueOn: '2026-11-08', minutes: 45 },
        { task: 'Water the plants', done: true, dueOn: '2026-11-06', minutes: 10 },
        { task: 'Book dentist appointment', done: false, dueOn: '2026-11-11', minutes: 15 },
        { task: 'Ship table editor', done: false, dueOn: '2026-11-07', minutes: 120 },
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
  return { name: 'myTable', columns: [{ name: 'column1', type: 'text' }], rows: [{}] };
}
