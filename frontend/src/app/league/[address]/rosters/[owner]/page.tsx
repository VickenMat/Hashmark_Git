// src/app/league/[address]/rosters/[owner]/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import { useParams } from 'next/navigation';
import { AbiFunctionNotFoundError } from 'viem';
import { useAccount, usePublicClient, useReadContract } from 'wagmi';
import { useTeamProfile, generatedLogoFor } from '@/lib/teamProfile';

const ZERO = '0x0000000000000000000000000000000000000000';

const LEAGUE_ABI = [
  { type: 'function', name: 'name',             stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getTeamByAddress', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'string' }] },
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

// Roster reader candidates (probe in order)
const ROSTER_READS = [
  { name: 'getRosterByOwner', inputs: [{ type: 'address' }] },
  { name: 'getRosterOf',      inputs: [{ type: 'address' }] },
  { name: 'getRoster',        inputs: [{ type: 'address' }] },
] as const;

// Commissioner function candidates (probe in order)
const COMMISH_READS = [
  { name: 'commissioner',    inputs: [] },
  { name: 'commish',         inputs: [] },
  { name: 'getCommissioner', inputs: [] },
  { name: 'owner',           inputs: [] },
  { name: 'admin',           inputs: [] },
] as const;

type Player = {
  id?: bigint | number | string;
  name?: string;
  pos?: string | number;
};

function isValidAddr(a: string): a is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}
const shortAddr = (a?: string, head = 6, tail = 4) =>
  !a ? '—' : a.length > head + tail + 2 ? `${a.slice(0, head + 2)}…${a.slice(-tail)}` : a;

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

function initials(n?: string) {
  const s = (n || '').trim();
  if (!s) return 'TM';
  const p = s.split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || 'TM';
}
function Avatar({ name, url, size = 12 }: { name?: string; url?: string; size?: 10 | 11 | 12 }) {
  const cls = `h-${size} w-${size} rounded-2xl object-cover ring-1 ring-white/15 bg-white/5`;
  const safe = name?.trim() || '—';
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={safe} className={cls} /> : (
    <div className={`h-${size} w-${size} rounded-2xl bg-white/10 grid place-items-center font-semibold`}>
      {initials(safe)}
    </div>
  );
}

/* ── POS colors (same scheme as elsewhere) ── */
function posClasses(pos?: string | number) {
  const p = typeof pos === 'string' ? pos.toUpperCase() : String(pos ?? '');
  switch (p) {
    case 'QB':  return { text: 'text-rose-300',    chip: 'bg-rose-500/20 border-rose-400/40 text-rose-200' };
    case 'RB':  return { text: 'text-emerald-300', chip: 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200' };
    case 'WR':  return { text: 'text-sky-300',     chip: 'bg-sky-500/20 border-sky-400/40 text-sky-200' };
    case 'TE':  return { text: 'text-orange-300',  chip: 'bg-orange-500/20 border-orange-400/40 text-orange-200' };
    case 'FLEX':return { text: 'text-slate-300',   chip: 'bg-slate-500/20 border-slate-400/40 text-slate-200' };
    case 'K':   return { text: 'text-amber-300',   chip: 'bg-amber-500/20 border-amber-400/40 text-amber-200' };
    case 'D/ST':
    case 'DST': return { text: 'text-violet-300',  chip: 'bg-violet-500/20 border-violet-400/40 text-violet-200' };
    case 'DL':
    case 'LB':
    case 'DB':  return { text: 'text-rose-300',    chip: 'bg-rose-800/30 border-rose-500/30 text-rose-200' };
    default:    return { text: 'text-gray-300',    chip: 'bg-white/10 border-white/20 text-gray-200' };
  }
}
function PosPill({ pos }: { pos?: string | number }) {
  const { chip } = posClasses(pos);
  return (
    <span className={`inline-flex items-center justify-center h-7 px-2 rounded-full border text-[11px] ${chip}`}>
      {typeof pos === 'number' ? String(pos) : (pos || '—')}
    </span>
  );
}
function Chip({
  children,
  tone = 'neutral',
}: { children: React.ReactNode; tone?: 'emerald' | 'fuchsia' | 'neutral' }) {
  const styles =
    tone === 'emerald'
      ? 'border-emerald-500/40 bg-emerald-600/20 text-emerald-100'
      : tone === 'fuchsia'
      ? 'border-fuchsia-500/40 bg-fuchsia-600/20 text-fuchsia-100'
      : 'border-white/10 bg-white/5 text-gray-200';
  return <span className={`text-[11px] rounded px-2 py-1 border ${styles}`}>{children}</span>;
}

/* ────────────────────────────────────────────────────────────────────────── */

export default function TeamRosterPage() {
  const { address: league, owner } = useParams<{ address: `0x${string}`; owner: string }>();
  const { address: wallet } = useAccount();
  const publicClient = usePublicClient();

  if (!isValidAddr(owner)) notFound();

  // League name (for header)
  const { data: leagueName } = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'name',
  });

  // Roster shape (to size the grid)
  const { data: rosterRaw } = useReadContract({
    abi: ROSTER_ABI, address: league, functionName: 'getRosterSettings'
  });
  const rosterSize = useMemo(() => {
    const n = (x:any,d=0)=>Number(x??d);
    const t = rosterRaw as any;
    const starters =
      n(t?.qb,1)+n(t?.rb,2)+n(t?.wr,2)+n(t?.te,1)+
      (n(t?.flexWRT,1)+n(t?.flexWR,0)+n(t?.flexWT,0)+n(t?.superFlexQWRT,0)+n(t?.idpFlex,0))+
      n(t?.dst,1)+n(t?.k,1)+n(t?.dl,0)+n(t?.lb,0)+n(t?.db,0);
    const bench = n(t?.bench,5);
    const ir = n(t?.ir,1);
    return starters + bench + ir;
  }, [rosterRaw]);

  // Viewed team: on-chain name + profile
  const { data: onChainName } = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getTeamByAddress',
    args: [owner as `0x${string}`],
  });
  const prof = useTeamProfile(league, owner as `0x${string}`, { name: onChainName as string });
  const teamName = (prof.name || (onChainName as string) || '').trim() || 'Team';
  const teamLogo = prof.logo || generatedLogoFor(owner as `0x${string}`);

  // "Your Team" pill
  const { data: myOnChainName } = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getTeamByAddress',
    args: [wallet ?? ZERO], query: { enabled: !!wallet },
  });
  const myProf = useTeamProfile(league, (wallet as `0x${string}`) || undefined, { name: (myOnChainName as string) || '' });
  const myDisplayName = (myProf.name || (myOnChainName as string) || '').trim() || undefined;
  const myLogo = useMemo(() => (wallet ? (myProf.logo || generatedLogoFor(wallet as `0x${string}`)) : undefined), [wallet, myProf.logo]);

  // Commissioner probe
  const [commish, setCommish] = useState<`0x${string}` | null>(null);
  useEffect(() => {
    let stop = false;
    (async () => {
      if (!publicClient) return;
      for (const c of COMMISH_READS) {
        try {
          const addr = (await publicClient.readContract({
            address: league,
            abi: [{ type: 'function', name: c.name, stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const,
            functionName: c.name as any,
          })) as `0x${string}`;
          if (!stop && addr && addr !== ZERO) { setCommish(addr); break; }
        } catch { /* try next */ }
      }
    })();
    return () => { stop = true; };
  }, [league, publicClient]);
  const isCommish = !!wallet && !!commish && wallet.toLowerCase() === commish.toLowerCase();

  // Roster (tolerant ABI probing)
  const [players, setPlayers] = useState<any[] | null>(null);
  const [loadedVia, setLoadedVia] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!publicClient) return;
      for (const cand of ROSTER_READS) {
        try {
          const data = await publicClient.readContract({
            address: league,
            abi: [{
              type: 'function',
              name: cand.name,
              stateMutability: 'view',
              inputs: cand.inputs,
              outputs: [{ type: 'tuple[]', components: [
                { name: 'id',  type: 'uint256' },
                { name: 'pos', type: 'uint8'    },
                { name: 'name',type: 'string'   },
              ] }],
            }] as const,
            functionName: cand.name as any,
            args: [owner as `0x${string}`],
          });
          if (!cancelled) {
            const arr = (data as any[]).map((p) => ({
              id: p?.id ?? p?.playerId ?? p?.[0],
              pos: p?.pos ?? p?.position ?? p?.[1],
              name: p?.name ?? p?.playerName ?? p?.[2],
            }));
            setPlayers(arr);
            setLoadedVia(cand.name);
          }
          return;
        } catch (e: any) {
          if (e instanceof AbiFunctionNotFoundError) continue;
          try {
            const data2 = await publicClient.readContract({
              address: league,
              abi: [{
                type: 'function',
                name: cand.name,
                stateMutability: 'view',
                inputs: cand.inputs,
                outputs: [{ type: 'uint256[]' }],
              }] as const,
              functionName: cand.name as any,
              args: [owner as `0x${string}`],
            });
            if (!cancelled) {
              const arr = (data2 as bigint[]).map((id) => ({ id }));
              setPlayers(arr);
              setLoadedVia(cand.name + ' (ids)');
            }
            return;
          } catch { /* keep probing */ }
        }
      }
      if (!cancelled) { setPlayers([]); setLoadedVia(null); }
    }
    run();
    return () => { cancelled = true; };
  }, [league, owner, publicClient]);

  const filled = players?.length ?? 0;

  /* ----- nicer player row ----- */
  function PlayerRow({ slotIndex, p }: { slotIndex: number; p?: any }) {
    const { text, chip } = posClasses(p?.pos);
    const name = p?.name?.trim() || '';
    const id = p?.id !== undefined ? `#${String(p.id)}` : '';
    const posLabel = typeof p?.pos === 'number' ? String(p?.pos) : (p?.pos || '');

    return (
      <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 hover:bg-white/[0.05] transition">
        <div className="flex items-center gap-3">
          {/* POS pill */}
          <PosPill pos={posLabel || undefined} />
          {/* Name + meta */}
          <div className="min-w-0 flex-1">
            <div className={`font-semibold truncate ${p ? 'text-white' : 'text-gray-400 italic'}`}>
              {p ? name : `Empty Slot ${slotIndex}`}
            </div>
            <div className="text-[11px] text-gray-400">
              {p ? (
                <>
                  {id || '—'} {id && (posLabel ? '• ' : '')}{posLabel && <span className={text}>{posLabel}</span>}
                </>
              ) : (
                '—'
              )}
            </div>
          </div>
          {/* Right-side small tag */}
          {p ? (
            <span className={`hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${chip}`}>
              Roster
            </span>
          ) : (
            <span className="hidden sm:inline-flex items-center rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-gray-300 bg-white/5">
              Empty
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Title row with "Your Team" pill */}
        <div className="grid grid-cols-3 items-start">
          <div />
          <div className="text-center">
            <h1 className="text-3xl font-extrabold">Roster</h1>
          </div>
          <div className="justify-self-end">
            {wallet && (
              <a
                href={`/league/${league}/team/${wallet}`}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 hover:bg-white/10 transition"
                title="Go to Your Team"
              >
                <Avatar name={myDisplayName || 'Team'} url={myLogo} size={10}/>
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

        {/* Header card */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Team identity */}
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={teamName} url={teamLogo} />
              <div className="min-w-0">
                <div className="text-2xl font-bold leading-tight truncate">{teamName}</div>
                <div className="text-[12px] text-gray-400 font-mono">{shortAddr(owner)}</div>
                <div className="text-[12px] text-gray-400">Record 0-0-0</div>
              </div>
            </div>

            {/* League quick info */}
            <div className="text-right">
              <div className="font-medium">{(leagueName as string) || '—'}</div>
              <div className="mt-1 flex items-center justify-end gap-2">
                <span className="font-mono text-[12px] text-gray-300">{shortAddr(league)}</span>
                <CopyBtn value={league} />
              </div>
            </div>
          </div>

          {/* Chips row */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!!wallet && wallet.toLowerCase() === owner.toLowerCase() && <Chip tone="emerald">You</Chip>}
            {isCommish && <Chip tone="fuchsia">Commissioner</Chip>}
            <Chip>Slots {filled}/{rosterSize}</Chip>
            {loadedVia && <Chip>source: {loadedVia}</Chip>}
            <a
              href={`/league/${league}/rosters`}
              className="ml-auto text-[12px] underline underline-offset-4 text-gray-300 hover:text-white"
            >
              View all rosters →
            </a>
          </div>
        </section>

        {/* Player slots — dynamic size */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: Math.max(1, rosterSize) }, (_, i) => (
              <PlayerRow key={i} slotIndex={i + 1} p={players?.[i]} />
            ))}
          </div>

          {filled === 0 && (
            <p className="text-xs text-gray-400 mt-4">
              This template shows placeholders until your contract exposes a roster read (e.g. <code className="font-mono">getRosterByOwner(address)</code>).
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
