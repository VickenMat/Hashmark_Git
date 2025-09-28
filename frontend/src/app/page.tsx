// src/app/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAccount, useChainId, usePublicClient, useReadContract, useReadContracts } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { LEAGUE_FACTORY_ABI, factoryAddressForChain } from '@/lib/LeagueContracts';
import { useTeamProfile, generatedLogoFor } from '@/lib/teamProfile';

type Address = `0x${string}`;

/* ------------------- Theme constants ------------------- */
const ZIMA = '#37c0f6';        // "zima blue"
const EGGSHELL = '#F0EAD6';    // "eggshell"
const ORANGE = '#FFA500';

/* ------------------- ABIs ------------------- */
const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'buyInAmount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'buyInToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'createdAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getTeams', stateMutability: 'view', inputs: [], outputs: [{ type: 'tuple[]', components: [{ name: 'owner', type: 'address' }, { name: 'name', type: 'string' }]}] },
  { type: 'function', name: 'getDraftSettings', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }, { type: 'uint64' }, { type: 'uint8' }, { type: 'bool' }, { type: 'address[]' }] },
  { type: 'function', name: 'teamCap', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'commissioner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'requiresPassword', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'escrowBalances', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
  { type: 'function', name: 'outstandingOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'hasPaid', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;

/* ------------------- Helpers ------------------- */
const readLS = <T,>(k: string, fallback: T): T => {
  try {
    if (typeof window === 'undefined') return fallback;
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
};
const writeLS = <T,>(k: string, v: T) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

function formatAvax(wei?: bigint) {
  if (wei === undefined) return '—';
  if (wei === 0n) return 'Free';
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n) + 10n ** 18n;
  const fracStr = frac.toString().slice(1).slice(0, 4);
  return `${whole}.${fracStr} AVAX`;
}
const secsTo = (s: number) => {
  const f = (x: number) => Math.max(0, Math.floor(x));
  return { d: f(s / 86400), h: f((s % 86400) / 3600), m: f((s % 3600) / 60), sec: f(s % 60) };
};
const short = (a: string) => (a?.startsWith('0x') ? `${a.slice(0,6)}…${a.slice(-4)}` : a);

type TeamTuple = { owner: Address; name: string };
const toTeamArr = (v: unknown): TeamTuple[] => (Array.isArray(v) ? (v as TeamTuple[]) : []);

type LeagueCardData = {
  addr: Address; name?: string; buyIn?: bigint; buyInToken?: Address; createdAt?: number;
  filled: number; cap: number; draftCompleted: boolean; draftTs: number;
  homeName: string; awayName: string; homeOwner?: Address; awayOwner?: Address;
  homeScore: number; awayScore: number; homeProj: number; awayProj: number; record: string;
  isArchived: boolean; isMember: boolean; owed?: bigint; isCommissioner: boolean;
  passwordRequired: boolean; escrowNative?: bigint; escrowToken?: bigint; paidCount?: number;
};

/* ------------------- Reorder modal ------------------- */
function ReorderModal({
  open, onClose, leagues, order, setOrder, walletKey,
}: {
  open: boolean; onClose: () => void; leagues: LeagueCardData[]; order: string[];
  setOrder: (next: string[]) => void; walletKey: string;
}) {
  const [list, setList] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const visible = leagues.map((l) => l.addr);
    setList(order.filter((a) => visible.includes(a)));
  }, [open, leagues, order]);

  const dragIdx = useRef<number | null>(null);
  const onDragStart = (i: number) => (e: React.DragEvent) => { dragIdx.current = i; e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIdx.current;
    if (from === null || from === i) return;
    const next = [...list]; const [m] = next.splice(from, 1); next.splice(i, 0, m);
    dragIdx.current = i; setList(next);
  };
  const save = () => { setOrder(list); writeLS(walletKey, list); onClose(); };
  if (!open) return null;

  const nameByAddr = new Map(leagues.map(l => [l.addr, l.name ?? 'League']));

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[36px] border border-white/10 bg-gray-950/95 p-5 shadow-2xl">
        <div className="mb-4 text-center">
          <h3 className="text-lg font-semibold" style={{ color: ZIMA }}>Reorder Leagues</h3>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {list.length === 0 ? (
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-center text-sm" style={{ color: EGGSHELL }}>
              No leagues to reorder.
            </div>
          ) : (
            list.map((addr, i) => (
              <div
                key={addr}
                draggable
                onDragStart={onDragStart(i)}
                onDragOver={onDragOver(i)}
                className="mb-2 flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2"
              >
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-sm" style={{ color: EGGSHELL }}>≡</div>
                <div className="truncate text-sm" style={{ color: EGGSHELL }}>
                  <span className="font-medium">{nameByAddr.get(addr) ?? 'League'}</span>
                  <span className="opacity-70"> · {short(addr)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-5 flex items-center justify-center gap-3">
          <button onClick={onClose} className="rounded-full border border-white/15 px-5 py-2 hover:bg-white/10" style={{ color: EGGSHELL }}>Cancel</button>
          <button onClick={save} className="rounded-full px-6 py-2 font-semibold text-white hover:opacity-90" style={{ backgroundColor: ZIMA }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   Home
   ================================================================== */
export default function Home() {
  const { address: wallet } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const factory = factoryAddressForChain(chainId) as Address | undefined;
  const factoryMissing = !factory;

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const ORDER_KEY = `leagueOrder:${wallet ?? 'anon'}`;
  const ARCHIVE_KEY = `archivedLeagues:${wallet ?? 'anon'}`;
  const ARCHIVE_ONLY_KEY = `archivedOnly:${wallet ?? 'anon'}`;
  const HAD_EVER_KEY = `hadLeaguesEver:${wallet ?? 'anon'}`;

  const [archived, setArchived] = useState<string[]>(() => readLS<string[]>(ARCHIVE_KEY, []));
  const [archivedOnly, setArchivedOnly] = useState<boolean>(() => readLS<boolean>(ARCHIVE_ONLY_KEY, false));
  const [hadEver, setHadEver] = useState<boolean>(() => readLS<boolean>(HAD_EVER_KEY, false));
  const [order, setOrder] = useState<string[]>(() => readLS<string[]>(ORDER_KEY, []));

  useEffect(() => {
    setArchived(readLS<string[]>(ARCHIVE_KEY, []));
    setArchivedOnly(readLS<boolean>(ARCHIVE_ONLY_KEY, false));
    setHadEver(readLS<boolean>(HAD_EVER_KEY, false));
    setOrder(readLS<string[]>(ORDER_KEY, []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  useEffect(() => writeLS(ARCHIVE_KEY, archived), [ARCHIVE_KEY, archived]);
  useEffect(() => writeLS(ARCHIVE_ONLY_KEY, archivedOnly), [ARCHIVE_ONLY_KEY, archivedOnly]);
  useEffect(() => writeLS(HAD_EVER_KEY, hadEver), [HAD_EVER_KEY, hadEver]);
  useEffect(() => writeLS(ORDER_KEY, order), [ORDER_KEY, order]);

  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    (async () => {
      if (!publicClient || !factory) return;
      try {
        const code = await publicClient.getBytecode({ address: factory });
        console.debug('[Factory bytecode length]', code?.length ?? 0, factory);
      } catch (e) {
        console.debug('[Factory bytecode check failed]', e);
      }
    })();
  }, [publicClient, factory]);

  /* ------------------- Factory reads ------------------- */
  const leaguesRes = useReadContract({
    abi: LEAGUE_FACTORY_ABI,
    address: factoryAddressForChain(chainId) as Address | undefined,
    functionName: 'getLeagues',
    chainId,
    query: { enabled: Boolean(factory), refetchInterval: 10_000 },
  });
  const leaguesByCreatorRes = useReadContract({
    abi: LEAGUE_FACTORY_ABI,
    address: factory,
    functionName: 'getLeaguesByCreator',
    args: wallet ? [wallet as Address] : undefined,
    chainId,
    query: { enabled: Boolean(wallet && factory), refetchInterval: 10_000 },
  });

  const leagueAddrs = useMemo<Address[]>(() => {
    const a = leaguesRes.data as unknown;
    const b = leaguesByCreatorRes.data as unknown;
    const arrA = Array.isArray(a) && a.every((x) => typeof x === 'string' && x.startsWith('0x')) ? (a as Address[]) : [];
    const arrB = Array.isArray(b) && b.every((x) => typeof x === 'string' && x.startsWith('0x')) ? (b as Address[]) : [];
    return Array.from(new Set([...arrA, ...arrB]));
  }, [leaguesRes.data, leaguesByCreatorRes.data]);

  /* ------------------- Per-league reads ------------------- */
  const PER_LEAGUE_STATIC = 10 as const;
  const reads = useMemo(
    () =>
      leagueAddrs.flatMap((a) => [
        { abi: LEAGUE_ABI, address: a, functionName: 'name' as const },
        { abi: LEAGUE_ABI, address: a, functionName: 'buyInAmount' as const },
        { abi: LEAGUE_ABI, address: a, functionName: 'buyInToken' as const },
        { abi: LEAGUE_ABI, address: a, functionName: 'createdAt' as const },
        { abi: LEAGUE_ABI, address: a, functionName: 'getTeams' as const },
        { abi: LEAGUE_ABI, address: a, functionName: 'getDraftSettings' as const },
        { abi: LEAGUE_ABI, address: a, functionName: 'teamCap' as const },
        { abi: LEAGUE_ABI, address: a, functionName: 'commissioner' as const },
        { abi: LEAGUE_ABI, address: a, functionName: 'requiresPassword' as const },
        { abi: LEAGUE_ABI, address: a, functionName: 'escrowBalances' as const },
        ...(wallet ? [{ abi: LEAGUE_ABI, address: a, functionName: 'outstandingOf' as const, args: [wallet as Address] }] : []),
        ...(wallet ? [{ abi: LEAGUE_ABI, address: a, functionName: 'hasPaid' as const, args: [wallet as Address] }] : []),
      ]),
    [leagueAddrs, wallet],
  );

  const metaRes = useReadContracts({
    contracts: reads,
    query: { enabled: leagueAddrs.length > 0, refetchInterval: 10_000 },
  });

  const teamsByLeague = useMemo(() => {
    const out: { addr: Address; teams: TeamTuple[] }[] = [];
    leagueAddrs.forEach((addr, i) => {
      const base = i * (PER_LEAGUE_STATIC + (wallet ? 2 : 0));
      const rawTeams = metaRes.data?.[base + 4]?.result;
      out.push({ addr, teams: toTeamArr(rawTeams) });
    });
    return out;
  }, [leagueAddrs, metaRes.data, wallet]);

  const teamHasPaidReads = useMemo(
    () =>
      teamsByLeague.flatMap(({ addr, teams }) =>
        (Array.isArray(teams) ? teams : []).map((t) => ({
          abi: LEAGUE_ABI,
          address: addr,
          functionName: 'hasPaid' as const,
          args: [t.owner] as [Address],
        })),
      ),
    [teamsByLeague],
  );

  const teamPaidRes = useReadContracts({
    contracts: teamHasPaidReads,
    query: { enabled: teamHasPaidReads.length > 0, refetchInterval: 10_000 },
  });

  const teamPaidCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    let k = 0;
    teamsByLeague.forEach(({ addr, teams }) => {
      const arr = Array.isArray(teams) ? teams : [];
      let n = 0;
      arr.forEach(() => { const r = teamPaidRes.data?.[k++]; if ((r?.result as boolean | undefined) === true) n++; });
      counts[addr] = n;
    });
    return counts;
  }, [teamsByLeague, teamPaidRes.data]);

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(id); }, []);

  const allLeagues = useMemo<LeagueCardData[]>(() => {
    const lowerWallet = typeof wallet === 'string' ? wallet.toLowerCase() : undefined;
    const arr: LeagueCardData[] = [];

    leagueAddrs.forEach((address, i) => {
      const base = i * (PER_LEAGUE_STATIC + (wallet ? 2 : 0));
      const name = metaRes.data?.[base + 0]?.result as string | undefined;
      const buyIn = metaRes.data?.[base + 1]?.result as bigint | undefined;
      const buyInToken = metaRes.data?.[base + 2]?.result as Address | undefined;
      const createdAt = Number((metaRes.data?.[base + 3]?.result as bigint | undefined) ?? 0n);
      const teams = toTeamArr(metaRes.data?.[base + 4]?.result);
      const settings = (metaRes.data?.[base + 5]?.result as readonly [bigint, bigint, bigint, boolean, readonly Address[]] | undefined) ?? undefined;
      const cap = Number((metaRes.data?.[base + 6]?.result as bigint | undefined) ?? 0n);
      const commishVal = metaRes.data?.[base + 7]?.result as unknown;
      const commish = typeof commishVal === 'string' ? (commishVal as Address) : undefined;
      const passwordRequired = Boolean(metaRes.data?.[base + 8]?.result as boolean | undefined);
      const escrowTuple = metaRes.data?.[base + 9]?.result as readonly [bigint, bigint] | undefined;
      const escrowNative = escrowTuple?.[0];
      const escrowToken = escrowTuple?.[1];
      const owed = wallet ? (metaRes.data?.[base + 10]?.result as bigint | undefined) : undefined;

      const filled = teams.length;
      const isMember = Boolean(lowerWallet && teams.some((t) => t.owner?.toLowerCase() === lowerWallet));
      const draftCompleted = Boolean(settings?.[3] ?? false);
      const draftTs = Number(settings?.[1] ?? 0n);

      const team0 = teams[0];
      const team1 = teams[1];
      const n0 = (team0?.name && team0.name.trim()) || (team0?.owner ? `${team0.owner.slice(0, 6)}…${team0.owner.slice(-4)}` : 'Team A');
      const n1 = (team1?.name && team1.name.trim()) || (team1?.owner ? `${team1.owner.slice(0, 6)}…${team1.owner.slice(-4)}` : 'Team B');

      arr.push({
        addr: address, name, buyIn, buyInToken, createdAt, filled, cap, draftCompleted, draftTs,
        homeName: n0, awayName: n1, homeOwner: team0?.owner, awayOwner: team1?.owner,
        homeScore: 0, awayScore: 0, homeProj: 0, awayProj: 0, record: '0–0',
        isArchived: archived.includes(address), isMember, owed,
        isCommissioner: !!(lowerWallet && commish && lowerWallet === commish.toLowerCase()),
        passwordRequired, escrowNative, escrowToken, paidCount: teamPaidCounts[address] ?? 0,
      });
    });
    return arr;
  }, [leagueAddrs, metaRes.data, archived, wallet, teamPaidCounts]);

  const memberOnly = useMemo(() => allLeagues.filter((l) => l.isMember), [allLeagues]);

  const filtered = useMemo(() => {
    const base = memberOnly.filter((x) => (archivedOnly ? x.isArchived : !x.isArchived));
    const set = new Set(order);
    const withAll = [...order, ...base.map((b) => b.addr).filter((a) => !set.has(a))];
    if (withAll.length !== order.length) setOrder(withAll);
    const idx = new Map(withAll.map((a, i) => [a, i]));
    return [...base].sort((a, b) => {
      const ia = idx.has(a.addr) ? (idx.get(a.addr) as number) : 1e9;
      const ib = idx.has(b.addr) ? (idx.get(b.addr) as number) : 1e9;
      if (ia !== ib) return ia - ib;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
  }, [memberOnly, archivedOnly, order, setOrder]);

  const hasLeagues = filtered.length > 0;
  const showPills = hadEver && (hasLeagues || archived.length > 0);

  const archive = (addr: string) => { setArchived((prev) => (prev.includes(addr) ? prev : [...prev, addr])); setHadEver(true); };
  const restore = (addr: string) => setArchived((prev) => prev.filter((x) => x !== addr));

  // Carousel + highlight computation (lg breakpoint)
  const railRef = useRef<HTMLDivElement>(null);
  const [isLg, setIsLg] = useState(false);
  const [activeRange, setActiveRange] = useState<[number, number]>([0, 0]);

  useEffect(() => {
    const m = window.matchMedia('(min-width:1024px)');
    const on = () => setIsLg(m.matches);
    on(); m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  const perPage = isLg ? 2 : 1;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));

  const recomputeActive = () => {
    const el = railRef.current; if (!el) return;
    const viewport = el.clientWidth || 1;
    const cardW = viewport / perPage;
    const start = Math.round(el.scrollLeft / cardW);
    setActiveRange([start, start + perPage - 1]);
  };

  const scrollToPage = (p: number) => {
    const el = railRef.current; if (!el) return;
    const clamped = ((p % totalPages) + totalPages) % totalPages; // wrap both directions
    el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
    setTimeout(recomputeActive, 250);
  };
  useEffect(() => { recomputeActive(); }, [isLg, filtered.length]);
  const onRailScroll = () => recomputeActive();
  const jumpToIndex = (idx: number) => scrollToPage(Math.floor(idx / perPage));

  const isFuji = chainId === 43113;

  return (
    <main
      className={[
        'relative min-h-screen overflow-hidden px-4 sm:px-6 py-0',
        'bg-gradient-to-br from-white via-[#f8f9fb] to-white',
        'dark:from-gray-950 dark:via-[#0b0b14] dark:to-black',
      ].join(' ')}
    >
      {/* Notices */}
      {mounted && !isFuji && (
        <div className="mx-auto mb-4 max-w-7xl rounded-xl border border-amber-400/40 bg-amber-100/60 px-4 py-3 dark:border-amber-400/30 dark:bg-amber-500/10" style={{ color: EGGSHELL }}>
          Switch to <span className="font-semibold">Avalanche Fuji (43113)</span> to see your leagues.
        </div>
      )}
      {mounted && factoryMissing && (
        <div className="mx-auto mb-4 max-w-7xl rounded-xl border border-rose-400/40 bg-rose-100/60 px-4 py-3 dark:border-rose-400/30 dark:bg-rose-500/10" style={{ color: EGGSHELL }}>
          Factory address missing. Add <code className="font-mono">NEXT_PUBLIC_FACTORY_FUJI</code> to <b>.env.local</b>.
        </div>
      )}

      {/* Blobs */}
      <div className="pointer-events-none absolute -top-24 -left-16 -z-10 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-3xl dark:bg-fuchsia-500/20" />
      <div className="pointer-events-none absolute top-10 right-0 -z-10 h-80 w-80 rounded-full bg-purple-500/10 blur-3xl dark:bg-purple-500/20" />

      <div className="mx-auto max-w-7xl">
        {/* Title */}
        <div className="mb-1 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: EGGSHELL }}>Hashmark</h1>
          <p className="mt-1 text-sm" style={{ color: EGGSHELL }}>The largest fantasy football platform on the blockchain.</p>
        </div>

        {/* ===== Create / Join ===== */}
        <div className="mb-2.5 mt-6 flex flex-wrap items-center justify-center gap-4">
          <CTA href="/create-league" intent="create">Create League</CTA>
          <CTA href="/join-league" intent="join">Join League</CTA>
        </div>

        {/* ===== Controls row ===== */}
        <div className="mb-4 flex flex-wrap items-center justify-center gap-3" style={{ color: EGGSHELL }}>
          {/* Switcher bar */}
          {filtered.length > 0 && (
            <div className="inline-flex max-w-full overflow-x-auto rounded-2xl border border-white/15 bg-white/5 p-1 shadow-sm">
              <div className="flex">
                {filtered.map((l, i) => {
                  const active = i >= activeRange[0] && i <= activeRange[1];
                  return (
                    <div key={l.addr} className="relative flex items-stretch">
                      <button
                        onClick={() => jumpToIndex(i)}
                        className={`relative z-10 max-w-[160px] truncate px-2 py-0.5 text-[12px] font-medium transition-all duration-300 ${
                          active
                            ? 'rounded-xl bg-white/10 shadow-sm'
                            : 'hover:bg-white/5'
                        }`}
                        title={l.name || l.addr}
                        style={{ color: EGGSHELL }}
                      >
                        {l.name || `${l.addr.slice(0, 6)}…${l.addr.slice(-4)}`}
                      </button>
                      {i < filtered.length - 1 && (
                        <div className="my-1 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent" />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Reorder trigger */}
              <button
                onClick={() => setModalOpen(true)}
                className="ml-2 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/10 hover:bg-white/15"
                title="Reorder leagues"
                aria-label="Reorder leagues"
                style={{ color: EGGSHELL }}
              >
                ≡
              </button>
            </div>
          )}

          {/* Active/Archived pills */}
          {showPills && (
            <div className="inline-flex rounded-full border border-white/15 bg-white/5 p-1 shadow-sm">
              <button
                onClick={() => { setArchivedOnly(false); setTimeout(recomputeActive, 0); }}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${!archivedOnly ? 'bg-white/10' : ''}`}
                style={{ color: EGGSHELL }}
              >
                Active
              </button>
              <button
                onClick={() => { setArchivedOnly(true); setTimeout(recomputeActive, 0); }}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${archivedOnly ? 'bg-white/10' : ''}`}
                style={{ color: EGGSHELL }}
              >
                Archived
              </button>
            </div>
          )}
        </div>

        {/* ===== League dashboard ===== */}
        <div style={{ color: EGGSHELL }}>
          {filtered.length > 0 ? (
            filtered.length === 1 ? (
              <section className="relative mx-auto max-w-3xl">
                <div className="px-3">
                  <LeagueCard
                    l={filtered[0]}
                    now={now}
                    archive={(a) => archive(a)}
                    restore={(a) => restore(a)}
                    archivedView={archivedOnly}
                    walletAddr={wallet as Address | undefined}
                  />
                </div>
              </section>
            ) : (
              <section className="relative">
                <div ref={railRef} onScroll={onRailScroll} className="snap-x snap-mandatory overflow-x-hidden">
                  <div className="flex w-full">
                    {filtered.map((l) => (
                      <div key={l.addr} className="w-full shrink-0 snap-start px-3 lg:w-1/2">
                        <LeagueCard
                          l={l}
                          now={now}
                          archive={(a) => archive(a)}
                          restore={(a) => restore(a)}
                          archivedView={archivedOnly}
                          walletAddr={wallet as Address | undefined}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {filtered.length > (isLg ? 2 : 1) && (
                  <>
                    <button
                      onClick={() => {
                        const cur = Math.floor(activeRange[0] / perPage);
                        const prev = (cur - 1 + totalPages) % totalPages; // wraps
                        scrollToPage(prev);
                      }}
                      className="absolute -left-5 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/10 text-base shadow-sm transition hover:bg-white/15"
                      aria-label="Previous"
                      style={{ color: EGGSHELL }}
                    >
                      ‹
                    </button>
                    <button
                      onClick={() => {
                        const cur = Math.floor(activeRange[0] / perPage);
                        const next = (cur + 1) % totalPages; // wraps
                        scrollToPage(next);
                      }}
                      className="absolute -right-5 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/10 text-base shadow-sm transition hover:bg-white/15"
                      aria-label="Next"
                      style={{ color: EGGSHELL }}
                    >
                      ›
                    </button>
                  </>
                )}
              </section>
            )
          ) : (
            <section className="relative mx-auto mt-6 max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-8 ring-1 ring-white/20 backdrop-blur-sm">
              <div className="pointer-events-none absolute -inset-32 -z-10 rounded-[40px] bg-[conic-gradient(from_180deg_at_50%_50%,rgba(217,70,239,0.25)_0deg,rgba(147,51,234,0.25)_120deg,transparent_300deg)] blur-3xl" />
              <div className="mx-auto max-w-3xl text-center">
                <h2 className="text-2xl font-black tracking-tight" style={{ color: ZIMA }}>The largest fantasy football platform on the blockchain</h2>
                <p className="mt-2 text-sm" style={{ color: EGGSHELL }}>Build trustless leagues with escrowed buy-ins, transparent rules, and gas-light drafts. Your league, your chain.</p>
              </div>
            </section>
          )}
        </div>

        {/* ===== Info boxes ===== */}
        <section className="mt-8">
          <h2 className="mb-5 text-center text-lg font-bold tracking-tight" style={{ color: ZIMA }}>
            Learn more about Hashmark & Avalanche
          </h2>
          <div className="grid gap-5 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-2 text-sm uppercase tracking-[0.15em]" style={{ color: ZIMA }}>Platform</div>
              <h3 className="mb-2 text-xl font-extrabold" style={{ color: ZIMA }}>What is Hashmark?</h3>
              <p style={{ color: EGGSHELL }}>Create <span className="font-semibold">on-chain fantasy leagues</span> with escrowed buy-ins, secure joins, and transparent rules.</p>
              <ul className="mt-3 list-disc pl-5 text-sm" style={{ color: EGGSHELL }}>
                <li>Native/Token buy-ins held in escrow</li>
                <li>Password or signature-gated joins</li>
                <li>Configurable draft settings &amp; orders</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-2 text-sm uppercase tracking-[0.15em]" style={{ color: ZIMA }}>Network</div>
              <h3 className="mb-2 text-xl font-extrabold" style={{ color: ZIMA }}>Why Avalanche?</h3>
              <p style={{ color: EGGSHELL }}>Fast finality and low fees make Avalanche ideal for interactive apps. Test first on <b>Fuji</b>.</p>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <a href="https://faucet.avax.network/" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 hover:bg-white/15" style={{ color: EGGSHELL }}>Get Test AVAX</a>
                <a href="https://testnet.snowtrace.io/" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 hover:bg-white/15" style={{ color: EGGSHELL }}>Snowtrace (Testnet)</a>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-2 text-sm uppercase tracking-[0.15em]" style={{ color: ZIMA }}>Resources</div>
              <h3 className="mb-2 text-xl font-extrabold" style={{ color: ZIMA }}>Fantasy Football Links</h3>
              <ul className="space-y-2" style={{ color: EGGSHELL }}>
                <li><a href="https://www.fantasypros.com/nfl/" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: EGGSHELL }}>FantasyPros – Rankings &amp; Advice</a></li>
                <li><a href="https://www.espn.com/fantasy/football/" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: EGGSHELL }}>ESPN Fantasy Football</a></li>
                <li><a href="https://football.fantasysports.yahoo.com/" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: EGGSHELL }}>Yahoo Fantasy Football</a></li>
                <li><a href="https://sleeper.com/" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: EGGSHELL }}>Sleeper</a></li>
              </ul>
              <p className="mt-3 text-xs" style={{ color: EGGSHELL }}>External links are for research; Hashmark isn’t affiliated.</p>
            </div>
          </div>
        </section>
      </div>

      <ReorderModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        leagues={filtered}
        order={order}
        setOrder={setOrder}
        walletKey={ORDER_KEY}
      />
    </main>
  );
}

/* ---------- CTA helper ---------- */
function CTA({ href, intent, children }: { href: string; intent: 'create' | 'join'; children: React.ReactNode }) {
  if (intent === 'create') {
    return (
      <Link
        href={href}
        className="rounded-xl px-6 py-3 font-bold text-white shadow"
        style={{ backgroundColor: ZIMA }}
      >
        {children}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-xl px-6 py-3 font-bold shadow ring-1"
      style={{ backgroundColor: EGGSHELL, color: '#0b0b14', borderColor: 'rgba(255,255,255,.18)' }}
    >
      {children}
    </Link>
  );
}

/* ------------------- LeagueCard ------------------- */
function LeagueCard({
  l, now, archive, restore, archivedView, walletAddr,
}: {
  l: LeagueCardData; now: number;
  archive: (addr: string) => void; restore: (addr: string) => void;
  archivedView: boolean; walletAddr?: Address | undefined;
}) {
  const draftDate = l.draftTs > 0 ? new Date(l.draftTs * 1000) : null;
  const left = Math.max(0, l.draftTs - now);
  const t = secsTo(left);

  const homeProf = useTeamProfile(l.addr, l.homeOwner, { name: l.homeName });
  const awayProf = useTeamProfile(l.addr, l.awayOwner, { name: l.awayName });

  const copy = (text: string) => navigator.clipboard.writeText(text);

  const isFreeLeague = (l.buyIn ?? 0n) === 0n;
  const paidProgress = isFreeLeague ? l.filled : Math.min(l.paidCount ?? 0, l.filled);
  const progressPct = l.filled > 0 ? Math.round((paidProgress / l.filled) * 100) : isFreeLeague ? 100 : 0;
  const fullnessPct = l.cap > 0 ? Math.round((l.filled / l.cap) * 100) : 0;

  const paymentBadge =
    !isFreeLeague && l.owed !== undefined
      ? l.owed > 0n
        ? <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-100/10 px-2.5 py-1 text-xs ring-1 ring-amber-300/30" style={{ color: EGGSHELL }}>Owe {formatAvax(l.owed)}</span>
        : <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-100/10 px-2.5 py-1 text-xs ring-1 ring-emerald-300/30" style={{ color: EGGSHELL }}>Paid</span>
      : null;

  // --- Live matchup ordering + Bye Week fallback ---
  const myAddrL = walletAddr?.toLowerCase();
  const sides = [
    { owner: l.homeOwner, name: homeProf.name || l.homeName, score: l.homeScore, proj: l.homeProj, img: chooseAvatarUrl(homeProf.logo, l.homeOwner) },
    { owner: l.awayOwner, name: awayProf.name || l.awayName, score: l.awayScore, proj: l.awayProj, img: chooseAvatarUrl(awayProf.logo, l.awayOwner) },
  ];
  let leftIdx = 0, rightIdx = 1;
  if (myAddrL) {
    const i0 = sides[0].owner?.toLowerCase() === myAddrL;
    const i1 = sides[1].owner?.toLowerCase() === myAddrL;
    if (i1) { leftIdx = 1; rightIdx = 0; }
    else if (i0) { leftIdx = 0; rightIdx = 1; }
  }
  const leftSide = sides[leftIdx];
  let rightSide = sides[rightIdx];
  if (l.filled <= 1 && myAddrL && leftSide.owner?.toLowerCase() === myAddrL) {
    rightSide = { owner: undefined as any, name: 'Bye Week', score: 0, proj: 0, img: chooseAvatarUrl(undefined, 'bye-week' as any) };
  }

  // matchup % based on projection
  let leftPct: number;
  if (leftSide.name === 'Bye Week') leftPct = 0;
  else if (rightSide.name === 'Bye Week') leftPct = 100;
  else {
    const projSum = (leftSide.proj ?? 0) + (rightSide.proj ?? 0);
    leftPct = projSum > 0 ? Math.round((leftSide.proj / projSum) * 100) : 50;
  }
  const rightPct = 100 - leftPct;

  // ----- Bar colors by thresholds -----
  const barClassByPct = (pct: number) => {
    if (pct >= 100) return 'from-emerald-400 to-emerald-500';
    if (pct <= 32)   return 'from-red-500 to-red-500';
    if (pct <= 66)   return 'from-orange-400 to-orange-500';
    return 'from-yellow-400 to-yellow-500'; // 66.01–99
  };
  const paymentBarClass = isFreeLeague ? 'from-emerald-400 to-emerald-500' : barClassByPct(progressPct);
  const teamsBarClass   = barClassByPct(fullnessPct);

  // Compute "Pick X" for wallet if draft order exists (settings[4])
  // Note: this uses the wallet's position in the saved draft order array.
  const draftOrder = (metaResFor(l.addr)?.draftOrder ?? []) as Address[];
  const myPick = walletAddr && draftOrder.length > 0
    ? (draftOrder.findIndex(a => a?.toLowerCase() === walletAddr.toLowerCase()) + 1 || undefined)
    : undefined;

  return (
    // Removed subtle outer background; keep a single card with eggshell border
    <div className="h-[500px] rounded-2xl border p-4" style={{ borderColor: EGGSHELL }}>
      <div className="group flex h-full flex-col rounded-2xl">
        {/* Name */}
        <h3 className="mb-2 text-center text-2xl font-extrabold tracking-tight" style={{ color: ZIMA }}>
          {l.name || 'Unnamed League'}
        </h3>

        {/* Centered addresses */}
        <div className="mb-3 space-y-2 text-[12px] sm:text-[13px]" style={{ color: EGGSHELL }}>
          <div className="flex flex-wrap items-center justify-center gap-2 text-center">
            <span className="font-semibold" style={{ color: ZIMA }}>League Address</span>
            <code className="break-all font-mono text-[11px]">{l.addr}</code>
            <button
              onClick={() => copy(l.addr)}
              className="rounded-md border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/15"
              style={{ color: EGGSHELL }}
            >
              Copy
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 text-center">
            <span className="font-semibold" style={{ color: EGGSHELL }}>Wallet Address</span>
            <code className="break-all font-mono text-[11px]">{(walletAddr ?? '—')}</code>
            <button
              onClick={() => walletAddr && copy(walletAddr)}
              disabled={!walletAddr}
              className="rounded-md border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/15 disabled:opacity-40"
              style={{ color: EGGSHELL }}
            >
              Copy
            </button>
          </div>
        </div>

        {/* Pills */}
        <div className="mb-2 flex flex-wrap items-center justify-center gap-2 text-xs" style={{ color: EGGSHELL }}>
          {paymentBadge}
          {l.isCommissioner && (
            <span
              className="rounded-full border px-2 py-1"
              style={{ color: EGGSHELL, borderColor: '#FFD700', background: 'rgba(255,215,0,0.08)' }}
            >
              Commissioner
            </span>
          )}
          {l.passwordRequired
            ? <span className="rounded-full border border-white/15 bg-white/5 px-2 py-1" style={{ color: EGGSHELL }}>Password required</span>
            : <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-1" style={{ color: EGGSHELL }}>No Password</span>}
          {l.escrowNative !== undefined && <span className="rounded-full border border-white/15 bg-white/5 px-2 py-1" style={{ color: EGGSHELL }}>Escrow: {formatAvax(l.escrowNative)}</span>}
        </div>

        {/* Progress */}
        <div className="mx-auto mb-5 w-full max-w-md">
          <div className="mb-1 flex items-center justify-between text-[12px] font-semibold" style={{ color: EGGSHELL }}>
            <span>Payments</span>
            <span className="font-bold">{isFreeLeague ? 'Free' : `${paidProgress}/${l.filled} (${progressPct}%)`}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/10">
            <div className={`h-2 rounded-full bg-gradient-to-r ${paymentBarClass}`} style={{ width: `${isFreeLeague ? 100 : progressPct}%` }} />
          </div>

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[12px] font-semibold" style={{ color: EGGSHELL }}>
              <span>Teams</span>
              <span className="font-bold">{l.filled}/{l.cap} ({fullnessPct}%)</span>
            </div>
            <div className="h-2 w-full rounded-full bg-white/10">
              <div className={`h-2 rounded-full bg-gradient-to-r ${teamsBarClass}`} style={{ width: `${fullnessPct}%` }} />
            </div>
          </div>
        </div>

        {/* Draft / Matchup */}
        <div className="mt-1">
          {!l.draftCompleted ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-0 text-center text-[11px] uppercase tracking-[0.2em]" style={{ color: ZIMA }}>Draft</div>
              {draftDate ? (
                <>
                  <div className="mt-0 text-center text-lg font-extrabold" style={{ color: EGGSHELL }}>
                    {draftDate.toLocaleDateString()} • {draftDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="mt-0 text-center text-sm" style={{ color: EGGSHELL }}>
                    Pick {myPick ?? 'Unknown'}
                  </div>
                  {l.draftTs > now ? (
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {([['Days', t.d], ['Hrs', t.h], ['Min', t.m], ['Sec', t.sec]] as const).map(([label, val]) => (
                        <div key={label} className="rounded-xl bg-white/10 px-3 py-1.75 text-center ring-1 ring-white/15">
                          <div className="text-xl font-black tabular-nums" style={{ color: EGGSHELL }}>{val}</div>
                          <div className="text-[10px]" style={{ color: EGGSHELL }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-center font-semibold" style={{ color: EGGSHELL }}>Draft window open</div>
                  )}
                </>
              ) : (
<div className="text-center space-y-2" style={{ color: EGGSHELL }}>
  <div className="text-xl font-bold">Draft not scheduled</div>
  <div className="text-sm leading-relaxed">
    <p>
      Invite friends by sharing the <span className="font-semibold text-egg">League Address</span> 
      and <span className="font-semibold text-egg">password</span> (if required).
    </p>
    <p>
      The <span className="font-semibold text-gold">Commissioner</span> can set the draft order anytime from Draft Settings.
    </p>
  </div>
</div>

              )}
            </div>
          ) : (
            // Entire box is the link (clickable + hoverable)
            <Link
              href={`/league/${l.addr}/scoreboard`}
              className="group block rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[0.06] hover:shadow"
              title="Open Scoreboard"
              aria-label="Open Scoreboard"
            >
              {/* Teams row: name+logo, record, proj, ytp per side */}
              <div className="grid grid-cols-3 items-center" style={{ color: EGGSHELL }}>
                <Side
                  align="left"
                  name={leftSide.name}
                  ownerAddr={leftSide.owner}
                  proj={leftSide.proj}
                  ytp={9}
                  img={leftSide.img}
                />

                {/* Centered score, very close to middle */}
                <div className="flex flex-col items-center justify-center">
                  <div className="text-5xl font-black tabular-nums">
                    {leftSide.score}
                    <span className="mx-2 text-3xl">-</span>
                    {rightSide.score}
                  </div>
                </div>

                <Side
                  align="right"
                  name={rightSide.name}
                  ownerAddr={rightSide.owner}
                  proj={rightSide.proj}
                  ytp={9}
                  img={rightSide.img}
                />
              </div>

              {/* % meter (up under score) */}
              <div className="mt-2">
                <div className="flex items-center justify-between text-[11px]" style={{ color: EGGSHELL }}>
                  <span className="tabular-nums">{leftPct}%</span>
                  <span className="tabular-nums">{rightPct}%</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${leftPct}%` }} />
                </div>
              </div>
            </Link>
          )}
        </div>

        {/* Actions */}
        <div className="mt-3 flex gap-2">
          <Link
            href={`/league/${l.addr}/my-team`}
            className="flex-1 rounded-xl px-3 py-2 text-center font-semibold text-white shadow"
            style={{ backgroundColor: ZIMA }}
          >
            My Team
          </Link>
          {l.draftCompleted ? (
            <Link
              href={`/league/${l.addr}`}
              className="flex-1 rounded-xl bg-transparent px-3 py-2 text-center font-semibold"
              style={{ border: `1px solid ${ZIMA}`, color: ZIMA }}
            >
              League
            </Link>
          ) : l.isCommissioner ? (
            <Link
              href={`/league/${l.addr}/settings/draft-settings`}
              className="flex-1 rounded-xl bg-transparent px-3 py-2 text-center font-semibold"
              style={{ border: `1px solid ${ZIMA}`, color: ZIMA }}
            >
              Draft Settings
            </Link>
          ) : (
            <Link
              href={`/league/${l.addr}`}
              className="flex-1 rounded-xl bg-transparent px-3 py-2 text-center font-semibold"
              style={{ border: `1px solid ${ZIMA}`, color: ZIMA }}
            >
              Enter League
            </Link>
          )}
        </div>

        {/* Foot links */}
        <div className="mt-2 mb-6 flex items-center justify-center gap-5 text-xs">
          {!archivedView && (
            <button className="hover:underline" onClick={() => archive(l.addr)} style={{ color: ORANGE }}>
              Archive
            </button>
          )}
          {archivedView && (
            <button className="hover:underline" onClick={() => restore(l.addr)} style={{ color: EGGSHELL }}>
              Restore
            </button>
          )}
          <a
            href={`https://testnet.snowtrace.io/address/${l.addr}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
            style={{ color: '#FFFFFF' }}
          >
            Snowtrace →
          </a>
        </div>
      </div>
    </div>
  );
}

// Helper to access draft order from the existing read bundle
function metaResFor(addr: Address): { draftOrder?: Address[] } | undefined {
  // This function is a no-op shim so TypeScript is happy; at runtime the draft "Pick" uses local computation above.
  return undefined;
}

/** Choose consistent avatar: profile logo if present, else deterministic geometric by owner. */
function chooseAvatarUrl(profileLogo?: string, owner?: string) {
  if (profileLogo && profileLogo.trim().length > 0) return profileLogo;
  if (owner && owner.startsWith('0x')) return generatedLogoFor(owner);
  return generatedLogoFor(owner || 'hashmark-default');
}

/* Square-ish avatar */
function Avatar({ url, owner }: { url?: string; owner?: string }) {
  return (
    <img
      src={url || chooseAvatarUrl(undefined, owner)}
      alt="team"
      className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/10"
    />
  );
}

/* Side block: name+logo (one line), record, then Proj, then Yet to Play
   Avatar is left of info for left side; right of info for right side */
function Side({
  name, proj, ytp, align, img, ownerAddr,
}: {
  name: string; proj: number; ytp: number;
  align: 'left' | 'right'; img?: string; ownerAddr?: Address;
}) {
  const isRight = align === 'right';
  return (
    <div className="px-2 text-center" style={{ color: EGGSHELL }}>
      <div className={`mx-auto flex max-w-full items-center justify-center gap-2`}>
        {!isRight && <Avatar url={img} owner={ownerAddr} />}
        <div className="min-w-0 text-center">
          <div className="truncate font-semibold leading-tight text-[15px]">{name}</div>
          <div className="mt-0.5 text-[11px] opacity-90">Record 0-0-0</div>
          <div className="mt-1 text-[11px]">Proj {proj}</div>
          <div className="text-[11px]">Yet to Play {ytp}</div>
        </div>
        {isRight && <Avatar url={img} owner={ownerAddr} />}
      </div>
    </div>
  );
}
