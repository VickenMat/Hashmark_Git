// src/lib/matchups.ts
export const REG_SEASON_WEEKS = 14;
export const BYE_ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`;
export const UI_VER = 'scoreboard-v4';

export type Team = { owner: `0x${string}`; name: string };
export type Pairing = { away?: Team; home?: Team; bye?: `0x${string}` | null };
export type WeekStatus = 'pre' | 'live' | 'final';

/* Local storage keys (mirror scoreboard) */
export const storageKey     = (league: `0x${string}`)           => `schedule:${league}`;
export const scoresKey      = (league: `0x${string}`, w: number) => `scores:${league}:${w}`;
export const lastMatchupKey = (league: `0x${string}`, a: string) => `hashmark:lastMatchup:${league}:${a.toLowerCase()}`;
export const activeWeekKey  = 'hashmark.activeWeek';

/* Small helpers */
export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
export const nameOrBye = (addr: `0x${string}`, fallback?: string) =>
  addr?.toLowerCase?.() === BYE_ZERO.toLowerCase() ? 'Bye Week' : (fallback?.trim() || 'Team');

export function parseNum(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : (typeof v === 'number' ? v : NaN);
  return Number.isFinite(n) ? n : 0;
}
export function computePerc(aProj: unknown, bProj: unknown): [number, number] {
  const a = parseNum(aProj), b = parseNum(bProj);
  const tot = a + b;
  if (tot <= 0) return [50, 50];
  return [(a / tot) * 100, (b / tot) * 100];
}

/* Optional records store: localStorage['records:<league>'] = { [addrLower]: "W-L-T" } */
export function getRecord(league: `0x${string}`, addr: `0x${string}`) {
  try {
    const raw = localStorage.getItem(`records:${league}`);
    if (!raw) return '0-0-0';
    const map = JSON.parse(raw) as Record<string, string>;
    return map[addr.toLowerCase()] || '0-0-0';
  } catch { return '0-0-0'; }
}
