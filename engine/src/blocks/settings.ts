/**
 * Settings (SPEC-presets-and-kit 4.2): `{fields[], defaults, scope}`.
 * One record. `defaults` fills anything not stored yet. `household` needs sign-in, the same rule
 * as an Entity. `device` and `user` do not: with no sign-in the record lives on the device.
 * This block does not write the store. It checks the record and returns a merged copy.
 * For `user` and `household`, the record lives in a KitStore entity: `settingsEntity` gives that
 * entity, and a row read back from the store (with `id` and the other store columns) reads as-is.
 * `device` has no store entity (a store scope can sync); keep that record on the device.
 */

import { checkValue, type EntityDef, type FieldDef } from '../store/schema';
import { checkFieldList, isSystemField } from './fields';

export type SettingsScope = 'user' | 'household' | 'device';

export interface SettingsBlock {
  fields: FieldDef[];
  defaults: Record<string, unknown>;
  scope: SettingsScope;
}

export interface SettingsOptions {
  /** True when the app has a SignIn block with a provider other than none. */
  signedIn?: boolean;
}

const SCOPES: SettingsScope[] = ['user', 'household', 'device'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Problems with the block itself (not a stored record). An empty list means usable. */
export function checkSettings(block: SettingsBlock, opts: SettingsOptions = {}): string[] {
  const errors: string[] = [];
  if (!SCOPES.includes(block?.scope)) errors.push('scope must be "user", "household" or "device"');
  else if (block.scope === 'household' && !opts.signedIn) errors.push('household scope needs sign-in');

  const fields = checkFieldList(block?.fields);
  errors.push(...fields.errors);

  if (!isRecord(block?.defaults)) {
    errors.push('defaults must be an object');
    return errors;
  }
  for (const key of Object.keys(block.defaults)) {
    if (!fields.names.has(key)) errors.push(`defaults: "${key}" is not a declared field`);
  }
  for (const f of fields.usable.values()) {
    if (!Object.prototype.hasOwnProperty.call(block.defaults, f.name)) {
      if (!f.optional) errors.push(`defaults: missing required field "${f.name}"`);
      continue;
    }
    const v = block.defaults[f.name];
    if (v === null && f.optional) continue;
    const err = checkValue(f, v);
    if (err) errors.push(`defaults "${f.name}": ${err}`);
  }
  return errors;
}

/**
 * Problems with a stored record against a block. `null` and `undefined` mean nothing is stored
 * yet, which is not a problem. Call this on a block that already checks clean.
 */
export function checkStoredSettings(block: SettingsBlock, stored: unknown): string[] {
  if (stored == null) return [];
  if (!isRecord(stored)) return ['stored settings must be an object'];
  const fields = checkFieldList(block?.fields);
  const errors: string[] = [];
  for (const key of Object.keys(stored)) {
    if (isSystemField(key) && !fields.names.has(key)) continue;
    if (!fields.names.has(key)) {
      errors.push(`stored: "${key}" is not a declared field`);
      continue;
    }
    const f = fields.usable.get(key);
    if (!f) continue;
    const v = stored[key];
    // Null on a required field means nothing is stored there (the store entity makes every field
    // optional), so the default applies. Null on an optional field is a stored clear.
    if (v === undefined || v === null) continue;
    const err = checkValue(f, v);
    if (err) errors.push(`stored "${key}": ${err}`);
  }
  return errors;
}

/**
 * Defaults overlaid with stored values. A copy: changing it does not change `defaults` or `stored`.
 * Null when the block or the stored record fails its check. A missing stored record returns the defaults.
 */
export function readSettings(
  block: SettingsBlock,
  stored?: Record<string, unknown> | null,
  opts: SettingsOptions = {},
): Record<string, unknown> | null {
  if (checkSettings(block, opts).length || checkStoredSettings(block, stored).length) return null;
  const { usable } = checkFieldList(block.fields);
  const src = isRecord(stored) ? stored : null;
  const out: Record<string, unknown> = {};
  for (const f of usable.values()) {
    const v = src && Object.prototype.hasOwnProperty.call(src, f.name) ? src[f.name] : undefined;
    const hasStored = v !== undefined && (v !== null || !!f.optional);
    if (hasStored) out[f.name] = structuredClone(v);
    else if (Object.prototype.hasOwnProperty.call(block.defaults, f.name)) out[f.name] = structuredClone(block.defaults[f.name]);
  }
  return out;
}

/**
 * The KitStore entity that holds the stored record for a `user` or `household` block. Every field
 * is optional there, because `defaults` fills anything not stored yet. Pass `store.list(name)[0]`
 * to `readSettings`. Null for `device` scope and for a block that fails its check.
 */
export function settingsEntity(name: string, block: SettingsBlock, opts: SettingsOptions = {}): EntityDef | null {
  if (checkSettings(block, opts).length) return null;
  if (block.scope === 'device') return null;
  return { name, scope: block.scope, fields: block.fields.map((f) => ({ ...structuredClone(f), optional: true })) };
}
