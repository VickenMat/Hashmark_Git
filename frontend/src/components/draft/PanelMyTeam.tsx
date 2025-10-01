'use client';

import React, { useMemo } from 'react';

const ZIMA = '#37c0f6';

type Address = `0x${string}`;
type Pick = { round: number; slot: number; owner: Address; player?: string; playerName?: string; playerTeam?: string; position?: string };

export default function PanelMyTeam({
  owner,
  picks,
}: {
  owner?: Address;
  picks: Pick[];
}) {
  const myPicks = useMemo(
    () => picks.filter(p => owner && p.owner?.toLowerCase() === owner.toLowerCase()),
    [owner, picks]
  );

  if (!owner) return <p className="text-sm text-gray-300 text-center">Connect your wallet to see your team.</p>;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      {myPicks.length === 0 ? (
        <div className="text-sm text-gray-300 text-center">No players drafted yet.</div>
      ) : (
        <ul className="mx-auto max-w-md space-y-1 text-sm">
          {myPicks
            .sort((a,b)=> (a.round - b.round) || (a.slot - b.slot))
            .map((p, idx) => (
              <li key={`${p.round}-${p.slot}-${idx}`} className="rounded border border-white/10 bg-black/30 px-2 py-1">
                <span className="font-semibold">{p.playerName || p.player}</span>
                <span className="opacity-80"> — {p.playerTeam} · {p.position}</span>
              </li>
            ))}
        </ul>
      )}
      <div className="mt-2 text-center text-xs opacity-80" style={{ color: ZIMA }}>
        Your roster updates immediately after each pick.
      </div>
    </div>
  );
}
