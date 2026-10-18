import type { UdpFormat } from '../../shared/f1.ts';

export interface PacketHeader {
  format: UdpFormat;
  gameYear: number;
  gameMajorVersion: number;
  gameMinorVersion: number;
  packetVersion: number;
  packetId: number;
  sessionUid: string;
  sessionTime: number;
  frame: number;
  overallFrame: number;
  playerCarIndex: number;
  secondaryPlayerCarIndex: number;
}

export interface CarMotion {
  x: number;
  y: number;
  z: number;
  /** Forward direction in the world X/Z plane, normalised. */
  fx: number;
  fz: number;
  yaw: number;
}

export interface SessionData {
  weather: number;
  trackTemperature: number;
  airTemperature: number;
  totalLaps: number;
  trackLength: number;
  sessionType: number;
  trackId: number;
  formula: number;
  sessionTimeLeft: number;
  sessionDuration: number;
  safetyCarStatus: number;
  networkGame: number;
  gameMode: number;
  ruleSet: number;
  sector2LapDistanceStart: number;
  sector3LapDistanceStart: number;
}

export interface CarLap {
  lastLapTimeMs: number;
  currentLapTimeMs: number;
  sector1TimeMs: number;
  sector2TimeMs: number;
  deltaToCarInFrontMs: number;
  deltaToRaceLeaderMs: number;
  lapDistance: number;
  totalDistance: number;
  carPosition: number;
  currentLapNum: number;
  /** 0 = none, 1 = pitting, 2 = in pit area */
  pitStatus: number;
  numPitStops: number;
  /** 0, 1 or 2 */
  sector: number;
  currentLapInvalid: boolean;
  penaltiesSec: number;
  totalWarnings: number;
  cornerCuttingWarnings: number;
  gridPosition: number;
  /** 0 = in garage, 1 = flying lap, 2 = in lap, 3 = out lap, 4 = on track */
  driverStatus: number;
  /** 0 = invalid, 1 = inactive, 2 = active, 3 = finished, 4 = dnf, 5 = dsq, 6 = not classified, 7 = retired */
  resultStatus: number;
}

export interface EventData {
  code: string;
  /** Present for FLBK. */
  flashback?: { frame: number; sessionTime: number };
}

export interface Participant {
  aiControlled: boolean;
  driverId: number;
  networkId: number;
  teamId: number;
  myTeam: boolean;
  raceNumber: number;
  nationality: number;
  name: string;
  yourTelemetry: number;
  platform: number;
  colours: string[];
}

export interface CarTelemetry {
  speed: number;
  throttle: number;
  steer: number;
  brake: number;
  clutch: number;
  gear: number;
  engineRpm: number;
  drs: boolean;
  revLightsPercent: number;
  brakesTemperature: number[];
  tyresSurfaceTemperature: number[];
  tyresInnerTemperature: number[];
  engineTemperature: number;
  tyresPressure: number[];
  surfaceType: number[];
}

export interface CarStatus {
  tractionControl: number;
  antiLockBrakes: number;
  fuelMix: number;
  frontBrakeBias: number;
  pitLimiter: boolean;
  fuelInTank: number;
  fuelCapacity: number;
  fuelRemainingLaps: number;
  maxRpm: number;
  idleRpm: number;
  maxGears: number;
  drsAllowed: boolean;
  drsActivationDistance: number;
  actualTyreCompound: number;
  visualTyreCompound: number;
  tyresAgeLaps: number;
  vehicleFiaFlags: number;
  ersStoreEnergy: number;
  ersDeployMode: number;
  ersHarvestedThisLapMguk: number;
  ersHarvestedThisLapMguh: number;
  /** Only in the 2026 format; 0 otherwise. */
  ersHarvestLimitPerLap: number;
  ersDeployedThisLap: number;
}

export interface CarDamage {
  tyresWear: number[];
  tyresDamage: number[];
  brakesDamage: number[];
  tyreBlisters: number[];
  frontLeftWingDamage: number;
  frontRightWingDamage: number;
  rearWingDamage: number;
  floorDamage: number;
  diffuserDamage: number;
  sidepodDamage: number;
  drsFault: boolean;
  ersFault: boolean;
  gearBoxDamage: number;
  engineDamage: number;
}

export interface LapHistory {
  lapTimeMs: number;
  sector1Ms: number;
  sector2Ms: number;
  sector3Ms: number;
  /** bit 0 lap valid, bits 1-3 sector 1-3 valid */
  validFlags: number;
}

export interface SessionHistory {
  carIdx: number;
  numLaps: number;
  laps: LapHistory[];
}

export interface CarTelemetry2 {
  activeAeroMode: number;
  activeAeroAvailable: boolean;
  overtakeAvailable: boolean;
  overtakeActive: boolean;
  regulations2026: boolean;
  drivingWrongWay: boolean;
}

export type Packet =
  | { kind: 'motion'; header: PacketHeader; cars: CarMotion[] }
  | { kind: 'session'; header: PacketHeader; session: SessionData }
  | { kind: 'lapData'; header: PacketHeader; cars: CarLap[] }
  | { kind: 'event'; header: PacketHeader; event: EventData }
  | { kind: 'participants'; header: PacketHeader; numActiveCars: number; participants: Participant[] }
  | { kind: 'carTelemetry'; header: PacketHeader; cars: CarTelemetry[] }
  | { kind: 'carStatus'; header: PacketHeader; cars: CarStatus[] }
  | { kind: 'carDamage'; header: PacketHeader; cars: CarDamage[] }
  | { kind: 'sessionHistory'; header: PacketHeader; history: SessionHistory }
  | { kind: 'carTelemetry2'; header: PacketHeader; cars: CarTelemetry2[] };

export type PacketKind = Packet['kind'];
