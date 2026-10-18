// Track Map (CONTEXT.md): drawn from your own first full lap at a circuit.
// A map made from an Invalid Lap is replaced by the first valid lap there.

import { lineFromSamples } from './samples.ts';
import type { NewLap, Store } from './store.ts';

const POINT_SPACING_METRES = 3;
const MIN_POINTS = 100;

export class TrackMaps {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  get(trackId: number): number[] | null {
    const map = this.store.trackMap(trackId);
    return map ? Array.from(map.points, (v) => Math.round(v * 10) / 10) : null;
  }

  /** Offer a just-saved lap as the map's source. Returns the new outline when the map changed. */
  consider(lapId: number, lap: NewLap): number[] | null {
    if (!lap.complete || lap.outLap || lap.inLap || lap.trackId < 0) return null;
    const existing = this.store.trackMap(lap.trackId);
    if (existing && (existing.sourceValid || !lap.valid)) return null;
    const points = lineFromSamples(lap.samples, POINT_SPACING_METRES);
    if (points.length / 2 < MIN_POINTS) return null;
    this.store.saveTrackMap(lap.trackId, lapId, lap.valid, Float32Array.from(points));
    return points;
  }
}
