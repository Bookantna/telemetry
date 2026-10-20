// Messages the PC program streams to the Live Dashboard over the WebSocket.
// Terms follow CONTEXT.md: Recorded Lap, Reference Lap, Delta, Gap, Track Map, Driving Line.

import type { CarGeneration, Conditions, SessionGroup, UdpFormat } from './f1.ts';

export interface LapSummary {
  id: number;
  sessionUid: string;
  trackId: number;
  trackName: string;
  sessionType: number;
  sessionGroup: SessionGroup;
  generation: CarGeneration;
  conditions: Conditions;
  lapNum: number;
  /** Null for an Incomplete Lap. */
  lapTimeMs: number | null;
  sectorsMs: [number | null, number | null, number | null];
  valid: boolean;
  complete: boolean;
  outLap: boolean;
  inLap: boolean;
  visualCompound: number;
  recordedAt: string;
  /** True when this lap is the Best Lap for its combination. */
  isBest: boolean;
}

/** The sample channels Lap Replay needs (server/record/samples.ts). */
export const REPLAY_CHANNELS = ['sessionTime', 'lapMs', 'x', 'z', 'speed', 'throttle', 'brake', 'gear'] as const;

/** One Recorded Lap for Lap Replay: its 60 Hz samples, one array per channel. */
export interface LapReplay {
  lap: LapSummary;
  /** The circuit's Track Map, when one has been drawn. */
  trackMap: number[] | null;
  samples: Record<(typeof REPLAY_CHANNELS)[number], number[]>;
}

export interface FeedStatus {
  receiving: boolean;
  format: UdpFormat | null;
  /** Set when the game sends a UDP Format this app cannot read (2023/2024). */
  unsupportedFormat: number | null;
  packetsPerSecond: number;
  forwardingTo: string[];
}

export interface SessionInfo {
  uid: string;
  trackId: number;
  trackName: string;
  trackLength: number;
  sessionType: number;
  sessionTypeName: string;
  group: SessionGroup;
  totalLaps: number;
  weather: number;
  trackTemperature: number;
  airTemperature: number;
  generation: CarGeneration;
  conditions: Conditions;
  sector2Start: number;
  sector3Start: number;
  safetyCarStatus: number;
}

/** Sent once per game frame. Short keys keep 60 Hz traffic small. */
export interface LiveFrame {
  t: number;
  lapNum: number;
  lapMs: number;
  dist: number;
  sector: number;
  invalid: boolean;
  pit: boolean;
  /** Delta in seconds against the Reference Lap; null when there is none. */
  delta: number | null;
  predictedMs: number | null;
  thr: number;
  brk: number;
  steer: number;
  speed: number;
  gear: number;
  rpm: number;
  revPct: number;
  drs: boolean;
  x: number;
  z: number;
  /** Direction of travel in the world X/Z plane, radians: atan2(forward z, forward x). */
  heading: number;
  /** Other cars, flat: [carIdx, x, z, carIdx, x, z, ...] */
  cars: number[];
}

export interface CarInfo {
  /** Wheel order everywhere: rear-left, rear-right, front-left, front-right. */
  tyreSurface: number[];
  tyreInner: number[];
  tyreWear: number[];
  tyrePressure: number[];
  tyreBlisters: number[];
  tyreDamage: number[];
  brakeTemp: number[];
  actualCompound: number;
  visualCompound: number;
  tyreAge: number;
  fuelLaps: number;
  fuelKg: number;
  fuelMix: number;
  ersStorePct: number;
  ersMode: string;
  ersDeployedPct: number;
  ersHarvestedPct: number;
  drsAllowed: boolean;
  drsDistance: number;
  brakeBias: number;
  pitLimiter: boolean;
  damage: {
    frontLeftWing: number;
    frontRightWing: number;
    rearWing: number;
    floor: number;
    diffuser: number;
    sidepod: number;
    gearbox: number;
    engine: number;
    drsFault: boolean;
    ersFault: boolean;
  };
  overtake: { available: boolean; active: boolean } | null;
}

export interface TimingRow {
  idx: number;
  pos: number;
  name: string;
  code: string;
  colour: string;
  gapToLeaderMs: number;
  lastLapMs: number;
  bestLapMs: number | null;
  inPit: boolean;
  visualCompound: number;
  isPlayer: boolean;
}

export interface TimingInfo {
  position: number;
  numCars: number;
  lapNum: number;
  totalLaps: number;
  lastLapMs: number | null;
  sessionBestMs: number | null;
  /** Current lap's finished sectors. */
  currentSectors: [number | null, number | null];
  lastSectors: [number | null, number | null, number | null] | null;
  referenceSectors: [number | null, number | null, number | null] | null;
  /** All-time best sector times for this combination (purple). */
  bestSectors: [number | null, number | null, number | null] | null;
  rows: TimingRow[];
}

export interface ReferenceInfo {
  lapId: number;
  lapTimeMs: number;
  sectorsMs: [number | null, number | null, number | null];
  source: 'all-time' | 'session';
  recordedAt: string;
  /** Driving Line of the Reference Lap, flat [x, z, x, z, ...]. */
  line: number[];
}

export type ServerMessage =
  | { type: 'hello'; urls: string[]; udpPort: number; version: string }
  | { type: 'status'; feed: FeedStatus; session: SessionInfo | null }
  | { type: 'frame'; f: LiveFrame }
  | { type: 'car'; car: CarInfo }
  | { type: 'timing'; timing: TimingInfo }
  | { type: 'trackMap'; trackId: number; points: number[] | null }
  | { type: 'reference'; reference: ReferenceInfo | null }
  /** The current lap's Driving Line so far: sent on connect, at each new lap and after a Flashback. */
  | { type: 'currentLine'; lapNum: number; points: number[] }
  | { type: 'lap'; lap: LapSummary }
  | { type: 'lapRemoved'; id: number };
