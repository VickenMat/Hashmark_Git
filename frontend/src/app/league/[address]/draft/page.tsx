'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAccount, useReadContract } from 'wagmi';
import { useTeamProfile } from '@/lib/teamProfile';

const LEAGUE_ABI = [
  { type:'function', name:'name', stateMutability:'view', inputs:[], outputs:[{type:'string'}] },
  { type:'function', name:'getTeamByAddress', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'string'}] },
  { type:'function', name:'getDraftSettings', stateMutability:'view', inputs:[], outputs:[
    {type:'uint8'}, {type:'uint64'}, {type:'uint8'}, {type:'bool'}, {type:'address[]'}
  ]},
] as const;

function initials(n?: string){ const s=(n||'').trim(); if(!s) return 'TM'; const p=s.split(/\s+/); return ((p[0]?.[0]??'')+(p[1]?.[0]??'')).toUpperCase() || 'TM'; }
function TeamBadge({ name, logo, wallet }:{ name?:string; logo?:string; wallet?:`0x${string}`|undefined }){
  const safe = name?.trim() || '—';
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? <img src={logo} alt={safe} className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/15"/> :
        <div className="h-10 w-10 rounded-xl bg-white/10 grid place-items-center font-semibold">{initials(safe)}</div>}
      <div className="leading-tight">
        <div className="text-xs text-gray-400">Your Team</div>
        <div className="font-semibold truncate max-w-[220px]" title={safe}>{safe}</div>
        {wallet && <div className="text-[10px] text-gray-500 font-mono truncate max-w-[220px]">{wallet}</div>}
      </div>
    </div>
  );
}

export default function DraftCenter() {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const { address: wallet } = useAccount();

  const { data: leagueName } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' });
  const { data: onChainTeamName } = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getTeamByAddress',
    args: [wallet ?? '0x0000000000000000000000000000000000000000'], query: { enabled: !!wallet }
  });
  const { data: draftSettings } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'getDraftSettings' });

  const profile = useTeamProfile(league, wallet, { name: onChainTeamName as string });
  const displayName = (profile.name || (onChainTeamName as string) || '').trim() || undefined;

  const ds = Array.isArray(draftSettings) ? {
    type: Number(draftSettings[0] ?? 0),    // 0=Snake,1=Auction
    ts:   Number(draftSettings[1] ?? 0) * 1000,
    order: Number(draftSettings[2] ?? 0),   // 0=Random,1=Manual
    done: Boolean(draftSettings[3]),
  } : undefined;

  const subtitle = useMemo(()=>league, [league]);
  const startStr = ds?.ts ? new Date(ds.ts).toLocaleString() : 'Not scheduled';

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-extrabold">Draft Center — {String(leagueName || 'League')}</h1>
            <p className="text-sm text-gray-400 font-mono mt-1">{subtitle}</p>
          </div>
          <TeamBadge name={displayName} logo={profile.logo} wallet={wallet} />
        </header>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold mb-3">Status</h2>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border border-white/10 bg-black/25 p-4">
              <div className="text-gray-400">Draft Type</div>
              <div className="font-semibold">{ds ? (ds.type===0?'Snake':ds.type===1?'Auction':`Type ${ds.type}`) : '—'}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 p-4">
              <div className="text-gray-400">Order Mode</div>
              <div className="font-semibold">{ds ? (ds.order===0?'Random':ds.order===1?'Manual':`Mode ${ds.order}`) : '—'}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 p-4">
              <div className="text-gray-400">Scheduled</div>
              <div className="font-semibold">{startStr}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 p-4">
              <div className="text-gray-400">Completed</div>
              <div className="font-semibold">{ds ? (ds.done ? 'Yes' : 'No') : '—'}</div>
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <Link href={`/league/${league}/settings/draft-settings`} className="rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 font-semibold">
              Edit Draft Settings
            </Link>
            <Link href={`/league/${league}/players`} className="rounded-lg border border-white/15 px-4 py-2 font-semibold hover:bg-white/10">
              Player Pool →
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold mb-2">Draft Room</h2>
          <p className="text-gray-300">Live picks board, timer, and chat will appear here.</p>
          <div className="mt-4 rounded-lg border border-white/10 bg-black/25 p-4">
            <div className="text-gray-400 text-sm mb-1">Your Slot</div>
            <div className="font-semibold">TBD</div>
          </div>
        </section>
      </div>
    </main>
  );
}
