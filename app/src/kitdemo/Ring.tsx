import type { ReactNode } from 'react';

/** Progress ring geometry: the bar is a circle of radius 42 in a 96x96 viewBox. */
export const RING_R = 42;
export const RING_C = 2 * Math.PI * RING_R;

interface Props {
  /** Ring fill as a 0..1 fraction; the accent bar is not rendered at 0. */
  pct: number;
  children: ReactNode;
}

/** The Daily Goal ring: a track circle, an accent arc for the filled fraction, and a centered label. */
export default function Ring({ pct, children }: Props) {
  const arc = Number.isFinite(pct) ? Math.min(1, Math.max(0, pct)) : 0;
  return (
    <div className="kd-ring" aria-hidden="true">
      <svg viewBox="0 0 96 96">
        <circle className="kd-ring-track" cx="48" cy="48" r={RING_R} />
        {arc > 0 && (
          <circle
            className="kd-ring-bar"
            cx="48"
            cy="48"
            r={RING_R}
            strokeDasharray={`${RING_C * arc} ${RING_C}`}
            transform="rotate(-90 48 48)"
          />
        )}
      </svg>
      <b>{children}</b>
    </div>
  );
}
