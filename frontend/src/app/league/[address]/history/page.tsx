'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import { useTeamProfile } from '@/lib/teamProfile';

const LEAGUE_ABI = [
  { type:'function', name:'name', stateMutability:'view', inputs:[], outputs:[{type:'string'}] },
  { type:'function', name:'getTeamByAddress', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'string'}] },
] as const;

const ZERO = '0x0000000000000000000000000000000000000000';
function initials(n?: string){ const s=(n||'').trim(); if(!s) return 'TM'; const p=s.split(/\s+/); return ((p[0]?.[0]??'')+(p[1]?.[0]??'')).toUpperCase() || 'TM'; }
function shortAddr(a?: `0x${string}`){ return a ? `${a.slice(0,6)}…${a.slice(-4)}` : ''; }

function ProfilePill({
  league, wallet, name, logo,
}: { league: `0x${string}`; wallet?: `0x${string}`; name?: string; logo?: string }) {
  const content = (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 shadow-sm hover:bg-white/[0.06]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? <img src={logo} alt={name || 'Team'} className="h-10 w-10 rounded-2xl object-cover ring-1 ring-white/15" />
            : <div className="h-10 w-10 rounded-2xl bg-white/10 grid place-items-center font-semibold">{initials(name)}</div>}
      <div className="leading-tight">
        <div className="font-semibold">{name || 'Your Team'}</div>
        {wallet && <div className="text-[11px] text-gray-400 font-mono">{shortAddr(wallet)}</div>}
      </div>
    </div>
  );
  if (!wallet) return <div className="opacity-70">{content}</div>;
  return <Link href={`/league/${league}/team/${wallet}`}>{content}</Link>;
}

function HeaderBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 items-center">
      <div /> {/* left empty (no hamburger) */}
      <h1 className="justify-self-center text-3xl font-extrabold">{title}</h1>
      <div className="justify-self-end">{right}</div>
    </div>
  );
}

type Year = number;
const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_SEASONS: Year[] = [CURRENT_YEAR, CURRENT_YEAR - 1];

export default function HistoryPage() {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const { address: wallet } = useAccount();

  const { data: onChainTeamName } = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getTeamByAddress',
    args: [wallet ?? ZERO], query: { enabled: !!wallet }
  });
  const profile = useTeamProfile(league, wallet, { name: onChainTeamName as string });
  const displayName = (profile.name || (onChainTeamName as string) || '').trim() || undefined;

  const [selectedYear, setSelectedYear] = useState<Year>(DEFAULT_SEASONS[0]!);

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <HeaderBar
          title="History"
          right={<ProfilePill league={league} wallet={wallet} name={displayName} logo={profile.logo} />}
        />

        {/* Year selector */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">League History</h2>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Season:</span>
              <div className="flex gap-1">
                {DEFAULT_SEASONS.map(y => (
                  <button
                    key={y}
                    onClick={()=>setSelectedYear(y)}
                    className={[
                      'px-3 py-1.5 rounded-xl border text-sm',
                      selectedYear === y
                        ? 'bg-white text-black border-white'
                        : 'bg-black/20 text-gray-300 border-white/10 hover:bg-black/30'
                    ].join(' ')}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Season summary cards */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h3 className="text-base font-semibold mb-3">{selectedYear} Summary</h3>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="rounded-lg border border-white/10 bg-black/25 p-4">
              <div className="text-sm text-gray-400">Champion</div>
              <div className="mt-1 font-semibold">TBD</div>
              <div className="text-xs text-gray-500">Playoff seed, record, PF</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 p-4">
              <div className="text-sm text-gray-400">Runner-Up</div>
              <div className="mt-1 font-semibold">TBD</div>
              <div className="text-xs text-gray-500">Final score, path</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 p-4">
              <div className="text-sm text-gray-400">Regular Season Best</div>
              <div className="mt-1 font-semibold">TBD</div>
              <div className="text-xs text-gray-500">Record, PF leader</div>
            </div>
          </div>
        </section>

        {/* Records & awards */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h3 className="text-base font-semibold mb-3">Records & Awards</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/10 bg-black/25 p-4">
              <div className="font-semibold mb-2">Season Records</div>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>Highest Single-Week Score — <span className="font-semibold">TBD</span></li>
                <li>Longest Win Streak — <span className="font-semibold">TBD</span></li>
                <li>Most Points For — <span className="font-semibold">TBD</span></li>
              </ul>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 p-4">
              <div className="font-semibold mb-2">Awards</div>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>MVP (Fantasy) — <span className="font-semibold">TBD</span></li>
                <li>Best Draft — <span className="font-semibold">TBD</span></li>
                <li>Best Trade — <span className="font-semibold">TBD</span></li>
              </ul>
            </div>
          </div>
        </section>

        {/* Playoff bracket placeholder */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Playoff Bracket</h3>
            <button
              className="text-sm px-3 py-1.5 rounded-xl border border-white text-black bg-white hover:opacity-90"
              onClick={() => alert('Export coming soon')}
            >
              Export Bracket
            </button>
          </div>
          <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-gray-400">
            Bracket visualization coming soon. (Seedings, matchups, scores)
          </div>
        </section>

        {/* Historic Transactions */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Historic Transactions</h3>
            <div className="flex gap-2">
              <button
                className="text-sm px-3 py-1.5 rounded-xl border border-white/10 bg-black/30 hover:bg-black/40"
                onClick={() => alert('Filter coming soon')}
              >
                Filter
              </button>
              <button
                className="text-sm px-3 py-1.5 rounded-xl border border-white text-black bg-white hover:opacity-90"
                onClick={() => alert('CSV export coming soon')}
              >
                Export CSV
              </button>
            </div>
          </div>

          <ul className="text-sm space-y-2 mt-3">
            <li className="rounded border border-white/10 bg-black/25 px-4 py-2 text-gray-300">
              FAAB, trades, adds/drops for {selectedYear} will be listed here.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
