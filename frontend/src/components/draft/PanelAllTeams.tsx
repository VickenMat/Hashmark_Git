'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import TeamInline from './TeamInline';

type Address = `0x${string}`;
type Pick = { round: number; slot: number; owner: Address; player?: string; playerName?: string; playerTeam?: string; position?: string };

const ZERO = '0x0000000000000000000000000000000000000000' as const;

export default function PanelAllTeams({
  league,
  header,
  selectedOwnerLower,
  picks,
  onSelectOwner,
}: {
  league: Address;
  header: { owner: Address; name: string }[];
  selectedOwnerLower?: string;
  picks: Pick[];
  onSelectOwner?: (owner?: string) => void;
}) {
  const initialIdx = useMemo(() => {
    if (!selectedOwnerLower) return 0;
    const i = header.findIndex(h => h.owner?.toLowerCase() === selectedOwnerLower);
    return i >= 0 ? i : 0;
  }, [header, selectedOwnerLower]);

  const [activeIdx, setActiveIdx] = useState(initialIdx);

  const picksByOwner = useMemo(() => {
    const m = new Map<Address, Pick[]>();
    picks.forEach(p => {
      const arr = m.get(p.owner) || [];
      arr.push(p);
      m.set(p.owner, arr);
    });
    return m;
  }, [picks]);

  const activeOwner = header[activeIdx]?.owner || ZERO;
  const activeName = header[activeIdx]?.name || `Team ${activeIdx + 1}`;
  const activePicks = (picksByOwner.get(activeOwner) || []).slice().sort((a,b)=>(a.round-b.round)||(a.slot-b.slot));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
        {header.map((h, i) => {
          const chosen = i === activeIdx;
          return (
            <Link
              key={`${h.owner}-${i}`}
              href={`?tab=all&team=${h.owner}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveIdx(i);
                onSelectOwner?.(h.owner);
              }}
              className={`rounded-full border px-3 py-1.5 text-sm flex items-center gap-2 no-underline ${chosen ? 'bg-white/10 border-white/20' : 'hover:bg-white/5 border-white/10'}`}
            >
              <TeamInline league={league} owner={h.owner} />
            </Link>
          );
        })}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
        <div className="mb-2 font-semibold" style={{ color: '#37c0f6' }}>{activeName}</div>
        {activePicks.length === 0 ? (
          <div className="text-sm text-gray-300">No players drafted yet.</div>
        ) : (
          <ul className="mx-auto max-w-md space-y-1 text-sm">
            {activePicks.map((p, idx) => (
              <li key={`${p.round}-${p.slot}-${idx}`} className="rounded border border-white/10 bg-black/30 px-2 py-1">
                <span className="font-semibold">{p.playerName || p.player}</span>
                <span className="opacity-80"> — {p.playerTeam} · {p.position}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
