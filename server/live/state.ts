// The latest value of everything the game has sent, and the dashboard messages built from it.

import {
  ERS_MAX_JOULES,
  ERS_MODES,
  ERS_MODES_2026,
  SESSION_TYPE_NAMES,
  carGeneration,
  conditionsFor,
  sessionGroup,
  teamColour,
  trackName,
  type UdpFormat,
} from '../../shared/f1.ts';
import type { CarInfo, FeedStatus, LiveFrame, SessionInfo, TimingInfo, TimingRow } from '../../shared/protocol.ts';
import type {
  CarDamage,
  CarLap,
  CarMotion,
  CarStatus,
  CarTelemetry,
  CarTelemetry2,
  Packet,
  Participant,
  SessionData,
} from '../f1/types.ts';
import type { LapContext } from '../record/recorder.ts';

export class LiveState {
  format: UdpFormat | null = null;
  unsupportedFormat: number | null = null;
  sessionUid: string | null = null;
  playerIdx = 0;
  session: SessionData | null = null;
  participants: Participant[] = [];
  numActiveCars = 0;
  laps: CarLap[] = [];
  telemetry: CarTelemetry[] = [];
  status: CarStatus[] = [];
  damage: CarDamage[] = [];
  telemetry2: CarTelemetry2[] = [];
  motion: CarMotion[] = [];
  /** Best lap per car, from the Session History packets. */
  readonly bestLapMsByCar = new Map<number, number>();
  /** Frame id each per-frame packet was last received on. */
  readonly frameOf = { lapData: -1, carTelemetry: -1, motion: -1 };

  private lastPacketAt = 0;
  private packetsThisSecond = 0;
  private packetsPerSecond = 0;
  private secondStartedAt = 0;

  /** Returns true when the packet started a new session. */
  apply(packet: Packet, now: number): boolean {
    this.countPacket(now);
    const { header } = packet;
    this.format = header.format;
    this.unsupportedFormat = null;
    this.playerIdx = header.playerCarIndex;
    let newSession = false;
    if (header.sessionUid !== this.sessionUid) {
      this.resetSession(header.sessionUid);
      newSession = true;
    }

    switch (packet.kind) {
      case 'session':
        this.session = packet.session;
        break;
      case 'participants':
        this.participants = packet.participants;
        this.numActiveCars = packet.numActiveCars;
        break;
      case 'lapData':
        this.laps = packet.cars;
        this.frameOf.lapData = header.frame;
        break;
      case 'carTelemetry':
        this.telemetry = packet.cars;
        this.frameOf.carTelemetry = header.frame;
        break;
      case 'motion':
        this.motion = packet.cars;
        this.frameOf.motion = header.frame;
        break;
      case 'carStatus':
        this.status = packet.cars;
        break;
      case 'carDamage':
        this.damage = packet.cars;
        break;
      case 'carTelemetry2':
        this.telemetry2 = packet.cars;
        break;
      case 'sessionHistory': {
        const best = packet.history.laps
          .filter((l) => l.lapTimeMs > 0 && (l.validFlags & 1) === 1)
          .reduce((min, l) => Math.min(min, l.lapTimeMs), Infinity);
        if (Number.isFinite(best)) this.bestLapMsByCar.set(packet.history.carIdx, best);
        break;
      }
      case 'event':
        break;
    }
    return newSession;
  }

  noteUnsupportedFormat(format: number, now: number): void {
    this.countPacket(now);
    this.unsupportedFormat = format;
  }

  private countPacket(now: number): void {
    this.lastPacketAt = now;
    if (now - this.secondStartedAt >= 1000) {
      this.packetsPerSecond = this.packetsThisSecond;
      this.packetsThisSecond = 0;
      this.secondStartedAt = now;
    }
    this.packetsThisSecond++;
  }

  private resetSession(uid: string): void {
    this.sessionUid = uid;
    this.session = null;
    this.participants = [];
    this.numActiveCars = 0;
    this.laps = [];
    this.telemetry = [];
    this.status = [];
    this.damage = [];
    this.telemetry2 = [];
    this.motion = [];
    this.bestLapMsByCar.clear();
  }

  receiving(now: number): boolean {
    return now - this.lastPacketAt < 2500;
  }

  /** True when lap data, telemetry and motion have all arrived for the same frame. */
  frameComplete(): boolean {
    const f = this.frameOf;
    return f.lapData >= 0 && f.lapData === f.carTelemetry && f.lapData === f.motion;
  }

  /** Driving on track: result status active (2) or finished (3). */
  onTrack(idx: number): boolean {
    const status = this.laps[idx]?.resultStatus ?? 0;
    return status === 2 || status === 3;
  }

  /** In the timing list: any real result status (not invalid or inactive). */
  classified(idx: number): boolean {
    return (this.laps[idx]?.resultStatus ?? 0) >= 2;
  }

  context(): LapContext | null {
    if (!this.session || this.format === null || this.sessionUid === null) return null;
    const status = this.status[this.playerIdx];
    const regs2026 = this.telemetry2[this.playerIdx]?.regulations2026 ?? false;
    return {
      sessionUid: this.sessionUid,
      sessionType: this.session.sessionType,
      sessionGroup: sessionGroup(this.session.sessionType),
      trackId: this.session.trackId,
      generation: carGeneration(this.format, this.session.formula, regs2026),
      conditions: conditionsFor(status?.actualTyreCompound ?? 0),
      udpFormat: this.format,
      actualCompound: status?.actualTyreCompound ?? 0,
      visualCompound: status?.visualTyreCompound ?? 0,
    };
  }

  feedStatus(now: number, forwardingTo: string[]): FeedStatus {
    const receiving = this.receiving(now);
    return {
      receiving,
      format: this.format,
      unsupportedFormat: this.unsupportedFormat,
      packetsPerSecond: receiving ? this.packetsPerSecond : 0,
      forwardingTo,
    };
  }

  sessionInfo(): SessionInfo | null {
    const s = this.session;
    const ctx = this.context();
    if (!s || !ctx || this.sessionUid === null) return null;
    return {
      uid: this.sessionUid,
      trackId: s.trackId,
      trackName: trackName(s.trackId),
      trackLength: s.trackLength,
      sessionType: s.sessionType,
      sessionTypeName: SESSION_TYPE_NAMES[s.sessionType] ?? 'Session',
      group: ctx.sessionGroup,
      totalLaps: s.totalLaps,
      weather: s.weather,
      trackTemperature: s.trackTemperature,
      airTemperature: s.airTemperature,
      generation: ctx.generation,
      conditions: ctx.conditions,
      sector2Start: s.sector2LapDistanceStart,
      sector3Start: s.sector3LapDistanceStart,
      safetyCarStatus: s.safetyCarStatus,
    };
  }

  frame(sessionTime: number, delta: number | null, predictedMs: number | null): LiveFrame | null {
    const i = this.playerIdx;
    const lap = this.laps[i];
    const tel = this.telemetry[i];
    const pos = this.motion[i];
    if (!lap || !tel || !pos) return null;
    const cars: number[] = [];
    this.motion.forEach((m, idx) => {
      if (idx === i || !this.onTrack(idx)) return;
      cars.push(idx, round1(m.x), round1(m.z));
    });
    return {
      t: round3(sessionTime),
      lapNum: lap.currentLapNum,
      lapMs: lap.currentLapTimeMs,
      dist: round1(lap.lapDistance),
      sector: lap.sector,
      invalid: lap.currentLapInvalid,
      pit: lap.pitStatus > 0,
      delta: delta === null ? null : round3(delta),
      predictedMs,
      thr: round3(tel.throttle),
      brk: round3(tel.brake),
      steer: round3(tel.steer),
      speed: tel.speed,
      gear: tel.gear,
      rpm: tel.engineRpm,
      revPct: tel.revLightsPercent,
      drs: tel.drs,
      x: round1(pos.x),
      z: round1(pos.z),
      heading: round3(Math.atan2(pos.fz, pos.fx)),
      cars,
    };
  }

  carInfo(): CarInfo | null {
    const i = this.playerIdx;
    const tel = this.telemetry[i];
    const status = this.status[i];
    if (!tel || !status) return null;
    const damage = this.damage[i];
    const t2 = this.telemetry2[i];
    const ersModes = this.format === 2026 ? ERS_MODES_2026 : ERS_MODES;
    return {
      tyreSurface: tel.tyresSurfaceTemperature,
      tyreInner: tel.tyresInnerTemperature,
      tyreWear: damage?.tyresWear.map(round1) ?? [0, 0, 0, 0],
      tyrePressure: tel.tyresPressure.map(round1),
      tyreBlisters: damage?.tyreBlisters ?? [0, 0, 0, 0],
      tyreDamage: damage?.tyresDamage ?? [0, 0, 0, 0],
      brakeTemp: tel.brakesTemperature,
      actualCompound: status.actualTyreCompound,
      visualCompound: status.visualTyreCompound,
      tyreAge: status.tyresAgeLaps,
      fuelLaps: round3(status.fuelRemainingLaps),
      fuelKg: round1(status.fuelInTank),
      fuelMix: status.fuelMix,
      ersStorePct: round1((status.ersStoreEnergy / ERS_MAX_JOULES) * 100),
      ersMode: ersModes[status.ersDeployMode] ?? 'None',
      ersDeployedPct: round1((status.ersDeployedThisLap / ERS_MAX_JOULES) * 100),
      ersHarvestedPct: round1(((status.ersHarvestedThisLapMguk + status.ersHarvestedThisLapMguh) / ERS_MAX_JOULES) * 100),
      drsAllowed: status.drsAllowed,
      drsDistance: status.drsActivationDistance,
      brakeBias: status.frontBrakeBias,
      pitLimiter: status.pitLimiter,
      damage: {
        frontLeftWing: damage?.frontLeftWingDamage ?? 0,
        frontRightWing: damage?.frontRightWingDamage ?? 0,
        rearWing: damage?.rearWingDamage ?? 0,
        floor: damage?.floorDamage ?? 0,
        diffuser: damage?.diffuserDamage ?? 0,
        sidepod: damage?.sidepodDamage ?? 0,
        gearbox: damage?.gearBoxDamage ?? 0,
        engine: damage?.engineDamage ?? 0,
        drsFault: damage?.drsFault ?? false,
        ersFault: damage?.ersFault ?? false,
      },
      overtake: this.format === 2026 && t2 ? { available: t2.overtakeAvailable, active: t2.overtakeActive } : null,
    };
  }

  timingRows(): TimingRow[] {
    const rows: TimingRow[] = [];
    this.laps.forEach((lap, idx) => {
      if (!this.classified(idx) || lap.carPosition === 0) return;
      const p = this.participants[idx];
      rows.push({
        idx,
        pos: lap.carPosition,
        name: p?.name || `Car ${idx + 1}`,
        code: driverCode(p?.name, idx),
        colour: p?.colours[0] ?? teamColour(p?.teamId ?? -1),
        gapToLeaderMs: lap.deltaToRaceLeaderMs,
        lastLapMs: lap.lastLapTimeMs,
        bestLapMs: this.bestLapMsByCar.get(idx) ?? null,
        inPit: lap.pitStatus > 0,
        visualCompound: this.status[idx]?.visualTyreCompound ?? 0,
        isPlayer: idx === this.playerIdx,
      });
    });
    return rows.sort((a, b) => a.pos - b.pos);
  }

  timing(extra: Pick<TimingInfo, 'sessionBestMs' | 'currentSectors' | 'lastSectors' | 'referenceSectors' | 'bestSectors'>): TimingInfo | null {
    const lap = this.laps[this.playerIdx];
    if (!lap) return null;
    const rows = this.timingRows();
    return {
      position: lap.carPosition,
      numCars: rows.length,
      lapNum: lap.currentLapNum,
      totalLaps: this.session?.totalLaps ?? 0,
      lastLapMs: lap.lastLapTimeMs > 0 ? lap.lastLapTimeMs : null,
      rows,
      ...extra,
    };
  }
}

/** Three-letter code from a name: "Lando Norris" -> "NOR". */
export function driverCode(name: string | undefined, idx: number): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const last = (words.at(-1) ?? '').replace(/[^\p{L}]/gu, '');
  return last.length >= 3 ? last.slice(0, 3).toUpperCase() : `P${idx + 1}`;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
