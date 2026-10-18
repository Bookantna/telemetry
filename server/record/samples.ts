// One row per game frame for the Player Car. Stored column-major as float32 so a
// 90 s lap at 60 Hz is about 250 KB and reads back without parsing.

export const CHANNELS = [
  'sessionTime',
  'lapMs',
  'dist',
  'x',
  'y',
  'z',
  'speed',
  'throttle',
  'brake',
  'steer',
  'gear',
  'rpm',
] as const;

export type Channel = (typeof CHANNELS)[number];
export type Sample = Record<Channel, number>;

export function encodeSamples(samples: Sample[]): Uint8Array {
  const n = samples.length;
  const out = new Float32Array(n * CHANNELS.length);
  CHANNELS.forEach((channel, c) => {
    const base = c * n;
    for (let i = 0; i < n; i++) out[base + i] = samples[i][channel];
  });
  return new Uint8Array(out.buffer);
}

export function decodeSamples(bytes: Uint8Array, count: number): Sample[] {
  const copy = bytes.slice();
  const data = new Float32Array(copy.buffer, copy.byteOffset, count * CHANNELS.length);
  const samples: Sample[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const s = {} as Sample;
    CHANNELS.forEach((channel, c) => {
      s[channel] = data[c * count + i];
    });
    samples[i] = s;
  }
  return samples;
}

/** Driving Line points, flat [x, z, ...], keeping one point every `stepMetres` of lap distance. */
export function lineFromSamples(samples: Sample[], stepMetres: number): number[] {
  const out: number[] = [];
  let lastDist = -Infinity;
  for (const s of samples) {
    if (s.dist < 0) continue;
    if (s.dist - lastDist < stepMetres) continue;
    out.push(round1(s.x), round1(s.z));
    lastDist = s.dist;
  }
  return out;
}

/** Like lineFromSamples, but spaced by ground distance, so it also works on an Out-Lap (negative lap distance). */
export function pathFromSamples(samples: Sample[], stepMetres: number): number[] {
  const out: number[] = [];
  let lx = Infinity;
  let lz = Infinity;
  for (const s of samples) {
    if (Math.hypot(s.x - lx, s.z - lz) < stepMetres) continue;
    out.push(round1(s.x), round1(s.z));
    lx = s.x;
    lz = s.z;
  }
  return out;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
