const two = (n: number) => String(n).padStart(2, '0');

/** A clock reading in ms as `12.34s`, `1:05.20`, or `2:03:07.50`; `—` for one that isn't finite. */
export function clockText(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const sign = ms < 0 ? '-' : '';
  const cs = Math.floor(Math.abs(ms) / 10);
  const secs = (cs % 6000) / 100;
  const mins = Math.floor(cs / 6000) % 60;
  const hours = Math.floor(cs / 360000);
  if (hours === 0 && mins === 0) return `${sign}${secs.toFixed(2)}s`;
  const s = secs.toFixed(2).padStart(5, '0');
  return hours === 0 ? `${sign}${mins}:${s}` : `${sign}${hours}:${two(mins)}:${s}`;
}
