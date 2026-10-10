// @vitest-environment jsdom
// Shell render tests against the real jsdom window/history: header Back must pop the entry go()
// pushed (no dead history entries), popstate must map an entry's kdScreen back to its screen, and
// the Goal screen must show the same goal Home's ring uses.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import schemaJson from '../../../stacks/kitdemo/schema.json';
import { createKitdemoStore, memoryBackend, type KitSchema } from '../../../engine/src';
import Shell from './Shell';

// React's act() only allows state updates inside it when this flag is set.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom does not implement scrolling; Shell scrolls the body on screen switches.
const elementProto = Element.prototype as unknown as { scrollTo?: () => void };
if (typeof elementProto.scrollTo !== 'function') elementProto.scrollTo = () => {};

const schema = schemaJson as KitSchema;
const tick = () => new Promise((r) => setTimeout(r, 0));

type GoalSeed = { id: string; kcal: number; active: boolean; createdAt: string };

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(async () => {
  const r = root;
  if (r) await act(async () => { r.unmount(); });
  container?.remove();
  container = undefined;
  root = undefined;
});

// Each render starts from a known entry so a fresh mount lands on Home no matter what earlier
// tests left current; pass an entry to simulate a reload that lands on a sub-screen entry.
async function renderShell(goalSeeds: GoalSeed[] = [], entry: { kdScreen: string } | null = null) {
  history.replaceState(null, '');
  if (entry) history.pushState(entry, '');
  const backend = memoryBackend();
  await backend.open(['food', 'meal', 'goal']);
  for (const g of goalSeeds) {
    await backend.put('goal', { id: g.id, kcal: g.kcal, active: g.active, createdAt: g.createdAt, updatedAt: g.createdAt });
  }
  const store = createKitdemoStore(null, { device: () => backend, stack: () => backend }, schema);
  container = document.createElement('div');
  document.body.appendChild(container);
  const r = createRoot(container);
  root = r;
  await act(async () => { r.render(<Shell store={store} session={null} schema={schema} />); });
  await act(async () => { await tick(); }); // let store.load() resolve and Home paint
}

const heading = () => container!.querySelector('h1')!.textContent;

const byLabel = (label: string) => {
  const el = container!.querySelector(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`no button with aria-label "${label}"`);
  return el as HTMLButtonElement;
};

const byLabelPrefix = (prefix: string) => {
  const el = [...container!.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith(prefix));
  if (!el) throw new Error(`no button with aria-label starting "${prefix}"`);
  return el as HTMLButtonElement;
};

// Clicks and then yields so a history traversal's popstate (a macrotask in jsdom) lands in act().
const click = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    await tick();
  });
};

const systemBack = async () => {
  await act(async () => { history.back(); await tick(); await tick(); });
};

const systemForward = async () => {
  await act(async () => { history.forward(); await tick(); await tick(); });
};

describe('kitdemo Shell history (real jsdom history)', () => {
  it('header Back pops the entry go() pushed: N round trips leave history.length unchanged and end on Home', async () => {
    await renderShell();
    expect(heading()).toBe('Kitdemo');
    const start = history.length;

    for (let i = 0; i < 3; i++) {
      await click(byLabelPrefix('Foods:'));
      expect(heading()).toBe('Foods');
      expect(history.state?.kdScreen).toBe('foods');
      await click(byLabel('Back'));
      expect(heading()).toBe('Kitdemo');
    }
    // Exactly one pushed entry: each trip pops what it pushed instead of stacking dead entries.
    expect(history.length).toBe(start + 1);
    // The current entry is the base entry, so the next system back leaves the app.
    expect(history.state).toBe(null);
  });

  it('one more back from Home exits at the base entry instead of traversing a dead entry', async () => {
    await renderShell();
    await click(byLabelPrefix('Foods:'));
    await click(byLabel('Back'));
    expect(heading()).toBe('Kitdemo');

    await systemBack(); // at the first entry this press leaves the app; jsdom no-ops
    expect(heading()).toBe('Kitdemo');
    expect(history.state).toBe(null);
  });

  it('system back from a pushed screen returns Home; forward restores that screen', async () => {
    await renderShell();
    await click(byLabelPrefix('Foods:'));
    expect(heading()).toBe('Foods');

    await systemBack();
    expect(heading()).toBe('Kitdemo');
    expect(history.state).toBe(null);

    await systemForward();
    expect(heading()).toBe('Foods');
    expect(history.state?.kdScreen).toBe('foods');
  });

  it('popstate onto an entry with an unknown kdScreen falls back to Home', async () => {
    await renderShell();
    expect(heading()).toBe('Kitdemo');
    // A stale or hand-edited entry can carry an unknown kdScreen; system back onto it must
    // land on Home rather than trust the raw value and render it as the heading.
    history.replaceState({ kdScreen: 'bogus' }, '');
    await click(byLabelPrefix('Foods:'));
    expect(heading()).toBe('Foods');
    await systemBack();
    expect(heading()).toBe('Kitdemo');
  });
});

describe('kitdemo Shell goal screen', () => {
  it('shows the newest active goal, the same one Home uses, not a newer paused one', async () => {
    await renderShell([
      { id: 'g1', kcal: 1500, active: true, createdAt: '2026-10-01T09:00:00.000Z' },
      { id: 'g2', kcal: 2500, active: false, createdAt: '2026-10-05T09:00:00.000Z' },
    ]);
    // Home's Daily Goal card is driven by the newest active goal (1,500).
    expect(byLabelPrefix('Daily Goal:').getAttribute('aria-label')).toContain('1,500');

    await click(byLabelPrefix('Daily Goal:'));
    expect(heading()).toBe('Goal');
    const card = container!.querySelector('section[aria-label="Goal"]')!;
    expect(card.textContent).toContain('1,500 kcal');
    expect(card.textContent).toContain('Active');
    expect(card.textContent).not.toContain('2,500');
  });

  it('falls back to the newest goal when none is active', async () => {
    await renderShell([
      { id: 'g1', kcal: 1800, active: false, createdAt: '2026-10-01T09:00:00.000Z' },
      { id: 'g2', kcal: 2200, active: false, createdAt: '2026-10-05T09:00:00.000Z' },
    ]);
    await click(byLabelPrefix('Daily Goal:'));
    expect(heading()).toBe('Goal');
    const card = container!.querySelector('section[aria-label="Goal"]')!;
    expect(card.textContent).toContain('2,200 kcal');
    expect(card.textContent).toContain('Paused');
  });
});

describe('kitdemo Shell screen-switch effect', () => {
  it('does not steal focus on first mount; a screen switch focuses the heading', async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    await renderShell();
    const h1 = container!.querySelector('h1')!;
    expect(document.activeElement).not.toBe(h1);

    await click(byLabelPrefix('Foods:'));
    expect(document.activeElement).toBe(container!.querySelector('h1'));
  });
});

describe('kitdemo Shell reload (mount reads the entry state)', () => {
  it('mounts on the entry screen after a reload: one header Back reaches Home', async () => {
    // renderShell pushes {kdScreen:'foods'} on the base entry before rendering, like a reload.
    await renderShell([], { kdScreen: 'foods' });
    expect(heading()).toBe('Foods');

    await click(byLabel('Back'));
    expect(heading()).toBe('Kitdemo');
    expect(history.state).toBe(null);
  });

  it('mounts on Goal after a reload onto the goal entry: one header Back reaches Home', async () => {
    // renderShell pushes {kdScreen:'goal'} on the base entry before rendering, like a reload.
    await renderShell([], { kdScreen: 'goal' });
    expect(heading()).toBe('Goal');

    await click(byLabel('Back'));
    expect(heading()).toBe('Kitdemo');
    expect(history.state).toBe(null);
  });

  it('falls back to Home when the entry carries an unknown kdScreen', async () => {
    await renderShell([], { kdScreen: 'bogus' });
    expect(heading()).toBe('Kitdemo');
  });
});
