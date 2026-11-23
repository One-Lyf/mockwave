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
});
