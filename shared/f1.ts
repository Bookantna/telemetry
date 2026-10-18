// Values from the F1 25 UDP specification (format 2025) and the 2026 Season Pack
// specification (format 2026). Mirrors: github.com/MacManley/f1-25-udp and f1-26-udp.

export const PacketId = {
  Motion: 0,
  Session: 1,
  LapData: 2,
  Event: 3,
  Participants: 4,
  CarSetups: 5,
  CarTelemetry: 6,
  CarStatus: 7,
  FinalClassification: 8,
  LobbyInfo: 9,
  CarDamage: 10,
  SessionHistory: 11,
  TyreSets: 12,
  MotionEx: 13,
  TimeTrial: 14,
  LapPositions: 15,
  CarTelemetry2: 16,
} as const;

export type UdpFormat = 2025 | 2026;

export const SUPPORTED_FORMATS: readonly UdpFormat[] = [2025, 2026];

export const HEADER_SIZE = 29;

/** Car slots in every per-car array. The 2026 format grew the grid for the 11th team. */
export const MAX_CARS: Record<UdpFormat, number> = { 2025: 22, 2026: 24 };

/** Packet sizes as published in the specs. A packet whose length differs is dropped. */
export const PACKET_SIZES: Record<UdpFormat, Partial<Record<number, number>>> = {
  2025: {
    [PacketId.Motion]: 1349,
    [PacketId.Session]: 753,
    [PacketId.LapData]: 1285,
    [PacketId.Event]: 45,
    [PacketId.Participants]: 1284,
    [PacketId.CarSetups]: 1133,
    [PacketId.CarTelemetry]: 1352,
    [PacketId.CarStatus]: 1239,
    [PacketId.FinalClassification]: 1042,
    [PacketId.LobbyInfo]: 954,
    [PacketId.CarDamage]: 1041,
    [PacketId.SessionHistory]: 1460,
    [PacketId.TyreSets]: 231,
    [PacketId.MotionEx]: 273,
    [PacketId.TimeTrial]: 101,
    [PacketId.LapPositions]: 1131,
  },
  2026: {
    [PacketId.Motion]: 1325,
    [PacketId.Session]: 926,
    [PacketId.LapData]: 1399,
    [PacketId.Event]: 45,
    [PacketId.Participants]: 1470,
    [PacketId.CarSetups]: 1233,
    [PacketId.CarTelemetry]: 1448,
    [PacketId.CarStatus]: 1445,
    [PacketId.FinalClassification]: 1134,
    [PacketId.LobbyInfo]: 1062,
    [PacketId.CarDamage]: 1133,
    [PacketId.SessionHistory]: 1460,
    [PacketId.TyreSets]: 231,
    [PacketId.MotionEx]: 273,
    [PacketId.TimeTrial]: 104,
    [PacketId.LapPositions]: 1231,
    [PacketId.CarTelemetry2]: 269,
  },
};

/** Not a game track: the demo feed's circuit, kept apart so it never touches a real Track Map. */
export const DEMO_TRACK_ID = 127;

export const TRACK_NAMES: Record<number, string> = {
  0: 'Melbourne',
  2: 'Shanghai',
  3: 'Sakhir',
  4: 'Catalunya',
  5: 'Monaco',
  6: 'Montréal',
  7: 'Silverstone',
  9: 'Hungaroring',
  10: 'Spa-Francorchamps',
  11: 'Monza',
  12: 'Singapore',
  13: 'Suzuka',
  14: 'Yas Marina',
  15: 'Austin',
  16: 'Interlagos',
  17: 'Red Bull Ring',
  19: 'Mexico City',
  20: 'Baku',
  26: 'Zandvoort',
  27: 'Imola',
  29: 'Jeddah',
  30: 'Miami',
  31: 'Las Vegas',
  32: 'Lusail',
  39: 'Silverstone Reverse',
  40: 'Red Bull Ring Reverse',
  41: 'Zandvoort Reverse',
  42: 'Madrid',
  [DEMO_TRACK_ID]: 'Demo Circuit',
};

export function trackName(trackId: number): string {
  return TRACK_NAMES[trackId] ?? (trackId < 0 ? 'Unknown track' : `Track ${trackId}`);
}

export const SESSION_TYPE_NAMES: Record<number, string> = {
  0: 'Unknown',
  1: 'Practice 1',
  2: 'Practice 2',
  3: 'Practice 3',
  4: 'Short Practice',
  5: 'Qualifying 1',
  6: 'Qualifying 2',
  7: 'Qualifying 3',
  8: 'Short Qualifying',
  9: 'One-Shot Qualifying',
  10: 'Sprint Shootout 1',
  11: 'Sprint Shootout 2',
  12: 'Sprint Shootout 3',
  13: 'Short Sprint Shootout',
  14: 'One-Shot Sprint Shootout',
  15: 'Race',
  16: 'Race 2',
  17: 'Race 3',
  18: 'Time Trial',
};

/** Session Type in CONTEXT.md: the grouping laps are compared within. */
export type SessionGroup = 'time-trial' | 'practice' | 'qualifying' | 'race';

export function sessionGroup(sessionType: number): SessionGroup {
  if (sessionType === 18) return 'time-trial';
  if (sessionType >= 5 && sessionType <= 14) return 'qualifying';
  if (sessionType >= 15 && sessionType <= 17) return 'race';
  return 'practice';
}

export const SESSION_GROUP_NAMES: Record<SessionGroup, string> = {
  'time-trial': 'Time Trial',
  practice: 'Practice',
  qualifying: 'Qualifying',
  race: 'Race',
};

/** Conditions in CONTEXT.md: decided by the tyres, not the weather report. */
export type Conditions = 'dry' | 'wet';

/** Actual compounds that are rain tyres: F1 inter (7) and wet (8), F1 Classic wet (10), F2 wet (15). */
const WET_COMPOUNDS = new Set([7, 8, 10, 15]);

export function conditionsFor(actualCompound: number): Conditions {
  return WET_COMPOUNDS.has(actualCompound) ? 'wet' : 'dry';
}

/** Car Generation in CONTEXT.md. Other formulas get their own bucket so they never mix with F1 laps. */
export type CarGeneration = '2025' | '2026' | 'F2' | 'Classic' | 'Generic';

export function carGeneration(format: UdpFormat, formula: number, regs2026: boolean): CarGeneration {
  if (formula === 2) return 'F2';
  if (formula === 1) return 'Classic';
  if (format === 2026 && (formula === 13 || regs2026)) return '2026';
  if (formula === 3) return 'Generic';
  return '2025';
}

export interface Compound {
  short: string;
  name: string;
  colour: string;
}

/** Visual compound as the HUD shows it (soft/medium/hard/inter/wet). */
export function visualCompound(visual: number): Compound {
  switch (visual) {
    case 16:
    case 19:
      return { short: 'S', name: 'Soft', colour: '#ff3b3b' };
    case 17:
    case 20:
      return { short: 'M', name: 'Medium', colour: '#ffd12e' };
    case 18:
    case 21:
    case 22:
      return { short: 'H', name: 'Hard', colour: '#f2f2f2' };
    case 7:
      return { short: 'I', name: 'Intermediate', colour: '#3ccf5a' };
    case 8:
    case 15:
      return { short: 'W', name: 'Wet', colour: '#3a8bff' };
    default:
      return { short: '?', name: 'Unknown', colour: '#8a8f98' };
  }
}

export const ERS_MODES: Record<number, string> = { 0: 'None', 1: 'Medium', 2: 'Hotlap', 3: 'Overtake' };
export const ERS_MODES_2026: Record<number, string> = { 0: 'None', 1: 'Medium', 2: 'Hotlap', 3: 'Boost' };

/** Battery size the game uses for the ERS store percentage. */
export const ERS_MAX_JOULES = 4_000_000;

export const FUEL_MIX: Record<number, string> = { 0: 'Lean', 1: 'Standard', 2: 'Rich', 3: 'Max' };

/** Fallback team colours, used only when the Participants packet carries no livery colour. */
const TEAM_COLOURS: Record<number, string> = {
  0: '#27f4d2',
  1: '#e8002d',
  2: '#3671c6',
  3: '#64c4ff',
  4: '#229971',
  5: '#ff87bc',
  6: '#6692ff',
  7: '#b6babd',
  8: '#ff8000',
  9: '#52e252',
  476: '#27f4d2',
  477: '#e8002d',
  478: '#3671c6',
  479: '#64c4ff',
  480: '#229971',
  481: '#ff87bc',
  482: '#6692ff',
  483: '#b6babd',
  484: '#ff8000',
  485: '#c0c4c8',
  486: '#d4af37',
};

export function teamColour(teamId: number): string {
  return TEAM_COLOURS[teamId] ?? '#8a8f98';
}

/** Wheel arrays are ordered rear-left, rear-right, front-left, front-right. */
export const WHEEL = { RL: 0, RR: 1, FL: 2, FR: 3 } as const;
