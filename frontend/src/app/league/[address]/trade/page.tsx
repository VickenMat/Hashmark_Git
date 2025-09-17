'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useAccount, usePublicClient, useReadContract } from 'wagmi';
import { AbiFunctionNotFoundError } from 'viem';
import { useTeamProfile, generatedLogoFor } from '@/lib/teamProfile';

const ZERO = '0x0000000000000000000000000000000000000000' as const;
const ROSTER_SIZE = 16;

/* ---- League ABI (minimal) ---- */
const LEAGUE_ABI = [
  { type: 'function', name: 'getTeamByAddress', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'string' }] },
] as const;

/* ---- Candidate roster readers; we try in order and fall back gracefully ---- */
const ROSTER_READS = [
  { name: 'getRosterByOwner', inputs: [{ type: 'address' }] },
  { name: 'getRosterOf',      inputs: [{ type: 'address' }] },
  { name: 'getRoster',        inputs: [{ type: 'address' }] },
] as const;

/* --------------------------------- Types ---------------------------------- */
type RosterItem = {
  id?: string | number | bigint;
  name?: string;
  position?: string;
  age?: number;
  team?: string; // optional if you later expose it
};

/* -------------------------------- Helpers --------------------------------- */
const shortAddr = (a?: string) => (a ? `${a.slice(0,6)}…${a.slice(-4)}` : '—');

function Avatar({ name, url, size = 8 }: { name?: string; url?: string; size?: 7 | 8 | 9 }) {
  const sizeClass = size === 7 ? 'h-7 w-7' : size === 8 ? 'h-8 w-8' : 'h-9 w-9';
  const safe = (name || '').trim() || '—';
  const cls = `${sizeClass} rounded-2xl object-cover ring-1 ring-white/15 bg-white/5`;
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={safe} className={cls} /> : (
    <div className={`${sizeClass} rounded-2xl bg-white/10 grid place-items-center text-xs font-semibold`}>
      {(safe.split(/\s+/).map(s => s[0]?.toUpperCase() || '').join('') || 'TM').slice(0,2)}
    </div>
  );
}
function posTextColor(p?: string) {
  switch ((p || '').toUpperCase()) {
    case 'QB':   return 'text-rose-300';
    case 'RB':   return 'text-emerald-300';
    case 'WR':   return 'text-sky-300';
    case 'TE':   return 'text-orange-300';
    case 'FLEX': return 'text-slate-300';
    case 'D/ST':
    case 'DST':  return 'text-violet-300';
    case 'K':    return 'text-amber-300';
    default:     return 'text-gray-300';
  }
}
function PositionPill({ pos }: { pos?: string }) {
  if (!pos) return null;
  return (
    <span className={`rounded px-2 py-[2px] text-[11px] border border-white/15 bg-white/5 ${posTextColor(pos)}`}>
      {pos}
    </span>
  );
}
function TeamPillLink({ league, owner }:{ league:`0x${string}`; owner:`0x${string}` }) {
  const prof = useTeamProfile(league, owner);
  const name = (prof.name || 'Team').trim();
  const logo = prof.logo || generatedLogoFor(owner);
  return (
    <a
      href={`/league/${league}/team/${owner}`}
      className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 hover:bg-white/10 transition"
      title="Go to Your Team"
    >
      <Avatar name={name} url={logo} size={7}/>
      <div className="leading-tight">
        <div className="text-base font-semibold truncate max-w-[180px]">{name}</div>
        <div className="text-[11px] text-gray-400 font-mono">{shortAddr(owner)}</div>
      </div>
    </a>
  );
}
function TeamHeaderCenteredLink({ league, owner }:{ league:`0x${string}`; owner:`0x${string}` }) {
  const prof = useTeamProfile(league, owner);
  const name = (prof.name || 'Team').trim();
  const logo = prof.logo || generatedLogoFor(owner);
  return (
    <a href={`/league/${league}/rosters/${owner}`} className="flex items-center justify-center gap-3 mb-3 hover:opacity-95">
      <Avatar name={name} url={logo}/>
      <div className="leading-tight text-center">
        <div className="font-semibold">{name}</div>
        <div className="text-[11px] text-gray-400 font-mono">{shortAddr(owner)}</div>
      </div>
    </a>
  );
}

/* ---------------------------- Roster data hook ---------------------------- */
function normalizePos(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).toUpperCase().trim();
  if (s === 'DST') return 'D/ST';
  return s || undefined;
}
function useOwnerRoster(league?: `0x${string}`, owner?: `0x${string}`) {
  const publicClient = usePublicClient();
  const [items, setItems] = useState<RosterItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!league || !owner || !publicClient) return;

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
                { name: 'id',   type: 'uint256' },
                { name: 'pos',  type: 'uint8'   }, // or string on some contracts
                { name: 'name', type: 'string'  },
              ]}],
            }] as const,
            functionName: cand.name as any,
            args: [owner],
          });

          if (!cancelled) {
            const arr = (data as any[]).map((p) => ({
              id:       p?.id ?? p?.playerId ?? p?.[0],
              position: normalizePos(p?.pos ?? p?.position ?? p?.[1]),
              name:     p?.name ?? p?.playerName ?? p?.[2],
            })) as RosterItem[];
            setItems(arr);
          }
          return; // success
        } catch (e:any) {
          // try as uint256[]
          if (!(e instanceof AbiFunctionNotFoundError)) {
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
                args: [owner],
              });
              if (!cancelled) {
                const arr = (data2 as bigint[]).map((id) => ({ id }));
                setItems(arr);
              }
              return;
            } catch { /* continue */ }
          }
        }
      }
      if (!cancelled) setItems([]);
    }
    run();
    return () => { cancelled = true; };
  }, [league, owner, publicClient]);

  return items;
}

/* ------------------------------- Table bits ------------------------------- */
type SortKey = 'name' | 'position' | 'age';
type SortDir = 'asc' | 'desc' | null;
type SortState = { key: SortKey; dir: SortDir };

function cycleDir(d: SortDir): SortDir {
  return d === null ? 'asc' : d === 'asc' ? 'desc' : null;
}
function caret(dir: SortDir) {
  return dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '◇';
}
function cmp(a: any, b: any) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;  // nulls last
  if (b == null) return -1;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return (a as number) - (b as number);
}

function useSorted(items: RosterItem[], sort: SortState | null) {
  return useMemo(() => {
    if (!sort || sort.dir === null) return items.slice();
    const arr = items.slice().sort((A, B) => {
      const a = sort.key === 'name' ? (A.name || '') :
                sort.key === 'position' ? (A.position || '') :
                (A.age ?? null);
      const b = sort.key === 'name' ? (B.name || '') :
                sort.key === 'position' ? (B.position || '') :
                (B.age ?? null);
      const base = cmp(a, b);
      return sort.dir === 'asc' ? base : -base;
    });
    return arr;
  }, [items, sort]);
}

function RosterTable({
  items, selected, onToggle, sort, setSort,
}:{
  items: RosterItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  sort: SortState | null;
  setSort: (next: SortState | null) => void;
}) {
  const sorted = useSorted(items, sort);
  // Scaffold to fixed row count; empty objects render blank rows
  const rows: (RosterItem & { _scaffoldId: string })[] = useMemo(() => {
    const padded = sorted.slice(0, ROSTER_SIZE);
    if (padded.length < ROSTER_SIZE) {
      for (let i = padded.length; i < ROSTER_SIZE; i++) padded.push({} as RosterItem);
    }
    return padded.map((r, i) => ({ ...r, _scaffoldId: String(r.id ?? `empty-${i}`) }));
  }, [sorted]);

  const headerBtn = (k: SortKey, label: string) => {
    const dir = sort?.key === k ? sort.dir : null;
    return (
      <button
        className="inline-flex items-center gap-1 text-left"
        onClick={() => setSort(dir === null ? { key: k, dir: 'asc' } : { key: k, dir: cycleDir(dir)! })}
        title={`Sort by ${label}`}
      >
        <span>{label}</span>
        <span className="text-[10px] text-gray-400">{caret(dir)}</span>
      </button>
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
      <table className="w-full text-sm">
        <thead className="text-[12px] tracking-wide text-gray-300">
          <tr className="[&>th]:px-3 [&>th]:py-2 bg-white/[0.03]">
            <th className="w-1/2">{headerBtn('name', 'Name')}</th>
            <th className="w-1/4">{headerBtn('position', 'Position')}</th>
            <th className="w-1/4 text-right">{headerBtn('age', 'Age')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const hasData = r.name || r.position || r.age != null || r.id != null;
            const id = String(r.id ?? r._scaffoldId);
            const isSel = hasData && selected.has(id);
            return (
              <tr
                key={id}
                onClick={() => hasData && onToggle(id)}
                className={`cursor-${hasData ? 'pointer' : 'default'} transition ${
                  isSel ? 'bg-emerald-500/10' : 'hover:bg-white/[0.04]'
                }`}
              >
                <td className="px-3 py-2">
                  {hasData ? <span className="font-medium">{r.name}</span> : <div className="h-[14px] rounded bg-white/5" />}
                </td>
                <td className="px-3 py-2">
                  {hasData ? <PositionPill pos={r.position}/> : <div className="h-[14px] rounded bg-white/5" />}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {hasData ? (r.age ?? '') : <div className="h-[14px] rounded bg-white/5 ml-auto w-10" />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------- Page ---------------------------------- */
export default function TradePage() {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const search = useSearchParams();
  const { address: wallet } = useAccount();

  const counterparty = (search.get('with') || '') as `0x${string}` | '';
  const you = wallet as `0x${string}` | undefined;

  // Top-right pill (reads are just to ensure wagmi is happy with the addr)
  useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getTeamByAddress',
    args: [you ?? ZERO], query: { enabled: !!you }
  });

  // Raw rosters
  const yourRosterRaw  = useOwnerRoster(league, you);
  const theirRosterRaw = useOwnerRoster(league, counterparty || undefined);

  // Sorting state
  const [mineSort, setMineSort] = useState<SortState | null>(null);
  const [theirsSort, setTheirsSort] = useState<SortState | null>(null);

  // Selection
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [theirs, setTheirs] = useState<Set<string>>(new Set());
  const toggleMine   = (id: string) => setMine(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleTheirs = (id: string) => setTheirs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const [showReview, setShowReview] = useState(false);
  const canReview = mine.size > 0 || theirs.size > 0;

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Title + Your Team pill on the right */}
        <div className="grid grid-cols-3 items-start">
          <div />
          <div className="text-center">
            <h1 className="text-3xl font-extrabold">Propose Trade</h1>
          </div>
          <div className="justify-self-end">
            {you && <TeamPillLink league={league} owner={you} />}
          </div>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-6">
          <div className="grid gap-6 sm:grid-cols-2">
            {/* Your table */}
            <div>
              {you && <TeamHeaderCenteredLink league={league} owner={you} />}
              <RosterTable
                items={yourRosterRaw}
                selected={mine}
                onToggle={toggleMine}
                sort={mineSort}
                setSort={setMineSort}
              />
            </div>

            {/* Counterparty table */}
            <div>
              {counterparty && <TeamHeaderCenteredLink league={league} owner={counterparty} />}
              <RosterTable
                items={theirRosterRaw}
                selected={theirs}
                onToggle={toggleTheirs}
                sort={theirsSort}
                setSort={setTheirsSort}
              />
            </div>
          </div>

          {/* Centered actions — Review then Cancel */}
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              disabled={!canReview}
              onClick={() => setShowReview(true)}
              className={`rounded-lg px-4 py-2 text-sm ${
                canReview
                  ? 'border border-fuchsia-500/30 bg-fuchsia-600/20 text-fuchsia-100 hover:border-fuchsia-400/60'
                  : 'border border-white/10 bg-white/5 text-gray-400 cursor-not-allowed'
              }`}
              title={canReview ? 'Review selected players' : 'Select at least one player'}
            >
              Review Trade
            </button>
            <button
              onClick={() => history.back()}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </section>
      </div>

      {/* Review Modal */}
      {showReview && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowReview(false)} />
          <div className="absolute left-1/2 top-1/2 w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#0c0f16] p-5 shadow-xl">
            <h2 className="text-xl font-semibold text-center mb-3">Review Trade</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-xs tracking-[0.18em] text-gray-400 text-center mb-2">YOU SEND</div>
                <div className="space-y-2">
                  {Array.from(mine).length === 0 ? (
                    <div className="text-center text-sm text-gray-500">No players selected.</div>
                  ) : (
                    Array.from(mine).map((id) => {
                      const p = yourRosterRaw.find(r => String(r.id ?? '') === id);
                      return (
                        <div key={id} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                          <div className="font-semibold">{p?.name || '(Unnamed player)'}</div>
                          <div className="text-[11px] text-gray-400 flex items-center gap-2">
                            <PositionPill pos={p?.position}/>
                            <span className="tabular-nums">{p?.age ?? ''}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs tracking-[0.18em] text-gray-400 text-center mb-2">YOU RECEIVE</div>
                <div className="space-y-2">
                  {Array.from(theirs).length === 0 ? (
                    <div className="text-center text-sm text-gray-500">No players selected.</div>
                  ) : (
                    Array.from(theirs).map((id) => {
                      const p = theirRosterRaw.find(r => String(r.id ?? '') === id);
                      return (
                        <div key={id} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                          <div className="font-semibold">{p?.name || '(Unnamed player)'}</div>
                          <div className="text-[11px] text-gray-400 flex items-center gap-2">
                            <PositionPill pos={p?.position}/>
                            <span className="tabular-nums">{p?.age ?? ''}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                onClick={() => {
                  // TODO: wire this up to your contract or API
                  const payload = { send: Array.from(mine), receive: Array.from(theirs) };
                  console.log('Trade Proposal', payload);
                  setShowReview(false);
                }}
                className="rounded-lg border border-emerald-500/40 bg-emerald-600/20 px-4 py-2 text-sm text-emerald-100 hover:border-emerald-400/70"
              >
                Send Trade
              </button>
              <button
                onClick={() => setShowReview(false)}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
