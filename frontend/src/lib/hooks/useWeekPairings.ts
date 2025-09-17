// src/lib/hooks/useWeekPairings.ts
import { useEffect, useState } from 'react';

export type MatchPair = { type:'match'; awayOwner:`0x${string}`; homeOwner:`0x${string}` };
export type ByePair   = { type:'bye'; owner:`0x${string}` };
export type WeekPairing = MatchPair | ByePair;

export function useWeekPairings(league?: `0x${string}`, week?: number) {
  const [data, setData] = useState<WeekPairing[] | null>(null);
  const [loading, setLoading] = useState<boolean>(!!(league && week));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    async function run() {
      if (!league || !week) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/league/${league}/week/${week}/pairings`, { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const json = (await res.json()) as { pairings: WeekPairing[] };
        if (!stop) setData(json.pairings || []);
      } catch (e: any) {
        if (!stop) setError(e?.message || 'Failed to load pairings');
      } finally {
        if (!stop) setLoading(false);
      }
    }
    run();
    return () => { stop = true; };
  }, [league, week]);

  return { pairings: data ?? [], loading, error };
}
