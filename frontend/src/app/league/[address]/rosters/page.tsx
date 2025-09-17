// src/app/league/[address]/rosters/page.tsx
'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import { useTeamProfile } from '@/lib/teamProfile';

const ZERO = '0x0000000000000000000000000000000000000000';

const LEAGUE_ABI = [
  { type: 'function', name: 'name',             stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getTeamByAddress', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'string' }] },
  {
    type: 'function',
    name: 'getTeams',
    stateMutability: 'view',
    inputs: [],
    outputs: [{
      type: 'tuple[]',
      components: [
        { name: 'owner', type: 'address' },
        { name: 'name',  type: 'string'  },
      ],
    }],
  },
] as const;

/** Roster settings ABI */
const ROSTER_ABI = [
  {
    type:'function', name:'getRosterSettings', stateMutability:'view', inputs:[], outputs:[{
      type:'tuple', components:[
        { name:'qb',           type:'uint8' },
        { name:'rb',           type:'uint8' },
        { name:'wr',           type:'uint8' },
        { name:'te',           type:'uint8' },
        { name:'flexWRT',      type:'uint8' },
        { name:'flexWR',       type:'uint8' },
        { name:'flexWT',       type:'uint8' },
        { name:'superFlexQWRT',type:'uint8' },
        { name:'idpFlex',      type:'uint8' },
        { name:'k',            type:'uint8' },
        { name:'dst',          type:'uint8' },
        { name:'dl',           type:'uint8' },
        { name:'lb',           type:'uint8' },
        { name:'db',           type:'uint8' },
        { name:'bench',        type:'uint8' },
        { name:'ir',           type:'uint8' },
      ]
    }]},
] as const;

type Team = { owner: `0x${string}`; name: string };

// compute starters/bench/ir from chain tuple
function useRosterShape(league: `0x${string}`) {
  // wagmi hook
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { data } = useReadContract({ abi: ROSTER_ABI, address: league, functionName: 'getRosterSettings' });
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useMemo(() => {
    const n = (x: any, d=0) => Number(x ?? d);
    const t = data as any;
    const starters: string[] = [];
    starters.push(...Array(n(t?.qb,1)).fill('QB'));
    starters.push(...Array(n(t?.rb,2)).fill('RB'));
    starters.push(...Array(n(t?.wr,2)).fill('WR'));
    starters.push(...Array(n(t?.te,1)).fill('TE'));
    const flexCount = n(t?.flexWRT,1)+n(t?.flexWR,0)+n(t?.flexWT,0)+n(t?.superFlexQWRT,0)+n(t?.idpFlex,0);
    starters.push(...Array(flexCount).fill('FLEX'));
    starters.push(...Array(n(t?.dst,1)).fill('D/ST'));
    starters.push(...Array(n(t?.k,1)).fill('K'));
    starters.push(...Array(n(t?.dl,0)).fill('DL'));
    starters.push(...Array(n(t?.lb,0)).fill('LB'));
    starters.push(...Array(n(t?.db,0)).fill('DB'));
    const bench = n(t?.bench,5);
    const ir = n(t?.ir,1);
    return { starters, bench, ir };
  }, [data]);
}

// --- Types for fake roster data ---
type Acquisition = 'Draft' | 'Free Agency' | 'Trade';
type RosterPlayer = {
  slot: string;          // e.g., "QB", "RB1", "Bench", "IR"
  name: string;
  nflTeam?: string;
  position?: string;     // e.g., "RB"
  acq?: Acquisition;     // how acquired
};
const rostersByOwner: Record<string, RosterPlayer[] | undefined> = Object.create(null);

function initials(n?: string){ const s=(n||'').trim(); if(!s) return 'TM'; const p=s.split(/\s+/); return ((p[0]?.[0]??'')+(p[1]?.[0]??'')).toUpperCase() || 'TM'; }
function Avatar({ name, url }:{ name?:string; url?:string }) {
  const safe = name?.trim() || '—';
  return url
    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={url} alt={safe} className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/15"/>
    : <div className="h-10 w-10 rounded-xl bg-white/10 grid place-items-center font-semibold">{initials(safe)}</div>;
}
function CopyBtn({ value }: { value: string }) {
  return (
    <button
      onClick={() => navigator.clipboard.writeText(value)}
      className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-gray-200 hover:border-fuchsia-400/60 transition"
      title="Copy to clipboard"
    >
      Copy
    </button>
  );
}
const shortAddr = (a?: string, head=6, tail=4) =>
  !a ? '—' : a.length > head + tail + 2 ? `${a.slice(0, head + 2)}…${a.slice(-tail)}` : a;

// one row in the roster table
function SlotRow({ slot, player }: { slot: string; player?: RosterPlayer }) {
  if (!player) {
    return (
      <div className="grid grid-cols-[70px_1fr_120px] items-center gap-3 px-3 py-2 rounded-lg border border-white/5 bg-white/[0.02]">
        <div className="text-xs text-gray-400">{slot}</div>
        <div className="text-sm text-gray-500 italic">—</div>
        <div className="text-[11px] text-gray-500 text-right">—</div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[70px_1fr_120px] items-center gap-3 px-3 py-2 rounded-lg border border-white/10 bg-black/25">
      <div className="text-xs text-gray-300 font-medium">{slot}</div>
      <div className="flex flex-col">
        <div className="text-sm font-semibold">{player.name}</div>
        <div className="text-xs text-gray-400">{[player.position, player.nflTeam].filter(Boolean).join(' • ')}</div>
      </div>
      <div className="text-[11px] text-right">
        <span className="rounded px-2 py-0.5 border border-white/10 bg-white/5">{player.acq || '—'}</span>
      </div>
    </div>
  );
}

function TeamCard({
  league,
  owner,
  fallbackName,
  you,
  starters,
  benchCount,
  irCount,
}: {
  league: `0x${string}`;
  owner: `0x${string}`;
  fallbackName: string;
  you: boolean;
  starters: string[];
  benchCount: number;
  irCount: number;
}) {
  const prof = useTeamProfile(league, owner, { name: fallbackName });
  const displayName = (prof.name || fallbackName || '').trim() || 'Team';
  const record = '0-0-0'; // TODO: wire real record
  const roster = rostersByOwner[owner.toLowerCase()] || [];

  // Build the exact starter labels (display base, keep keys unique internally)
  const counts: Record<string, number> = {};
  const starterRows = starters.map((base) => {
    counts[base] = (counts[base] || 0) + 1;
    const key = `${base}-${counts[base]}`;
    const player =
      roster.find(r => r.slot === `${base}${counts[base]}`) ||
      roster.find(r => r.slot === base);
    return { key, label: base, player };
  });

  const benchRows = Array.from({ length: benchCount }, (_, i) => {
    const key = `Bench-${i+1}`;
    const player = roster.find(r => r.slot === `Bench${i+1}`) || roster.find(r => r.slot === 'Bench');
    return { key, player };
  });

  const irRows = Array.from({ length: irCount }, (_, i) => {
    const key = `IR-${i+1}`;
    const player = roster.find(r => r.slot === `IR${i+1}`) || roster.find(r => r.slot === 'IR');
    return { key, player };
  });

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
      {/* Header row */}
      <div className="flex items-center gap-3">
        <Avatar name={displayName} url={prof.logo}/>
        <div className="min-w-0 mr-auto">
          <div className="flex items-center gap-2">
            <Link
              href={`/league/${league}/rosters/${owner}`}
              className="font-semibold hover:underline truncate"
              title={`Open ${displayName}`}
            >
              {displayName}
            </Link>
          </div>
          <div className="mt-0.5 text-xs text-gray-400 font-mono flex items-center gap-2">
            <span>{shortAddr(owner)}</span>
            <CopyBtn value={owner}/>
          </div>
          <div className="mt-0.5 text-[11px] text-gray-400">Record {record}</div>
        </div>
      </div>

      {/* Roster table header — POS not SLOT */}
      <div className="grid grid-cols-[70px_1fr_120px] items-center gap-3 px-3 text-[11px] tracking-[0.18em] text-gray-400">
        <div>POS</div>
        <div>PLAYER</div>
        <div className="text-right">ACQ</div>
      </div>

      {/* Starters */}
      <div className="space-y-2">
        {starterRows.map(({ key, label, player }) => (
          <SlotRow key={key} slot={label} player={player}/>
        ))}
      </div>

      {/* Bench */}
      <div>
        <div className="text-xs tracking-[0.18em] text-gray-400 mt-4 mb-2 text-center">BENCH</div>
        <div className="space-y-2">
          {benchRows.map(({ key, player }) => (
            <SlotRow key={key} slot="Bench" player={player}/>
          ))}
        </div>
      </div>

      {/* IR */}
      <div>
        <div className="text-xs tracking-[0.18em] text-gray-400 mt-4 mb-2 text-center">IR</div>
        <div className="space-y-2">
          {irRows.map(({ key, player }) => (
            <SlotRow key={key} slot="IR" player={player}/>
          ))}
        </div>
      </div>

      {/* Propose Trade below IR, centered */}
      {!you && (
        <div className="pt-2 flex justify-center">
          <button
            className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-600/20 px-4 py-2 text-sm text-fuchsia-100 hover:border-fuchsia-400/60"
            onClick={() => { window.location.href = `/league/${league}/trade?with=${owner}`; }}
            title="Propose a trade to this team"
          >
            Propose Trade
          </button>
        </div>
      )}

      <div className="text-[11px] text-gray-500">
        {roster.length === 0
          ? 'Pre-draft: roster will populate after the draft completes.'
          : 'Acquisition shows how each player joined this roster (Draft, Free Agency, Trade)'}
      </div>
    </div>
  );
}

export default function RostersPage() {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const { address: wallet } = useAccount();

  const { data: leagueName } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' });
  const { data: myOnChainName } = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getTeamByAddress',
    args: [wallet ?? ZERO], query: { enabled: !!wallet }
  });
  const { data: teamsRaw } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'getTeams' });

  const myProfile = useTeamProfile(league, wallet, { name: myOnChainName as string });
  const myDisplayName = (myProfile.name || (myOnChainName as string) || '').trim() || undefined;

  const teams: Team[] = useMemo(() => {
    const list = (teamsRaw as unknown as Team[] | undefined) ?? [];
    return list
      .filter(t => t.owner && t.owner !== ZERO)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [teamsRaw]);

  // dynamic roster shape for this league
  const shape = useRosterShape(league);

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Centered title bar + clickable team pill */}
        <div className="grid grid-cols-3 items-start">
          <div />
          <div className="text-center">
            <h1 className="text-3xl font-extrabold">Rosters</h1>
            <div className="text-sm text-gray-400">{String(leagueName || '')}</div>
          </div>
          <div className="justify-self-end">
            {wallet && (
              <a
                href={`/league/${league}/team/${wallet}`}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 hover:bg-white/10 transition"
              >
                <Avatar name={myDisplayName || 'Team'} url={myProfile.logo} />
                <div className="leading-tight">
                  <div className="text-base font-semibold truncate max-w-[180px]">
                    {(myDisplayName || 'Team').trim()}
                  </div>
                  <div className="text-[11px] text-gray-400 font-mono">
                    {shortAddr(wallet)}
                  </div>
                </div>
              </a>
            )}
          </div>
        </div>

        {/* Three cards per row (wraps) */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          {teams.length === 0 ? (
            <p className="text-sm text-gray-400">No teams yet.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {teams.map((t) => (
                <TeamCard
                  key={t.owner}
                  league={league}
                  owner={t.owner}
                  fallbackName={t.name}
                  you={!!wallet && wallet.toLowerCase() === t.owner.toLowerCase()}
                  starters={shape.starters}
                  benchCount={shape.bench}
                  irCount={shape.ir}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
