import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  chipLabel, foodsCard, goalRing, kindRows, localDate, todaySummary,
  type KitSchema, type KitStore, type KitdemoSession, type Row,
} from '../../../engine/src';
import { getStoredThemeMode, setThemeMode, type ThemeMode } from '../theme';
import EntityForm from './EntityForm';
import { IconBack, IconChevron, IconMore, IconPlus } from './icons';
import './kitdemo.css';

type Screen = 'home' | 'foods' | 'goal';
type Sheet = { entity: 'meal' | 'food' | 'goal'; row?: Row } | null;

const title = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const kcal = (n: number) => `${n.toLocaleString('en-US')} kcal`;
const num = (n: number) => n.toLocaleString('en-US');

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

/** Progress ring geometry: the bar is a circle of radius 42 in a 96x96 viewBox. */
const RING_R = 42;
const RING_C = 2 * Math.PI * RING_R;

const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

interface Props {
  store: KitStore;
  session: KitdemoSession | null;
  schema: KitSchema;
}

export default function Shell({ store, session, schema }: Props) {
  const [ready, setReady] = useState<'loading' | 'ok' | string>('loading');
  const [screen, setScreen] = useState<Screen>('home');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredThemeMode());
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

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const entity = (name: string) => schema.entities.find((e) => e.name === name)!;
  const close = () => setSheet(null);
  const go = (next: Screen) => { setMenuOpen(false); setScreen(next); };
  const openSheet = (next: Sheet) => { setMenuOpen(false); setSheet(next); };

  const loaded = ready === 'ok';
  const foods = loaded ? (store.list('food') as unknown as { id: string; name: string; kcal: number }[]) : [];
  const meals = loaded ? (store.list('meal') as unknown as { id: string; food: string; kind: string; eatenAt: string }[]) : [];
  const goals = loaded ? (store.list('goal') as unknown as { id: string; kcal: number; active: boolean; createdAt?: string }[]) : [];
  const today = todaySummary({ meals, foods, goals }, localDate(new Date()));
  const ring = goalRing(today.eaten, today.goal);
  const foodsLine = foodsCard(foods);
  const mealRows = kindRows(today);
  const foodChoices = [...foods].sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ id: f.id, label: `${f.name} (${kcal(f.kcal)})` }));
  const goalRow = [...goals].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).pop();

  const rows = {
    meal: Object.fromEntries(meals.map((m) => [m.id, m])),
    food: Object.fromEntries(foods.map((f) => [f.id, f])),
  };

  const goalLine = !ring.hasGoal
    ? `${num(today.eaten)} kcal Eaten`
    : ring.left > 0
      ? `${num(ring.left)} kcal Left`
      : ring.over > 0
        ? `${num(ring.over)} kcal Over`
        : 'Goal Met';
  const goalStatus = ring.hasGoal ? 'Goal Active' : 'No Goal';

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
        {screen !== 'home' && (
          <button type="button" className="kd-iconbtn" aria-label="Back" onClick={() => go('home')}>
            <IconBack />
          </button>
        )}
        <h1>{screen === 'home' ? 'Kitdemo' : title(screen)}</h1>
        <span className="kd-chip"><i />{chipLabel(session)}</span>
        <button
          type="button"
          className="kd-iconbtn"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <IconMore />
        </button>
      </header>

      {menuOpen && (
        <>
          <button type="button" className="kd-menu-scrim" aria-label="Close Menu" tabIndex={-1} onClick={() => setMenuOpen(false)} />
          <div className="kd-menu" role="menu" aria-label="Options">
            <p className="kd-menu-label">Theme</p>
            {THEME_MODES.map((mode) => (
              <button
                type="button"
                key={mode}
                role="menuitemradio"
                aria-checked={theme === mode}
                className={theme === mode ? 'on' : ''}
                onClick={() => { setThemeMode(mode); setTheme(mode); setMenuOpen(false); }}
              >
                {title(mode)}
              </button>
            ))}
          </div>
        </>
      )}

      <main className="kd-body">
        {ready === 'loading' && <p className="kd-empty" role="status">Loading</p>}
        {ready !== 'loading' && !loaded && (
          <div className="kd-card" role="alert">
            <h3>Could Not Open Your Data</h3>
            <p className="kd-empty">{ready}</p>
            <button type="button" className="kd-btn" onClick={() => { setReady('loading'); setAttempt((n) => n + 1); }}>Try Again</button>
          </div>
        )}

        {loaded && screen === 'home' && (
          <>
            <section className="kd-card">
              <button
                type="button"
                className="kd-goalcard"
                aria-label={`Daily Goal: ${goalLine}, ${goalStatus}`}
                onClick={() => go('goal')}
              >
                <div className="kd-ring" aria-hidden="true">
                  <svg viewBox="0 0 96 96">
                    <circle className="kd-ring-track" cx="48" cy="48" r={RING_R} />
                    <circle
                      className="kd-ring-bar"
                      cx="48" cy="48"
                      r={RING_R}
                      strokeDasharray={`${RING_C * ring.pct} ${RING_C}`}
                      transform="rotate(-90 48 48)"
                    />
                  </svg>
                  <b><span>{num(today.eaten)}<small>{ring.hasGoal ? `of ${num(today.goal!.kcal)}` : 'eaten'}</small></span></b>
                </div>
                <div className="kd-goaltxt">
                  <span className="kd-label">Daily Goal</span>
                  <div className="kd-big">{goalLine}</div>
                  <div className="kd-s">{goalStatus}</div>
                </div>
              </button>
            </section>

            <section className="kd-card" aria-label="Today's Meals">
              <h3>Today's Meals</h3>
              {mealRows.map(({ kind, meals: kindMeals, empty }) => (
                <div className="kd-kindgroup" key={kind}>
                  {empty ? (
                    <div className="kd-row">
                      <span className="kd-kind">{title(kind)}</span>
                      <div className="kd-main kd-empty">Nothing Yet</div>
                    </div>
                  ) : (
                    kindMeals.map((m, i) => (
                      <button type="button" className="kd-row" key={m.id} onClick={() => openSheet({ entity: 'meal', row: rows.meal[m.id] as unknown as Row })}>
                        <span className="kd-kind">{i === 0 ? title(kind) : ''}</span>
                        <div className="kd-main"><div className="kd-t">{m.food ? m.food.name : 'Deleted Food'}</div></div>
                        {m.food && <span className="kd-kcal">{kcal(m.food.kcal)}</span>}
                      </button>
                    ))
                  )}
                </div>
              ))}
              <button type="button" className="kd-btn kd-block" onClick={() => openSheet({ entity: 'meal' })}><IconPlus />Log Meal</button>
            </section>

            <section className="kd-card" aria-label="Foods">
              <h3>Foods</h3>
              <button type="button" className="kd-row" aria-label={`Foods: ${foodsLine.heading}`} onClick={() => go('foods')}>
                <div className="kd-main">
                  <div className="kd-t">{foodsLine.heading}</div>
                  {!foodsLine.empty && <div className="kd-s">{foodsLine.names}</div>}
                </div>
                <IconChevron />
              </button>
            </section>
          </>
        )}

        {loaded && screen === 'foods' && (
          <section className="kd-card" aria-label="Foods">
            <div className="kd-cardhead">
              <h3>Foods</h3>
              <button type="button" className="kd-btn small" onClick={() => openSheet({ entity: 'food' })}>Add Food</button>
            </div>
            {foods.length === 0 && <p className="kd-empty">No Foods Yet</p>}
            {[...foods].sort((a, b) => a.name.localeCompare(b.name)).map((f) => (
              <button type="button" className="kd-row" key={f.id} onClick={() => openSheet({ entity: 'food', row: rows.food[f.id] as unknown as Row })}>
                <div className="kd-main"><div className="kd-t">{f.name}</div></div>
                <span className="kd-kcal">{kcal(f.kcal)}</span>
                <IconChevron />
              </button>
            ))}
          </section>
        )}

        {loaded && screen === 'goal' && (
          <section className="kd-card" aria-label="Goal">
            <h3>Goal</h3>
            {goalRow ? (
              <button type="button" className="kd-row" onClick={() => openSheet({ entity: 'goal', row: goalRow as unknown as Row })}>
                <div className="kd-main"><div className="kd-t">{kcal(goalRow.kcal)}</div><div className="kd-s">{goalRow.active ? 'Active' : 'Paused'}</div></div>
                <IconChevron />
              </button>
            ) : (
              <>
                <p className="kd-empty">No Goal Yet</p>
                <button type="button" className="kd-btn" onClick={() => openSheet({ entity: 'goal' })}>Set Goal</button>
              </>
            )}
          </section>
        )}
      </main>

      {renderSheet()}
    </div>
  );
}
