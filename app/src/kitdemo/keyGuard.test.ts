import { describe, it, expect } from 'vitest';
import { assertKitdemoKeySafe } from './keyGuard';

const b64url = (o: object) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role, iss: 'fake' })}.fakesig`;

describe('assertKitdemoKeySafe', () => {
  it('rejects an sb_secret_ key', () => {
    expect(() => assertKitdemoKeySafe('sb_secret_FAKEFIXTURE')).toThrow(/service key/);
  });
  it('rejects a service_role JWT', () => {
    expect(() => assertKitdemoKeySafe(jwt('service_role'))).toThrow(/service key/);
  });
  it('allows an anon JWT', () => {
    expect(() => assertKitdemoKeySafe(jwt('anon'))).not.toThrow();
  });
  it('allows a publishable key', () => {
    expect(() => assertKitdemoKeySafe('sb_publishable_FAKEFIXTURE')).not.toThrow();
  });
  it('allows empty, whitespace and missing', () => {
    expect(() => assertKitdemoKeySafe('')).not.toThrow();
    expect(() => assertKitdemoKeySafe('   ')).not.toThrow();
    expect(() => assertKitdemoKeySafe(undefined)).not.toThrow();
  });
  it('ignores malformed JWT-shaped values', () => {
    expect(() => assertKitdemoKeySafe('a.!!!.c')).not.toThrow();
  });
  it('rejects a service key wrapped in literal quotes', () => {
    expect(() => assertKitdemoKeySafe(`"${jwt('service_role')}"`)).toThrow(/service key/);
    expect(() => assertKitdemoKeySafe(`'sb_secret_FAKEFIXTURE'`)).toThrow(/service key/);
  });
  it('rejects a whole NAME=value line pasted as the value', () => {
    expect(() =>
      assertKitdemoKeySafe(`VITE_KITDEMO_STACK_KEY=${jwt('service_role')}`),
    ).toThrow(/service key/);
    expect(() =>
      assertKitdemoKeySafe('VITE_KITDEMO_STACK_KEY=sb_secret_FAKEFIXTURE'),
    ).toThrow(/service key/);
  });
  it('rejects a service_role JWT with whitespace inside the payload', () => {
    const [h, p, s] = jwt('service_role').split('.');
    const spaced = `${h}.${p.slice(0, 6)} \n ${p.slice(6)}.${s}`;
    expect(() => assertKitdemoKeySafe(spaced)).toThrow(/service key/);
  });
  it('rejects non-anon roles such as postgres and supabase_admin', () => {
    expect(() => assertKitdemoKeySafe(jwt('postgres'))).toThrow(/service key/);
    expect(() => assertKitdemoKeySafe(jwt('supabase_admin'))).toThrow(/service key/);
  });
  it('still allows an anon JWT wrapped in quotes', () => {
    expect(() => assertKitdemoKeySafe(`"${jwt('anon')}"`)).not.toThrow();
  });
  it('rejects a service_role JWT with a backslash line-continuation in the payload', () => {
    const [h, p, s] = jwt('service_role').split('.');
    const broken = `${h}.${p.slice(0, 6)}\\\n${p.slice(6)}.${s}`;
    expect(broken).toContain('\\\n');
    expect(() => assertKitdemoKeySafe(broken)).toThrow(/service key/);
  });
});
