/** Logic behind the kitdemo shell: store wiring, the chip, and the Meals tab summary. */

import type { StoreBackend } from '../store/backend';
import type { KitSchema } from '../store/schema';
import { createStore, type KitStore } from '../store/store';

export interface KitdemoSession {
  /** Shown in the chip. */
  name: string;
  accessToken: () => Promise<string | null>;
}

export interface KitdemoBackends {
  /** Used with no sign-in: rows stay on this device. */
  device: () => StoreBackend;
  /** Used when signed in: the app stack scopes rows to the owner. */
  stack: (session: KitdemoSession) => StoreBackend;
}

export function createKitdemoStore(session: KitdemoSession | null, backends: KitdemoBackends, schema: KitSchema): KitStore {
  return createStore(schema, {
    backend: session ? backends.stack(session) : backends.device(),
    signedIn: session !== null,
  });
}

export const chipLabel = (session: KitdemoSession | null) =>
  session ? session.name.trim() || 'Signed In' : 'On This Device';

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar day as YYYY-MM-DD. */
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local day of a stored date: a value with no zone is already local; one with a zone is converted. */
function dayOf(value: string): string {
  return /(Z|[+-]\d{2}:?\d{2})$/.test(value) && value.length > 10 ? localDate(new Date(value)) : value.slice(0, 10);
}

export const KINDS = ['breakfast', 'lunch', 'dinner'] as const;
export type Kind = (typeof KINDS)[number];

interface FoodRow { id: string; name: string; kcal: number }
interface MealRow { id: string; food: string; kind: string; eatenAt: string }
interface GoalRow { id: string; kcal: number; active: boolean; createdAt?: string }

export interface TodayMeal {
  id: string;
  /** Undefined when the food was deleted. */
  food?: FoodRow;
}

export interface TodaySummary {
  byKind: Record<Kind, TodayMeal[]>;
  eaten: number;
  goal: { kcal: number } | null;
}

export function todaySummary(rows: { meals: MealRow[]; foods: FoodRow[]; goals: GoalRow[] }, today: string): TodaySummary {
  const foods = new Map(rows.foods.map((f) => [f.id, f]));
  const byKind: Record<Kind, TodayMeal[]> = { breakfast: [], lunch: [], dinner: [] };
  let eaten = 0;
  const todays = rows.meals
    .filter((m) => dayOf(m.eatenAt) === today && (KINDS as readonly string[]).includes(m.kind))
    .sort((a, b) => a.eatenAt.localeCompare(b.eatenAt));
  for (const m of todays) {
    const food = foods.get(m.food);
    byKind[m.kind as Kind].push({ id: m.id, food });
    if (food) eaten += food.kcal;
  }
  const active = rows.goals.filter((g) => g.active).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const goal = active.length ? { kcal: active[active.length - 1].kcal } : null;
  return { byKind, eaten, goal };
}
