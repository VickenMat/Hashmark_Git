'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import TeamInline from './TeamInline';

type Address = `0x${string}`;
const ZERO: Address = '0x0000000000000000000000000000000000000000';

type PickItem = {
  round: number;
  slot: number;
  owner: Address;
  player?: string;
};

export default function PanelAllTeams({
  league,
  header,
  picks,
  selectedOwnerLower,
  onSelectOwner,
}: {
  league: Address;
  header: { owner: Address; name: string }[];
  picks: PickItem[];
  selectedOwnerLower?: string;
  onSelectOwner?: (owner?: string) => void;
}) {
  const initialIdx = useMemo(() => {
    if (!selectedOwnerLower) return 0;
    const i = header.findIndex(h => h.owner?.toLowerCase() === selectedOwnerLower);
    return i >= 0 ? i : 0;
  }, [header, selectedOwnerLower]);

  const [activeIdx, setActiveIdx] = useState(initialIdx);
  useEffect(() => setActiveIdx(initialIdx), [initialIdx]);

  const picksByOwner = useMemo(() => {
    const m = new Map<Address, PickItem[]>();
    (picks || []).forEach(p => {
      const arr = m.get(p.owner) || [];
      arr.push(p);
      m.set(p.owner, arr);
    });
    return m;
  }, [picks]);

  const activeOwner = header[activeIdx]?.owner || ZERO;
  const activeName = header[activeIdx]?.name || `Team ${activeIdx + 1}`;
  const activePicks = picksByOwner.get(activeOwner) || [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
        {header.map((h, i) => (
          <Link
            key={`${h.owner}-${i}`}
            href={`?tab=all&team=${h.owner}`}
            onClick={(e) => {
              e.preventDefault();
              setActiveIdx(i);
              onSelectOwner?.(h.owner);
            }}
            className={`rounded-full border px-3 py-1.5 text-sm flex items-center gap-2 no-underline ${i===activeIdx ? 'bg-white/10 border-white/20' : 'hover:bg-white/5 border-white/10'}`}
          >
            <TeamInline league={league} owner={h.owner} labelOverride={h.name} />
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
        <div className="mb-2 font-semibold" style={{ color: '#37c0f6' }}>{activeName}</div>
        {activePicks.length === 0 ? (
          <div className="text-sm text-gray-300">No players drafted yet.</div>
        ) : (
          <ul className="mx-auto max-w-md space-y-1 text-sm">
            {activePicks
              .sort((a,b)=> (a.round - b.round) || (a.slot - b.slot))
              .map((p, idx) => (
                <li key={`${p.round}-${p.slot}-${idx}`} className="rounded border border-white/10 bg-black/30 px-2 py-1">
                  Round {p.round} · Pick {p.slot} — <span className="font-semibold">{p.player || 'Player'}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
