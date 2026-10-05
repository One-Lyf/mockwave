import { useEffect, useState, useSyncExternalStore } from 'react';
import { chipLabel, KINDS, localDate, todaySummary, type KitSchema, type KitStore, type KitdemoSession, type Row } from '../../../engine/src';
import EntityForm from './EntityForm';
import { IconChevron, IconFood, IconGoal, IconMeal, IconPlus } from './icons';
import './kitdemo.css';

type Tab = 'meals' | 'foods' | 'goal';
type Sheet = { entity: 'meal' | 'food' | 'goal'; row?: Row } | null;

const title = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const kcal = (n: number) => `${n.toLocaleString('en-US')} kcal`;

/** Local date and time as a datetime-local value, minutes precision. */
function nowLocal() {
  const d = new Date();
  return `${localDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function useStoreVersion(store: KitStore) {
  const [state] = useState(() => ({ v: 0 }));
  return useSyncExternalStore(
    (cb) => store.subscribe(() => { state.v += 1; cb(); }),
    () => state.v,
  );
}

interface Props {
  store: KitStore;
  session: KitdemoSession | null;
  schema: KitSchema;
}

export default function Shell({ store, session, schema }: Props) {
  const [ready, setReady] = useState<'loading' | 'ok' | string>('loading');
  const [tab, setTab] = useState<Tab>('meals');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [attempt, setAttempt] = useState(0);
  useStoreVersion(store);

  useEffect(() => {
    let live = true;
    store.load().then(
      () => live && setReady('ok'),
      (e: unknown) => live && setReady(e instanceof Error ? e.message : 'Could Not Open The Store'),
    );
    return () => { live = false; };
  }, [store, attempt]);

  const entity = (name: string) => schema.entities.find((e) => e.name === name)!;
  const close = () => setSheet(null);

  const loaded = ready === 'ok';
  const foods = loaded ? (store.list('food') as unknown as { id: string; name: string; kcal: number }[]) : [];
  const meals = loaded ? (store.list('meal') as unknown as { id: string; food: string; kind: string; eatenAt: string }[]) : [];
  const goals = loaded ? (store.list('goal') as unknown as { id: string; kcal: number; active: boolean; createdAt?: string }[]) : [];
  const today = todaySummary({ meals, foods, goals }, localDate(new Date()));
  const foodChoices = [...foods].sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ id: f.id, label: `${f.name} (${kcal(f.kcal)})` }));
  const goalRow = [...goals].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).pop();

  const rows = {
    meal: Object.fromEntries(meals.map((m) => [m.id, m])),
    food: Object.fromEntries(foods.map((f) => [f.id, f])),
  };

  function renderSheet() {
    if (!sheet) return null;
    const { entity: name, row } = sheet;
    const editing = !!row;
    const heading = { meal: editing ? 'Edit Meal' : 'Log Meal', food: editing ? 'Edit Food' : 'Add Food', goal: editing ? 'Edit Goal' : 'Set Goal' }[name];
    const saveLabel = { meal: 'Save Meal', food: 'Save Food', goal: 'Save Goal' }[name];
    return (
      <EntityForm
        key={`${name}:${row?.id ?? 'new'}`}
        entity={entity(name)}
        heading={heading}
        saveLabel={saveLabel}
        row={row}
        defaults={name === 'meal' ? { eatenAt: nowLocal() } : name === 'goal' ? { active: true } : undefined}
        choices={{ food: foodChoices }}
        onCancel={close}
        onSave={async (values) => {
          if (row) await store.update(name, row.id, values);
          else await store.create(name, values);
          close();
        }}
        onDelete={row ? async () => { await store.delete(name, row.id); close(); } : undefined}
      />
    );
  }

  return (
    <div className="kd">
      <header className="kd-top">
        <h1>Kitdemo</h1>
        <span className="kd-chip"><i />{chipLabel(session)}</span>
      </header>

      <main className="kd-body">
        {ready === 'loading' && <p className="kd-empty" role="status">Loading</p>}
        {ready !== 'loading' && !loaded && (
          <div className="kd-card" role="alert">
            <h3>Could Not Open Your Data</h3>
            <p className="kd-empty">{ready}</p>
            <button type="button" className="kd-btn" onClick={() => { setReady('loading'); setAttempt((n) => n + 1); }}>Try Again</button>
          </div>
        )}

        {loaded && tab === 'meals' && (
          <>
            <section className="kd-card" aria-label="Today">
              <h3>Today</h3>
              {KINDS.map((kind) => (
                <div className="kd-kindgroup" key={kind}>
                  {today.byKind[kind].length === 0 ? (
                    <div className="kd-row">
                      <span className="kd-kind">{title(kind)}</span>
                      <div className="kd-main kd-empty">Nothing Yet</div>
                    </div>
                  ) : (
                    today.byKind[kind].map((m, i) => (
                      <button type="button" className="kd-row" key={m.id} onClick={() => setSheet({ entity: 'meal', row: rows.meal[m.id] as unknown as Row })}>
                        <span className="kd-kind">{i === 0 ? title(kind) : ''}</span>
                        <div className="kd-main"><div className="kd-t">{m.food ? m.food.name : 'Deleted Food'}</div></div>
                        {m.food && <span className="kd-kcal">{kcal(m.food.kcal)}</span>}
                      </button>
                    ))
                  )}
                </div>
              ))}
            </section>
            <section className="kd-card" aria-label="Goal">
              <h3>Goal</h3>
              {today.goal ? (
                <div className="kd-row static">
                  <div className="kd-main"><div className="kd-t">{kcal(today.goal.kcal)}</div><div className="kd-s">Active</div></div>
                  <span className="kd-kcal">{today.eaten.toLocaleString('en-US')} eaten</span>
                </div>
              ) : (
                <div className="kd-row static">
                  <div className="kd-main kd-empty">No Active Goal</div>
                  <span className="kd-kcal">{today.eaten.toLocaleString('en-US')} eaten</span>
                </div>
              )}
            </section>
          </>
        )}

        {loaded && tab === 'foods' && (
          <section className="kd-card" aria-label="Foods">
            <div className="kd-cardhead">
              <h3>Foods</h3>
              <button type="button" className="kd-btn small" onClick={() => setSheet({ entity: 'food' })}>Add Food</button>
            </div>
            {foods.length === 0 && <p className="kd-empty">No Foods Yet</p>}
            {[...foods].sort((a, b) => a.name.localeCompare(b.name)).map((f) => (
              <button type="button" className="kd-row" key={f.id} onClick={() => setSheet({ entity: 'food', row: rows.food[f.id] as unknown as Row })}>
                <div className="kd-main"><div className="kd-t">{f.name}</div></div>
                <span className="kd-kcal">{kcal(f.kcal)}</span>
                <IconChevron />
              </button>
            ))}
          </section>
        )}

        {loaded && tab === 'goal' && (
          <section className="kd-card" aria-label="Goal">
            <h3>Goal</h3>
            {goalRow ? (
              <button type="button" className="kd-row" onClick={() => setSheet({ entity: 'goal', row: goalRow as unknown as Row })}>
                <div className="kd-main"><div className="kd-t">{kcal(goalRow.kcal)}</div><div className="kd-s">{goalRow.active ? 'Active' : 'Paused'}</div></div>
                <IconChevron />
              </button>
            ) : (
              <>
                <p className="kd-empty">No Goal Yet</p>
                <button type="button" className="kd-btn" onClick={() => setSheet({ entity: 'goal' })}>Set Goal</button>
              </>
            )}
          </section>
        )}
      </main>

      {loaded && (
        <button type="button" className="kd-fab" aria-label="Log Meal" onClick={() => setSheet({ entity: 'meal' })}><IconPlus /></button>
      )}

      <nav className="kd-tabs" aria-label="Sections">
        {([['meals', 'Meals', <IconMeal />], ['foods', 'Foods', <IconFood />], ['goal', 'Goal', <IconGoal />]] as const).map(([id, name, icon]) => (
          <button type="button" key={id} className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            {icon}{name}
          </button>
        ))}
      </nav>

      {renderSheet()}
    </div>
  );
}
