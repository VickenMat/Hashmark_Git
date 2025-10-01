'use client';

import React, { useMemo } from 'react';
import TeamInline from './TeamInline';

type Address = `0x${string}`;
type Pick = { round: number; slot: number; owner: Address; player?: string; playerName?: string; playerTeam?: string; position?: string };

export default function PanelHistory({
  league,
  picks,
}: {
  league: Address;
  picks: Pick[];
}) {
  const ordered = useMemo(() => {
    return picks.slice().sort((a,b)=> (a.round - b.round) || (a.slot - b.slot));
  }, [picks]);

  if (ordered.length === 0) {
    return <p className="text-sm text-gray-300 text-center">No picks yet.</p>;
  }

  return (
    <ol className="mx-auto max-w-2xl space-y-2">
      {ordered.map((p, i) => (
        <li key={`${p.round}-${p.slot}-${i}`}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="rounded bg-white/10 px-2 py-[2px] font-mono text-xs">{i+1}</span>
            <span className="font-semibold">{p.playerName || p.player}</span>
            <span className="opacity-80 text-sm">{p.playerTeam} · {p.position}</span>
          </div>
          <div className="text-sm opacity-90">
            <TeamInline league={league} owner={p.owner} />
          </div>
        </li>
      ))}
    </ol>
  );
}
