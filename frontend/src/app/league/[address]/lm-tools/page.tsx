// src/app/league/[address]/lm-tools/page.tsx
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import CommissionerGuard from '@/components/CommissionerGuard';
import { useTeamProfile } from '@/lib/teamProfile';

const LEAGUE_ABI = [
  { type:'function', name:'name', stateMutability:'view', inputs:[], outputs:[{type:'string'}] },
  { type:'function', name:'getTeamByAddress', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'string'}] },
] as const;

const ZERO = '0x0000000000000000000000000000000000000000' as const;

/* ─────────── helpers ─────────── */
function shortAddr(a?: string){ if(!a) return '—'; return `${a.slice(0,6)}…${a.slice(-4)}`; }
function initials(n?: string){ const s=(n||'').trim(); if(!s) return 'TM'; const p=s.split(/\s+/); return ((p[0]?.[0]??'')+(p[1]?.[0]??'')).toUpperCase() || 'TM'; }

/* ─────────── UI bits ─────────── */
function CopyBtn({ value, label='Copy' }:{ value?: string; label?: string }) {
  if (!value) return null;
  return (
    <button
      onClick={() => navigator.clipboard.writeText(value)}
      className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] hover:border-fuchsia-400/60 transition"
      title="Copy to clipboard"
    >
      {label}
    </button>
  );
}

function MyTeamPill({ href, name, logo, wallet }:{
  href:string; name?:string; logo?:string; wallet?:`0x${string}`|undefined;
}) {
  const display = name?.trim() || 'My Team';
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] px-3 py-2 shadow-lg ring-1 ring-black/20 hover:border-fuchsia-400/60 transition"
      title="Go to My Team"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? (
        <img src={logo} alt={display} className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/15"/>
      ) : (
        <div className="h-9 w-9 rounded-xl bg-white/10 grid place-items-center text-xs font-bold">
          {initials(display)}
        </div>
      )}
      <div className="leading-tight text-left">
        <div className="font-semibold text-white">{display}</div>
        <div className="text-[11px] font-mono text-gray-300">{shortAddr(wallet)}</div>
      </div>
    </Link>
  );
}

function InfoBox({
  label, value, full, canCopy,
}:{
  label:string; value:React.ReactNode; full?:string; canCopy?:boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-4">
      <div className="text-[10px] font-semibold tracking-[0.2em] text-gray-400">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="min-w-0 font-medium truncate" title={typeof full === 'string' ? full : undefined}>
          {value}
        </div>
        {canCopy && <CopyBtn value={full} />}
      </div>
    </div>
  );
}

function Tile({ href, title, desc, emoji }:{
  href:string; title:string; desc:string; emoji:string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-fuchsia-400/50 hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-fuchsia-400/40 text-center shadow-sm"
    >
      <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-xl">
        {emoji}
      </div>
      <div className="text-[15px] font-semibold">{title}</div>
      <div className="mt-1 text-[13px] text-gray-400">{desc}</div>
      <div className="mt-2 text-[11px] text-fuchsia-300 opacity-0 transition group-hover:opacity-100">
        Changes are saved on-chain
      </div>
    </Link>
  );
}

/* ─────────── Page ─────────── */
export default function LMToolsLanding() {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const { address: wallet } = useAccount();

  const { data: leagueName } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' });
  const { data: onChainTeamName } = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getTeamByAddress',
    args: [wallet ?? ZERO], query: { enabled: !!wallet }
  });

  const prof = useTeamProfile(league, wallet, { name: onChainTeamName as string });
  const displayName = (prof.name || (onChainTeamName as string) || '').trim() || undefined;

  const base = `/league/${league}/settings`;

  return (
    <CommissionerGuard>
      <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* Header: centered title + My Team pill on the right */}
          <div className="flex items-start justify-between">
            <div className="flex-1" />
            <h1 className="text-3xl font-extrabold text-center flex-1">LM Tools</h1>
            <div className="flex-1 flex justify-end">
              <MyTeamPill href={`/league/${league}/team`} name={displayName} logo={prof.logo} wallet={wallet} />
            </div>
          </div>

          {/* League info bar: short values + Copy buttons */}
          <section className="rounded-2xl border border-white/10 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(250,116,255,0.08),transparent_60%),radial-gradient(120%_120%_at_100%_0%,rgba(123,97,255,0.08),transparent_60%)] p-5 shadow-inner">
            <div className="grid gap-4 sm:grid-cols-3">
              <InfoBox label="LEAGUE" value={<span className="font-semibold">{String(leagueName || '—')}</span>} />
              <InfoBox
                label="LEAGUE ADDRESS"
                value={<span className="font-mono text-sm">{shortAddr(league)}</span>}
                full={league}
                canCopy
              />
              <InfoBox
                label="YOUR WALLET"
                value={<span className="font-mono text-sm">{shortAddr(wallet)}</span>}
                full={wallet}
                canCopy
              />
            </div>
          </section>

          {/* Centered commissioner note */}
          <div className="flex justify-center">
            <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-amber-100 text-center w-full sm:w-auto">
              Commissioner-only. Choose a section to edit on-chain
            </div>
          </div>

          {/* Tiles — slightly smaller, centered */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Tile href={`${base}/league-settings`}      title="League Settings"       desc="Adjust basic settings"            emoji="🏟️" />
            <Tile href={`${base}/team-settings`}        title="Team Settings"         desc="Change your team name & logo"    emoji="🏈" />
            <Tile href={`${base}/roster-settings`}      title="Roster Settings"       desc="Roster sizes & positions"        emoji="🧩" />
            <Tile href={`${base}/scoring-settings`}     title="Scoring Settings"      desc="Scoring rules & bonuses"         emoji="🔢" />
            <Tile href={`${base}/draft-settings`}       title="Draft Settings"        desc="Draft config & pick-trading"     emoji="🗓️" />
            <Tile href={`${base}/member-settings`}      title="Member Settings"       desc="Invites, limits, password"       emoji="👥" />
            <Tile href={`${base}/co-owner-settings`}    title="Co-Owner Settings"     desc="Add/manage co-owners"            emoji="🤝" />
            <Tile href={`${base}/playoff-settings`}     title="Playoff Settings"      desc="Teams, start week, rounds, seeding" emoji="🏆" />
            <Tile href={`${base}/division-settings`}    title="Division Settings"     desc="Divisions & scheduling"          emoji="🧭" />
            <Tile href={`${base}/commissioner-control`} title="Commissioner Control"  desc="Locks, pauses, global toggles"   emoji="🎛️" />
            <Tile href={`${base}/previous-leagues`}     title="Previous Leagues"      desc="Import settings from prior years" emoji="🕰️" />
            <Tile href={`${base}/delete-league`}        title="Delete / Reset League" desc="Reset rosters or delete the league" emoji="🗑️" />
          </section>
        </div>
      </main>
    </CommissionerGuard>
  );
}
