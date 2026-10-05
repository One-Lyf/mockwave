/**
 * EntityForm contract (SPEC-presets-and-kit 4.2): a form may require a field the Entity marks
 * optional, but must never skip a field the Entity requires.
 */

import type { EntityDef, FieldDef } from '../store/schema';

export interface FormOptions {
  /** Fields to show, in order. Defaults to every field; omitting an Entity-required one throws. */
  fields?: string[];
  /** Entity-optional fields this form insists on. */
  require?: string[];
}

export interface FormField {
  field: FieldDef;
  required: boolean;
}

export function formFields(entity: EntityDef, opts: FormOptions = {}): FormField[] {
  const known = new Set(entity.fields.map((f) => f.name));
  const unknown = [...(opts.fields ?? []), ...(opts.require ?? [])].filter((n) => !known.has(n));
  if (unknown.length) throw new Error(`${entity.name} form: no such field ${unknown.join(', ')}`);
  const shown = opts.fields ? new Set(opts.fields) : known;
  const skipped = entity.fields.filter((f) => !f.optional && !shown.has(f.name)).map((f) => f.name);
  if (skipped.length) throw new Error(`${entity.name} form: cannot skip required field ${skipped.join(', ')}`);
  const insist = new Set(opts.require ?? []);
  return entity.fields
    .filter((f) => shown.has(f.name))
    .map((f) => ({ field: f, required: !f.optional || insist.has(f.name) }));
}

export type FormInput = Record<string, string | boolean | undefined>;

export interface FormResult {
  values: Record<string, unknown>;
  /** Field name to message; empty when the form can be saved. */
  errors: Record<string, string>;
}

export function readForm(fields: FormField[], input: FormInput): FormResult {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const { field, required } of fields) {
    const raw = input[field.name];
    if (field.type === 'boolean') {
      values[field.name] = raw === true;
      continue;
    }
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) {
      if (required) errors[field.name] = 'Required';
      continue;
    }
    if (field.type === 'number') {
      const n = Number(text);
      if (Number.isFinite(n)) values[field.name] = n;
      else errors[field.name] = 'Enter a Number';
    } else if (field.type === 'enum') {
      if (field.enum!.includes(text)) values[field.name] = text;
      else errors[field.name] = 'Pick One';
    } else if (field.type === 'date') {
      if (Number.isNaN(Date.parse(text))) errors[field.name] = 'Enter a Date';
      else values[field.name] = text;
    } else {
      values[field.name] = text;
    }
  }
  return { values, errors };
}
