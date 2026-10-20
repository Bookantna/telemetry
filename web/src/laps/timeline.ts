// Reading a Recorded Lap's samples at any moment, for Lap Replay. No DOM, so it can be tested.

import type { LapReplay } from '../../../shared/protocol.ts';

export type Samples = LapReplay['samples'];

/** The lap at one moment, in the shapes the live map and trace read. */
export interface Moment {
  /** Index of the last sample at or before this moment. */
  i: number;
  t: number;
  lapMs: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  gear: number;
  thr: number;
  brk: number;
}

/** Index of the last value at or before x in an ascending array; 0 when x comes before them all. */
export function indexAt(xs: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  if (hi <= 0 || x < xs[0]) return 0;
  if (x >= xs[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Direction of travel at each sample, like LiveFrame.heading. Held while the car stands still. */
export function headings(s: Samples): number[] {
  const n = s.x.length;
  const out: number[] = new Array(n);
  let last = NaN;
  for (let i = 0; i < n; i++) {
    // ±5 frames either side smooths out the jitter of a single frame's movement.
    const a = Math.max(0, i - 5);
    const b = Math.min(n - 1, i + 5);
    const dx = s.x[b] - s.x[a];
    const dz = s.z[b] - s.z[a];
    if (Math.hypot(dx, dz) > 0.5) last = Math.atan2(dz, dx);
    out[i] = last;
  }
  // Standing still at the start: face the way the car first moves.
  const first = out.find((v) => !Number.isNaN(v)) ?? 0;
  return out.map((v) => (Number.isNaN(v) ? first : v));
}

/** The lap at session time t, interpolated between the samples either side. */
export function momentAt(s: Samples, heads: number[], t: number): Moment {
  const times = s.sessionTime;
  const i = indexAt(times, t);
  const j = Math.min(i + 1, times.length - 1);
  const span = times[j] - times[i];
  const f = span > 0 ? Math.max(0, Math.min(1, (t - times[i]) / span)) : 0;
  const mix = (v: number[]) => v[i] + (v[j] - v[i]) * f;
  // Turn the short way round, so ±π does not spin the close-up.
  let turn = heads[j] - heads[i];
  turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
  return {
    i,
    t,
    lapMs: mix(s.lapMs),
    x: mix(s.x),
    z: mix(s.z),
    heading: heads[i] + turn * f,
    speed: mix(s.speed),
    gear: s.gear[f < 0.5 ? i : j],
    thr: mix(s.throttle),
    brk: mix(s.brake),
  };
}
