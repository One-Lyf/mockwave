/**
 * Per-app stack backend: the kit store when the app has sign-in. Talks to the app's own Supabase
 * stack through PostgREST with plain `fetch`, sending the platform session token so the tables'
 * owner policies (see `schemaToSql`) scope every read and write to the signed-in user.
 */

import type { Row, StoreBackend } from './backend';

export interface StackBackendOptions {
  /** The app stack's public URL, e.g. https://oldtown.tail53f85e.ts.net:8560/kitdemo */
  url: string;
  /** The app stack's publishable key. */
  key: string;
  /** The app's Postgres schema (its slug). */
  schema: string;
  /** Returns the current platform session token, or null when signed out. */
  accessToken: () => Promise<string | null>;
  fetch?: typeof fetch;
  /** Rows per page when reading; keep at or under the stack's max-rows. */
  pageSize?: number;
}

export function stackBackend(opts: StackBackendOptions): StoreBackend {
  const http = opts.fetch ?? globalThis.fetch;
  const base = `${opts.url.replace(/\/$/, '')}/rest/v1`;
  const pageSize = opts.pageSize ?? 1000;

  async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
    const token = await opts.accessToken();
    if (!token) throw new Error('stackBackend: not signed in');
    const res = await http(`${base}/${path}`, {
      method,
      headers: {
        apikey: opts.key,
        Authorization: `Bearer ${token}`,
        [method === 'GET' ? 'Accept-Profile' : 'Content-Profile']: opts.schema,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`stackBackend: ${method} ${path} failed (${res.status}): ${await res.text()}`);
    return res;
  }

  const table = (entity: string) => encodeURIComponent(entity);

  return {
    async open(entities) {
      // Fails early and clearly when the migration has not been applied.
      for (const e of entities) await call('GET', `${table(e)}?select=id&limit=0`, {});
    },
    async all(entity) {
      const rows: Row[] = [];
      for (let from = 0; ; from += pageSize) {
        const res = await call('GET', `${table(entity)}?select=*&order=id`, { Range: `${from}-${from + pageSize - 1}` });
        const page = (await res.json()) as Row[];
        rows.push(...page);
        if (page.length < pageSize) return rows;
      }
    },
    async put(entity, row) {
      await call('POST', table(entity), { Prefer: 'resolution=merge-duplicates,return=minimal' }, row);
    },
    async remove(entity, id) {
      await call('DELETE', `${table(entity)}?id=eq.${encodeURIComponent(id)}`, { Prefer: 'return=minimal' });
    },
  };
}
