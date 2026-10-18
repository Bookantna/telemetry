// Time formatting shared by the PC console and the dashboard.

const MINUS = '−';

/** 81234 -> "1:21.234"; 21234 -> "21.234". */
export function formatLapTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalMs = Math.round(ms);
  const minutes = Math.floor(totalMs / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  const tail = `${String(seconds).padStart(minutes ? 2 : 1, '0')}.${String(millis).padStart(3, '0')}`;
  return minutes ? `${minutes}:${tail}` : tail;
}

/** Signed seconds with a real minus sign: -0.2345 -> "−0.235", 1.2 -> "+1.200". */
export function formatDelta(seconds: number, digits = 3): string {
  const rounded = Number(Math.abs(seconds).toFixed(digits));
  if (rounded === 0) return (0).toFixed(digits);
  return `${seconds < 0 ? MINUS : '+'}${rounded.toFixed(digits)}`;
}

/** Sector time: 28456 -> "28.456". */
export function formatSector(ms: number | null): string {
  return ms === null || ms <= 0 ? '—' : formatLapTime(ms);
}
