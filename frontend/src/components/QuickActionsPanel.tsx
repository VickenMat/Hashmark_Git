// src/components/QuickActionsPanel.tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function QuickActionsPanel({
  league,
  owner,
}:{
  league: `0x${string}`;
  owner?: `0x${string}`;
}) {
  const ownerKey = (owner || '').toLowerCase();
  const tradesKey = `trades:${league}:${ownerKey}`;
  const claimsKey = `claims:${league}:${ownerKey}`;

  const [mounted, setMounted] = useState(false);
  const [trades, setTrades] = useState(0);
  const [claims, setClaims] = useState(0);
  useEffect(() => {
    setMounted(true);
    try {
      setTrades(Number(localStorage.getItem(tradesKey) || 0));
      setClaims(Number(localStorage.getItem(claimsKey) || 0));
    } catch {}
  }, [tradesKey, claimsKey]);

  return (
    <aside className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Activity</div>
        <div className="text-[11px] text-gray-400">This team</div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Link
          href={`/league/${league}/trades`}
          className="group rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] transition p-3"
        >
          <div className="text-[11px] uppercase tracking-wide text-gray-400">Trades</div>
          <div className="mt-1 text-2xl font-extrabold">{mounted ? trades : 0}</div>
          <div className="mt-2 text-xs text-gray-400 group-hover:text-gray-300">View history →</div>
        </Link>

        <Link
          href={`/league/${league}/claims`}
          className="group rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] transition p-3"
        >
          <div className="text-[11px] uppercase tracking-wide text-gray-400">Claims</div>
          <div className="mt-1 text-2xl font-extrabold">{mounted ? claims : 0}</div>
          <div className="mt-2 text-xs text-gray-400 group-hover:text-gray-300">View history →</div>
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link
          href={`/league/${league}/claims/add`}
          className="rounded-lg border border-white/10 bg-emerald-600/20 hover:bg-emerald-600/30 px-3 py-2 text-center font-semibold"
        >
          Add
        </Link>
        <Link
          href={`/league/${league}/claims/cut`}
          className="rounded-lg border border-white/10 bg-rose-600/20 hover:bg-rose-600/30 px-3 py-2 text-center font-semibold"
        >
          Cut
        </Link>
      </div>
    </aside>
  );
}
