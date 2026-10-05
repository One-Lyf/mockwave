import { describe, expect, it, vi } from 'vitest';
import { stackBackend } from './stackBackend';

function setup(responses: Array<{ status?: number; body?: unknown }> = [], token: string | null = 'tok', key = 'pub') {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? {};
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  const backend = stackBackend({
    url: 'https://stack.test/kitdemo/',
    key,
    schema: 'kitdemo',
    accessToken: async () => token,
    fetch: fetch as unknown as typeof globalThis.fetch,
    pageSize: 2,
  });
  return { backend, calls };
}

const headers = (init: RequestInit) => init.headers as Record<string, string>;

describe('stackBackend', () => {
  const r = (id: string) => ({ id, createdAt: 't', updatedAt: 't' });

  it('reads through PostgREST with the session token and schema, paging until an empty page', async () => {
    const { backend, calls } = setup([{ body: [r('a'), r('b')] }, { body: [r('c')] }, { body: [] }]);
    expect(await backend.all('food')).toEqual([r('a'), r('b'), r('c')]);
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe('https://stack.test/kitdemo/rest/v1/food?select=*&order=id');
    expect(headers(calls[0].init)).toMatchObject({ apikey: 'pub', Authorization: 'Bearer tok', 'Accept-Profile': 'kitdemo', Range: '0-1' });
    expect(headers(calls[1].init).Range).toBe('2-3');
  });

  it('keeps reading when the stack caps pages below pageSize', async () => {
    // max-rows of 1 on the stack: every page is short, but only an empty page ends the read.
    const { backend, calls } = setup([{ body: [r('a')] }, { body: [r('b')] }, { body: [] }]);
    expect(await backend.all('food')).toEqual([r('a'), r('b')]);
    expect(headers(calls[1].init).Range).toBe('1-2');
  });

  it('refuses a service-role key', () => {
    const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
    expect(() => setup([], 'tok', jwt({ role: 'service_role' }))).toThrow('service-role');
    expect(() => setup([], 'tok', 'sb_secret_abc')).toThrow('service-role');
    expect(() => setup([], 'tok', jwt({ role: 'anon' }))).not.toThrow();
    expect(() => setup([], 'tok', 'sb_publishable_abc')).not.toThrow();
  });

  it('upserts on put and deletes by id', async () => {
    const { backend, calls } = setup();
    const row = { id: 'x/1', createdAt: 't', updatedAt: 't', name: 'Oats' };
    await backend.put('food', row);
    await backend.remove('food', 'x/1');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual(row);
    expect(headers(calls[0].init)).toMatchObject({ 'Content-Profile': 'kitdemo', Prefer: 'resolution=merge-duplicates,return=minimal' });
    expect(calls[1].url).toBe('https://stack.test/kitdemo/rest/v1/food?id=eq.x%2F1');
    expect(calls[1].init.method).toBe('DELETE');
  });

  it('checks every table on open and reports server errors', async () => {
    const { backend, calls } = setup([{}, { status: 404, body: { message: 'relation "kitdemo.meal" does not exist' } }]);
    await expect(backend.open(['food', 'meal'])).rejects.toThrow('GET meal?select=id&limit=0 failed (404)');
    expect(calls).toHaveLength(2);
  });

  it('refuses to call the stack when signed out', async () => {
    const { backend, calls } = setup([], null);
    await expect(backend.all('food')).rejects.toThrow('not signed in');
    expect(calls).toHaveLength(0);
  });
});
