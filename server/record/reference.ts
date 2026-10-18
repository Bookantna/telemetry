// Picks the Reference Lap (CONTEXT.md) and computes Delta against it.
// Time Trial compares against the all-time Best Lap; every other Session Type
// compares against your fastest valid lap so far in that session.

import type { ReferenceInfo } from '../../shared/protocol.ts';
import type { LapContext } from './recorder.ts';
import { lineFromSamples } from './samples.ts';
import type { Store } from './store.ts';

interface Loaded {
  info: ReferenceInfo;
  /** Strictly increasing lap distance, metres. */
  dist: Float64Array;
  /** Lap time at each distance, ms. */
  lapMs: Float64Array;
}

export class ReferenceTracker {
  private ref: Loaded | null = null;
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  get info(): ReferenceInfo | null {
    return this.ref?.info ?? null;
  }

  /** Re-pick the Reference Lap for the current context. Returns true when it changed. */
  refresh(ctx: LapContext | null): boolean {
    const summary = !ctx
      ? null
      : ctx.sessionGroup === 'time-trial'
        ? this.store.bestLap(ctx)
        : this.store.sessionBestLap(ctx.sessionUid, ctx);
    if ((summary?.id ?? null) === (this.ref?.info.lapId ?? null)) return false;
    if (!summary || summary.lapTimeMs === null) {
      this.ref = null;
      return true;
    }
    const samples = this.store.lapSamples(summary.id);
    const dist: number[] = [];
    const lapMs: number[] = [];
    for (const s of samples) {
      if (s.dist < 0) continue;
      if (dist.length && s.dist <= dist[dist.length - 1]) continue;
      dist.push(s.dist);
      lapMs.push(s.lapMs);
    }
    this.ref = {
      dist: Float64Array.from(dist),
      lapMs: Float64Array.from(lapMs),
      info: {
        lapId: summary.id,
        lapTimeMs: summary.lapTimeMs,
        sectorsMs: summary.sectorsMs,
        source: ctx?.sessionGroup === 'time-trial' ? 'all-time' : 'session',
        recordedAt: summary.recordedAt,
        line: lineFromSamples(samples, 4),
      },
    };
    return true;
  }

  /** Delta in seconds at this point of the lap; negative means faster than the Reference Lap. */
  delta(dist: number, lapMs: number): number | null {
    const ref = this.ref;
    if (!ref || ref.dist.length < 2 || dist < 0 || dist > ref.dist[ref.dist.length - 1]) return null;
    return (lapMs - interpolate(ref.dist, ref.lapMs, dist)) / 1000;
  }
}

/** Linear interpolation of ys at x, where xs is strictly increasing. */
export function interpolate(xs: Float64Array, ys: Float64Array, x: number): number {
  if (x <= xs[0]) return ys[0];
  let lo = 0;
  let hi = xs.length - 1;
  if (x >= xs[hi]) return ys[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + f * (ys[hi] - ys[lo]);
}
