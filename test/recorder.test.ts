import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BLANK_LAP, BLANK_TELEMETRY } from '../server/f1/encode.ts';
import type { CarLap } from '../server/f1/types.ts';
import { Recorder, type LapContext } from '../server/record/recorder.ts';
import { ReferenceTracker, interpolate } from '../server/record/reference.ts';
import { Store } from '../server/record/store.ts';

const TRACK_LENGTH = 5000;
const HZ = 20;

let store: Store;
let ctx: LapContext;
let recorder: Recorder;
let events: string[];
let t: number;

function context(overrides: Partial<LapContext> = {}): LapContext {
  return {
    sessionUid: '1',
    sessionType: 18,
    sessionGroup: 'time-trial',
    trackId: 11,
    generation: '2025',
    conditions: 'dry',
    udpFormat: 2025,
    actualCompound: 18,
    visualCompound: 17,
    ...overrides,
  };
}

beforeEach(() => {
  store = new Store(':memory:');
  ctx = context();
  events = [];
  t = 100;
  recorder = new Recorder(
    store,
    {
      lapSaved: (id, lap) => events.push(`saved:${id}:lap${lap.lapNum}`),
      lapRemoved: (id) => events.push(`removed:${id}`),
      lapValidityChanged: (id, valid) => events.push(`validity:${id}:${valid}`),
      currentLineReset: (lapNum, samples) => events.push(`line:${lapNum}:${samples.length}`),
    },
    () => ctx,
  );
});

interface DriveOptions {
  lapNum: number;
  lapTimeMs: number;
  lastLapTimeMs?: number;
  /** Fraction of the lap to start and stop at. */
  from?: number;
  to?: number;
  lap?: (fraction: number) => Partial<CarLap>;
}

/** Drive part of a lap at constant speed, one frame every 1/HZ s. */
function drive(o: DriveOptions): void {
  const from = o.from ?? 0;
  const to = o.to ?? 1;
  const frames = Math.max(1, Math.round((o.lapTimeMs / 1000) * (to - from) * HZ));
  for (let f = 0; f <= frames; f++) {
    const fraction = from + ((to - from) * f) / frames;
    if (fraction >= 1) break;
    const lap: CarLap = {
      ...BLANK_LAP,
      currentLapNum: o.lapNum,
      currentLapTimeMs: Math.round(fraction * o.lapTimeMs),
      lastLapTimeMs: o.lastLapTimeMs ?? 0,
      lapDistance: fraction * TRACK_LENGTH,
      sector: fraction < 1 / 3 ? 0 : fraction < 2 / 3 ? 1 : 2,
      sector1TimeMs: fraction >= 1 / 3 ? Math.round(o.lapTimeMs / 3) : 0,
      sector2TimeMs: fraction >= 2 / 3 ? Math.round(o.lapTimeMs / 3) : 0,
      driverStatus: 1,
      resultStatus: 2,
      ...o.lap?.(fraction),
    };
    const angle = fraction * Math.PI * 2;
    recorder.addFrame(ctx.sessionUid, t, lap, { ...BLANK_TELEMETRY, speed: 200 }, { x: Math.cos(angle) * 800, y: 0, z: Math.sin(angle) * 800, fx: 0, fz: 1, yaw: 0 });
    t += 1 / HZ;
  }
}

/** First frame of the next lap, which closes the previous one. */
function crossLine(lapNum: number, lastLapTimeMs: number): void {
  drive({ lapNum, lapTimeMs: 90_000, lastLapTimeMs, from: 0, to: 1 / (90 * HZ) });
}

describe('Recorded Laps', () => {
  it('saves complete laps with the game lap time and sectors, and finds the Best Lap', () => {
    drive({ lapNum: 1, lapTimeMs: 90_000 });
    crossLine(2, 90_000);
    drive({ lapNum: 2, lapTimeMs: 88_500, lastLapTimeMs: 90_000 });
    crossLine(3, 88_500);

    const laps = store.sessionLaps('1');
    assert.equal(laps.length, 2);
    assert.deepEqual(laps.map((l) => [l.lapNum, l.lapTimeMs, l.complete, l.valid]), [
      [1, 90_000, true, true],
      [2, 88_500, true, true],
    ]);
    assert.deepEqual(laps[1].sectorsMs, [29_500, 29_500, 29_500]);
    assert.equal(store.bestLap(ctx)?.lapNum, 2);
  });

  it('an Invalid Lap is saved but never becomes the Best Lap', () => {
    drive({ lapNum: 1, lapTimeMs: 85_000, lap: (f) => ({ currentLapInvalid: f > 0.5 }) });
    crossLine(2, 85_000);
    drive({ lapNum: 2, lapTimeMs: 90_000, lastLapTimeMs: 85_000 });
    crossLine(3, 90_000);

    const [first] = store.sessionLaps('1');
    assert.equal(first.valid, false);
    assert.equal(store.bestLap(ctx)?.lapNum, 2);
  });

  it('labels Out-Laps and In-Laps, which cannot be a Best Lap', () => {
    drive({ lapNum: 1, lapTimeMs: 100_000, lap: (f) => ({ pitStatus: f < 0.1 ? 2 : 0, driverStatus: 3 }) });
    crossLine(2, 100_000);
    drive({ lapNum: 2, lapTimeMs: 89_000, lastLapTimeMs: 100_000 });
    crossLine(3, 89_000);
    drive({ lapNum: 3, lapTimeMs: 88_000, lastLapTimeMs: 89_000, lap: (f) => ({ pitStatus: f > 0.95 ? 1 : 0 }) });
    crossLine(4, 88_000);

    const laps = store.sessionLaps('1');
    assert.deepEqual(laps.map((l) => [l.lapNum, l.outLap, l.inLap]), [
      [1, true, false],
      [2, false, false],
      [3, false, true],
    ]);
    assert.equal(store.bestLap(ctx)?.lapNum, 2, 'the faster in-lap does not count');
  });

  it('a Flashback mid-lap cuts the lap back, and clears an invalidation after the rewind point', () => {
    drive({ lapNum: 1, lapTimeMs: 90_000, to: 0.4 });
    const rewindPoint = t;
    drive({ lapNum: 1, lapTimeMs: 90_000, from: 0.4, to: 0.6, lap: (f) => ({ currentLapInvalid: f > 0.5 }) });
    recorder.rewindTo(rewindPoint);
    drive({ lapNum: 1, lapTimeMs: 90_000, from: 0.4 });
    crossLine(2, 90_000);

    const [lap] = store.sessionLaps('1');
    assert.equal(lap.valid, true);
    const samples = store.lapSamples(lap.id);
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i].sessionTime > samples[i - 1].sessionTime, 'no rewound frames left in the lap');
    }
  });

  it('a Flashback back across the line reopens the saved lap instead of saving it twice', () => {
    drive({ lapNum: 1, lapTimeMs: 90_000 });
    const beforeLine = t - 2;
    crossLine(2, 90_000);
    drive({ lapNum: 2, lapTimeMs: 90_000, to: 0.02 });
    const [saved] = store.sessionLaps('1');

    recorder.rewindTo(beforeLine);
    assert.ok(events.includes(`removed:${saved.id}`));
    assert.equal(store.sessionLaps('1').length, 0);

    drive({ lapNum: 1, lapTimeMs: 90_000, from: (beforeLine - 100) / 90 + 0.0001 });
    crossLine(2, 89_900);
    const laps = store.sessionLaps('1');
    assert.equal(laps.length, 1);
    assert.equal(laps[0].lapTimeMs, 89_900);
    assert.equal(laps[0].complete, true);
  });

  it('time going backwards without a FLBK event is treated as a Flashback', () => {
    drive({ lapNum: 1, lapTimeMs: 90_000, to: 0.5 });
    t -= 10;
    drive({ lapNum: 1, lapTimeMs: 90_000, from: 0.5 - 10 / 90 });
    crossLine(2, 90_000);
    const [lap] = store.sessionLaps('1');
    const samples = store.lapSamples(lap.id);
    assert.ok(samples.every((s, i) => i === 0 || s.sessionTime > samples[i - 1].sessionTime));
  });

  it('a restart mid-lap saves an Incomplete Lap and starts again', () => {
    drive({ lapNum: 1, lapTimeMs: 90_000, to: 0.5 });
    drive({ lapNum: 1, lapTimeMs: 90_000 });
    crossLine(2, 90_000);

    const laps = store.sessionLaps('1');
    assert.deepEqual(laps.map((l) => [l.complete, l.lapTimeMs]), [
      [false, null],
      [true, 90_000],
    ]);
  });

  it('a lap the app only saw part of is kept but never complete', () => {
    drive({ lapNum: 3, lapTimeMs: 90_000, from: 0.5 });
    crossLine(4, 90_000);
    const [lap] = store.sessionLaps('1');
    assert.equal(lap.complete, false);
    assert.equal(store.bestLap(ctx), null);
  });

  it('the game invalidating a lap afterwards updates the saved lap', () => {
    drive({ lapNum: 1, lapTimeMs: 90_000 });
    crossLine(2, 90_000);
    const [lap] = store.sessionLaps('1');
    recorder.applySessionHistory([{ lapTimeMs: 90_000, sector1Ms: 0, sector2Ms: 0, sector3Ms: 0, validFlags: 0 }]);
    assert.ok(events.includes(`validity:${lap.id}:false`));
    assert.equal(store.getLap(lap.id)?.valid, false);
  });
});

describe('Reference Lap and Delta', () => {
  it('Time Trial uses the all-time Best Lap, other sessions only this session', () => {
    drive({ lapNum: 1, lapTimeMs: 86_000 });
    crossLine(2, 86_000);

    const reference = new ReferenceTracker(store);
    reference.refresh(context({ sessionUid: '2' }));
    assert.equal(reference.info?.lapTimeMs, 86_000, 'Time Trial: best lap from an earlier session');
    assert.equal(reference.info?.source, 'all-time');

    reference.refresh(context({ sessionUid: '2', sessionGroup: 'race', sessionType: 15 }));
    assert.equal(reference.info, null, 'race in a new session: no lap yet, so no Delta');

    reference.refresh(context({ conditions: 'wet' }));
    assert.equal(reference.info, null, 'wet laps never compare against dry laps');
  });

  it('Delta is the time difference at the same distance', () => {
    drive({ lapNum: 1, lapTimeMs: 90_000 });
    crossLine(2, 90_000);
    const reference = new ReferenceTracker(store);
    reference.refresh(ctx);
    // Halfway round, 1 s slower than the reference.
    const delta = reference.delta(TRACK_LENGTH / 2, 46_000);
    assert.ok(delta !== null && Math.abs(delta - 1) < 0.01, `delta was ${delta}`);
    assert.equal(reference.delta(-20, 0), null, 'before the line there is no Delta');
  });

  it('interpolates linearly between samples', () => {
    const xs = Float64Array.from([0, 10, 20]);
    const ys = Float64Array.from([0, 100, 300]);
    assert.equal(interpolate(xs, ys, 15), 200);
    assert.equal(interpolate(xs, ys, -5), 0);
    assert.equal(interpolate(xs, ys, 25), 300);
  });
});
