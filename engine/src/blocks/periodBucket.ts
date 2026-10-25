/**
 * PeriodBucket (SPEC-presets-and-kit 4.2): `{period:'day'|'month', itemSchema}`.
 * Items are grouped by the calendar date written on their one date field. A time or a zone
 * on that string does not move the bucket: `2024-01-15T23:00:00.000Z` stays in 2024-01-15.
 * This block does not store rows. It checks them and returns a copy grouped by period.
 * The rows live in a KitStore entity: `periodBucketEntity` gives that entity, and rows read back
 * from the store (with `id`, `createdAt` and the other store columns) check and group as-is.
 */

import { checkValue, type EntityDef, type FieldDef } from '../store/schema';
import { checkFieldList, isSystemField } from './fields';

export type Period = 'day' | 'month';

export interface PeriodBucket {
  period: Period;
  itemSchema: FieldDef[];
}

export type PeriodItem = Record<string, unknown>;

export interface PeriodGroup {
  period: string;
  items: PeriodItem[];
}

/** The bucket key for a date string, or null when it is not a real YYYY-MM-DD calendar date. */
export function periodKey(period: Period, value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  const ym = `${m[1]}-${m[2]}`;
  return period === 'month' ? ym : `${ym}-${m[3]}`;
}

function dateField(usable: Map<string, FieldDef>): FieldDef | undefined {
  const dates = [...usable.values()].filter((f) => f.type === 'date');
  if (dates.length !== 1 || dates[0].optional) return undefined;
  return dates[0];
}

/** Problems with the bucket and, when `items` is passed, each item. An empty list means usable. */
export function checkPeriodBucket(bucket: PeriodBucket, items?: PeriodItem[]): string[] {
  const errors: string[] = [];
  const period = bucket?.period === 'day' || bucket?.period === 'month' ? bucket.period : undefined;
  if (!period) errors.push('period must be "day" or "month"');
  const fields = checkFieldList(bucket?.itemSchema);
  errors.push(...fields.errors);
  const dated = dateField(fields.usable);
  if (!dated) errors.push('period bucket needs one required date field');

  if (items === undefined) return errors;
  if (!Array.isArray(items)) return [...errors, 'items must be a list'];
  const schema = Array.isArray(bucket?.itemSchema) ? bucket.itemSchema : [];

  items.forEach((item, i) => {
    const at = `item ${i}`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!fields.names.has(key) && !isSystemField(key)) errors.push(`${at}: "${key}" is not a declared field`);
    }
    for (const f of schema) {
      if (!f || typeof f !== 'object') continue;
      const v = item[f.name];
      if (v === undefined) {
        if (!f.optional) errors.push(`${at}: missing required field "${f.name}"`);
        continue;
      }
      const def = fields.usable.get(f.name);
      if (!def) continue;
      if (v === null && def.optional) continue;
      if (dated && f.name === dated.name && period) {
        if (typeof v !== 'string' || !periodKey(period, v)) {
          errors.push(`${at} field "${f.name}": ${typeof v === 'string' ? 'must be a YYYY-MM-DD date' : 'must be an ISO date string'}`);
        }
        continue;
      }
      const err = checkValue(def, v);
      if (err) errors.push(`${at} field "${f.name}": ${err}`);
    }
  });
  return errors;
}

/**
 * A copy of the items grouped by period, keys sorted ascending, items in input order.
 * Null when the bucket or any item fails the check. Changing the copy does not change `items`.
 */
export function groupPeriodBucket(bucket: PeriodBucket, items: PeriodItem[]): PeriodGroup[] | null {
  if (checkPeriodBucket(bucket, items).length) return null;
  const dated = dateField(checkFieldList(bucket.itemSchema).usable)!;
  const groups = new Map<string, PeriodItem[]>();
  for (const item of items) {
    const key = periodKey(bucket.period, item[dated.name] as string)!;
    const copy = structuredClone(item);
    const list = groups.get(key);
    if (list) list.push(copy);
    else groups.set(key, [copy]);
  }
  return [...groups.keys()].sort().map((period) => ({ period, items: groups.get(period)! }));
}

/**
 * The KitStore entity that holds this bucket's items: the item schema as its fields. Add it to the
 * app's `KitSchema.entities`, then pass `store.list(name)` to `groupPeriodBucket`.
 * Null when the bucket fails its check. `household` needs sign-in, which `createStore` enforces.
 */
export function periodBucketEntity(
  name: string,
  bucket: PeriodBucket,
  scope: EntityDef['scope'] = 'user',
): EntityDef | null {
  if (checkPeriodBucket(bucket).length) return null;
  return { name, scope, fields: structuredClone(bucket.itemSchema) };
}
