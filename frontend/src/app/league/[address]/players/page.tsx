// src/app/league/[address]/players/page.tsx
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import { useTeamProfile } from '@/lib/teamProfile';

const LEAGUE_ABI = [
  { type:'function', name:'getTeamByAddress', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'string'}] },
] as const;

const ZERO = '0x0000000000000000000000000000000000000000' as const;

/* ─────────────────────────────── UI helpers ─────────────────────────────── */
function initials(n?: string){
  const s=(n||'').trim(); if(!s) return 'TM';
  const p=s.split(/\s+/); return ((p[0]?.[0]??'')+(p[1]?.[0]??'')).toUpperCase() || 'TM';
}
function shortAddr(a?: `0x${string}`){ return a ? `${a.slice(0,6)}…${a.slice(-4)}` : ''; }

function ProfilePill({
  league, wallet, name, logo,
}:{
  league: `0x${string}`;
  wallet?: `0x${string}` | undefined;
  name?: string;
  logo?: string;
}){
  const content = (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 shadow-sm hover:bg-white/[0.06]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? (
        <img src={logo} alt={name || 'Team'} className="h-10 w-10 rounded-2xl object-cover ring-1 ring-white/15" />
      ) : (
        <div className="h-10 w-10 rounded-2xl bg-white/10 grid place-items-center font-semibold">
          {initials(name)}
        </div>
      )}
      <div className="leading-tight">
        <div className="font-semibold">{name || 'Your Team'}</div>
        {wallet && <div className="text-[11px] text-gray-400 font-mono">{shortAddr(wallet)}</div>}
      </div>
    </div>
  );

  if (!wallet) return <div className="opacity-70">{content}</div>;
  return <Link href={`/league/${league}/team/${wallet}`}>{content}</Link>;
}

function HeaderBar({ title, right }: { title: string; right?: React.ReactNode }){
  return (
    <div className="grid grid-cols-3 items-center">
      <div /> {/* no left hamburger */}
      <h1 className="justify-self-center text-3xl font-extrabold">{title}</h1>
      <div className="justify-self-end">{right}</div>
    </div>
  );
}

/* ─────────────────────────────── Page ─────────────────────────────── */
export default function PlayersPage() {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const { address: wallet } = useAccount();

  // pull your team name for the pill (and for profile.logo)
  const { data: onChainTeamName } = useReadContract({
    abi: LEAGUE_ABI,
    address: league,
    functionName: 'getTeamByAddress',
    args: [wallet ?? ZERO],
    query: { enabled: !!wallet },
  });

  const profile = useTeamProfile(league, wallet, { name: onChainTeamName as string });
  const displayName = (profile.name || (onChainTeamName as string) || '').trim() || undefined;

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <HeaderBar
          title="Players"
          right={<ProfilePill league={league} wallet={wallet} name={displayName} logo={profile.logo} />}
        />

        {/* Filters / search scaffold */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex gap-2">
              {['ALL','QB','RB','WR','TE','K','D/ST'].map((p)=>(
                <button key={p} className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-sm hover:bg-white/10">{p}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <input placeholder="Search players…" className="w-64 bg-white/5 border border-white/10 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-600"/>
              <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 outline-none">
                <option>Sort: ADP</option>
                <option>Sort: Name</option>
                <option>Sort: Proj</option>
                <option>Sort: Roster %</option>
              </select>
            </div>
          </div>

          {/* Table scaffold */}
          <div className="mt-5 rounded-xl border border-white/10 overflow-hidden">
            <div className="grid grid-cols-12 bg-white/[0.04] px-3 py-2 text-xs uppercase tracking-wide text-gray-400">
              <div className="col-span-4">Player</div>
              <div className="col-span-2">Team</div>
              <div className="col-span-2">Pos</div>
              <div className="col-span-2 text-right">Proj</div>
              <div className="col-span-2 text-right">ADP</div>
            </div>
            {Array.from({length:6}).map((_,i)=>(
              <div key={i} className="grid grid-cols-12 px-3 py-3 border-t border-white/10 text-gray-300">
                <div className="col-span-4">Placeholder Player {i+1}</div>
                <div className="col-span-2">TBD</div>
                <div className="col-span-2">WR</div>
                <div className="col-span-2 text-right">—</div>
                <div className="col-span-2 text-right">—</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
