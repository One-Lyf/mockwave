/**
 * The kit store: one schema in, a typed data layer out. It validates every write against the
 * schema, keeps an in-memory snapshot so reads are synchronous (what a binding resolver needs),
 * and generates the data and action surfaces a Tier 0 app binds to (SPEC-presets-and-kit 4.0).
 *
 * Surface naming: entity `meal` gives data path `meal` (an array of live rows) and actions
 * `meal.create`, `meal.update`, `meal.delete`.
 */

import type { Row, StoreBackend } from './backend';
import { SYSTEM_FIELDS, checkValue, validateSchema, type EntityDef, type KitSchema } from './schema';

/** Same shape as fluxwave's `DataField` (packages/app-adapter), kept structural so Mockwave has no Fluxwave dependency. */
export interface SurfaceField {
  path: string;
  label: string;
  kind: 'number' | 'string' | 'boolean' | 'array' | 'object';
  writable?: boolean;
}

/** Same shape as fluxwave's `ActionDef`. */
export interface SurfaceAction {
  name: string;
  label: string;
  description?: string;
}

export interface StoreOptions {
  backend: StoreBackend;
  /** True when the app has sign-in (allows household scope). */
  signedIn?: boolean;
  newId?: () => string;
  now?: () => Date;
}

export interface KitStore {
  /** Opens the backend and loads every entity into the snapshot. Call before anything else. */
  load(): Promise<void>;
  list(entity: string): Row[];
  get(entity: string, id: string): Row | undefined;
  create(entity: string, values: Record<string, unknown>): Promise<Row>;
  update(entity: string, id: string, patch: Record<string, unknown>): Promise<Row>;
  delete(entity: string, id: string): Promise<void>;
  dataSurface(): SurfaceField[];
  actionSurface(): SurfaceAction[];
  /** Resolves a data path: an entity name gives its live rows. */
  getData(path: string): unknown;
  /** Runs a generated action: `<entity>.create` takes values, `.update` takes `{id, ...patch}`, `.delete` takes `{id}`. */
  dispatch(action: string, payload?: unknown): Promise<unknown>;
  subscribe(listener: () => void): () => void;
}

export class StoreError extends Error {}

/** Drops keys whose value is undefined, so a spread never writes them over a row. */
const defined = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/([A-Z])/g, ' $1');

export function createStore(schema: KitSchema, opts: StoreOptions): KitStore {
  const problems = validateSchema(schema, { signedIn: opts.signedIn });
  if (problems.length) throw new StoreError(`invalid schema: ${problems.join('; ')}`);

  const { backend } = opts;
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const now = opts.now ?? (() => new Date());
  const entities = new Map(schema.entities.map((e) => [e.name, e]));
  const snapshot = new Map<string, Map<string, Row>>();
  const listeners = new Set<() => void>();
  let loaded = false;

  const entityOf = (name: string): EntityDef => {
    const e = entities.get(name);
    if (!e) throw new StoreError(`unknown entity "${name}"`);
    if (!loaded) throw new StoreError('store not loaded; call load() first');
    return e;
  };
  const live = (entity: string) => [...snapshot.get(entity)!.values()].filter((r) => !r.deletedAt);
  const notify = () => listeners.forEach((l) => l());

  function check(e: EntityDef, values: Record<string, unknown>, partial: boolean) {
    const errors: string[] = [];
    for (const key of Object.keys(values)) {
      if (!e.fields.some((f) => f.name === key)) errors.push(`"${key}" is not a field of ${e.name}`);
    }
    for (const f of e.fields) {
      const v = values[f.name];
      if (v === undefined) {
        // A patch may leave a field out, but naming a required field as undefined would erase it.
        if ((!partial || f.name in values) && !f.optional) errors.push(`"${f.name}" is required`);
        continue;
      }
      if (v === null && f.optional) continue;
      const err = checkValue(f, v);
      if (err) errors.push(`"${f.name}" ${err}`);
      else if (f.type === 'ref') {
        const target = snapshot.get(f.to!)!.get(v as string);
        if (!target || target.deletedAt) errors.push(`"${f.name}" points to a missing ${f.to}`);
      }
    }
    if (errors.length) throw new StoreError(`${e.name}: ${errors.join('; ')}`);
  }

  async function write(entity: string, row: Row) {
    await backend.put(entity, row);
    snapshot.get(entity)!.set(row.id, row);
    notify();
    return { ...row };
  }

  const store: KitStore = {
    async load() {
      const names = [...entities.keys()];
      await backend.open(names);
      for (const name of names) {
        snapshot.set(name, new Map((await backend.all(name)).map((r) => [r.id, r])));
      }
      loaded = true;
      notify();
    },

    list(entity) {
      entityOf(entity);
      return live(entity).map((r) => ({ ...r }));
    },

    get(entity, id) {
      entityOf(entity);
      const r = snapshot.get(entity)!.get(id);
      return r && !r.deletedAt ? { ...r } : undefined;
    },

    async create(entity, values) {
      const e = entityOf(entity);
      check(e, values, false);
      const at = now().toISOString();
      return write(entity, { ...defined(values), id: newId(), createdAt: at, updatedAt: at });
    },

    async update(entity, id, patch) {
      const e = entityOf(entity);
      const current = snapshot.get(entity)!.get(id);
      if (!current || current.deletedAt) throw new StoreError(`${entity}: no row "${id}"`);
      const system = Object.keys(patch).filter((k) => (SYSTEM_FIELDS as readonly string[]).includes(k));
      if (system.length) throw new StoreError(`${entity}: cannot set ${system.join(', ')}`);
      check(e, patch, true);
      return write(entity, { ...current, ...defined(patch), updatedAt: now().toISOString() });
    },

    async delete(entity, id) {
      const e = entityOf(entity);
      const current = snapshot.get(entity)!.get(id);
      if (!current || current.deletedAt) throw new StoreError(`${entity}: no row "${id}"`);
      if (e.softDelete) {
        const at = now().toISOString();
        await write(entity, { ...current, deletedAt: at, updatedAt: at });
        return;
      }
      await backend.remove(entity, id);
      snapshot.get(entity)!.delete(id);
      notify();
    },

    dataSurface() {
      return schema.entities.map((e) => ({ path: e.name, label: label(e.name), kind: 'array' as const }));
    },

    actionSurface() {
      return schema.entities.flatMap((e) => [
        { name: `${e.name}.create`, label: `Add ${label(e.name)}` },
        { name: `${e.name}.update`, label: `Edit ${label(e.name)}` },
        { name: `${e.name}.delete`, label: `Delete ${label(e.name)}` },
      ]);
    },

    getData(path) {
      if (!entities.has(path) || !loaded) return undefined;
      return live(path);
    },

    async dispatch(action, payload) {
      const dot = action.lastIndexOf('.');
      if (dot < 0) throw new StoreError(`unknown action "${action}"`);
      const entity = action.slice(0, dot);
      const verb = action.slice(dot + 1);
      const p = (payload ?? {}) as Record<string, unknown>;
      const { id, ...rest } = p;
      switch (verb) {
        case 'create':
          return store.create(entity, p);
        case 'update':
          return store.update(entity, String(id), rest);
        case 'delete':
          return store.delete(entity, String(id));
        default:
          throw new StoreError(`unknown action "${action}"`);
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}
