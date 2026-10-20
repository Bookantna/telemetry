import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headings, indexAt, momentAt, type Samples } from '../web/src/laps/timeline.ts';

function samples(overrides: Partial<Samples>): Samples {
  const n = (overrides.sessionTime ?? [10, 11]).length;
  const zeros = () => new Array<number>(n).fill(0);
  return {
    sessionTime: [10, 11],
    lapMs: zeros(),
    x: zeros(),
    z: zeros(),
    speed: zeros(),
    throttle: zeros(),
    brake: zeros(),
    gear: zeros(),
    ...overrides,
  };
}

describe('Lap Replay timeline', () => {
  it('finds the last sample at or before a time, including repeated times from a paused game', () => {
    const times = [0, 1, 1, 2];
    assert.equal(indexAt(times, -1), 0);
    assert.equal(indexAt(times, 0.5), 0);
    assert.equal(indexAt(times, 1), 2);
    assert.equal(indexAt(times, 1.5), 2);
    assert.equal(indexAt(times, 9), 3);
  });

  it('interpolates position and pedals between samples', () => {
    const s = samples({ x: [0, 10], throttle: [0, 1], brake: [1, 0], gear: [3, 4] });
    const m = momentAt(s, [0, 0], 10.25);
    assert.equal(m.i, 0);
    assert.equal(m.x, 2.5);
    assert.equal(m.thr, 0.25);
    assert.equal(m.brk, 0.75);
    assert.equal(m.gear, 3);
  });

  it('turns the short way round across ±π', () => {
    const m = momentAt(samples({}), [3.1, -3.1], 10.5);
    assert.ok(Math.abs(Math.abs(m.heading) - Math.PI) < 0.01, `heading ${m.heading}`);
  });

  it('faces the direction of travel, also while standing still at the start', () => {
    const z = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];
    const s = samples({ sessionTime: z.map((_, i) => i), z });
    for (const h of headings(s)) assert.ok(Math.abs(h - Math.PI / 2) < 1e-9, `heading ${h}`);
  });
});
