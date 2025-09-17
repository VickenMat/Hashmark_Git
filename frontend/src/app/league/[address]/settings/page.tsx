// src/app/league/[address]/settings/page.tsx
'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  useAccount,
  useReadContract,
  useReadContracts,
} from 'wagmi';
import { useTeamProfile } from '@/lib/teamProfile';

/* ----------------------- ABI (reads only) ----------------------- */
const LEAGUE_ABI = [
  { type: 'function', name: 'name',                stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'commissioner',        stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'createdAt',           stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'buyInToken',          stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'buyInAmount',         stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'escrowBalances',      stateMutability: 'view', inputs: [], outputs: [{ type:'uint256' }, { type:'uint256' }] },
  { type: 'function', name: 'teamCap',             stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'requiresPassword',    stateMutability: 'view', inputs: [], outputs: [{ type: 'bool'    }] },
  { type: 'function', name: 'getTeams',            stateMutability: 'view', inputs: [], outputs: [{
      type: 'tuple[]',
      components: [
        { name: 'owner', type: 'address' },
        { name: 'name',  type: 'string'  },
      ],
    }]
  },
  // NOTE: League.sol returns 6 values here
  { type: 'function', name: 'getDraftSettings',    stateMutability: 'view', inputs: [], outputs: [
      { type: 'uint8'   }, // draftType
      { type: 'uint64'  }, // draftTimestamp
      { type: 'uint8'   }, // orderMode
      { type: 'bool'    }, // draftCompleted
      { type: 'address[]' }, // manualOrder
      { type: 'bool'    }, // draftPickTradingEnabled
    ]
  },
  // For payment progress per team (view only summary)
  { type: 'function', name: 'hasPaid',             stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;

const ZERO = '0x0000000000000000000000000000000000000000';

type Team = { owner: `0x${string}`; name: string };

/* ----------------------- helpers ----------------------- */
function formatAvax(wei?: bigint) {
  if (wei === undefined) return '—';
  if (wei === 0n) return 'Free';
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n) + 10n ** 18n;
  const fracStr = frac.toString().slice(1).slice(0, 4);
  return `${whole}.${fracStr} AVAX`;
}
function shortAddr(a?: string) {
  if (!a) return '—';
  return `${a.slice(0,6)}…${a.slice(-4)}`;
}
function fmtDateSecs(s?: bigint) {
  const n = Number(s ?? 0n);
  if (!n) return '—';
  return new Date(n * 1000).toLocaleString();
}
function initials(n?: string){
  const s=(n||'').trim(); if(!s) return 'TM';
  const p=s.split(/\s+/); return ((p[0]?.[0]??'') + (p[1]?.[0]??'')).toUpperCase() || 'TM';
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

/* Label maps (show numeric code if unknown) */
function draftTypeLabel(code?: number) {
  if (code === undefined) return '—';
  // Adjust these to your exact enum; we show the numeric too.
  const map: Record<number, string> = {
    0: 'Snake',
    1: 'Linear',
    2: 'Auction',
  };
  return map[code] ? `${map[code]} (${code})` : `Unknown (${code})`;
}
function orderModeLabel(code?: number) {
  if (code === undefined) return '—';
  const map: Record<number, string> = {
    0: 'Randomize',
    1: 'Manual',
    2: 'Reverse Standings',
  };
  return map[code] ? `${map[code]} (${code})` : `Unknown (${code})`;
}

/* Render a manual-order address with resolved team name (GLOBAL profile fallback) */
function OrderTeamRow({ league, addr }: { league: `0x${string}`; addr: `0x${string}` }) {
  const { data: onchainName } = useReadContract({
    abi: LEAGUE_ABI,
    address: league,
    functionName: 'getTeamByAddress',
    args: [addr],
  });
  const prof = useTeamProfile(league, addr, { name: onchainName as string });
  const name = (prof.name || (onchainName as string) || '').trim() || shortAddr(addr);

  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="flex items-center gap-3 min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {prof.logo ? (
          <img src={prof.logo} alt={name} className="h-7 w-7 rounded-md object-cover ring-1 ring-white/15" />
        ) : (
          <div className="h-7 w-7 rounded-md bg-white/10 grid place-items-center text-[11px] font-semibold">
            {initials(name)}
          </div>
        )}
        <div className="min-w-0">
          <div className="font-medium truncate" title={name}>{name}</div>
          <div className="text-[11px] text-gray-400 font-mono truncate">{addr}</div>
        </div>
      </div>
      <CopyBtn value={addr} />
    </div>
  );
}

/* ----------------------- Page ----------------------- */
export default function LeagueSettingsView() {
  const { address: league } = useParams<{ address: `0x${string}` }>();
  const { address: wallet } = useAccount();

  /* Core reads */
  const { data: leagueName }     = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' });
  const { data: commissioner }   = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'commissioner' });
  const { data: createdAt }      = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'createdAt' });
  const { data: buyInToken }     = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'buyInToken' });
  const { data: buyInAmount }    = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'buyInAmount' });
  const { data: escrowTuple }    = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'escrowBalances' });
  const { data: teamCapRaw }     = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'teamCap' });
  const { data: requiresPw }     = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'requiresPassword' });
  const { data: draft }          = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'getDraftSettings' });
  const { data: teamsRaw }       = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'getTeams' });

  const isNative = ((buyInToken as string | undefined)?.toLowerCase() ?? '') === ZERO;

  const escrowNative = (escrowTuple as readonly [bigint, bigint] | undefined)?.[0];
  const escrowToken  = (escrowTuple as readonly [bigint, bigint] | undefined)?.[1];

  const teamCap = (() => {
    try { return Number(teamCapRaw as bigint); } catch { return undefined; }
  })();

  const draftType  = Number((draft as any)?.[0] ?? undefined);
  const draftTs    = BigInt((draft as any)?.[1] ?? 0n);
  const orderMode  = Number((draft as any)?.[2] ?? undefined);
  const draftDone  = Boolean((draft as any)?.[3] ?? false);
  const manualList = ((draft as any)?.[4] ?? []) as `0x${string}`[];
  const pickTrade  = Boolean((draft as any)?.[5] ?? false);

  const teams: Team[] = useMemo(() => {
    const list = (teamsRaw as unknown as Team[] | undefined) ?? [];
    return list.filter(t => t.owner && t.owner !== ZERO);
  }, [teamsRaw]);

  const teamsJoined = teams.length;

  /* Payment progress (view-only) */
  const hasPaidReads = useMemo(() => teams.map(t => ({
    abi: LEAGUE_ABI,
    address: league,
    functionName: 'hasPaid' as const,
    args: [t.owner],
  })), [league, teams]);
  const paidRes = useReadContracts({
    contracts: hasPaidReads,
    query: { enabled: hasPaidReads.length > 0 },
  });
  const paidCount = useMemo(() => {
    if (!teams.length) return 0;
    let n = 0;
    for (let i=0;i<teams.length;i++) {
      if ((paidRes.data?.[i]?.result as boolean | undefined) === true) n++;
    }
    return n;
  }, [teams.length, paidRes.data]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-6 py-10">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold">League Settings (View-Only)</h1>
            <p className="text-sm text-gray-400 font-mono mt-1">{league}</p>
          </div>

          {/* Optional: quick link to LM Tools for commish */}
          {wallet && commissioner && wallet.toLowerCase() === (commissioner as string).toLowerCase() && (
            <Link
              href={`/league/${league}/lm-tools`}
              className="rounded-lg border border-fuchsia-400/50 bg-fuchsia-500/10 px-4 py-2 text-sm font-semibold text-fuchsia-200 hover:border-fuchsia-400"
              title="Open LM Tools (editable settings)"
            >
              Open LM Tools
            </Link>
          )}
        </header>

        {/* Summary tiles */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="LEAGUE NAME"   value={String(leagueName || '—')} />
          <Tile label="COMMISSIONER"  value={commissioner ? shortAddr(commissioner as string) : '—'} />
          <Tile label="CREATED"       value={fmtDateSecs(createdAt as bigint)} />
          <Tile label="TEAMS"         value={`${teamsJoined}${teamCap ? ` / ${teamCap}` : ''}`} />
        </section>

        {/* Financials */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold mb-4">Financials</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KV label="Buy-In"
                value={isNative
                  ? formatAvax(buyInAmount as bigint)
                  : `${String(buyInAmount ?? 0)} (ERC-20)`} />
            <KV label="Buy-In Token"
                value={isNative ? 'Native (AVAX)' : (buyInToken as string || '—')}
                copy={isNative ? undefined : (buyInToken as string)} />
            <KV label="Escrow (Native)"
                value={formatAvax(escrowNative)} />
            <KV label="Escrow (Token)"
                value={String(escrowToken ?? 0n)} />
            <KV label="Payments Progress"
                value={teamsJoined > 0
                  ? `${paidCount}/${teamsJoined} paid`
                  : '—'} />
          </div>
        </section>

        {/* Access & Roster */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold mb-4">Access & Roster</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KV label="Requires Password" value={(requiresPw as boolean) ? 'Yes' : 'No'} />
            <KV label="Team Cap" value={typeof teamCap === 'number' ? String(teamCap) : '—'} />
          </div>
        </section>

        {/* Draft Settings */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold mb-4">Draft</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KV label="Draft Type" value={draftTypeLabel(draftType)} />
            <KV label="Order Mode" value={orderModeLabel(orderMode)} />
            <KV label="Draft Time" value={fmtDateSecs(draftTs)} />
            <KV label="Draft Completed" value={draftDone ? 'Yes' : 'No'} />
            <KV label="Pick Trading Enabled" value={pickTrade ? 'Yes' : 'No'} />
          </div>

          {/* Manual order list */}
          <div className="mt-5">
            <div className="mb-2 text-sm text-gray-300 font-semibold">Manual Draft Order</div>
            {manualList?.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {manualList.map((addr) => (
                  <OrderTeamRow key={addr} league={league} addr={addr} />
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-500">No manual order set.</div>
            )}
          </div>
        </section>

        {/* Members quick view */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold mb-4">Members (Read-Only)</h2>
          {teamsJoined === 0 ? (
            <div className="text-sm text-gray-400">No teams have joined yet.</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {teams.map((t) => (
                <OrderTeamRow key={t.owner} league={league} addr={t.owner} />
              ))}
            </div>
          )}
          <div className="mt-4 text-sm">
            Want the full list? Open{' '}
            <Link href={`/league/${league}/members`} className="text-fuchsia-300 hover:underline">
              Members
            </Link>
            .
          </div>
        </section>
      </div>
    </main>
  );
}

/* ----------------------- tiny presentational bits ----------------------- */
function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
      <div className="text-[11px] tracking-[0.2em] text-gray-400">{label}</div>
      <div className="mt-2 text-xl font-extrabold break-words">{value}</div>
    </div>
  );
}

function KV({ label, value, copy }: { label: string; value: React.ReactNode; copy?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
      <div className="text-[11px] tracking-[0.2em] text-gray-400 flex items-center justify-between">
        <span>{label}</span>
        {copy ? <CopyBtn value={copy} /> : null}
      </div>
      <div className="mt-1 text-sm font-medium break-words">{value}</div>
    </div>
  );
}