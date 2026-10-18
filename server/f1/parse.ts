import { HEADER_SIZE, MAX_CARS, PACKET_SIZES, PacketId, SUPPORTED_FORMATS, type UdpFormat } from '../../shared/f1.ts';
import { Reader } from './reader.ts';
import type {
  CarDamage,
  CarLap,
  CarMotion,
  CarStatus,
  CarTelemetry,
  CarTelemetry2,
  EventData,
  LapHistory,
  Packet,
  PacketHeader,
  Participant,
  SessionData,
} from './types.ts';

export type ParseResult =
  | { ok: true; packet: Packet }
  | { ok: false; reason: 'too-short' | 'unsupported-format' | 'bad-size' | 'not-used'; format?: number; packetId?: number };

export function parsePacket(bytes: Uint8Array): ParseResult {
  if (bytes.byteLength < HEADER_SIZE) return { ok: false, reason: 'too-short' };
  const r = new Reader(bytes);
  const format = r.u16();
  if (!SUPPORTED_FORMATS.includes(format as UdpFormat)) {
    return { ok: false, reason: 'unsupported-format', format };
  }
  r.offset = 0;
  const header = readHeader(r);
  const expected = PACKET_SIZES[header.format][header.packetId];
  if (expected !== undefined && expected !== bytes.byteLength) {
    return { ok: false, reason: 'bad-size', format, packetId: header.packetId };
  }

  const cars = MAX_CARS[header.format];
  switch (header.packetId) {
    case PacketId.Motion:
      return ok({ kind: 'motion', header, cars: times(cars, () => readMotion(r, header.format)) });
    case PacketId.Session:
      return ok({ kind: 'session', header, session: readSession(r) });
    case PacketId.LapData:
      return ok({ kind: 'lapData', header, cars: times(cars, () => readLap(r)) });
    case PacketId.Event:
      return ok({ kind: 'event', header, event: readEvent(r) });
    case PacketId.Participants: {
      const numActiveCars = r.u8();
      const participants = times(cars, () => readParticipant(r, header.format));
      return ok({ kind: 'participants', header, numActiveCars, participants });
    }
    case PacketId.CarTelemetry:
      return ok({ kind: 'carTelemetry', header, cars: times(cars, () => readTelemetry(r, header.format)) });
    case PacketId.CarStatus:
      return ok({ kind: 'carStatus', header, cars: times(cars, () => readStatus(r, header.format)) });
    case PacketId.CarDamage:
      return ok({ kind: 'carDamage', header, cars: times(cars, () => readDamage(r)) });
    case PacketId.SessionHistory:
      return ok({ kind: 'sessionHistory', header, history: readSessionHistory(r) });
    case PacketId.CarTelemetry2:
      return ok({ kind: 'carTelemetry2', header, cars: times(cars, () => readTelemetry2(r)) });
    default:
      return { ok: false, reason: 'not-used', format, packetId: header.packetId };
  }
}

function ok(packet: Packet): ParseResult {
  return { ok: true, packet };
}

function times<T>(count: number, read: () => T): T[] {
  const out = new Array<T>(count);
  for (let i = 0; i < count; i++) out[i] = read();
  return out;
}

export function readHeader(r: Reader): PacketHeader {
  return {
    format: r.u16() as UdpFormat,
    gameYear: r.u8(),
    gameMajorVersion: r.u8(),
    gameMinorVersion: r.u8(),
    packetVersion: r.u8(),
    packetId: r.u8(),
    sessionUid: r.u64().toString(),
    sessionTime: r.f32(),
    frame: r.u32(),
    overallFrame: r.u32(),
    playerCarIndex: r.u8(),
    secondaryPlayerCarIndex: r.u8(),
  };
}

function readMotion(r: Reader, format: UdpFormat): CarMotion {
  const x = r.f32();
  const y = r.f32();
  const z = r.f32();
  r.skip(12); // world velocity
  const fx = r.i16() / 32767;
  r.skip(2); // forward Y
  const fz = r.i16() / 32767;
  r.skip(6); // right direction vector
  r.skip(format === 2026 ? 6 : 12); // g-forces: int16 quantised in 2026, float before
  const yaw = r.f32();
  r.skip(8); // pitch, roll
  return { x, y, z, fx, fz, yaw };
}

/** Offset of m_sector2LapDistanceStart, identical in both formats. */
const SESSION_SECTOR2_OFFSET = 745;

function readSession(r: Reader): SessionData {
  const weather = r.u8();
  const trackTemperature = r.i8();
  const airTemperature = r.i8();
  const totalLaps = r.u8();
  const trackLength = r.u16();
  const sessionType = r.u8();
  const trackId = r.i8();
  const formula = r.u8();
  const sessionTimeLeft = r.u16();
  const sessionDuration = r.u16();
  r.skip(5); // pit speed limit, paused, spectating, spectator index, SLI Pro
  r.skip(1 + 21 * 5); // marshal zones
  const safetyCarStatus = r.u8();
  const networkGame = r.u8();
  r.skip(1 + 64 * 8); // weather forecast samples
  r.skip(2 + 12 + 3 + 9); // forecast accuracy, AI difficulty, link ids, pit window, assists
  const gameMode = r.u8();
  const ruleSet = r.u8();
  r.offset = SESSION_SECTOR2_OFFSET;
  const sector2LapDistanceStart = r.f32();
  const sector3LapDistanceStart = r.f32();
  return {
    weather,
    trackTemperature,
    airTemperature,
    totalLaps,
    trackLength,
    sessionType,
    trackId,
    formula,
    sessionTimeLeft,
    sessionDuration,
    safetyCarStatus,
    networkGame,
    gameMode,
    ruleSet,
    sector2LapDistanceStart,
    sector3LapDistanceStart,
  };
}

function readSplit(r: Reader): number {
  const ms = r.u16();
  const minutes = r.u8();
  return minutes * 60_000 + ms;
}

function readLap(r: Reader): CarLap {
  const lastLapTimeMs = r.u32();
  const currentLapTimeMs = r.u32();
  const sector1TimeMs = readSplit(r);
  const sector2TimeMs = readSplit(r);
  const deltaToCarInFrontMs = readSplit(r);
  const deltaToRaceLeaderMs = readSplit(r);
  const lapDistance = r.f32();
  const totalDistance = r.f32();
  r.skip(4); // safety car delta
  const carPosition = r.u8();
  const currentLapNum = r.u8();
  const pitStatus = r.u8();
  const numPitStops = r.u8();
  const sector = r.u8();
  const currentLapInvalid = r.u8() === 1;
  const penaltiesSec = r.u8();
  const totalWarnings = r.u8();
  const cornerCuttingWarnings = r.u8();
  r.skip(2); // unserved drive-through and stop-go penalties
  const gridPosition = r.u8();
  const driverStatus = r.u8();
  const resultStatus = r.u8();
  r.skip(1 + 2 + 2 + 1 + 4 + 1); // pit lane timers, penalty flag, speed trap
  return {
    lastLapTimeMs,
    currentLapTimeMs,
    sector1TimeMs,
    sector2TimeMs,
    deltaToCarInFrontMs,
    deltaToRaceLeaderMs,
    lapDistance,
    totalDistance,
    carPosition,
    currentLapNum,
    pitStatus,
    numPitStops,
    sector,
    currentLapInvalid,
    penaltiesSec,
    totalWarnings,
    cornerCuttingWarnings,
    gridPosition,
    driverStatus,
    resultStatus,
  };
}

function readEvent(r: Reader): EventData {
  const code = String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8());
  if (code === 'FLBK') {
    return { code, flashback: { frame: r.u32(), sessionTime: r.f32() } };
  }
  return { code };
}

function readParticipant(r: Reader, format: UdpFormat): Participant {
  const wide = format === 2026; // driver, network and team ids became uint16
  const aiControlled = r.u8() === 1;
  const driverId = wide ? r.u16() : r.u8();
  const networkId = wide ? r.u16() : r.u8();
  const teamId = wide ? r.u16() : r.u8();
  const myTeam = r.u8() === 1;
  const raceNumber = r.u8();
  const nationality = r.u8();
  const name = r.str(32);
  const yourTelemetry = r.u8();
  r.skip(1); // show online names
  r.skip(2); // tech level
  const platform = r.u8();
  const numColours = r.u8();
  const colours: string[] = [];
  for (let i = 0; i < 4; i++) {
    const rgb = [r.u8(), r.u8(), r.u8()];
    if (i < numColours) colours.push(`#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`);
  }
  return { aiControlled, driverId, networkId, teamId, myTeam, raceNumber, nationality, name, yourTelemetry, platform, colours };
}

function readTelemetry(r: Reader, format: UdpFormat): CarTelemetry {
  const speed = r.u16();
  const throttle = r.f32();
  const steer = r.f32();
  const brake = r.f32();
  const clutch = r.u8();
  const gear = r.i8();
  const engineRpm = r.u16();
  const drs = r.u8() === 1;
  const revLightsPercent = r.u8();
  r.skip(2); // rev lights bit value
  const brakesTemperature = r.u16s(4);
  const tyresSurfaceTemperature = r.u8s(4);
  const tyresInnerTemperature = r.u8s(4);
  const engineTemperature = format === 2026 ? r.u8() : r.u16();
  const tyresPressure = r.f32s(4);
  const surfaceType = r.u8s(4);
  return {
    speed,
    throttle,
    steer,
    brake,
    clutch,
    gear,
    engineRpm,
    drs,
    revLightsPercent,
    brakesTemperature,
    tyresSurfaceTemperature,
    tyresInnerTemperature,
    engineTemperature,
    tyresPressure,
    surfaceType,
  };
}

function readStatus(r: Reader, format: UdpFormat): CarStatus {
  const tractionControl = r.u8();
  const antiLockBrakes = r.u8();
  const fuelMix = r.u8();
  const frontBrakeBias = r.u8();
  const pitLimiter = r.u8() === 1;
  const fuelInTank = r.f32();
  const fuelCapacity = r.f32();
  const fuelRemainingLaps = r.f32();
  const maxRpm = r.u16();
  const idleRpm = r.u16();
  const maxGears = r.u8();
  const drsAllowed = r.u8() === 1;
  const drsActivationDistance = r.u16();
  const actualTyreCompound = r.u8();
  const visualTyreCompound = r.u8();
  const tyresAgeLaps = r.u8();
  const vehicleFiaFlags = r.i8();
  r.skip(8); // ICE and MGU-K power
  const ersStoreEnergy = r.f32();
  const ersDeployMode = r.u8();
  const ersHarvestedThisLapMguk = r.f32();
  const ersHarvestedThisLapMguh = r.f32();
  const ersHarvestLimitPerLap = format === 2026 ? r.f32() : 0;
  const ersDeployedThisLap = r.f32();
  r.skip(1); // network paused
  return {
    tractionControl,
    antiLockBrakes,
    fuelMix,
    frontBrakeBias,
    pitLimiter,
    fuelInTank,
    fuelCapacity,
    fuelRemainingLaps,
    maxRpm,
    idleRpm,
    maxGears,
    drsAllowed,
    drsActivationDistance,
    actualTyreCompound,
    visualTyreCompound,
    tyresAgeLaps,
    vehicleFiaFlags,
    ersStoreEnergy,
    ersDeployMode,
    ersHarvestedThisLapMguk,
    ersHarvestedThisLapMguh,
    ersHarvestLimitPerLap,
    ersDeployedThisLap,
  };
}

function readDamage(r: Reader): CarDamage {
  const tyresWear = r.f32s(4);
  const tyresDamage = r.u8s(4);
  const brakesDamage = r.u8s(4);
  const tyreBlisters = r.u8s(4);
  const frontLeftWingDamage = r.u8();
  const frontRightWingDamage = r.u8();
  const rearWingDamage = r.u8();
  const floorDamage = r.u8();
  const diffuserDamage = r.u8();
  const sidepodDamage = r.u8();
  const drsFault = r.u8() === 1;
  const ersFault = r.u8() === 1;
  const gearBoxDamage = r.u8();
  const engineDamage = r.u8();
  r.skip(8); // engine component wear, blown, seized
  return {
    tyresWear,
    tyresDamage,
    brakesDamage,
    tyreBlisters,
    frontLeftWingDamage,
    frontRightWingDamage,
    rearWingDamage,
    floorDamage,
    diffuserDamage,
    sidepodDamage,
    drsFault,
    ersFault,
    gearBoxDamage,
    engineDamage,
  };
}

function readSessionHistory(r: Reader) {
  const carIdx = r.u8();
  const numLaps = r.u8();
  r.skip(5); // tyre stint count, best lap and best sector lap numbers
  const laps: LapHistory[] = [];
  for (let i = 0; i < 100; i++) {
    const lap: LapHistory = {
      lapTimeMs: r.u32(),
      sector1Ms: readSplit(r),
      sector2Ms: readSplit(r),
      sector3Ms: readSplit(r),
      validFlags: r.u8(),
    };
    if (i < numLaps) laps.push(lap);
  }
  return { carIdx, numLaps, laps };
}

function readTelemetry2(r: Reader): CarTelemetry2 {
  const activeAeroMode = r.u8();
  const activeAeroAvailable = r.u8() === 1;
  r.skip(2); // active aero activation distance
  const overtakeAvailable = r.u8() === 1;
  const overtakeActive = r.u8() === 1;
  r.skip(2); // overtake activation distance
  const regulations2026 = r.u8() === 1;
  const drivingWrongWay = r.u8() === 1;
  return { activeAeroMode, activeAeroAvailable, overtakeAvailable, overtakeActive, regulations2026, drivingWrongWay };
}
