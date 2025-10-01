'use client';

import React, { useMemo } from 'react';
import { useAccount } from 'wagmi';
import { loadDraftState } from '@/lib/draft-storage';

type Address = `0x${string}`;
type Pick = { round: number; slot: number; owner: Address; player?: string; playerName?: string; playerTeam?: string; position?: string };

export default function PanelMyTeam({
  league,
  picks,
  owner, // optional override
}: {
  league: Address;
  picks?: Pick[];
  owner?: Address;
}) {
  const { address } = useAccount();
  const me = (owner ?? (address as Address) ?? undefined);

  const rows: Pick[] = useMemo(() => {
    if (Array.isArray(picks)) return picks;
    const s = loadDraftState(league);
    return Array.isArray(s?.picks) ? (s!.picks as Pick[]) : [];
  }, [league, picks]);

  const myPicks = useMemo(
    () => rows.filter(p => me && p.owner?.toLowerCase() === me.toLowerCase())
              .sort((a,b)=> (a.round - b.round) || (a.slot - b.slot)),
    [rows, me]
  );

  if (!me) return <p className="text-sm text-gray-300 text-center">Connect your wallet to see your team.</p>;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      {myPicks.length === 0 ? (
        <div className="text-sm text-gray-300 text-center">No players drafted yet.</div>
      ) : (
        <ul className="mx-auto max-w-md space-y-1 text-sm">
          {myPicks.map((p, idx) => (
            <li key={`${p.round}-${p.slot}-${idx}`} className="rounded border border-white/10 bg-black/30 px-2 py-1">
              <span className="font-semibold">{p.playerName || p.player}</span>
              <span className="opacity-80"> — {p.playerTeam} · {p.position}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 text-center text-xs opacity-80" style={{ color: '#37c0f6' }}>
        Your roster updates immediately after each pick.
      </div>
    </div>
  );
}
