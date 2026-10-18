// SQLite persistence for Recorded Laps, Track Maps and other cars' timing.
// Uses Node's built-in node:sqlite, so there is no native module to install.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { trackName, type CarGeneration, type Conditions, type SessionGroup } from '../../shared/f1.ts';
import type { LapSummary } from '../../shared/protocol.ts';
import { decodeSamples, encodeSamples, type Sample } from './samples.ts';

/** The combination a Best Lap is kept for (CONTEXT.md: Best Lap). */
export interface LapKey {
  trackId: number;
  generation: CarGeneration;
  sessionGroup: SessionGroup;
  conditions: Conditions;
}

export interface NewLap extends LapKey {
  sessionUid: string;
  sessionType: number;
  lapNum: number;
  lapTimeMs: number | null;
  sectorsMs: [number | null, number | null, number | null];
  valid: boolean;
  complete: boolean;
  outLap: boolean;
  inLap: boolean;
  visualCompound: number;
  actualCompound: number;
  udpFormat: number;
  samples: Sample[];
}

interface LapRow {
  id: number;
  session_uid: string;
  track_id: number;
  session_type: number;
  session_group: SessionGroup;
  generation: CarGeneration;
  conditions: Conditions;
  lap_num: number;
  lap_time_ms: number | null;
  sector1_ms: number | null;
  sector2_ms: number | null;
  sector3_ms: number | null;
  valid: number;
  complete: number;
  out_lap: number;
  in_lap: number;
  visual_compound: number;
  recorded_at: string;
  is_best?: number;
}

const SUMMARY_COLUMNS = `id, session_uid, track_id, session_type, session_group, generation, conditions, lap_num,
  lap_time_ms, sector1_ms, sector2_ms, sector3_ms, valid, complete, out_lap, in_lap, visual_compound, recorded_at`;

/** A lap that can be a Best Lap: valid, complete, and not an Out-Lap or In-Lap. */
function eligible(table = ''): string {
  const t = table ? `${table}.` : '';
  return `${t}valid = 1 AND ${t}complete = 1 AND ${t}out_lap = 0 AND ${t}in_lap = 0 AND ${t}lap_time_ms IS NOT NULL`;
}
const BEST_ELIGIBLE = eligible();
const KEY_MATCH = 'track_id = ? AND generation = ? AND session_group = ? AND conditions = ?';

function keyParams(key: LapKey): SQLInputValue[] {
  return [key.trackId, key.generation, key.sessionGroup, key.conditions];
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS laps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_uid TEXT NOT NULL,
        track_id INTEGER NOT NULL,
        session_type INTEGER NOT NULL,
        session_group TEXT NOT NULL,
        generation TEXT NOT NULL,
        conditions TEXT NOT NULL,
        lap_num INTEGER NOT NULL,
        lap_time_ms INTEGER,
        sector1_ms INTEGER,
        sector2_ms INTEGER,
        sector3_ms INTEGER,
        valid INTEGER NOT NULL,
        complete INTEGER NOT NULL,
        out_lap INTEGER NOT NULL,
        in_lap INTEGER NOT NULL,
        visual_compound INTEGER NOT NULL,
        actual_compound INTEGER NOT NULL,
        udp_format INTEGER NOT NULL,
        recorded_at TEXT NOT NULL,
        sample_count INTEGER NOT NULL,
        samples BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS laps_by_key ON laps (track_id, generation, session_group, conditions, lap_time_ms);
      CREATE INDEX IF NOT EXISTS laps_by_session ON laps (session_uid, lap_num);

      CREATE TABLE IF NOT EXISTS track_maps (
        track_id INTEGER PRIMARY KEY,
        source_lap_id INTEGER,
        source_valid INTEGER NOT NULL,
        points BLOB NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS other_car_laps (
        session_uid TEXT NOT NULL,
        car_idx INTEGER NOT NULL,
        lap_num INTEGER NOT NULL,
        name TEXT NOT NULL,
        team_id INTEGER NOT NULL,
        lap_time_ms INTEGER NOT NULL,
        PRIMARY KEY (session_uid, car_idx, lap_num)
      );

      CREATE TABLE IF NOT EXISTS other_car_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_uid TEXT NOT NULL,
        start_time REAL NOT NULL,
        data BLOB NOT NULL
      );
    `);
  }

  insertLap(lap: NewLap): number {
    const result = this.db
      .prepare(
        `INSERT INTO laps (session_uid, track_id, session_type, session_group, generation, conditions, lap_num,
          lap_time_ms, sector1_ms, sector2_ms, sector3_ms, valid, complete, out_lap, in_lap, visual_compound,
          actual_compound, udp_format, recorded_at, sample_count, samples)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        lap.sessionUid,
        lap.trackId,
        lap.sessionType,
        lap.sessionGroup,
        lap.generation,
        lap.conditions,
        lap.lapNum,
        lap.lapTimeMs,
        lap.sectorsMs[0],
        lap.sectorsMs[1],
        lap.sectorsMs[2],
        lap.valid ? 1 : 0,
        lap.complete ? 1 : 0,
        lap.outLap ? 1 : 0,
        lap.inLap ? 1 : 0,
        lap.visualCompound,
        lap.actualCompound,
        lap.udpFormat,
        new Date().toISOString(),
        lap.samples.length,
        encodeSamples(lap.samples),
      );
    return Number(result.lastInsertRowid);
  }

  deleteLap(id: number): boolean {
    return this.db.prepare('DELETE FROM laps WHERE id = ?').run(id).changes > 0;
  }

  setLapValid(id: number, valid: boolean): void {
    this.db.prepare('UPDATE laps SET valid = ? WHERE id = ?').run(valid ? 1 : 0, id);
  }

  getLap(id: number): LapSummary | null {
    const row = this.db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM laps WHERE id = ?`).get(id) as LapRow | undefined;
    return row ? this.withBestFlag(row) : null;
  }

  lapSamples(id: number): Sample[] {
    const row = this.db.prepare('SELECT sample_count, samples FROM laps WHERE id = ?').get(id) as
      | { sample_count: number; samples: Uint8Array }
      | undefined;
    return row ? decodeSamples(row.samples, row.sample_count) : [];
  }

  /** Best Lap for a combination, across all sessions. */
  bestLap(key: LapKey): LapSummary | null {
    const row = this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM laps WHERE ${KEY_MATCH} AND ${BEST_ELIGIBLE} ORDER BY lap_time_ms, id LIMIT 1`)
      .get(...keyParams(key)) as LapRow | undefined;
    return row ? toSummary(row, true) : null;
  }

  /** Fastest eligible lap so far in one session (the Reference Lap outside Time Trial). */
  sessionBestLap(sessionUid: string, key: LapKey): LapSummary | null {
    const row = this.db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM laps WHERE session_uid = ? AND ${KEY_MATCH} AND ${BEST_ELIGIBLE}
         ORDER BY lap_time_ms, id LIMIT 1`,
      )
      .get(sessionUid, ...keyParams(key)) as LapRow | undefined;
    return row ? this.withBestFlag(row) : null;
  }

  /** Fastest time ever in each sector for a combination (shown purple). */
  bestSectors(key: LapKey): [number | null, number | null, number | null] {
    const row = this.db
      .prepare(
        `SELECT MIN(sector1_ms) AS s1, MIN(sector2_ms) AS s2, MIN(sector3_ms) AS s3 FROM laps
         WHERE ${KEY_MATCH} AND ${BEST_ELIGIBLE}`,
      )
      .get(...keyParams(key)) as { s1: number | null; s2: number | null; s3: number | null };
    return [row.s1, row.s2, row.s3];
  }

  sessionLaps(sessionUid: string): LapSummary[] {
    const rows = this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM laps WHERE session_uid = ? ORDER BY lap_num, id`)
      .all(sessionUid) as unknown as LapRow[];
    return rows.map((row) => this.withBestFlag(row));
  }

  /** Newest first, each flagged when it is the Best Lap of its combination. */
  listLaps(limit: number): LapSummary[] {
    const rows = this.db
      .prepare(
        `WITH best AS (
           SELECT track_id, generation, session_group, conditions, MIN(lap_time_ms) AS best_ms
           FROM laps WHERE ${BEST_ELIGIBLE} GROUP BY track_id, generation, session_group, conditions
         )
         SELECT ${SUMMARY_COLUMNS.split(',').map((c) => `l.${c.trim()}`).join(', ')},
           CASE WHEN ${eligible('l')} AND l.lap_time_ms = b.best_ms THEN 1 ELSE 0 END AS is_best
         FROM laps l
         LEFT JOIN best b USING (track_id, generation, session_group, conditions)
         ORDER BY l.id DESC LIMIT ?`,
      )
      .all(limit) as unknown as LapRow[];
    return rows.map((row) => toSummary(row, row.is_best === 1));
  }

  private withBestFlag(row: LapRow): LapSummary {
    const best = this.bestLap({
      trackId: row.track_id,
      generation: row.generation,
      sessionGroup: row.session_group,
      conditions: row.conditions,
    });
    return toSummary(row, best?.id === row.id);
  }

  trackMap(trackId: number): { points: Float32Array; sourceValid: boolean } | null {
    const row = this.db.prepare('SELECT points, source_valid FROM track_maps WHERE track_id = ?').get(trackId) as
      | { points: Uint8Array; source_valid: number }
      | undefined;
    if (!row) return null;
    const copy = row.points.slice();
    return { points: new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4), sourceValid: row.source_valid === 1 };
  }

  saveTrackMap(trackId: number, sourceLapId: number, sourceValid: boolean, points: Float32Array): void {
    this.db
      .prepare(
        `INSERT INTO track_maps (track_id, source_lap_id, source_valid, points, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (track_id) DO UPDATE SET source_lap_id = excluded.source_lap_id,
           source_valid = excluded.source_valid, points = excluded.points, updated_at = excluded.updated_at`,
      )
      .run(trackId, sourceLapId, sourceValid ? 1 : 0, new Uint8Array(points.buffer, points.byteOffset, points.byteLength), new Date().toISOString());
  }

  saveOtherCarLap(sessionUid: string, carIdx: number, lapNum: number, name: string, teamId: number, lapTimeMs: number): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO other_car_laps (session_uid, car_idx, lap_num, name, team_id, lap_time_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionUid, carIdx, lapNum, name, teamId, lapTimeMs);
  }

  /** Other cars' positions, rows of [sessionTime, carIdx, x, z]. */
  saveOtherCarPositions(sessionUid: string, startTime: number, rows: Float32Array): void {
    this.db
      .prepare('INSERT INTO other_car_positions (session_uid, start_time, data) VALUES (?, ?, ?)')
      .run(sessionUid, startTime, new Uint8Array(rows.buffer, rows.byteOffset, rows.byteLength));
  }
}

function toSummary(row: LapRow, isBest: boolean): LapSummary {
  return {
    id: row.id,
    sessionUid: row.session_uid,
    trackId: row.track_id,
    trackName: trackName(row.track_id),
    sessionType: row.session_type,
    sessionGroup: row.session_group,
    generation: row.generation,
    conditions: row.conditions,
    lapNum: row.lap_num,
    lapTimeMs: row.lap_time_ms,
    sectorsMs: [row.sector1_ms, row.sector2_ms, row.sector3_ms],
    valid: row.valid === 1,
    complete: row.complete === 1,
    outLap: row.out_lap === 1,
    inLap: row.in_lap === 1,
    visualCompound: row.visual_compound,
    recordedAt: row.recorded_at,
    isBest,
  };
}
