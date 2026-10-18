import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PACKET_SIZES, PacketId, type UdpFormat } from '../shared/f1.ts';
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
} from '../server/f1/encode.ts';
import { parsePacket } from '../server/f1/parse.ts';
import type { Packet, SessionData } from '../server/f1/types.ts';

const header: HeaderInput = {
  sessionUid: '18446744073709551615',
  sessionTime: 123.5,
  frame: 7380,
  overallFrame: 7400,
  playerCarIndex: 3,
};

const session: SessionData = {
  weather: 1,
  trackTemperature: 34,
  airTemperature: -2,
  totalLaps: 5,
  trackLength: 5793,
  sessionType: 18,
  trackId: 11,
  formula: 0,
  sessionTimeLeft: 600,
  sessionDuration: 3600,
  safetyCarStatus: 0,
  networkGame: 0,
  gameMode: 5,
  ruleSet: 2,
  sector2LapDistanceStart: 1900.5,
  sector3LapDistanceStart: 4100.25,
};

function parsed<K extends Packet['kind']>(bytes: Uint8Array, kind: K): Extract<Packet, { kind: K }> {
  const result = parsePacket(bytes);
  assert.ok(result.ok, `parse failed: ${JSON.stringify(result)}`);
  assert.equal(result.packet.kind, kind);
  return result.packet as Extract<Packet, { kind: K }>;
}

for (const format of [2025, 2026] as UdpFormat[]) {
  describe(`format ${format}`, () => {
    it('every encoder fills exactly the published packet size', () => {
      // finish() throws when a layout does not add up to PACKET_SIZES.
      encodeMotion(format, header, []);
      encodeSession(format, header, session);
      encodeLapData(format, header, []);
      encodeEvent(format, header, 'SSTA');
      encodeParticipants(format, header, []);
      encodeCarTelemetry(format, header, []);
      encodeCarStatus(format, header, []);
      encodeCarDamage(format, header, []);
      encodeSessionHistory(format, header, 0, []);
      if (format === 2026) encodeCarTelemetry2(header, []);
    });

    it('round-trips the header, including a full 64-bit session id', () => {
      const p = parsed(encodeEvent(format, header, 'SSTA'), 'event');
      assert.equal(p.header.format, format);
      assert.equal(p.header.sessionUid, header.sessionUid);
      assert.equal(p.header.sessionTime, 123.5);
      assert.equal(p.header.frame, 7380);
      assert.equal(p.header.overallFrame, 7400);
      assert.equal(p.header.playerCarIndex, 3);
      assert.equal(p.event.code, 'SSTA');
    });

    it('round-trips session data', () => {
      const p = parsed(encodeSession(format, header, session), 'session');
      assert.deepEqual(p.session, session);
    });

    it('round-trips lap data for the last car slot', () => {
      const last = format === 2026 ? 23 : 21;
      const cars = [];
      cars[last] = { ...BLANK_LAP, lastLapTimeMs: 81234, sector1TimeMs: 65432, currentLapNum: 9, lapDistance: 1234.5, currentLapInvalid: true, driverStatus: 1 };
      const p = parsed(encodeLapData(format, header, cars), 'lapData');
      assert.equal(p.cars.length, last + 1);
      assert.equal(p.cars[last].lastLapTimeMs, 81234);
      assert.equal(p.cars[last].sector1TimeMs, 65432, 'minutes part + ms part');
      assert.equal(p.cars[last].currentLapNum, 9);
      assert.equal(p.cars[last].lapDistance, 1234.5);
      assert.equal(p.cars[last].currentLapInvalid, true);
    });

    it('round-trips telemetry, status and damage', () => {
      const tel = { ...BLANK_TELEMETRY, speed: 312, throttle: 0.75, brake: 0.25, gear: 7, engineRpm: 11800, tyresPressure: [22.5, 22.5, 23, 23], engineTemperature: 105 };
      const t = parsed(encodeCarTelemetry(format, header, [tel]), 'carTelemetry');
      assert.deepEqual(t.cars[0], tel);

      const status = { ...BLANK_STATUS, fuelRemainingLaps: 1.5, ersStoreEnergy: 2_000_000, actualTyreCompound: 8, ersHarvestLimitPerLap: format === 2026 ? 1_000_000 : 0 };
      const s = parsed(encodeCarStatus(format, header, [status]), 'carStatus');
      assert.deepEqual(s.cars[0], status);

      const damage = { ...BLANK_DAMAGE, tyresWear: [10.5, 11, 9, 9.5], frontLeftWingDamage: 12 };
      const d = parsed(encodeCarDamage(format, header, [damage]), 'carDamage');
      assert.deepEqual(d.cars[0], damage);
    });

    it('round-trips participants with wide ids in 2026', () => {
      const p = parsed(
        encodeParticipants(format, header, [
          { aiControlled: false, driverId: format === 2026 ? 300 : 50, networkId: 1, teamId: format === 2026 ? 485 : 8, myTeam: false, raceNumber: 44, nationality: 10, name: 'Driver Name', yourTelemetry: 1, platform: 1, colours: ['#ff8000', '#47c7fc'] },
        ]),
        'participants',
      );
      assert.equal(p.numActiveCars, 1);
      assert.equal(p.participants[0].name, 'Driver Name');
      assert.equal(p.participants[0].teamId, format === 2026 ? 485 : 8);
      assert.deepEqual(p.participants[0].colours, ['#ff8000', '#47c7fc']);
    });

    it('decodes the flashback event', () => {
      const p = parsed(encodeEvent(format, header, 'FLBK', { frame: 7000, sessionTime: 116.25 }), 'event');
      assert.deepEqual(p.event, { code: 'FLBK', flashback: { frame: 7000, sessionTime: 116.25 } });
    });

    it('decodes session history validity flags', () => {
      const p = parsed(encodeSessionHistory(format, header, 3, [{ lapTimeMs: 90000, sector1Ms: 30000, sector2Ms: 30000, sector3Ms: 30000, validFlags: 0b1110 }]), 'sessionHistory');
      assert.equal(p.history.carIdx, 3);
      assert.equal(p.history.laps[0].validFlags & 1, 0);
    });
  });
}

describe('fixed offsets, independent of the encoder', () => {
  // These write single fields at hand-computed offsets from the spec, so a mistake
  // made identically in parse.ts and encode.ts still fails here.
  function blank(format: UdpFormat, packetId: number): { bytes: Uint8Array; view: DataView } {
    const bytes = new Uint8Array(PACKET_SIZES[format][packetId]!);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, format, true);
    view.setUint8(6, packetId);
    return { bytes, view };
  }

  it('2025 lap data: car stride 57, lap distance at +20, lap number at +33', () => {
    const { bytes, view } = blank(2025, PacketId.LapData);
    view.setFloat32(29 + 57 * 4 + 20, 777.25, true);
    view.setUint8(29 + 57 * 4 + 33, 12);
    const p = parsed(bytes, 'lapData');
    assert.equal(p.cars[4].lapDistance, 777.25);
    assert.equal(p.cars[4].currentLapNum, 12);
  });

  it('telemetry: brake at +10; tyre pressure at +40 in 2025 and +39 in 2026', () => {
    for (const [format, stride, pressureAt] of [[2025, 60, 40], [2026, 59, 39]] as const) {
      const { bytes, view } = blank(format, PacketId.CarTelemetry);
      view.setFloat32(29 + stride * 2 + 10, 0.5, true);
      view.setFloat32(29 + stride * 2 + pressureAt, 24.5, true);
      const p = parsed(bytes, 'carTelemetry');
      assert.equal(p.cars[2].brake, 0.5);
      assert.equal(p.cars[2].tyresPressure[0], 24.5);
    }
  });

  it('motion: x at +0, yaw at +48 in 2025 (stride 60) and +42 in 2026 (stride 54)', () => {
    for (const [format, stride, yawAt] of [[2025, 60, 48], [2026, 54, 42]] as const) {
      const { bytes, view } = blank(format, PacketId.Motion);
      view.setFloat32(29 + stride * 5, -350.5, true);
      view.setFloat32(29 + stride * 5 + yawAt, 1.25, true);
      view.setInt16(29 + stride * 5 + 24, -32767, true); // forward X at +24
      const p = parsed(bytes, 'motion');
      assert.equal(p.cars[5].x, -350.5);
      assert.equal(p.cars[5].yaw, 1.25);
      assert.equal(p.cars[5].fx, -1);
    }
  });

  it('car status: compound at +25, ERS store at +37; deployed shifts by 4 bytes in 2026', () => {
    for (const [format, stride, deployedAt] of [[2025, 55, 50], [2026, 59, 54]] as const) {
      const { bytes, view } = blank(format, PacketId.CarStatus);
      view.setUint8(29 + stride + 25, 7);
      view.setFloat32(29 + stride + 37, 3_000_000, true);
      view.setFloat32(29 + stride + deployedAt, 500_000, true);
      const p = parsed(bytes, 'carStatus');
      assert.equal(p.cars[1].actualTyreCompound, 7);
      assert.equal(p.cars[1].ersStoreEnergy, 3_000_000);
      assert.equal(p.cars[1].ersDeployedThisLap, 500_000);
    }
  });

  it('session: track id at 36, session type at 35, sector 2 start at 745', () => {
    const { bytes, view } = blank(2026, PacketId.Session);
    view.setInt8(36, 42);
    view.setUint8(35, 18);
    view.setFloat32(745, 2222.5, true);
    const p = parsed(bytes, 'session');
    assert.equal(p.session.trackId, 42);
    assert.equal(p.session.sessionType, 18);
    assert.equal(p.session.sector2LapDistanceStart, 2222.5);
  });
});

describe('rejects what it cannot read', () => {
  it('flags old UDP formats', () => {
    const bytes = new Uint8Array(1285);
    new DataView(bytes.buffer).setUint16(0, 2024, true);
    const result = parsePacket(bytes);
    assert.deepEqual(result, { ok: false, reason: 'unsupported-format', format: 2024 });
  });

  it('drops a packet whose size does not match the spec', () => {
    const bytes = encodeLapData(2025, header, []).subarray(0, 1200);
    const result = parsePacket(bytes);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'bad-size');
  });
});
