import { describe, expect, it, vi } from 'vitest';
import { stackBackend } from './stackBackend';

function setup(responses: Array<{ status?: number; body?: unknown }> = [], token: string | null = 'tok') {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? {};
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  const backend = stackBackend({
    url: 'https://stack.test/kitdemo/',
    key: 'pub',
    schema: 'kitdemo',
    accessToken: async () => token,
    fetch: fetch as unknown as typeof globalThis.fetch,
    pageSize: 2,
  });
  return { backend, calls };
}

const headers = (init: RequestInit) => init.headers as Record<string, string>;

describe('stackBackend', () => {
  it('reads through PostgREST with the session token and schema, paging until a short page', async () => {
    const r = (id: string) => ({ id, createdAt: 't', updatedAt: 't' });
    const { backend, calls } = setup([{ body: [r('a'), r('b')] }, { body: [r('c')] }]);
    expect(await backend.all('food')).toEqual([r('a'), r('b'), r('c')]);
    expect(calls.map((c) => c.url)).toEqual([
      'https://stack.test/kitdemo/rest/v1/food?select=*&order=id',
      'https://stack.test/kitdemo/rest/v1/food?select=*&order=id',
    ]);
    expect(headers(calls[0].init)).toMatchObject({ apikey: 'pub', Authorization: 'Bearer tok', 'Accept-Profile': 'kitdemo', Range: '0-1' });
    expect(headers(calls[1].init).Range).toBe('2-3');
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
