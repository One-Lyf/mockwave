import { describe, expect, it } from 'vitest';
import type { FieldDef } from '../store/schema';
import { checkSettings, checkStoredSettings, readSettings, type SettingsBlock } from './settings';

const fields: FieldDef[] = [
  { name: 'name', type: 'string' },
  { name: 'budget', type: 'number' },
  { name: 'share', type: 'boolean', optional: true },
  { name: 'opened', type: 'date', optional: true },
  { name: 'theme', type: 'enum', enum: ['light', 'dark'], optional: true },
  { name: 'home', type: 'ref', to: 'place', optional: true },
];

const block: SettingsBlock = {
  fields,
  defaults: { name: 'Ada', budget: 20 },
  scope: 'device',
};

describe('checkSettings', () => {
  it('accepts device and user with no sign-in, and household only with sign-in', () => {
    expect(checkSettings(block)).toEqual([]);
    expect(checkSettings({ ...block, scope: 'user' })).toEqual([]);
    expect(checkSettings({ ...block, scope: 'household' })).toEqual(['household scope needs sign-in']);
    expect(checkSettings({ ...block, scope: 'household' }, { signedIn: true })).toEqual([]);
    expect(checkSettings({ ...block, scope: 'session' as 'device' })).toEqual([
      'scope must be "user", "household" or "device"',
    ]);
  });

  it('requires a default for every required field, and the default must fit the field', () => {
    expect(checkSettings({ ...block, defaults: { name: 'Ada' } })).toEqual([
      'defaults: missing required field "budget"',
    ]);
    expect(checkSettings({ ...block, defaults: { name: 'Ada', budget: 20, extra: 1 } })).toEqual([
      'defaults: "extra" is not a declared field',
    ]);
    const bad = checkSettings({
      ...block,
      defaults: { name: 1, budget: null, share: 'yes', theme: 'neon', home: 4, opened: 'nope' },
    });
    expect(bad).toContain('defaults "name": must be a string');
    expect(bad).toContain('defaults "budget": must be a finite number');
    expect(bad).toContain('defaults "share": must be true or false');
    expect(bad).toContain('defaults "theme": must be one of light, dark');
    expect(bad).toContain('defaults "home": must be a string');
    expect(bad).toContain('defaults "opened": must be an ISO date string');
  });

  it('allows an omitted or null optional default, and rejects a non-object defaults', () => {
    expect(checkSettings({ ...block, defaults: { name: 'Ada', budget: 0, share: null } })).toEqual([]);
    expect(checkSettings({ ...block, defaults: [] as unknown as Record<string, unknown> })).toEqual([
      'defaults must be an object',
    ]);
    expect(checkSettings({ ...block, fields: 'nope' as unknown as FieldDef[] }).join('\n')).toMatch(/fields must be a list/);
  });

  it('flags reserved, duplicate and empty-enum fields', () => {
    const errors = checkSettings({
      scope: 'user',
      defaults: {},
      fields: [
        { name: 'ownerId', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'level', type: 'enum', enum: [] },
      ],
    });
    expect(errors).toContain('field "ownerId": reserved name');
    expect(errors).toContain('field "name": duplicate name');
    expect(errors).toContain('field "level": enum needs values');
  });
});

describe('readSettings', () => {
  it('fills from defaults, lets a valid stored value win, and copies both ways', () => {
    const stored = { name: 'Bea', share: true };
    const got = readSettings(block, stored);
    expect(got).toEqual({ name: 'Bea', budget: 20, share: true });
    got!.name = 'Cara';
    expect(stored.name).toBe('Bea');
    expect(block.defaults.name).toBe('Ada');
    expect(readSettings(block, null)).toEqual({ name: 'Ada', budget: 20 });
    expect(readSettings(block)).toEqual({ name: 'Ada', budget: 20 });
  });

  it('returns null for a bad block, a bad stored record, or household with no sign-in', () => {
    expect(readSettings(block, { budget: 'lots' })).toBeNull();
    expect(readSettings(block, { extra: 1 })).toBeNull();
    expect(readSettings(block, [] as unknown as Record<string, unknown>)).toBeNull();
    expect(readSettings({ ...block, scope: 'household' }, { name: 'Bea' })).toBeNull();
    expect(readSettings({ ...block, scope: 'household' }, { name: 'Bea' }, { signedIn: true })).toEqual({
      name: 'Bea',
      budget: 20,
    });
    expect(block.defaults).toEqual({ name: 'Ada', budget: 20 });
  });

  it('names stored problems and treats a missing record as clean', () => {
    expect(checkStoredSettings(block, null)).toEqual([]);
    expect(checkStoredSettings(block, undefined)).toEqual([]);
    expect(checkStoredSettings(block, { theme: 'neon', extra: 1 })).toEqual([
      'stored "theme": must be one of light, dark',
      'stored: "extra" is not a declared field',
    ]);
    expect(checkStoredSettings(block, 'nope')).toEqual(['stored settings must be an object']);
  });
});
