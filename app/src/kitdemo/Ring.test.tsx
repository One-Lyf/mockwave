import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Ring, { RING_C } from './Ring';

// Shell feeds Ring the goalRing() fraction, which is 0 both when nothing is eaten and
// when there is no goal (engine/src/kitdemo/dashboard.test.ts), so pct 0 covers both.
const render = (pct: number) => renderToStaticMarkup(<Ring pct={pct}><span>Label</span></Ring>);

describe('kitdemo Ring (render)', () => {
  it('renders the track but no progress arc at 0 (empty day, and no-goal via goalRing)', () => {
    const html = render(0);
    expect(html).toContain('kd-ring-track');
    expect(html).not.toContain('kd-ring-bar');
  });

  it('draws a partial dasharray for a partial arc', () => {
    expect(render(0.5)).toContain(`stroke-dasharray="${RING_C * 0.5} ${RING_C}"`);
  });

  it('draws a full-circle dasharray at the goal and over it', () => {
    expect(render(1)).toContain(`stroke-dasharray="${RING_C} ${RING_C}"`);
  });

  it('clamps out-of-range fractions instead of drawing past the ring', () => {
    expect(render(1.4)).toContain(`stroke-dasharray="${RING_C} ${RING_C}"`);
    expect(render(-0.2)).not.toContain('kd-ring-bar');
  });
});
