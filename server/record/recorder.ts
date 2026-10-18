// Turns the Player Car's frames into Recorded Laps (CONTEXT.md), labelled valid or
// invalid, complete or incomplete, out-lap or in-lap. A Flashback cuts the open lap
// back to the rewind point, and can reopen a lap that was already saved.

import type { CarLap, CarMotion, CarTelemetry, LapHistory } from '../f1/types.ts';
import type { Sample } from './samples.ts';
import type { LapKey, NewLap, Store } from './store.ts';

export interface LapContext extends LapKey {
  sessionUid: string;
  sessionType: number;
  udpFormat: number;
  actualCompound: number;
  visualCompound: number;
}

export interface RecorderEvents {
  lapSaved(id: number, lap: NewLap): void;
  lapRemoved(id: number): void;
  lapValidityChanged(id: number, valid: boolean): void;
  /** The open lap's line restarted: a new lap began, or a Flashback trimmed it. */
  currentLineReset(lapNum: number, samples: Sample[]): void;
}

interface Stamp {
  ms: number;
  at: number;
}

interface OpenLap {
  lapNum: number;
  samples: Sample[];
  invalidSince: number | null;
  /** 'pit-start' until the car first leaves the pit lane after starting the lap in it. */
  pitPhase: 'pit-start' | 'track';
  outLap: boolean;
  inLapSince: number | null;
  sector1: Stamp | null;
  sector2: Stamp | null;
}

interface SavedLap {
  id: number;
  lap: OpenLap;
}

/** Scraps shorter than this (a restart right after the line, a menu blip) are not worth keeping. */
const MIN_FRAGMENT_SAMPLES = 60;
const MIN_FRAGMENT_METRES = 200;
/** A lap counts as seen from the start when its first frame is this close to the line. */
const START_TOLERANCE_MS = 1500;
/** Ten minutes at 60 Hz; protects memory if the car sits on track for a long time. */
const MAX_SAMPLES = 36_000;

export class Recorder {
  private open: OpenLap | null = null;
  private lastSaved: SavedLap | null = null;
  private sessionUid: string | null = null;
  private readonly savedByLapNum = new Map<number, { id: number; valid: boolean }>();
  private readonly store: Store;
  private readonly events: RecorderEvents;
  private readonly context: () => LapContext | null;

  constructor(store: Store, events: RecorderEvents, context: () => LapContext | null) {
    this.store = store;
    this.events = events;
    this.context = context;
  }

  get currentLapNum(): number {
    return this.open?.lapNum ?? 0;
  }

  get currentSamples(): Sample[] {
    return this.open?.samples ?? [];
  }

  /** The open lap's sector times so far, for the timing panel. */
  get currentSectors(): [number | null, number | null] {
    return [this.open?.sector1?.ms ?? null, this.open?.sector2?.ms ?? null];
  }

  get currentLapIsOutLap(): boolean {
    return this.open?.outLap ?? false;
  }

  /** Called once per game frame with the Player Car's data. */
  addFrame(sessionUid: string, sessionTime: number, lap: CarLap, tel: CarTelemetry, motion: CarMotion): void {
    if (sessionUid !== this.sessionUid) {
      this.endSession();
      this.sessionUid = sessionUid;
    }

    if (lap.driverStatus === 0) {
      // Back in the garage: whatever lap was open ends here.
      if (this.open) {
        this.open.inLapSince ??= sessionTime;
        this.finishIncomplete();
      }
      return;
    }

    const last = this.open?.samples.at(-1);
    if (last && sessionTime < last.sessionTime - 0.05) {
      // Time went backwards without a FLBK event (the event packet can be lost).
      this.rewindTo(sessionTime);
    }

    let open = this.open;
    if (open) {
      const lastLapMs = open.samples.at(-1)?.lapMs ?? 0;
      if (lap.currentLapNum > open.lapNum) {
        this.saveComplete(open, lap.lastLapTimeMs);
        open = null;
      } else if (lap.currentLapNum < open.lapNum || lap.currentLapTimeMs + 1000 < lastLapMs) {
        // Lap counter or lap timer jumped back without a Flashback: a restart.
        this.finishIncomplete();
        open = null;
      }
    }
    if (!open) open = this.startLap(lap);

    this.track(open, sessionTime, lap);
    if (open.samples.length < MAX_SAMPLES) {
      open.samples.push({
        sessionTime,
        lapMs: lap.currentLapTimeMs,
        dist: lap.lapDistance,
        x: motion.x,
        y: motion.y,
        z: motion.z,
        speed: tel.speed,
        throttle: tel.throttle,
        brake: tel.brake,
        steer: tel.steer,
        gear: tel.gear,
        rpm: tel.engineRpm,
      });
    }
  }

  /** FLBK event: the game rewound to `sessionTime`. */
  rewindTo(sessionTime: number): void {
    const open = this.open;
    if (open && open.samples.length > 0 && open.samples[0].sessionTime <= sessionTime) {
      trim(open, sessionTime);
      this.events.currentLineReset(open.lapNum, open.samples);
      return;
    }
    const saved = this.lastSaved;
    if (saved && saved.lap.samples[0].sessionTime <= sessionTime) {
      // Flashback back across the finish line: the saved lap never really ended.
      this.store.deleteLap(saved.id);
      this.savedByLapNum.delete(saved.lap.lapNum);
      this.events.lapRemoved(saved.id);
      trim(saved.lap, sessionTime);
      this.open = saved.lap;
      this.lastSaved = null;
      this.events.currentLineReset(saved.lap.lapNum, saved.lap.samples);
      return;
    }
    this.open = null;
  }

  /** The game's own lap history can invalidate a lap after it ended (penalties). */
  applySessionHistory(laps: LapHistory[]): void {
    laps.forEach((history, i) => {
      if (history.lapTimeMs <= 0) return;
      const saved = this.savedByLapNum.get(i + 1);
      if (!saved) return;
      const valid = (history.validFlags & 1) === 1;
      if (valid === saved.valid) return;
      saved.valid = valid;
      this.store.setLapValid(saved.id, valid);
      this.events.lapValidityChanged(saved.id, valid);
    });
  }

  /** Session ended, changed, or the app is shutting down. */
  endSession(): void {
    if (this.open) this.finishIncomplete();
    this.lastSaved = null;
    this.savedByLapNum.clear();
    this.sessionUid = null;
  }

  private startLap(lap: CarLap): OpenLap {
    const open: OpenLap = {
      lapNum: lap.currentLapNum,
      samples: [],
      invalidSince: null,
      pitPhase: lap.pitStatus > 0 ? 'pit-start' : 'track',
      outLap: lap.pitStatus > 0 || lap.driverStatus === 3,
      inLapSince: null,
      sector1: null,
      sector2: null,
    };
    this.open = open;
    this.events.currentLineReset(open.lapNum, open.samples);
    return open;
  }

  private track(open: OpenLap, t: number, lap: CarLap): void {
    if (lap.currentLapInvalid) open.invalidSince ??= t;
    if (lap.driverStatus === 3) open.outLap = true;
    if (lap.driverStatus === 2) open.inLapSince ??= t;
    if (lap.pitStatus > 0) {
      if (open.pitPhase === 'track') open.inLapSince ??= t;
    } else {
      open.pitPhase = 'track';
    }
    if (lap.sector >= 1 && lap.sector1TimeMs > 0) open.sector1 ??= { ms: lap.sector1TimeMs, at: t };
    if (lap.sector >= 2 && lap.sector2TimeMs > 0) open.sector2 ??= { ms: lap.sector2TimeMs, at: t };
  }

  private saveComplete(open: OpenLap, gameLapTimeMs: number): void {
    const lapTimeMs = gameLapTimeMs > 0 ? gameLapTimeMs : (open.samples.at(-1)?.lapMs ?? 0);
    // A lap the app only saw part of (it started mid-lap) is kept, but never counts as complete.
    const seenFromStart = (open.samples[0]?.lapMs ?? Infinity) <= START_TOLERANCE_MS;
    const s1 = open.sector1?.ms ?? null;
    const s2 = open.sector2?.ms ?? null;
    const s3 = s1 !== null && s2 !== null ? lapTimeMs - s1 - s2 : null;
    const id = this.save(open, {
      lapTimeMs,
      sectorsMs: [s1, s2, s3],
      complete: seenFromStart,
    });
    if (id === null) return;
    this.lastSaved = { id, lap: open };
  }

  private finishIncomplete(): void {
    const open = this.open;
    this.open = null;
    this.lastSaved = null;
    if (!open || open.samples.length < MIN_FRAGMENT_SAMPLES) return;
    const dists = open.samples.map((s) => s.dist).filter((d) => d >= 0);
    const covered = dists.length ? Math.max(...dists) - Math.min(...dists) : 0;
    if (covered < MIN_FRAGMENT_METRES) return;
    this.save(open, {
      lapTimeMs: null,
      sectorsMs: [open.sector1?.ms ?? null, open.sector2?.ms ?? null, null],
      complete: false,
    });
  }

  private save(open: OpenLap, result: Pick<NewLap, 'lapTimeMs' | 'sectorsMs' | 'complete'>): number | null {
    const ctx = this.context();
    if (!ctx || this.sessionUid === null) return null;
    const lap: NewLap = {
      sessionUid: this.sessionUid,
      trackId: ctx.trackId,
      sessionType: ctx.sessionType,
      sessionGroup: ctx.sessionGroup,
      generation: ctx.generation,
      conditions: ctx.conditions,
      lapNum: open.lapNum,
      ...result,
      valid: open.invalidSince === null,
      outLap: open.outLap,
      inLap: open.inLapSince !== null,
      visualCompound: ctx.visualCompound,
      actualCompound: ctx.actualCompound,
      udpFormat: ctx.udpFormat,
      samples: open.samples,
    };
    const id = this.store.insertLap(lap);
    if (lap.complete) this.savedByLapNum.set(lap.lapNum, { id, valid: lap.valid });
    this.events.lapSaved(id, lap);
    return id;
  }
}

/** Session times this close count as the same frame (they are stored as float32). */
const SAME_FRAME_SECONDS = 0.001;

/** Drop everything from the rewind point on; the game resends the frame at `t` itself. */
function trim(lap: OpenLap, t: number): void {
  lap.samples = lap.samples.filter((s) => s.sessionTime < t - SAME_FRAME_SECONDS);
  if (lap.invalidSince !== null && lap.invalidSince >= t) lap.invalidSince = null;
  if (lap.inLapSince !== null && lap.inLapSince >= t) lap.inLapSince = null;
  if (lap.sector1 && lap.sector1.at >= t) lap.sector1 = null;
  if (lap.sector2 && lap.sector2.at >= t) lap.sector2 = null;
}
