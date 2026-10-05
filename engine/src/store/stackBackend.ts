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
  /** Rows asked for per page when reading. A lower max-rows on the stack is fine: reading stops only on an empty page. */
  pageSize?: number;
}

/** True for a key that bypasses row-level security: a new-style secret key or a service_role JWT. */
function isServiceKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { role?: string }).role === 'service_role';
  } catch {
    return false;
  }
}

export function stackBackend(opts: StackBackendOptions): StoreBackend {
  // Clients only ever hold the publishable key; a service-role key would skip owner scoping.
  if (isServiceKey(opts.key)) throw new Error('stackBackend: refusing a service-role key; pass the publishable key');
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
      // Only an empty page ends the read: a stack whose max-rows is below pageSize returns short
      // pages, and stopping on one would silently drop every row past the cap.
      const rows: Row[] = [];
      for (;;) {
        const from = rows.length;
        const res = await call('GET', `${table(entity)}?select=*&order=id`, { Range: `${from}-${from + pageSize - 1}` });
        const page = (await res.json()) as Row[];
        if (!page.length) return rows;
        rows.push(...page);
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
