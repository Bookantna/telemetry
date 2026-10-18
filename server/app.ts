// Wires the Telemetry Feed through recording, the Reference Lap and the Track Map,
// and streams the result to every connected Live Dashboard.

import type { ServerMessage, TimingInfo } from '../shared/protocol.ts';
import { parsePacket } from './f1/parse.ts';
import type { EventData } from './f1/types.ts';
import { LiveState } from './live/state.ts';
import type { Forwarder } from './net/forwarder.ts';
import type { ApiHandlers, WebServer } from './net/http.ts';
import { Recorder, type LapContext } from './record/recorder.ts';
import { ReferenceTracker } from './record/reference.ts';
import { pathFromSamples } from './record/samples.ts';
import type { NewLap, Store } from './record/store.ts';
import { TrackMaps } from './record/trackmap.ts';
import { formatLapTime } from '../shared/format.ts';

const CURRENT_LINE_STEP_METRES = 2;
const POSITION_SAMPLE_SECONDS = 0.2;
const POSITION_CHUNK_SECONDS = 30;

export interface AppInfo {
  urls: string[];
  udpPort: number;
  httpPort: number;
  version: string;
  dbPath: string;
}

export class App {
  readonly live = new LiveState();
  private readonly store: Store;
  private readonly forwarder: Forwarder;
  private readonly info: AppInfo;
  private readonly recorder: Recorder;
  private readonly reference: ReferenceTracker;
  private readonly maps: TrackMaps;
  private web: WebServer | null = null;
  private timers: NodeJS.Timeout[] = [];

  private lastFrameEmitted = -1;
  private contextKey = '';
  private trackIdShown: number | null = null;
  private lastLapSectors: TimingInfo['lastSectors'] = null;
  private cachedBest: { key: string; sessionBestMs: number | null; bestSectors: TimingInfo['bestSectors'] } | null = null;

  private readonly otherCarLapNums = new Map<number, number>();
  private positionRows: number[] = [];
  private positionChunkStart = 0;
  private lastPositionSampleAt = -Infinity;
  private positionsSessionUid: string | null = null;

  constructor(store: Store, forwarder: Forwarder, info: AppInfo) {
    this.store = store;
    this.forwarder = forwarder;
    this.info = info;
    this.reference = new ReferenceTracker(store);
    this.maps = new TrackMaps(store);
    this.recorder = new Recorder(
      store,
      {
        lapSaved: (id, lap) => this.onLapSaved(id, lap),
        lapRemoved: (id) => {
          this.invalidateBest();
          this.refreshReference();
          this.send({ type: 'lapRemoved', id });
        },
        lapValidityChanged: (id) => {
          this.invalidateBest();
          this.refreshReference();
          const lap = this.store.getLap(id);
          if (lap) this.send({ type: 'lap', lap });
        },
        currentLineReset: (lapNum, samples) => {
          this.send({ type: 'currentLine', lapNum, points: pathFromSamples(samples, CURRENT_LINE_STEP_METRES) });
        },
      },
      () => this.live.context(),
    );
  }

  attach(web: WebServer): void {
    this.web = web;
  }

  start(): void {
    this.timers.push(setInterval(() => this.sendCar(), 200));
    this.timers.push(
      setInterval(() => {
        this.checkContext();
        this.sendStatus();
        this.sendTiming();
      }, 500),
    );
  }

  shutdown(): void {
    for (const t of this.timers) clearInterval(t);
    this.recorder.endSession();
    this.flushPositions();
  }

  readonly api: ApiHandlers = {
    listLaps: (limit) => this.store.listLaps(limit),
    deleteLap: (id) => {
      const deleted = this.store.deleteLap(id);
      if (deleted) {
        this.invalidateBest();
        this.refreshReference();
        this.send({ type: 'lapRemoved', id });
      }
      return deleted;
    },
    info: () => this.info,
    snapshot: () => this.snapshot(),
  };

  onDatagram(bytes: Buffer, now = Date.now()): void {
    this.forwarder.send(bytes);
    const result = parsePacket(bytes);
    if (!result.ok) {
      if (result.reason === 'unsupported-format' && result.format !== undefined) {
        this.live.noteUnsupportedFormat(result.format, now);
      }
      return;
    }
    const packet = result.packet;
    if (this.live.apply(packet, now)) this.onNewSession();

    switch (packet.kind) {
      case 'session':
        this.checkContext();
        break;
      case 'event':
        this.onEvent(packet.event);
        break;
      case 'sessionHistory':
        if (packet.history.carIdx === this.live.playerIdx) this.recorder.applySessionHistory(packet.history.laps);
        break;
      case 'lapData':
        this.recordOtherCarLaps();
        break;
      case 'motion':
        this.sampleOtherCarPositions(packet.header.sessionTime);
        break;
    }

    if (
      (packet.kind === 'lapData' || packet.kind === 'carTelemetry' || packet.kind === 'motion') &&
      this.live.frameComplete() &&
      this.live.frameOf.lapData !== this.lastFrameEmitted
    ) {
      this.lastFrameEmitted = this.live.frameOf.lapData;
      this.onFrame(packet.header.sessionTime);
    }
  }

  private onFrame(sessionTime: number): void {
    const live = this.live;
    const i = live.playerIdx;
    const lap = live.laps[i];
    const tel = live.telemetry[i];
    const motion = live.motion[i];
    if (!lap || !tel || !motion || live.sessionUid === null) return;

    // The formation lap is not a lap of the race; do not record it.
    if (live.session?.safetyCarStatus !== 3) {
      this.recorder.addFrame(live.sessionUid, sessionTime, lap, tel, motion);
    }

    const ref = this.reference.info;
    const delta = this.recorder.currentLapIsOutLap ? null : this.reference.delta(lap.lapDistance, lap.currentLapTimeMs);
    const predictedMs = delta !== null && ref ? Math.round(ref.lapTimeMs + delta * 1000) : null;
    const frame = live.frame(sessionTime, delta, predictedMs);
    if (frame) this.send({ type: 'frame', f: frame }, true);
  }

  private onEvent(event: EventData): void {
    if (event.code === 'FLBK' && event.flashback) {
      this.recorder.rewindTo(event.flashback.sessionTime);
    } else if (event.code === 'SEND') {
      this.recorder.endSession();
      this.flushPositions();
    }
  }

  private onNewSession(): void {
    this.flushPositions();
    this.otherCarLapNums.clear();
    this.lastLapSectors = null;
    this.lastFrameEmitted = -1;
    this.invalidateBest();
    this.send({ type: 'currentLine', lapNum: 0, points: [] });
  }

  private onLapSaved(id: number, lap: NewLap): void {
    this.invalidateBest();
    const outline = this.maps.consider(id, lap);
    if (outline) this.send({ type: 'trackMap', trackId: lap.trackId, points: outline });
    if (lap.complete) this.lastLapSectors = lap.sectorsMs;
    this.refreshReference();
    const summary = this.store.getLap(id);
    if (summary) this.send({ type: 'lap', lap: summary });

    const labels = [
      lap.complete ? null : 'incomplete',
      lap.valid ? null : 'invalid',
      lap.outLap ? 'out-lap' : null,
      lap.inLap ? 'in-lap' : null,
      summary?.isBest ? 'BEST' : null,
    ].filter(Boolean);
    const time = lap.lapTimeMs !== null ? formatLapTime(lap.lapTimeMs) : '—';
    console.log(`  Lap ${lap.lapNum}  ${time}  ${labels.join(', ')}`);
  }

  private checkContext(): void {
    const ctx = this.live.context();
    const key = contextKey(ctx);
    if (key !== this.contextKey) {
      this.contextKey = key;
      this.invalidateBest();
      this.refreshReference();
    }
    if (ctx && ctx.trackId !== this.trackIdShown) {
      this.trackIdShown = ctx.trackId;
      this.send({ type: 'trackMap', trackId: ctx.trackId, points: this.maps.get(ctx.trackId) });
    }
  }

  private refreshReference(): void {
    if (this.reference.refresh(this.live.context())) {
      this.send({ type: 'reference', reference: this.reference.info });
    }
  }

  private invalidateBest(): void {
    this.cachedBest = null;
  }

  private best(ctx: LapContext): NonNullable<App['cachedBest']> {
    const key = contextKey(ctx);
    if (this.cachedBest?.key !== key) {
      this.cachedBest = {
        key,
        sessionBestMs: this.store.sessionBestLap(ctx.sessionUid, ctx)?.lapTimeMs ?? null,
        bestSectors: this.store.bestSectors(ctx),
      };
    }
    return this.cachedBest;
  }

  private recordOtherCarLaps(): void {
    const live = this.live;
    if (live.sessionUid === null) return;
    live.laps.forEach((lap, idx) => {
      if (idx === live.playerIdx || !live.classified(idx)) return;
      const previous = this.otherCarLapNums.get(idx);
      this.otherCarLapNums.set(idx, lap.currentLapNum);
      if (previous === undefined || lap.currentLapNum <= previous || lap.lastLapTimeMs <= 0) return;
      const p = live.participants[idx];
      this.store.saveOtherCarLap(live.sessionUid!, idx, previous, p?.name ?? '', p?.teamId ?? -1, lap.lastLapTimeMs);
    });
  }

  private sampleOtherCarPositions(sessionTime: number): void {
    const live = this.live;
    if (live.sessionUid === null) return;
    if (sessionTime < this.lastPositionSampleAt) this.lastPositionSampleAt = -Infinity; // Flashback
    if (sessionTime - this.lastPositionSampleAt < POSITION_SAMPLE_SECONDS) return;
    this.lastPositionSampleAt = sessionTime;
    if (this.positionRows.length === 0) {
      this.positionChunkStart = sessionTime;
      this.positionsSessionUid = live.sessionUid;
    }
    live.motion.forEach((m, idx) => {
      if (idx === live.playerIdx || !live.onTrack(idx)) return;
      this.positionRows.push(sessionTime, idx, m.x, m.z);
    });
    if (sessionTime - this.positionChunkStart >= POSITION_CHUNK_SECONDS) this.flushPositions();
  }

  private flushPositions(): void {
    if (this.positionRows.length && this.positionsSessionUid !== null) {
      this.store.saveOtherCarPositions(this.positionsSessionUid, this.positionChunkStart, Float32Array.from(this.positionRows));
    }
    this.positionRows = [];
  }

  private snapshot(): ServerMessage[] {
    const now = Date.now();
    const ctx = this.live.context();
    const messages: ServerMessage[] = [
      { type: 'hello', urls: this.info.urls, udpPort: this.info.udpPort, version: this.info.version },
      { type: 'status', feed: this.live.feedStatus(now, this.forwarder.labels), session: this.live.sessionInfo() },
      { type: 'reference', reference: this.reference.info },
      {
        type: 'currentLine',
        lapNum: this.recorder.currentLapNum,
        points: pathFromSamples(this.recorder.currentSamples, CURRENT_LINE_STEP_METRES),
      },
    ];
    if (ctx) messages.push({ type: 'trackMap', trackId: ctx.trackId, points: this.maps.get(ctx.trackId) });
    const car = this.live.carInfo();
    if (car) messages.push({ type: 'car', car });
    const timing = this.timing();
    if (timing) messages.push({ type: 'timing', timing });
    return messages;
  }

  private sendStatus(): void {
    this.send({
      type: 'status',
      feed: this.live.feedStatus(Date.now(), this.forwarder.labels),
      session: this.live.sessionInfo(),
    });
  }

  private sendCar(): void {
    const car = this.live.carInfo();
    if (car) this.send({ type: 'car', car }, true);
  }

  private sendTiming(): void {
    const timing = this.timing();
    if (timing) this.send({ type: 'timing', timing }, true);
  }

  private timing(): TimingInfo | null {
    const ctx = this.live.context();
    const best = ctx ? this.best(ctx) : null;
    return this.live.timing({
      sessionBestMs: best?.sessionBestMs ?? null,
      bestSectors: best?.bestSectors ?? null,
      currentSectors: this.recorder.currentSectors,
      lastSectors: this.lastLapSectors,
      referenceSectors: this.reference.info?.sectorsMs ?? null,
    });
  }

  private send(message: ServerMessage, droppable = false): void {
    this.web?.broadcast(message, droppable);
  }
}

function contextKey(ctx: LapContext | null): string {
  return ctx ? [ctx.sessionUid, ctx.trackId, ctx.generation, ctx.sessionGroup, ctx.conditions].join('|') : '';
}
