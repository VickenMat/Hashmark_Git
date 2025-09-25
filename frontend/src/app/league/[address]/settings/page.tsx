// src/app/league/[address]/settings/page.tsx
'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { useTeamProfile } from '@/lib/teamProfile';

/* ---------------- ABIs ---------------- */
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
  { type: 'function', name: 'getDraftSettings',    stateMutability: 'view', inputs: [], outputs: [
      { type: 'uint8'   }, // draftType
      { type: 'uint64'  }, // draftTimestamp
      { type: 'uint8'   }, // orderMode
      { type: 'bool'    }, // draftCompleted
      { type: 'address[]' }, // manualOrder
      { type: 'bool'    }, // draftPickTradingEnabled
    ]
  },
  { type: 'function', name: 'hasPaid',             stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name:'getTeamByAddress',     stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'string'}] },
] as const;

const SETTINGS_ABI = [
  { type:'function', name:'getLeagueSettings', stateMutability:'view', inputs:[], outputs:[{ type:'tuple', components:[
    { name:'leagueName', type:'string' },
    { name:'leagueLogo', type:'string' },
    { name:'numberOfTeams', type:'uint8' },
    { name:'waiverType', type:'uint8' },
    { name:'waiverBudget', type:'uint64' },
    { name:'waiverMinBid', type:'uint64' },
    { name:'waiverClearance', type:'uint8' },
    { name:'waiversAfterDropDays', type:'uint8' },
    { name:'tradeReviewDays', type:'uint8' },
    { name:'tradeDeadlineWeek', type:'uint8' },
    { name:'leagueType', type:'uint8' },
    { name:'extraGameVsMedian', type:'bool' },
    { name:'preventDropAfterKickoff', type:'bool' },
    { name:'lockAllMoves', type:'bool' },
  ]}]},
] as const;

const ZERO = '0x0000000000000000000000000000000000000000';

/* ---------------- helpers ---------------- */
function shortAddr(a?: string) { if (!a) return '—'; return `${a.slice(0,6)}…${a.slice(-4)}`; }
function fmtDateSecs(s?: bigint) { const n = Number(s ?? 0n); if (!n) return '—'; return new Date(n * 1000).toLocaleString(); }
function initials(n?: string){ const s=(n||'').trim(); if(!s) return 'TM'; const p=s.split(/\s+/); return ((p[0]?.[0]??'') + (p[1]?.[0]??'')).toUpperCase() || 'TM'; }
const num = (v: unknown): number | undefined => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };

function CopyBtn({ value }: { value?: string }) {
  if (!value) return null;
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

function InfoBox({ label, value, full, canCopy }:{
  label:string; value:React.ReactNode; full?:string; canCopy?:boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-4 text-center">
      <div className="text-[10px] font-semibold tracking-[0.2em] text-gray-400">{label}</div>
      <div className="mt-1 flex items-center justify-center gap-2">
        <div className="min-w-0 font-medium truncate" title={typeof full === 'string' ? full : undefined}>
          {value}
        </div>
        {canCopy && <CopyBtn value={full} />}
      </div>
    </div>
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

/* Simple labels (no numeric codes) */
function draftTypeLabel(code?: number) {
  return ({0:'Snake',1:'Linear',2:'Auction'} as Record<number,string>)[Number(code ?? -1)] ?? '—';
}
function orderModeLabel(code?: number) {
  return ({0:'Randomize',1:'Manual',2:'Reverse Standings'} as Record<number,string>)[Number(code ?? -1)] ?? '—';
}
const WAIVER_TYPE: Record<number,string> = { 0: 'Rolling', 1: 'Reverse standings', 2: 'FAAB' };
const LEAGUE_TYPE: Record<number,string> = { 0: 'Redraft', 1: 'Keeper', 2: 'Dynasty' };

function formatAvax2dp(wei?: bigint) {
  if (wei === undefined) return '—';
  const n = Number(wei) / 1e18;
  return `${n.toFixed(2)} AVAX`;
}

/* ---------------- Page ---------------- */
export default function LeagueSettingsView() {
  const { address: league } = useParams<{ address: `0x${string}` }>();
  const { address: wallet } = useAccount();

  // Core reads
  const { data: leagueName }   = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' });
  const { data: commissioner } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'commissioner' });
  const { data: createdAt }    = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'createdAt' });
  const { data: buyInToken }   = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'buyInToken' });
  const { data: buyInAmount }  = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'buyInAmount' });
  const { data: escrowTuple }  = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'escrowBalances' });
  const { data: teamCapRaw }   = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'teamCap' });
  const { data: draft }        = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'getDraftSettings' });
  const { data: teamsRaw }     = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'getTeams' });

  // My team pill (profile)
  const { data: onChainTeamName } = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getTeamByAddress',
    args: [wallet ?? ZERO], query: { enabled: !!wallet }
  });
  const prof = useTeamProfile(league, wallet, { name: onChainTeamName as string });
  const displayName = (prof.name || (onChainTeamName as string) || '').trim() || undefined;

  // LM settings (read-only mirror)
  const { data: s } = useReadContract({
    abi: SETTINGS_ABI, address: league, functionName: 'getLeagueSettings'
  });
  const lm = s as any;

  const isNative = ((buyInToken as string | undefined)?.toLowerCase() ?? '') === ZERO;
  const escrowNative = (escrowTuple as readonly [bigint, bigint] | undefined)?.[0];

  const teamCap = (() => { try { return Number(teamCapRaw as bigint); } catch { return undefined; } })();

  const draftType  = Number((draft as any)?.[0] ?? undefined);
  const draftTs    = BigInt((draft as any)?.[1] ?? 0n);
  const orderMode  = Number((draft as any)?.[2] ?? undefined);
  const draftDone  = Boolean((draft as any)?.[3] ?? false);

  const teams = useMemo(() => {
    const list = (teamsRaw as unknown as { owner:`0x${string}`; name:string }[] | undefined) ?? [];
    return list.filter(t => t.owner && t.owner !== ZERO);
  }, [teamsRaw]);

  const paidRes = useReadContracts({
    contracts: teams.map(t => ({
      abi: LEAGUE_ABI, address: league, functionName: 'hasPaid' as const, args: [t.owner],
    })),
    query: { enabled: teams.length > 0 },
  });
  const paidCount = useMemo(() => {
    if (!teams.length) return 0;
    let n = 0;
    for (let i=0;i<teams.length;i++) {
      if ((paidRes.data?.[i]?.result as boolean | undefined) === true) n++;
    }
    return n;
  }, [teams.length, paidRes.data]);

  // Derived LM settings (read-only)
  const lmLeagueName   = (lm?.leagueName ?? '') as string;
  const lmTeams        = num(lm?.numberOfTeams) ?? teams.length || '—';
  const lmWaiverType   = ({0:'Rolling',1:'Reverse standings',2:'FAAB'} as Record<number,string>)[num(lm?.waiverType) ?? 0] ?? '—';
  const lmFaabBudget   = Number(lm?.waiverBudget ?? 0);
  const lmMinBid       = Number(lm?.waiverMinBid ?? 0);
  const lmWAfterDrop   = num(lm?.waiversAfterDropDays) ?? 0;
  const lmTradeReview  = num(lm?.tradeReviewDays) ?? 0;
  const lmDeadlineWk   = num(lm?.tradeDeadlineWeek) ?? 0;
  const lmType         = ({0:'Redraft',1:'Keeper',2:'Dynasty'} as Record<number,string>)[num(lm?.leagueType) ?? 0] ?? '—';
  const lmVsMedian     = Boolean(lm?.extraGameVsMedian);
  const lmNoDropAfter  = Boolean(lm?.preventDropAfterKickoff);
  const lmLockMoves    = Boolean(lm?.lockAllMoves);

  const totalTeamsForPayments = teamCap ?? teams.length;

  const headerTitle = `${String(leagueName || lmLeagueName || 'League')} Settings`;

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-6 py-10">
      <div className="mx-auto w-full max-w-6xl space-y-8 text-center">
        {/* Header: centered; title is "[League Name] Settings" */}
        <header className="flex items-start justify-between">
          <div className="flex-1" />
          <h1 className="text-3xl font-extrabold text-center flex-1">{headerTitle}</h1>
          <div className="flex-1 flex justify-end">
            <MyTeamPill href={`/league/${league}/team`} name={displayName} logo={prof.logo} wallet={wallet} />
          </div>
        </header>

        {/* Info bar: MY TEAM / LEAGUE ADDRESS / COMMISSIONER */}
        <section className="rounded-2xl border border-white/10 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(250,116,255,0.08),transparent_60%),radial-gradient(120%_120%_at_100%_0%,rgba(123,97,255,0.08),transparent_60%)] p-5 shadow-inner">
          <div className="grid gap-4 sm:grid-cols-3">
            <InfoBox
              label="MY TEAM"
              value={<span className="font-mono text-sm">{shortAddr(wallet)}</span>}
              full={wallet as string}
              canCopy
            />
            <InfoBox
              label="LEAGUE ADDRESS"
              value={<span className="font-mono text-sm">{shortAddr(league)}</span>}
              full={league}
              canCopy
            />
            <InfoBox
              label="COMMISSIONER"
              value={<span className="font-mono text-sm">{shortAddr(commissioner as string)}</span>}
              full={commissioner as string}
              canCopy
            />
          </div>
        </section>

        {/* Summary tiles stay as before */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoBox label="CREATED" value={fmtDateSecs(createdAt as bigint)} />
          <InfoBox label="TEAMS JOINED / CAP" value={`${teams.length}${teamCap ? ` / ${teamCap}` : ''}`} />
          <InfoBox label="LEAGUE TYPE" value={lmType} />
          <InfoBox label="DRAFT" value={`${draftTypeLabel(Number(draftType))}${draftDone ? ' • Completed' : ''}`} />
        </section>

        {/* Financials (centered, 2dp, no token escrow box) */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold mb-4">Financials</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoBox label="Buy-In" value={isNative ? formatAvax2dp(buyInAmount as bigint) : `${String(buyInAmount ?? 0)} (ERC-20)`} />
            <InfoBox label="Buy-In Token" value={isNative ? 'Native (AVAX)' : (buyInToken as string || '—')} full={isNative ? undefined : (buyInToken as string)} canCopy={!isNative} />
            <InfoBox label="Escrow (Native)" value={formatAvax2dp(escrowNative)} />
            <InfoBox label="Payments Progress" value={`${paidCount}/${totalTeamsForPayments} paid`} />
          </div>
        </section>

        {/* League Settings — responsive grid: 2 cols on half, 3 cols on full */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold mb-4">League Settings</h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoBox label="League Name" value={String(lmLeagueName || leagueName || '—')} />
            <InfoBox label="Number of Teams" value={String(lmTeams)} />
            <InfoBox label="League Type" value={lmType} />

            <InfoBox label="Waiver Type" value={lmWaiverType} />
            {/* Only show FAAB details when FAAB is the waiver type */}
            {lmWaiverType === 'FAAB' && (
              <>
                <InfoBox label="FAAB Budget ($)" value={String(lmFaabBudget)} />
                <InfoBox label="Minimum Bid ($)" value={String(lmMinBid)} />
              </>
            )}

            <InfoBox label="Time on Waivers After Cut" value={lmWAfterDrop === 0 ? 'None' : `${lmWAfterDrop} day${lmWAfterDrop===1?'':'s'}`} />
            <InfoBox label="Trade Review" value={lmTradeReview === 0 ? 'None' : `${lmTradeReview} day${lmTradeReview===1?'':'s'}`} />
            <InfoBox label="Trade Deadline" value={lmDeadlineWk === 0 ? 'None' : `Week ${lmDeadlineWk}`} />

            <InfoBox label="Extra Game vs Median" value={lmVsMedian ? 'On' : 'Off'} />
            <InfoBox label="Prevent Drop After Kickoff" value={lmNoDropAfter ? 'On' : 'Off'} />
            <InfoBox label="Lock All Moves" value={lmLockMoves ? 'On' : 'Off'} />
          </div>
        </section>

        {/* For commissioner, keep the CTA; otherwise, no “read-only” text */}
        {wallet && commissioner && wallet.toLowerCase() === (commissioner as string).toLowerCase() ? (
          <div className="flex justify-center">
            <Link
              href={`/league/${league}/lm-tools`}
              className="rounded-2xl border border-fuchsia-400/50 bg-fuchsia-500/10 px-4 py-2 text-sm font-semibold text-fuchsia-200 hover:border-fuchsia-400"
            >
              Open LM Tools (edit on-chain)
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}
