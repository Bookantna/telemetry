// Demo feed: impersonates F1 25 by sending real UDP packets for a car lapping a
// made-up circuit, so the dashboard can be seen and tested without the game.
//
//   npm run demo                      Time Trial, 2025 format, to 127.0.0.1:20777
//   npm run demo -- --mode race       20-car race
//   npm run demo -- --format 2026     2026 Season Pack format
//   npm run demo -- --speed 4         four times real speed

import { createSocket } from 'node:dgram';
import { parseArgs } from 'node:util';
import { DEMO_TRACK_ID, type UdpFormat } from '../../shared/f1.ts';
import {
  BLANK_DAMAGE,
  BLANK_LAP,
  BLANK_STATUS,
  BLANK_TELEMETRY,
  encodeCarDamage,
  encodeCarStatus,
  encodeCarTelemetry,
  encodeCarTelemetry2,
  encodeEvent,
  encodeLapData,
  encodeMotion,
  encodeParticipants,
  encodeSession,
  encodeSessionHistory,
  type HeaderInput,
} from '../f1/encode.ts';
import type { CarLap, CarTelemetry, LapHistory, Participant } from '../f1/types.ts';
import { buildProfile, buildTrack, inputsAt, type Profile } from './track.ts';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'tt' },
    format: { type: 'string', default: '2025' },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '20777' },
    rate: { type: 'string', default: '60' },
    speed: { type: 'string', default: '1' },
  },
});

const race = values.mode === 'race';
const format = (Number(values.format) === 2026 ? 2026 : 2025) as UdpFormat;
const rate = Math.max(10, Math.min(60, Number(values.rate)));
const speed = Math.max(0.25, Math.min(10, Number(values.speed)));
const host = values.host!;
const port = Number(values.port);
const dt = 1 / rate;

const track = buildTrack();
const L = track.length;
const sessionUid = String(BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)));
const socket = createSocket('udp4');

const GRID: [string, number, string][] = [
  ['Player', 8, '#ff8000'],
  ['Lando Norris', 8, '#ff8000'],
  ['Max Verstappen', 2, '#3671c6'],
  ['George Russell', 0, '#27f4d2'],
  ['Charles Leclerc', 1, '#e8002d'],
  ['Lewis Hamilton', 1, '#e8002d'],
  ['Kimi Antonelli', 0, '#27f4d2'],
  ['Alexander Albon', 3, '#64c4ff'],
  ['Fernando Alonso', 4, '#229971'],
  ['Carlos Sainz', 3, '#64c4ff'],
  ['Isack Hadjar', 6, '#6692ff'],
  ['Pierre Gasly', 5, '#ff87bc'],
  ['Yuki Tsunoda', 2, '#3671c6'],
  ['Oliver Bearman', 7, '#b6babd'],
  ['Nico Hulkenberg', 9, '#52e252'],
  ['Liam Lawson', 6, '#6692ff'],
  ['Esteban Ocon', 7, '#b6babd'],
  ['Lance Stroll', 4, '#229971'],
  ['Gabriel Bortoleto', 9, '#52e252'],
  ['Franco Colapinto', 5, '#ff87bc'],
];

interface Car {
  idx: number;
  pace: number;
  s: number;
  lapNum: number;
  lapStart: number;
  lastLapMs: number;
  sector1Ms: number;
  sector2Ms: number;
  invalid: boolean;
  invalidAt: number | null;
  profile: Profile;
  noisePhase: number[];
  history: LapHistory[];
  v: number;
}

const PLAYER = 0;
const cars: Car[] = (race ? GRID : GRID.slice(0, 1)).map((_, idx) => {
  const car: Car = {
    idx,
    pace: idx === PLAYER ? 1 : 0.985 + Math.random() * 0.03,
    s: race ? -10 - idx * 8 : -700,
    lapNum: 1,
    lapStart: 0,
    lastLapMs: 0,
    sector1Ms: 0,
    sector2Ms: 0,
    invalid: false,
    invalidAt: null,
    profile: null as unknown as Profile,
    noisePhase: [],
    history: [],
    v: 0,
  };
  newLapProfile(car);
  return car;
});
const player = cars[PLAYER];

let t = 0;
let frame = 0;
let overallFrame = 0;
const lightsOutAt = race ? 4 : 0;
let flyingLaps = 0;
let flashbackDoneThisLap = false;
let historyCursor = 0;
const snapshots: { t: number; frame: number; car: Car; ers: number }[] = [];

let ersStore = 3_200_000;
let ersDeployedThisLap = 0;
let fuelLaps = race ? 1.2 : 3;
const tyreWear = [3, 3, 3.5, 3.5];
const tyreInner = [92, 92, 90, 90];
const brakeTemp = [450, 450, 520, 520];

function newLapProfile(car: Car): void {
  car.noisePhase = [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28];
  const grip = car.pace * (0.996 + Math.random() * 0.008);
  const [a, b, c] = car.noisePhase;
  car.profile = buildProfile(track, grip, (i) => {
    const x = (i / L) * Math.PI * 2;
    return 0.008 * Math.sin(3 * x + a) + 0.006 * Math.sin(7 * x + b) + 0.004 * Math.sin(13 * x + c);
  });
  const willInvalidate = car.idx === PLAYER && Math.random() < 0.18;
  car.invalidAt = willInvalidate ? L * (0.2 + Math.random() * 0.7) : null;
}

function stepIndex(s: number): number {
  return ((Math.floor(s) % L) + L) % L;
}

function advance(car: Car): void {
  if (race && t < lightsOutAt) {
    car.v = 0;
    return;
  }
  const outLap = !race && car.lapNum === 1;
  const target = car.profile.v[stepIndex(car.s)] * (outLap ? 0.7 : 1);
  car.v = car.v + Math.max(-60 * dt, Math.min(18 * dt, target - car.v));
  const before = car.s;
  car.s += car.v * dt;
  // Time the car passed distance d during this frame, interpolated within the frame.
  const timeAt = (d: number) => t - dt + (dt * (d - before)) / (car.s - before);

  if (before < L / 3 && car.s >= L / 3) car.sector1Ms = lapMsAt(car, timeAt(L / 3));
  if (before < (2 * L) / 3 && car.s >= (2 * L) / 3) car.sector2Ms = lapMsAt(car, timeAt((2 * L) / 3)) - car.sector1Ms;
  if (car.invalidAt !== null && car.s >= car.invalidAt) car.invalid = true;

  const crossedFromOutLap = before < 0 && car.s >= 0 && !race;
  if (car.s >= L || crossedFromOutLap) {
    const lineAt = timeAt(crossedFromOutLap ? 0 : L);
    const time = lapMsAt(car, lineAt);
    if (car.s >= L) {
      car.lastLapMs = time;
      car.history.push({
        lapTimeMs: time,
        sector1Ms: car.sector1Ms,
        sector2Ms: car.sector2Ms,
        sector3Ms: time - car.sector1Ms - car.sector2Ms,
        validFlags: car.invalid ? 0 : 0b1111,
      });
      car.s -= L;
    }
    car.lapNum += 1;
    car.lapStart = lineAt;
    car.sector1Ms = 0;
    car.sector2Ms = 0;
    car.invalid = false;
    newLapProfile(car);
    if (car.idx === PLAYER) {
      flyingLaps += 1;
      flashbackDoneThisLap = false;
      ersDeployedThisLap = 0;
      if (car.lastLapMs) console.log(`  lap ${car.lapNum - 1}: ${(car.lastLapMs / 1000).toFixed(3)} s`);
    }
  }
}

function lapMs(car: Car): number {
  return lapMsAt(car, t);
}

function lapMsAt(car: Car, time: number): number {
  const start = race ? Math.max(car.lapStart, lightsOutAt) : car.lapStart;
  return Math.max(0, Math.round((time - start) * 1000));
}

function totalDistance(car: Car): number {
  return (car.lapNum - 1) * L + car.s;
}

function header(): HeaderInput {
  return { sessionUid, sessionTime: t, frame, overallFrame, playerCarIndex: PLAYER };
}

function send(bytes: Uint8Array): void {
  socket.send(bytes, port, host);
}

function participants(): Participant[] {
  return cars.map((car) => {
    const [name, teamId, colour] = GRID[car.idx];
    return {
      aiControlled: car.idx !== PLAYER,
      driverId: car.idx,
      networkId: 0,
      teamId: format === 2026 ? 476 + teamId : teamId,
      myTeam: false,
      raceNumber: car.idx + 1,
      nationality: 0,
      name,
      yourTelemetry: 1,
      platform: 1,
      colours: [colour],
    };
  });
}

function tick(): void {
  t += dt;
  frame += 1;
  overallFrame += 1;

  // Flashback demo: on every fourth flying Time Trial lap, rewind four seconds at 55% distance.
  if (!race && flyingLaps > 0 && flyingLaps % 4 === 0 && !flashbackDoneThisLap && player.s > L * 0.55) {
    const target = snapshots.find((snap) => snap.t >= t - 4);
    if (target) {
      flashbackDoneThisLap = true;
      Object.assign(player, { ...target.car, history: [...target.car.history] });
      ersStore = target.ers;
      t = target.t;
      frame = target.frame;
      send(encodeEvent(format, header(), 'FLBK', { frame, sessionTime: t }));
      console.log('  flashback: rewound 4 s');
    }
  }

  for (const car of cars) advance(car);
  snapshots.push({ t, frame, car: { ...player, history: [...player.history] }, ers: ersStore });
  while (snapshots.length > rate * 6) snapshots.shift();

  const step = stepIndex(player.s);
  const { throttle, brake, steer } = inputsAt(track, player.profile, step, player.pace);
  const moving = player.v > 1;
  const kmh = Math.round(player.v * 3.6);
  const gear = kmh < 5 ? 1 : Math.min(8, 1 + [80, 115, 150, 185, 220, 255, 290].filter((g) => kmh > g).length);
  const bands = [0, 80, 115, 150, 185, 220, 255, 290, 340];
  const lo = bands[gear - 1];
  const hi = bands[gear];
  const rpm = Math.round(4500 + ((kmh - lo) / (hi - lo)) * 7000);
  const thr = moving ? throttle : race && t < lightsOutAt ? 0.2 : 0.3;
  const brk = moving ? brake : 0;

  // Tyres, brakes and energy react to how the car is driven.
  const surface = [0, 1, 2, 3].map((w) => {
    const front = w >= 2;
    const base = front ? 90 : 94;
    return Math.round(base + (front ? 14 : 6) * brk + 10 * Math.abs(steer) + 4 * thr + Math.sin(t * 3 + w) * 1.5);
  });
  surface.forEach((s, w) => (tyreInner[w] += (s - tyreInner[w]) * 0.004));
  brakeTemp.forEach((b, w) => {
    // Heats quickly towards about 1000 °C (front) under full braking, cools slowly towards 350 °C.
    const target = 350 + (w >= 2 ? 650 : 450) * brk;
    brakeTemp[w] = b + (target - b) * (target > b ? 2.5 : 0.35) * dt;
  });
  if (moving) {
    tyreWear.forEach((_, w) => (tyreWear[w] += (w >= 2 ? 1.1 : 0.9) * (player.v * dt) / L));
    if (race) fuelLaps -= (0.12 * player.v * dt) / L;
    const deploying = thr > 0.95 && kmh > 200 && ersStore > 0;
    ersStore += (brk > 0.2 ? 140_000 : 0) * dt - (deploying ? 55_000 : 0) * dt;
    if (deploying) ersDeployedThisLap += 55_000 * dt;
    ersStore = Math.max(0, Math.min(4_000_000, ersStore));
  }

  const telemetry: CarTelemetry[] = cars.map((car) => {
    if (car.idx !== PLAYER) return { ...BLANK_TELEMETRY, speed: Math.round(car.v * 3.6), throttle: 1, gear: 7, engineRpm: 11000 };
    return {
      ...BLANK_TELEMETRY,
      speed: kmh,
      throttle: thr,
      brake: brk,
      steer,
      gear,
      engineRpm: rpm,
      revLightsPercent: Math.max(0, Math.min(100, Math.round(((rpm - 9500) / 2500) * 100))),
      drs: !race && player.s > 50 && player.s < 700 && kmh > 250,
      brakesTemperature: brakeTemp.map(Math.round),
      tyresSurfaceTemperature: surface,
      tyresInnerTemperature: tyreInner.map(Math.round),
      engineTemperature: 108,
      tyresPressure: tyreInner.map((v) => 22 + (v - 85) * 0.06),
    };
  });

  const order = [...cars].sort((a, b) => totalDistance(b) - totalDistance(a));
  const laps: CarLap[] = cars.map((car) => {
    const pos = order.indexOf(car);
    const leader = order[0];
    const ahead = order[pos - 1];
    const v = Math.max(car.v, 30);
    const outLap = !race && car.lapNum === 1;
    return {
      ...BLANK_LAP,
      lastLapTimeMs: car.lastLapMs,
      currentLapTimeMs: lapMs(car),
      sector1TimeMs: car.s >= L / 3 ? car.sector1Ms : 0,
      sector2TimeMs: car.s >= (2 * L) / 3 ? car.sector2Ms : 0,
      deltaToCarInFrontMs: ahead ? Math.round(((totalDistance(ahead) - totalDistance(car)) / v) * 1000) : 0,
      deltaToRaceLeaderMs: Math.round(((totalDistance(leader) - totalDistance(car)) / v) * 1000),
      lapDistance: car.s,
      totalDistance: Math.max(0, totalDistance(car)),
      carPosition: pos + 1,
      currentLapNum: car.lapNum,
      sector: car.s < L / 3 ? 0 : car.s < (2 * L) / 3 ? 1 : 2,
      currentLapInvalid: car.invalid,
      gridPosition: car.idx + 1,
      driverStatus: outLap ? 3 : 1,
      resultStatus: 2,
    };
  });

  const h = header();
  send(encodeLapData(format, h, laps));
  send(
    encodeMotion(
      format,
      h,
      cars.map((car) => {
        const p = track[stepIndex(car.s)];
        const q = track[stepIndex(car.s + 3)];
        const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        return { x: p.x, y: 0, z: p.z, fx: (q.x - p.x) / len, fz: (q.z - p.z) / len, yaw: 0 };
      }),
    ),
  );
  send(encodeCarTelemetry(format, h, telemetry));
  send(
    encodeCarStatus(
      format,
      h,
      cars.map((car) => ({
        ...BLANK_STATUS,
        fuelInTank: race ? 40 + fuelLaps * 1.6 : 12,
        fuelRemainingLaps: car.idx === PLAYER ? fuelLaps : 1,
        actualTyreCompound: race ? 18 : 17,
        visualTyreCompound: race ? 17 : 16,
        tyresAgeLaps: Math.max(0, car.lapNum - 1),
        ersStoreEnergy: car.idx === PLAYER ? ersStore : 3_000_000,
        ersDeployedThisLap: car.idx === PLAYER ? ersDeployedThisLap : 0,
        ersDeployMode: race ? 1 : 2,
        drsAllowed: !race,
      })),
    ),
  );
  if (format === 2026) {
    send(encodeCarTelemetry2(h, cars.map(() => ({ activeAeroMode: 0, activeAeroAvailable: false, overtakeAvailable: false, overtakeActive: false, regulations2026: true, drivingWrongWay: false }))));
  }

  if (frame % Math.round(rate / 2) === 0) {
    send(
      encodeSession(format, h, {
        weather: 0,
        trackTemperature: 38,
        airTemperature: 27,
        totalLaps: race ? 12 : 0,
        trackLength: L,
        sessionType: race ? 15 : 18,
        trackId: DEMO_TRACK_ID,
        formula: format === 2026 ? 13 : 0,
        sessionTimeLeft: 3600,
        sessionDuration: 3600,
        safetyCarStatus: 0,
        networkGame: 0,
        gameMode: race ? 4 : 5,
        ruleSet: race ? 1 : 2,
        sector2LapDistanceStart: L / 3,
        sector3LapDistanceStart: (2 * L) / 3,
      }),
    );
  }
  if (frame % Math.round(rate / 10) === 0) {
    send(
      encodeCarDamage(
        format,
        h,
        cars.map((car) => (car.idx === PLAYER ? { ...BLANK_DAMAGE, tyresWear: tyreWear.map((w) => Math.round(w * 10) / 10), frontLeftWingDamage: race && player.lapNum > 4 ? 8 : 0 } : BLANK_DAMAGE)),
      ),
    );
  }
  if (frame % Math.round(rate / 20) === 0) {
    const car = cars[historyCursor++ % cars.length];
    send(encodeSessionHistory(format, h, car.idx, car.history));
  }
  if (frame % (rate * 5) === 0) send(encodeParticipants(format, h, participants()));
}

// Frame 1 also carries Participants, as the game does.
send(encodeEvent(format, header(), 'SSTA'));
send(encodeParticipants(format, header(), participants()));

const started = performance.now();
let sent = 0;
function pump(): void {
  const due = Math.floor(((performance.now() - started) / 1000) * rate * speed);
  while (sent < due) {
    tick();
    sent++;
  }
  setTimeout(pump, 4);
}

console.log(`Demo feed: ${race ? '20-car race' : 'Time Trial'} on the Demo Circuit (${L} m), UDP Format ${format}, ${rate} Hz${speed !== 1 ? `, ${speed}x speed` : ''} -> ${host}:${port}`);
console.log(`Ideal lap ${player.profile.lapTime.toFixed(3)} s. Ctrl+C to stop.`);
pump();
