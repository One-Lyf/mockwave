import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import kitdemo from '../../../stacks/kitdemo/schema.json';
import type { KitSchema } from './schema';
import { schemaToSql } from './sql';

const schema = kitdemo as KitSchema;
const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), '../../../stacks/kitdemo/migrations/0001_kitdemo_init.sql');

describe('schemaToSql', () => {
  it('matches the committed kitdemo migration (run `npm run gen:sql` to refresh)', () => {
    const sql = schemaToSql('kitdemo', schema);
    if (process.env.UPDATE_SQL) writeFileSync(MIGRATION, sql);
    expect(readFileSync(MIGRATION, 'utf8')).toBe(sql);
  });

  it('refuses bad slugs, invalid schemas and household scope', () => {
    expect(() => schemaToSql('Kit-Demo', schema)).toThrow('app slug');
    expect(() => schemaToSql('x', { entities: [{ name: 'a', scope: 'user', fields: [{ name: 'ownerId', type: 'string' }] }] })).toThrow(
      'reserved name',
    );
    expect(() => schemaToSql('x', { entities: [{ name: 'chore', scope: 'household', fields: [] }] })).toThrow('household');
  });

  it('escapes quotes in enum values', () => {
    const sql = schemaToSql('x', { entities: [{ name: 'a', scope: 'user', fields: [{ name: 'k', type: 'enum', enum: ["it's"] }] }] });
    expect(sql).toContain(`'it''s'`);
  });
});

// Owner scoping, tested with two users against a real Postgres. The stack's `auth.uid()` reads the
// JWT claims PostgREST sets per request; here the same setting is set by hand. Skipped without Postgres.
const pgBin = ['/usr/lib/postgresql'].filter(existsSync).flatMap((d) => readdirSync(d).map((v) => join(d, v, 'bin')))[0];
const asRoot = process.getuid?.() === 0;

describe.skipIf(!pgBin)('owner scoping on the kitdemo migration (two users)', () => {
  let dir = '';
  const port = String(55000 + Math.floor(Math.random() * 1000));
  const run = (bin: string, args: string[]) =>
    execFileSync(asRoot ? 'runuser' : join(pgBin!, bin), asRoot ? ['-u', 'postgres', '--', join(pgBin!, bin), ...args] : args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const psql = (sql: string) => run('psql', ['-h', dir, '-p', port, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql]).trim();

  const A = '00000000-0000-0000-0000-00000000000a';
  const B = '00000000-0000-0000-0000-00000000000b';
  const as = (sub: string, sql: string) =>
    psql(
      `begin; set local role authenticated; set local "request.jwt.claims" = '{"sub":"${sub}","role":"authenticated"}'; ${sql}; commit;`,
    );
  const fails = (sub: string, sql: string) => {
    try {
      as(sub, sql);
    } catch (e) {
      return String((e as { stderr?: string }).stderr ?? e);
    }
    throw new Error(`expected failure: ${sql}`);
  };
  const now = `'2026-10-05T12:00:00Z'`;
  const food = (id: string, name: string, extra = '') =>
    `insert into kitdemo.food (id, "createdAt", "updatedAt", name, kcal${extra ? ', "ownerId"' : ''}) values ('${id}', ${now}, ${now}, '${name}', 100${extra ? `, '${extra}'` : ''})`;
  const fA = '10000000-0000-0000-0000-00000000000a';
  const fB = '10000000-0000-0000-0000-00000000000b';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kitpg-'));
    if (asRoot) execFileSync('chown', ['postgres', dir]);
    run('initdb', ['-D', join(dir, 'data'), '-U', 'postgres', '-A', 'trust']);
    run('pg_ctl', ['-D', join(dir, 'data'), '-l', join(dir, 'log'), '-o', `-k ${dir} -p ${port} -c listen_addresses=''`, '-w', 'start']);
    // What the W2 app stack provides: the API roles and GoTrue's claim-reading auth.uid().
    psql(`create role anon nologin; create role authenticated nologin; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
          (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;`);
    psql(readFileSync(MIGRATION, 'utf8'));
    as(A, food(fA, 'Oats'));
    as(B, food(fB, 'Rice'));
  }, 60_000);

  afterAll(() => {
    if (!dir) return;
    try {
      run('pg_ctl', ['-D', join(dir, 'data'), '-m', 'immediate', 'stop']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stamps the owner and shows each user only their own rows', () => {
    expect(as(A, `select name, "ownerId" from kitdemo.food`)).toBe(`Oats|${A}`);
    expect(as(B, `select name from kitdemo.food`)).toBe('Rice');
  });

  it("does not let one user change or delete another's rows", () => {
    expect(as(B, `update kitdemo.food set kcal = 1 where id = '${fA}' returning id`)).toBe('');
    expect(as(B, `delete from kitdemo.food where id = '${fA}' returning id`)).toBe('');
    expect(as(A, `select kcal from kitdemo.food`)).toBe('100');
  });

  it('refuses rows written for another owner, including through upsert', () => {
    expect(fails(B, food('10000000-0000-0000-0000-0000000000bb', 'Fake', A))).toMatch(/row-level security/);
    expect(fails(B, `${food(fA, 'Stolen')} on conflict (id) do update set name = excluded.name`)).toMatch(/row-level security/);
  });

  it("refuses a ref to another user's row", () => {
    const meal = (sub: string, f: string) =>
      as(sub, `insert into kitdemo.meal (id, "createdAt", "updatedAt", food, kind, "eatenAt") values (gen_random_uuid(), ${now}, ${now}, '${f}', 'lunch', ${now})`);
    meal(A, fA);
    expect(() => meal(B, fA)).toThrow(/foreign key/);
  });

  it('enforces enum values and gives anon no access', () => {
    expect(
      fails(A, `insert into kitdemo.meal (id, "createdAt", "updatedAt", food, kind, "eatenAt") values (gen_random_uuid(), ${now}, ${now}, '${fA}', 'brunch', ${now})`),
    ).toMatch(/check constraint/);
    expect(() => psql(`set role anon; select * from kitdemo.food`)).toThrow(/permission denied/);
  });
});
