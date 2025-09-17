// src/app/league/[address]/claims/cut/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import Link from 'next/link';

type Player = { id: string; name: string; pos: string };

function loadRoster(league: `0x${string}`, owner?: `0x${string}`): Player[] {
  if (!league || !owner) return [];
  try {
    const raw = localStorage.getItem(`roster:${league}:${owner.toLowerCase()}`);
    return raw ? (JSON.parse(raw) as Player[]) : [];
  } catch { return []; }
}
function saveRoster(league: `0x${string}`, owner: `0x${string}`, roster: Player[]) {
  try { localStorage.setItem(`roster:${league}:${owner.toLowerCase()}`, JSON.stringify(roster)); } catch {}
}
function bumpClaims(league: `0x${string}`, owner: `0x${string}`) {
  try {
    const key = `claims:${league}:${owner.toLowerCase()}`;
    const n = Number(localStorage.getItem(key) || 0);
    localStorage.setItem(key, String(n + 1));
  } catch {}
}

export default function CutPlayersPage() {
  const { address: league } = useParams<{ address: `0x${string}` }>();
  const { address: owner } = useAccount();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!mounted || !league || !owner) return;
    setPlayers(loadRoster(league, owner));
  }, [mounted, league, owner]);

  const allChecked = useMemo(
    () => players.length > 0 && players.every(p => selected[p.id]),
    [players, selected]
  );

  function toggleAll() {
    const next: Record<string, boolean> = {};
    if (!allChecked) players.forEach(p => next[p.id] = true);
    setSelected(next);
  }

  function toggleOne(id: string) {
    setSelected(s => ({ ...s, [id]: !s[id] }));
  }

  function cutSelected() {
    if (!league || !owner) return;
    const ids = new Set(Object.keys(selected).filter(k => selected[k]));
    if (ids.size === 0) return;

    const remaining = players.filter(p => !ids.has(p.id));
    setPlayers(remaining);
    setSelected({});
    saveRoster(league, owner, remaining);
    bumpClaims(league, owner);
    alert(`Cut ${ids.size} player${ids.size > 1 ? 's' : ''}.`);
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-6 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="grid grid-cols-3 items-center">
          <Link href={`/league/${league}/team/${owner ?? ''}`} className="justify-self-start text-sm text-gray-300 hover:underline">
            ← Back to Team
          </Link>
          <h1 className="justify-self-center text-3xl font-extrabold">Cut Players</h1>
          <div />
        </div>

        {!mounted ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="h-6 w-48 rounded bg-white/10 animate-pulse" />
            <div className="mt-3 h-24 rounded bg-white/5 animate-pulse" />
          </div>
        ) : !owner ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-gray-400">
            Connect your wallet to view your roster.
          </div>
        ) : players.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-gray-400">
            Your roster is empty.
          </div>
        ) : (
          <section className="rounded-2xl border border-white/10 bg-white/[0.02]">
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  className="size-4 accent-fuchsia-600"
                />
                <span className="text-sm text-gray-200">Select all</span>
              </div>
              <button
                onClick={cutSelected}
                className="rounded-lg bg-rose-600 hover:bg-rose-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                disabled={Object.values(selected).every(v => !v)}
              >
                Cut Selected
              </button>
            </div>

            <div className="border-t border-white/10 divide-y divide-white/10">
              {players.map(p => (
                <label key={p.id} className="flex items-center justify-between px-4 py-3 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={!!selected[p.id]}
                      onChange={() => toggleOne(p.id)}
                      className="size-4 accent-fuchsia-600"
                    />
                    <div className="leading-tight">
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-[11px] text-gray-400">{p.pos}</div>
                    </div>
                  </div>
                  {/* placeholder columns for future team/opponent/meta */}
                  <div className="text-sm text-gray-400">Rostered</div>
                </label>
              ))}
            </div>

            <div className="px-4 py-3 flex items-center justify-end border-t border-white/10">
              <button
                onClick={cutSelected}
                className="rounded-lg bg-rose-600 hover:bg-rose-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                disabled={Object.values(selected).every(v => !v)}
              >
                Cut Selected
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
