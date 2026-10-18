// Packet encoder: the exact mirror of parse.ts. The demo feed uses it to impersonate
// the game, and the tests use it to prove every layout adds up to the published size.

import { MAX_CARS, PACKET_SIZES, PacketId, type UdpFormat } from '../../shared/f1.ts';
import { Writer } from './reader.ts';
import type {
  CarDamage,
  CarLap,
  CarMotion,
  CarStatus,
  CarTelemetry,
  CarTelemetry2,
  LapHistory,
  PacketHeader,
  Participant,
  SessionData,
} from './types.ts';

export type HeaderInput = Pick<PacketHeader, 'sessionUid' | 'sessionTime' | 'frame' | 'overallFrame' | 'playerCarIndex'>;

function begin(format: UdpFormat, packetId: number, h: HeaderInput): Writer {
  const size = PACKET_SIZES[format][packetId];
  if (size === undefined) throw new Error(`No size for packet ${packetId} in format ${format}`);
  const w = new Writer(size);
  w.u16(format);
  w.u8(format % 100);
  w.u8(1);
  w.u8(format === 2026 ? 25 : 10);
  w.u8(1);
  w.u8(packetId);
  w.u64(BigInt(h.sessionUid));
  w.f32(h.sessionTime);
  w.u32(h.frame);
  w.u32(h.overallFrame);
  w.u8(h.playerCarIndex);
  w.u8(255);
  return w;
}

function finish(w: Writer, packetId: number): Uint8Array {
  if (w.offset !== w.bytes.byteLength) {
    throw new Error(`Packet ${packetId} layout wrote ${w.offset} bytes, spec says ${w.bytes.byteLength}`);
  }
  return w.bytes;
}

function eachCar<T>(format: UdpFormat, cars: T[], blank: T, write: (car: T) => void): void {
  for (let i = 0; i < MAX_CARS[format]; i++) write(cars[i] ?? blank);
}

function writeSplit(w: Writer, ms: number): void {
  const minutes = Math.floor(ms / 60_000);
  w.u16(ms - minutes * 60_000);
  w.u8(minutes);
}

const BLANK_MOTION: CarMotion = { x: 0, y: 0, z: 0, fx: 0, fz: 0, yaw: 0 };

export function encodeMotion(format: UdpFormat, h: HeaderInput, cars: CarMotion[]): Uint8Array {
  const w = begin(format, PacketId.Motion, h);
  eachCar(format, cars, BLANK_MOTION, (c) => {
    w.f32(c.x);
    w.f32(c.y);
    w.f32(c.z);
    w.skip(12);
    w.i16(Math.round(c.fx * 32767));
    w.i16(0);
    w.i16(Math.round(c.fz * 32767));
    w.skip(6);
    w.skip(format === 2026 ? 6 : 12);
    w.f32(c.yaw);
    w.skip(8);
  });
  return finish(w, PacketId.Motion);
}

export function encodeSession(format: UdpFormat, h: HeaderInput, s: SessionData): Uint8Array {
  const w = begin(format, PacketId.Session, h);
  w.u8(s.weather);
  w.i8(s.trackTemperature);
  w.i8(s.airTemperature);
  w.u8(s.totalLaps);
  w.u16(s.trackLength);
  w.u8(s.sessionType);
  w.i8(s.trackId);
  w.u8(s.formula);
  w.u16(s.sessionTimeLeft);
  w.u16(s.sessionDuration);
  w.skip(5);
  w.skip(1 + 21 * 5);
  w.u8(s.safetyCarStatus);
  w.u8(s.networkGame);
  w.skip(1 + 64 * 8);
  w.skip(2 + 12 + 3 + 9);
  w.u8(s.gameMode);
  w.u8(s.ruleSet);
  w.skip(4 + 1 + 4 + 3 + 24 + 1 + 12); // time of day .. weekend structure
  w.f32(s.sector2LapDistanceStart);
  w.f32(s.sector3LapDistanceStart);
  if (format === 2026) w.skip(1 + 1 + 64 + 1 + 64 + 1 + 32 + 4 + 5); // active aero, DRS zones, assists
  return finish(w, PacketId.Session);
}

export const BLANK_LAP: CarLap = {
  lastLapTimeMs: 0,
  currentLapTimeMs: 0,
  sector1TimeMs: 0,
  sector2TimeMs: 0,
  deltaToCarInFrontMs: 0,
  deltaToRaceLeaderMs: 0,
  lapDistance: 0,
  totalDistance: 0,
  carPosition: 0,
  currentLapNum: 0,
  pitStatus: 0,
  numPitStops: 0,
  sector: 0,
  currentLapInvalid: false,
  penaltiesSec: 0,
  totalWarnings: 0,
  cornerCuttingWarnings: 0,
  gridPosition: 0,
  driverStatus: 0,
  resultStatus: 0,
};

export function encodeLapData(format: UdpFormat, h: HeaderInput, cars: CarLap[]): Uint8Array {
  const w = begin(format, PacketId.LapData, h);
  eachCar(format, cars, BLANK_LAP, (c) => {
    w.u32(c.lastLapTimeMs);
    w.u32(c.currentLapTimeMs);
    writeSplit(w, c.sector1TimeMs);
    writeSplit(w, c.sector2TimeMs);
    writeSplit(w, c.deltaToCarInFrontMs);
    writeSplit(w, c.deltaToRaceLeaderMs);
    w.f32(c.lapDistance);
    w.f32(c.totalDistance);
    w.f32(0);
    w.u8(c.carPosition);
    w.u8(c.currentLapNum);
    w.u8(c.pitStatus);
    w.u8(c.numPitStops);
    w.u8(c.sector);
    w.u8(c.currentLapInvalid ? 1 : 0);
    w.u8(c.penaltiesSec);
    w.u8(c.totalWarnings);
    w.u8(c.cornerCuttingWarnings);
    w.skip(2);
    w.u8(c.gridPosition);
    w.u8(c.driverStatus);
    w.u8(c.resultStatus);
    w.skip(1 + 2 + 2 + 1 + 4);
    w.u8(255);
  });
  w.u8(255);
  w.u8(255);
  return finish(w, PacketId.LapData);
}

export function encodeEvent(
  format: UdpFormat,
  h: HeaderInput,
  code: string,
  flashback?: { frame: number; sessionTime: number },
): Uint8Array {
  const w = begin(format, PacketId.Event, h);
  for (let i = 0; i < 4; i++) w.u8(code.charCodeAt(i));
  if (flashback) {
    w.u32(flashback.frame);
    w.f32(flashback.sessionTime);
  }
  w.offset = w.bytes.byteLength;
  return finish(w, PacketId.Event);
}

const BLANK_PARTICIPANT: Participant = {
  aiControlled: true,
  driverId: 0,
  networkId: 0,
  teamId: 0,
  myTeam: false,
  raceNumber: 0,
  nationality: 0,
  name: '',
  yourTelemetry: 0,
  platform: 255,
  colours: [],
};

export function encodeParticipants(format: UdpFormat, h: HeaderInput, participants: Participant[]): Uint8Array {
  const w = begin(format, PacketId.Participants, h);
  w.u8(participants.length);
  const wide = format === 2026;
  eachCar(format, participants, BLANK_PARTICIPANT, (p) => {
    w.u8(p.aiControlled ? 1 : 0);
    if (wide) {
      w.u16(p.driverId);
      w.u16(p.networkId);
      w.u16(p.teamId);
    } else {
      w.u8(p.driverId);
      w.u8(p.networkId);
      w.u8(p.teamId);
    }
    w.u8(p.myTeam ? 1 : 0);
    w.u8(p.raceNumber);
    w.u8(p.nationality);
    w.str(p.name, 32);
    w.u8(p.yourTelemetry);
    w.u8(0);
    w.u16(0);
    w.u8(p.platform);
    w.u8(p.colours.length);
    for (let i = 0; i < 4; i++) {
      const hex = p.colours[i] ?? '#000000';
      w.u8(parseInt(hex.slice(1, 3), 16));
      w.u8(parseInt(hex.slice(3, 5), 16));
      w.u8(parseInt(hex.slice(5, 7), 16));
    }
  });
  return finish(w, PacketId.Participants);
}

export const BLANK_TELEMETRY: CarTelemetry = {
  speed: 0,
  throttle: 0,
  steer: 0,
  brake: 0,
  clutch: 0,
  gear: 0,
  engineRpm: 0,
  drs: false,
  revLightsPercent: 0,
  brakesTemperature: [0, 0, 0, 0],
  tyresSurfaceTemperature: [0, 0, 0, 0],
  tyresInnerTemperature: [0, 0, 0, 0],
  engineTemperature: 0,
  tyresPressure: [0, 0, 0, 0],
  surfaceType: [0, 0, 0, 0],
};

export function encodeCarTelemetry(format: UdpFormat, h: HeaderInput, cars: CarTelemetry[]): Uint8Array {
  const w = begin(format, PacketId.CarTelemetry, h);
  eachCar(format, cars, BLANK_TELEMETRY, (c) => {
    w.u16(c.speed);
    w.f32(c.throttle);
    w.f32(c.steer);
    w.f32(c.brake);
    w.u8(c.clutch);
    w.i8(c.gear);
    w.u16(c.engineRpm);
    w.u8(c.drs ? 1 : 0);
    w.u8(c.revLightsPercent);
    w.u16(0);
    for (const v of c.brakesTemperature) w.u16(v);
    for (const v of c.tyresSurfaceTemperature) w.u8(v);
    for (const v of c.tyresInnerTemperature) w.u8(v);
    if (format === 2026) w.u8(c.engineTemperature);
    else w.u16(c.engineTemperature);
    for (const v of c.tyresPressure) w.f32(v);
    for (const v of c.surfaceType) w.u8(v);
  });
  w.u8(255);
  w.u8(255);
  w.i8(0);
  return finish(w, PacketId.CarTelemetry);
}

export const BLANK_STATUS: CarStatus = {
  tractionControl: 0,
  antiLockBrakes: 0,
  fuelMix: 1,
  frontBrakeBias: 50,
  pitLimiter: false,
  fuelInTank: 0,
  fuelCapacity: 110,
  fuelRemainingLaps: 0,
  maxRpm: 13000,
  idleRpm: 4000,
  maxGears: 8,
  drsAllowed: false,
  drsActivationDistance: 0,
  actualTyreCompound: 18,
  visualTyreCompound: 17,
  tyresAgeLaps: 0,
  vehicleFiaFlags: 0,
  ersStoreEnergy: 0,
  ersDeployMode: 1,
  ersHarvestedThisLapMguk: 0,
  ersHarvestedThisLapMguh: 0,
  ersHarvestLimitPerLap: 0,
  ersDeployedThisLap: 0,
};

export function encodeCarStatus(format: UdpFormat, h: HeaderInput, cars: CarStatus[]): Uint8Array {
  const w = begin(format, PacketId.CarStatus, h);
  eachCar(format, cars, BLANK_STATUS, (c) => {
    w.u8(c.tractionControl);
    w.u8(c.antiLockBrakes);
    w.u8(c.fuelMix);
    w.u8(c.frontBrakeBias);
    w.u8(c.pitLimiter ? 1 : 0);
    w.f32(c.fuelInTank);
    w.f32(c.fuelCapacity);
    w.f32(c.fuelRemainingLaps);
    w.u16(c.maxRpm);
    w.u16(c.idleRpm);
    w.u8(c.maxGears);
    w.u8(c.drsAllowed ? 1 : 0);
    w.u16(c.drsActivationDistance);
    w.u8(c.actualTyreCompound);
    w.u8(c.visualTyreCompound);
    w.u8(c.tyresAgeLaps);
    w.i8(c.vehicleFiaFlags);
    w.f32(0);
    w.f32(0);
    w.f32(c.ersStoreEnergy);
    w.u8(c.ersDeployMode);
    w.f32(c.ersHarvestedThisLapMguk);
    w.f32(c.ersHarvestedThisLapMguh);
    if (format === 2026) w.f32(c.ersHarvestLimitPerLap);
    w.f32(c.ersDeployedThisLap);
    w.u8(0);
  });
  return finish(w, PacketId.CarStatus);
}

export const BLANK_DAMAGE: CarDamage = {
  tyresWear: [0, 0, 0, 0],
  tyresDamage: [0, 0, 0, 0],
  brakesDamage: [0, 0, 0, 0],
  tyreBlisters: [0, 0, 0, 0],
  frontLeftWingDamage: 0,
  frontRightWingDamage: 0,
  rearWingDamage: 0,
  floorDamage: 0,
  diffuserDamage: 0,
  sidepodDamage: 0,
  drsFault: false,
  ersFault: false,
  gearBoxDamage: 0,
  engineDamage: 0,
};

export function encodeCarDamage(format: UdpFormat, h: HeaderInput, cars: CarDamage[]): Uint8Array {
  const w = begin(format, PacketId.CarDamage, h);
  eachCar(format, cars, BLANK_DAMAGE, (c) => {
    for (const v of c.tyresWear) w.f32(v);
    for (const v of c.tyresDamage) w.u8(v);
    for (const v of c.brakesDamage) w.u8(v);
    for (const v of c.tyreBlisters) w.u8(v);
    w.u8(c.frontLeftWingDamage);
    w.u8(c.frontRightWingDamage);
    w.u8(c.rearWingDamage);
    w.u8(c.floorDamage);
    w.u8(c.diffuserDamage);
    w.u8(c.sidepodDamage);
    w.u8(c.drsFault ? 1 : 0);
    w.u8(c.ersFault ? 1 : 0);
    w.u8(c.gearBoxDamage);
    w.u8(c.engineDamage);
    w.skip(8);
  });
  return finish(w, PacketId.CarDamage);
}

export function encodeSessionHistory(format: UdpFormat, h: HeaderInput, carIdx: number, laps: LapHistory[]): Uint8Array {
  const w = begin(format, PacketId.SessionHistory, h);
  w.u8(carIdx);
  w.u8(laps.length);
  w.skip(5);
  for (let i = 0; i < 100; i++) {
    const lap = laps[i];
    w.u32(lap?.lapTimeMs ?? 0);
    writeSplit(w, lap?.sector1Ms ?? 0);
    writeSplit(w, lap?.sector2Ms ?? 0);
    writeSplit(w, lap?.sector3Ms ?? 0);
    w.u8(lap?.validFlags ?? 0);
  }
  w.skip(8 * 3);
  return finish(w, PacketId.SessionHistory);
}

const BLANK_TELEMETRY2: CarTelemetry2 = {
  activeAeroMode: 0,
  activeAeroAvailable: false,
  overtakeAvailable: false,
  overtakeActive: false,
  regulations2026: false,
  drivingWrongWay: false,
};

export function encodeCarTelemetry2(h: HeaderInput, cars: CarTelemetry2[]): Uint8Array {
  const w = begin(2026, PacketId.CarTelemetry2, h);
  eachCar(2026, cars, BLANK_TELEMETRY2, (c) => {
    w.u8(c.activeAeroMode);
    w.u8(c.activeAeroAvailable ? 1 : 0);
    w.u16(0);
    w.u8(c.overtakeAvailable ? 1 : 0);
    w.u8(c.overtakeActive ? 1 : 0);
    w.u16(0);
    w.u8(c.regulations2026 ? 1 : 0);
    w.u8(c.drivingWrongWay ? 1 : 0);
  });
  return finish(w, PacketId.CarTelemetry2);
}
