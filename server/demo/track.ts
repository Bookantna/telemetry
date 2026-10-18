// A made-up circuit and a simple physics model for the demo feed. The speed profile
// comes from cornering and braking limits, so brake traces taper into corners the
// way real trail braking does.

const G = 9.81;
const V_MAX = 92; // m/s, about 330 km/h

export interface TrackPoint {
  x: number;
  z: number;
  /** Signed curvature, 1/m. Positive turns right. */
  k: number;
}

export interface Profile {
  /** Speed at each 1 m step, m/s. */
  v: Float64Array;
  /** Time from the line to each step, s. */
  t: Float64Array;
  lapTime: number;
}

type Segment = { straight: number } | { radius: number; degrees: number };

/**
 * The Demo Circuit as straights and arcs (positive degrees turn left). The turns
 * add up to 360 degrees; the main and back straight lengths are then solved so the
 * loop closes exactly. Corners range from a 75 km/h hairpin to 250 km/h sweepers.
 */
const LAYOUT: Segment[] = [
  // Main straight, then up the east side.
  { straight: 1000 },
  { radius: 35, degrees: 90 },
  { straight: 150 },
  { radius: 70, degrees: -35 },
  { straight: 60 },
  { radius: 100, degrees: 35 },
  { straight: 330 },
  { radius: 45, degrees: 90 },
  // Along the top: chicane, fast left-right.
  { straight: 250 },
  { radius: 40, degrees: -50 },
  { straight: 50 },
  { radius: 40, degrees: 50 },
  { straight: 260 },
  { radius: 140, degrees: 45 },
  { straight: 150 },
  { radius: 130, degrees: -45 },
  { straight: 150 },
  { radius: 75, degrees: 90 },
  // Down the west side through a hairpin switchback.
  { straight: 250 },
  { radius: 24, degrees: 135 },
  { straight: 120 },
  { radius: 26, degrees: -135 },
  { straight: 200 },
  { radius: 60, degrees: 90 },
  { straight: 120 },
];

export function buildTrack(): TrackPoint[] {
  const segments = closeLoop(LAYOUT);
  const pts: TrackPoint[] = [];
  let x = 0;
  let z = 0;
  let heading = 0;
  for (const seg of segments) {
    if ('straight' in seg) {
      for (let d = 0; d < seg.straight; d++) {
        pts.push({ x, z, k: 0 });
        x += Math.cos(heading);
        z += Math.sin(heading);
      }
    } else {
      const sweep = (seg.degrees * Math.PI) / 180;
      const length = Math.round(seg.radius * Math.abs(sweep));
      const k = Math.sign(sweep) / seg.radius;
      for (let d = 0; d < length; d++) {
        pts.push({ x, z, k });
        heading += sweep / length;
        x += Math.cos(heading);
        z += Math.sin(heading);
      }
    }
  }
  return pts;
}

/**
 * Lengthen or shorten two straights so the circuit ends where it began. Every pair of
 * straights is tried; the pair needing the smallest change, with no straight shorter
 * than 60 m, wins.
 */
function closeLoop(layout: Segment[]): Segment[] {
  let x = 0;
  let z = 0;
  let heading = 0;
  const headings: number[] = [];
  for (const seg of layout) {
    headings.push(heading);
    if ('straight' in seg) {
      x += Math.cos(heading) * seg.straight;
      z += Math.sin(heading) * seg.straight;
    } else {
      const sweep = (seg.degrees * Math.PI) / 180;
      const chord = 2 * seg.radius * Math.sin(Math.abs(sweep) / 2);
      x += Math.cos(heading + sweep / 2) * chord;
      z += Math.sin(heading + sweep / 2) * chord;
      heading += sweep;
    }
  }
  const straights = layout.flatMap((seg, i) => ('straight' in seg ? [i] : []));
  let best: { a: number; b: number; da: number; db: number } | null = null;
  for (const a of straights) {
    for (const b of straights) {
      if (b <= a) continue;
      const ua = [Math.cos(headings[a]), Math.sin(headings[a])];
      const ub = [Math.cos(headings[b]), Math.sin(headings[b])];
      const det = ua[0] * ub[1] - ua[1] * ub[0];
      if (Math.abs(det) < 0.3) continue;
      const da = (-x * ub[1] + z * ub[0]) / det;
      const db = (-ua[0] * z + ua[1] * x) / det;
      const la = (layout[a] as { straight: number }).straight + da;
      const lb = (layout[b] as { straight: number }).straight + db;
      if (la < 60 || lb < 60) continue;
      if (!best || Math.abs(da) + Math.abs(db) < Math.abs(best.da) + Math.abs(best.db)) best = { a, b, da, db };
    }
  }
  if (!best) throw new Error('Demo Circuit layout cannot be closed');
  const { a, b, da, db } = best;
  return layout.map((seg, i) => {
    if (i === a) return { straight: (seg as { straight: number }).straight + da };
    if (i === b) return { straight: (seg as { straight: number }).straight + db };
    return seg;
  });
}

/** Speed profile for one lap. `grip` scales cornering and braking; `noise` varies them along the lap. */
export function buildProfile(track: TrackPoint[], grip: number, noise: (i: number) => number): Profile {
  const n = track.length;
  const k = smoothCurvature(track, CORNER_EASE_METRES);
  const g = new Float64Array(n);
  const limit = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    g[i] = grip * (1 + noise(i));
    // a_lat(v) = g * (1.8 + 2.7 (v/90)^2): downforce grows with speed.
    const denom = k[i] - (G * g[i] * 2.7) / 8100;
    limit[i] = denom <= 0 ? V_MAX : Math.min(V_MAX, Math.sqrt((G * g[i] * 1.8) / denom));
  }
  // Friction circle: whatever grip cornering uses is not available for braking or accelerating.
  const share = (v: number, i: number) => {
    const ratio = Math.min(1, (v * v * k[i]) / lateralLimit(v, g[i]));
    return Math.sqrt(Math.max(0.03, 1 - ratio * ratio));
  };
  const v = Float64Array.from(limit);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const prev = v[(i - 1 + n) % n];
      v[i] = Math.min(v[i], Math.sqrt(prev * prev + 2 * accelLimit(prev) * share(prev, i)));
    }
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n;
      const next = v[j];
      v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * brakeLimit(next, grip) * share(next, j)));
    }
  }
  const t = new Float64Array(n);
  for (let i = 1; i < n; i++) t[i] = t[i - 1] + 2 / (v[i - 1] + v[i]);
  const lapTime = t[n - 1] + 2 / (v[n - 1] + v[0]);
  return { v, t, lapTime };
}

/** Driver inputs at step i: brake and throttle as a share of what the tyres allow, steer from curvature. */
export function inputsAt(track: TrackPoint[], profile: Profile, i: number, grip: number) {
  const n = track.length;
  const v0 = profile.v[i];
  const v1 = profile.v[(i + 1) % n];
  const accel = (v1 * v1 - v0 * v0) / 2;
  let throttle = 0;
  let brake = 0;
  if (accel < -0.3) {
    brake = Math.min(1, -accel / brakeLimit(v0, grip));
  } else if (accel > 0.15) {
    throttle = Math.min(1, 0.2 + (0.8 * accel) / accelLimit(v0));
  } else {
    throttle = v0 > V_MAX - 1 ? 1 : 0.3 + 0.4 * (v0 / V_MAX);
  }
  const steer = Math.max(-1, Math.min(1, smoothK(track, i) * 25));
  return { throttle, brake, steer };
}

/** Corners ease in and out over this distance instead of starting abruptly. */
const CORNER_EASE_METRES = 22;

function lateralLimit(v: number, g: number): number {
  return G * g * (1.8 + 2.7 * (v / 90) ** 2);
}

function brakeLimit(v: number, grip: number): number {
  return G * grip * (2 + 3 * (v / 90) ** 2);
}

function accelLimit(v: number): number {
  return Math.max(1, 14 * (1 - v / 96));
}

function smoothCurvature(track: TrackPoint[], half: number): Float64Array {
  const n = track.length;
  const out = new Float64Array(n);
  let sum = 0;
  for (let d = -half; d <= half; d++) sum += Math.abs(track[(d + n) % n].k);
  for (let i = 0; i < n; i++) {
    out[i] = sum / (2 * half + 1);
    sum += Math.abs(track[(i + half + 1) % n].k) - Math.abs(track[(i - half + n) % n].k);
  }
  return out;
}

function smoothK(track: TrackPoint[], i: number): number {
  const n = track.length;
  let sum = 0;
  for (let d = -6; d <= 6; d++) sum += track[(i + d + n) % n].k;
  return sum / 13;
}
