// src/app/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId, usePublicClient, useReadContract, useReadContracts } from 'wagmi';
import { LEAGUE_FACTORY_ABI, factoryAddressForChain } from '@/lib/LeagueContracts';
import { useTeamProfile } from '@/lib/teamProfile';

/* ------------------- Types ------------------- */
type Address = `0x${string}`;

/* ------------------- On-chain ABIs ------------------- */
// Keep this local minimal ABI for per-league reads (or you can import from LeagueContracts if you prefer)
const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'buyInAmount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'buyInToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'createdAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'getTeams',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'name', type: 'string' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getDraftSettings',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }, { type: 'uint64' }, { type: 'uint8' }, { type: 'bool' }, { type: 'address[]' }],
  },
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
  } catch {
    return fallback;
  }
};
const writeLS = <T,>(k: string, v: T) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

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

type TeamTuple = { owner: Address; name: string };
const toTeamArr = (v: unknown): TeamTuple[] => (Array.isArray(v) ? (v as TeamTuple[]) : []);

type LeagueCardData = {
  addr: Address;
  name?: string;
  buyIn?: bigint;
  buyInToken?: Address;
  createdAt?: number;
  filled: number;
  cap: number;
  draftCompleted: boolean;
  draftTs: number;
  homeName: string;
  awayName: string;
  homeOwner?: Address;
  awayOwner?: Address;
  homeScore: number;
  awayScore: number;
  homeProj: number;
  awayProj: number;
  record: string;
  isArchived: boolean;
  isMember: boolean;
  owed?: bigint;
  isCommissioner: boolean;
  passwordRequired: boolean;
  escrowNative?: bigint;
  escrowToken?: bigint;
  paidCount?: number;
};

/* ---------- Wallet UI ---------- */
function ConnectControlsTop() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        if (!mounted) return null;
        if (!account) {
          return (
            <button onClick={openConnectModal} className="rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 font-semibold">
              Connect Wallet
            </button>
          );
        }
        return (
          <div className="flex items-center gap-2">
            <button
              onClick={openChainModal}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm hover:bg-white/10"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {chain?.iconUrl ? <img src={chain.iconUrl} alt={chain?.name ?? 'Chain'} className="h-4 w-4 rounded-full" /> : null}
              <span className="truncate max-w-[120px]">{chain?.name ?? 'Select Network'}</span>
              <span aria-hidden>▾</span>
            </button>
            <button
              onClick={openAccountModal}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm hover:bg-white/10"
            >
              <span className="truncate max-w-[140px]">{account?.displayName}</span>
              {account?.displayBalance ? <span className="opacity-80">{account.displayBalance}</span> : null}
              <span aria-hidden>▾</span>
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

/* ---------- Reorder modal ---------- */
function ReorderModal({
  open,
  onClose,
  leagues,
  order,
  setOrder,
  walletKey,
}: {
  open: boolean;
  onClose: () => void;
  leagues: LeagueCardData[];
  order: string[];
  setOrder: (next: string[]) => void;
  walletKey: string;
}) {
  const [list, setList] = useState<string[]>(order);
  const dragIdx = useRef<number | null>(null);

  useEffect(() => {
    if (open) setList(order);
  }, [open, order]);

  const onDragStart = (i: number) => (e: React.DragEvent) => {
    dragIdx.current = i;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIdx.current;
    if (from === null || from === i) return;
    const next = [...list];
    const [m] = next.splice(from, 1);
    next.splice(i, 0, m);
    dragIdx.current = i;
    setList(next);
  };
  const onDrop = () => {
    dragIdx.current = null;
  };
  const save = () => {
    setOrder(list);
    writeLS(walletKey, list);
    onClose();
  };

  if (!open) return null;

  const lookup = new Map(leagues.map((l) => [l.addr, l]));

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-gray-950 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Reorder Leagues</h3>
          <button onClick={onClose} className="rounded-md bg-white/10 px-2 py-1 hover:bg-white/20">✕</button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {list.map((addr, i) => (
            <div
              key={addr}
              draggable
              onDragStart={onDragStart(i)}
              onDragOver={onDragOver(i)}
              onDrop={onDrop}
              className="mb-2 flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2"
            >
              <div className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/10 text-sm">≡</div>
              <div className="w-6 shrink-0 text-right tabular-nums text-sm">{i + 1}</div>
              <div className="truncate text-sm">{lookup.get(addr)?.name || addr}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2">Cancel</button>
          <button onClick={save} className="rounded-lg bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-700">Save</button>
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

  // Pick the correct factory for the current chain
  const factory = factoryAddressForChain(chainId) as Address | undefined;
  const factoryMissing = !factory;

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Wallet-scoped storage keys
  const ORDER_KEY = `leagueOrder:${wallet ?? 'anon'}`;
  const ARCHIVE_KEY = `archivedLeagues:${wallet ?? 'anon'}`;
  const ARCHIVE_ONLY_KEY = `archivedOnly:${wallet ?? 'anon'}`;
  const HAD_EVER_KEY = `hadLeaguesEver:${wallet ?? 'anon'}`;

  // States
  const [archived, setArchived] = useState<string[]>(() => readLS<string[]>(ARCHIVE_KEY, []));
  const [archivedOnly, setArchivedOnly] = useState<boolean>(() => readLS<boolean>(ARCHIVE_ONLY_KEY, false));
  const [hadEver, setHadEver] = useState<boolean>(() => readLS<boolean>(HAD_EVER_KEY, false));
  const [order, setOrder] = useState<string[]>(() => readLS<string[]>(ORDER_KEY, []));

  // Wallet change -> rehydrate
  useEffect(() => {
    setArchived(readLS<string[]>(ARCHIVE_KEY, []));
    setArchivedOnly(readLS<boolean>(ARCHIVE_ONLY_KEY, false));
    setHadEver(readLS<boolean>(HAD_EVER_KEY, false));
    setOrder(readLS<string[]>(ORDER_KEY, []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  // Persist
  useEffect(() => writeLS(ARCHIVE_KEY, archived), [ARCHIVE_KEY, archived]);
  useEffect(() => writeLS(ARCHIVE_ONLY_KEY, archivedOnly), [ARCHIVE_ONLY_KEY, archivedOnly]);
  useEffect(() => writeLS(HAD_EVER_KEY, hadEver), [HAD_EVER_KEY, hadEver]);
  useEffect(() => writeLS(ORDER_KEY, order), [ORDER_KEY, order]);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);

  // Debug helper: verify deployed code at factory address
  useEffect(() => {
    (async () => {
      if (!publicClient || !factory) return;
      try {
        const code = await publicClient.getBytecode({ address: factory });
        // Shows 0 if not a contract
        // eslint-disable-next-line no-console
        console.debug('[Factory bytecode length]', code?.length ?? 0, factory);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.debug('[Factory bytecode check failed]', e);
      }
    })();
  }, [publicClient, factory]);

  /* ------------------- Factory reads ------------------- */

  // 1) Possibly empty on some deploys
  const leaguesRes = useReadContract({
    abi: LEAGUE_FACTORY_ABI,
    // address: factory,
    address: factoryAddressForChain(chainId) as Address | undefined,
    functionName: 'getLeagues',
    chainId,
    query: { enabled: Boolean(factory), refetchInterval: 10_000 },
  });

  // 2) Always safe; shows leagues you created even if you’re not yet a member
  const leaguesByCreatorRes = useReadContract({
    abi: LEAGUE_FACTORY_ABI,
    address: factory,
    functionName: 'getLeaguesByCreator',
    args: wallet ? [wallet as Address] : undefined,
    chainId,
    query: { enabled: Boolean(wallet && factory), refetchInterval: 10_000 },
  });

  // Union of both results
  const leagueAddrs = useMemo<Address[]>(() => {
    const a = leaguesRes.data as unknown;
    const b = leaguesByCreatorRes.data as unknown;

    const arrA =
      Array.isArray(a) && a.every((x) => typeof x === 'string' && x.startsWith('0x')) ? (a as Address[]) : [];
    const arrB =
      Array.isArray(b) && b.every((x) => typeof x === 'string' && x.startsWith('0x')) ? (b as Address[]) : [];

    return Array.from(new Set([...arrA, ...arrB]));
  }, [leaguesRes.data, leaguesByCreatorRes.data]);

  /* ------------------- Per-league reads (static + wallet) ------------------- */
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

  // Teams by league
  const teamsByLeague = useMemo(() => {
    const out: { addr: Address; teams: TeamTuple[] }[] = [];
    leagueAddrs.forEach((addr, i) => {
      const base = i * (PER_LEAGUE_STATIC + (wallet ? 2 : 0));
      const rawTeams = metaRes.data?.[base + 4]?.result;
      out.push({ addr, teams: toTeamArr(rawTeams) });
    });
    return out;
  }, [leagueAddrs, metaRes.data, wallet]);

  // Per-team hasPaid() reads
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
      arr.forEach(() => {
        const r = teamPaidRes.data?.[k++];
        if ((r?.result as boolean | undefined) === true) n++;
      });
      counts[addr] = n;
    });
    return counts;
  }, [teamsByLeague, teamPaidRes.data]);

  // Ticking
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // Build cards
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
      const settings =
        (metaRes.data?.[base + 5]?.result as readonly [bigint, bigint, bigint, boolean, readonly Address[]] | undefined) ?? undefined;
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
      const n0 =
        (team0?.name && team0.name.trim()) ||
        (team0?.owner ? `${team0.owner.slice(0, 6)}…${team0.owner.slice(-4)}` : 'Team A');
      const n1 =
        (team1?.name && team1.name.trim()) ||
        (team1?.owner ? `${team1.owner.slice(0, 6)}…${team1.owner.slice(-4)}` : 'Team B');

      arr.push({
        addr: address,
        name,
        buyIn,
        buyInToken,
        createdAt,
        filled,
        cap,
        draftCompleted,
        draftTs,
        homeName: n0,
        awayName: n1,
        homeOwner: team0?.owner,
        awayOwner: team1?.owner,
        homeScore: 0,
        awayScore: 0,
        homeProj: 0,
        awayProj: 0,
        record: '0–0',
        isArchived: archived.includes(address),
        isMember,
        owed,
        isCommissioner: !!(lowerWallet && commish && lowerWallet === commish.toLowerCase()),
        passwordRequired,
        escrowNative,
        escrowToken,
        paidCount: teamPaidCounts[address] ?? 0,
      });
    });

    return arr;
  }, [leagueAddrs, metaRes.data, archived, wallet, teamPaidCounts]);

  // SHOW: leagues you’re a member of OR you created
  const createdByMe = useMemo<Set<string>>(() => {
    const b = leaguesByCreatorRes.data as unknown;
    const arrB = Array.isArray(b) ? (b as string[]) : [];
    return new Set(arrB.map((x) => x.toLowerCase()));
  }, [leaguesByCreatorRes.data]);

  const membershipFiltered = useMemo(
    () => allLeagues.filter((l) => l.isMember || createdByMe.has(l.addr.toLowerCase())),
    [allLeagues, createdByMe]
  );

  useEffect(() => {
    if (membershipFiltered.length > 0 || archived.length > 0) setHadEver(true);
  }, [membershipFiltered.length, archived.length]);

  // Apply archived toggle + order
  const filtered = useMemo(() => {
    const base = membershipFiltered.filter((x) => (archivedOnly ? x.isArchived : !x.isArchived));
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
  }, [membershipFiltered, archivedOnly, order, setOrder]);

  const hasLeagues = filtered.length > 0;
  const showPills = hadEver && (hasLeagues || archived.length > 0);

  const archive = (addr: string) => {
    setArchived((prev) => (prev.includes(addr) ? prev : [...prev, addr]));
    setHadEver(true);
  };
  const restore = (addr: string) => setArchived((prev) => prev.filter((x) => x !== addr));

  // Carousel
  const railRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [isMd, setIsMd] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(min-width:768px)');
    const on = () => setIsMd(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const perPage = isMd ? 2 : 1;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const scrollToPage = (p: number) => {
    const el = railRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(totalPages - 1, p));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
    setPage(clamped);
  };
  const onRailScroll = () => {
    const el = railRef.current;
    if (!el) return;
    setPage(Math.round(el.scrollLeft / el.clientWidth));
  };

  const isFuji = chainId === 43113;

  return (
    <>
      {/* Top navbar */}
      <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-black/40 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/avalanche-avax-logo.svg" alt="Hashmark Logo" width={24} height={24} />
            <span className="text-lg font-semibold">Hashmark</span>
          </Link>
          <ConnectControlsTop />
        </div>
      </header>

      <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-4 sm:px-6 py-6 sm:py-10">
        {/* Network guardrail */}
        {mounted && !isFuji && (
          <div className="mx-auto mb-4 max-w-6xl rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-amber-200">
            You’re on a different network. Switch to <span className="font-semibold">Avalanche Fuji (43113)</span> to
            see your leagues and interact with them.
          </div>
        )}
        {/* Factory guardrail */}
        {mounted && factoryMissing && (
          <div className="mx-auto mb-4 max-w-6xl rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-rose-200">
            Factory address is not set for this chain. Add <code className="font-mono">NEXT_PUBLIC_FACTORY_FUJI</code> (or the
            appropriate chain variable) to <b>.env.local</b>.
          </div>
        )}

        {/* blobs */}
        <div className="pointer-events-none absolute -top-24 -left-16 -z-10 h-72 w-72 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="pointer-events-none absolute top-10 right-0 -z-10 h-80 w-80 rounded-full bg-purple-500/20 blur-3xl" />

        <div className="mx-auto max-w-6xl">
          {/* Actions */}
          <div className="mb-6 sm:mb-8 flex flex-wrap items-center justify-center gap-4">
            <CTA href="/create-league" primary>+ Create League</CTA>
            <CTA href="/join-league">Join League</CTA>
          </div>

          {/* Pills */}
          <div className={`mb-6 flex items-center justify-center gap-3 transition-opacity ${mounted && showPills ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
            <div className="inline-flex rounded-full border border-white/15 bg-white/5 p-1 shadow-lg shadow-purple-500/10">
              <button
                onClick={() => setArchivedOnly(false)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${!archivedOnly ? 'bg-white text-purple-700' : 'text-white/80 hover:text-white'}`}
              >
                Active
              </button>
              <button
                onClick={() => setArchivedOnly(true)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${archivedOnly ? 'bg-white text-purple-700' : 'text-white/80 hover:text-white'}`}
              >
                Archived
              </button>
            </div>
            <button onClick={() => setModalOpen(true)} className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm font-semibold hover:bg-white/10">
              Reorder
            </button>
          </div>

          {/* Leagues */}
          {filtered.length > 0 ? (
            filtered.length === 1 ? (
              <section className="mx-auto max-w-3xl">
                <LeagueCard
                  l={filtered[0]}
                  now={now}
                  archive={archive}
                  restore={restore}
                  archivedView={archivedOnly}
                  walletAddr={wallet as Address | undefined}
                />
              </section>
            ) : (
              <section className="relative">
                <div ref={railRef} onScroll={onRailScroll} className="snap-x snap-mandatory overflow-x-hidden">
                  <div className="flex w-full">
                    {filtered.map((l) => (
                      <div key={l.addr} className="w-full shrink-0 snap-start px-3 md:w-1/2">
                        <LeagueCard
                          l={l}
                          now={now}
                          archive={archive}
                          restore={restore}
                          archivedView={archivedOnly}
                          walletAddr={wallet as Address | undefined}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {filtered.length > (isMd ? 2 : 1) && (
                  <>
                    <button
                      onClick={() => scrollToPage(page - 1)}
                      disabled={page <= 0}
                      className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-2 transition hover:bg-white/10 disabled:opacity-40"
                      aria-label="Previous"
                    >
                      ‹
                    </button>
                    <button
                      onClick={() => scrollToPage(page + 1)}
                      disabled={page >= totalPages - 1}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-2 transition hover:bg-white/10 disabled:opacity-40"
                      aria-label="Next"
                    >
                      ›
                    </button>
                    <div className="mt-5 flex items-center justify-center gap-2">
                      {Array.from({ length: totalPages }).map((_, i) => (
                        <button
                          key={i}
                          onClick={() => scrollToPage(i)}
                          className={`h-2.5 w-6 rounded-full transition ${i === page ? 'bg-gradient-to-r from-fuchsia-400 to-purple-400 shadow-[0_0_10px_rgba(217,70,239,0.6)]' : 'bg-white/25 hover:bg-white/40'}`}
                          aria-label={`Go to page ${i + 1}`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </section>
            )
          ) : (
            <>
              <p className="mt-10 text-center text-gray-400">No leagues yet. Create or join to get started.</p>
              <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <div className="h-6 w-1/3 rounded bg-white/10" />
                    <div className="mt-4 h-24 rounded-xl border border-white/10 bg-black/20" />
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="h-10 rounded-xl bg-white/10" />
                      <div className="h-10 rounded-xl bg-white/5" />
                    </div>
                    <div className="mt-3 text-xs text-gray-400">
                      Tip: You’ll see your leagues here after you create or join one.
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-10 flex items-center justify-center gap-4 text-sm text-gray-400">
                <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1">
                  {chainId ? `Network: ${chainId}` : 'Network: —'}
                </span>
                <span>Need help? You can always reach out to your league commissioner.</span>
              </div>
            </>
          )}

          {/* Info Boxes */}
          <section className="mt-12">
            <h2 className="mb-5 text-center text-lg font-bold tracking-tight text-white/90">
              Learn more about Hashmark & Avalanche
            </h2>
            <div className="grid gap-5 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <div className="mb-2 text-sm uppercase tracking-[0.15em] text-purple-200/90">Platform</div>
                <h3 className="mb-2 text-xl font-extrabold">What is Hashmark?</h3>
                <p className="text-gray-300">
                  Create <span className="font-semibold">on-chain fantasy leagues</span> with escrowed buy-ins, secure
                  joins, and transparent rules.
                </p>
                <ul className="mt-3 list-disc pl-5 text-sm text-gray-400">
                  <li>Native/Token buy-ins held in escrow</li>
                  <li>Password or signature-gated joins</li>
                  <li>Configurable draft settings &amp; orders</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <div className="mb-2 text-sm uppercase tracking-[0.15em] text-purple-200/90">Network</div>
                <h3 className="mb-2 text-xl font-extrabold">Why Avalanche?</h3>
                <p className="text-gray-300">
                  Fast finality and low fees make Avalanche ideal for interactive apps. Test first on <b>Fuji</b>.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  <a href="https://faucet.avax.network/" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 hover:bg-white/10">
                    Get Test AVAX
                  </a>
                  <a href="https://testnet.snowtrace.io/" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 hover:bg-white/10">
                    Snowtrace (Testnet)
                  </a>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <div className="mb-2 text-sm uppercase tracking-[0.15em] text-purple-200/90">Resources</div>
                <h3 className="mb-2 text-xl font-extrabold">Fantasy Football Links</h3>
                <ul className="space-y-2 text-gray-300">
                  <li><a href="https://www.fantasypros.com/nfl/" target="_blank" rel="noopener noreferrer" className="text-fuchsia-300 hover:underline">FantasyPros – Rankings &amp; Advice</a></li>
                  <li><a href="https://www.espn.com/fantasy/football/" target="_blank" rel="noopener noreferrer" className="text-fuchsia-300 hover:underline">ESPN Fantasy Football</a></li>
                  <li><a href="https://football.fantasysports.yahoo.com/" target="_blank" rel="noopener noreferrer" className="text-fuchsia-300 hover:underline">Yahoo Fantasy Football</a></li>
                  <li><a href="https://sleeper.com/" target="_blank" rel="noopener noreferrer" className="text-fuchsia-300 hover:underline">Sleeper</a></li>
                </ul>
                <p className="mt-3 text-xs text-gray-500">External links are for research; Hashmark isn’t affiliated.</p>
              </div>
            </div>
          </section>
        </div>
      </main>

      <ReorderModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        leagues={filtered}
        order={order}
        setOrder={setOrder}
        walletKey={ORDER_KEY}
      />
    </>
  );
}

/* ---------- CTA helper ---------- */
function CTA({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return primary ? (
    <Link
      href={href}
      className="rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 px-6 py-3 font-bold shadow-lg shadow-fuchsia-500/25 hover:from-fuchsia-500 hover:to-purple-500 focus:outline-none focus:ring-2 focus:ring-white/60"
    >
      {children}
    </Link>
  ) : (
    <Link
      href={href}
      className="rounded-xl border border-fuchsia-400/50 bg-fuchsia-500/5 px-6 py-3 font-bold text-fuchsia-200 hover:border-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-300/50"
    >
      {children}
    </Link>
  );
}

/* ------------------- LeagueCard ------------------- */
function LeagueCard({
  l,
  now,
  archive,
  restore,
  archivedView,
  walletAddr,
}: {
  l: LeagueCardData;
  now: number;
  archive: (addr: string) => void;
  restore: (addr: string) => void;
  archivedView: boolean;
  walletAddr?: Address | undefined;
}) {
  const draftDate = l.draftTs > 0 ? new Date(l.draftTs * 1000) : null;
  const left = Math.max(0, l.draftTs - now);
  const t = secsTo(left);
  const preDraft = !l.draftCompleted;

  const homeProf = useTeamProfile(l.addr, l.homeOwner, { name: l.homeName });
  const awayProf = useTeamProfile(l.addr, l.awayOwner, { name: l.awayName });

  const copy = (text: string) => navigator.clipboard.writeText(text);

  // Payment progress & labels
  const isFreeLeague = (l.buyIn ?? 0n) === 0n;
  const paidProgress = isFreeLeague ? l.filled : Math.min(l.paidCount ?? 0, l.filled);
  const progressPct = l.filled > 0 ? Math.round((paidProgress / l.filled) * 100) : isFreeLeague ? 100 : 0;

  // Fullness (pre-draft)
  const fullnessPct = l.cap > 0 ? Math.round((l.filled / l.cap) * 100) : 0;

  const paymentBadge =
    !isFreeLeague && l.owed !== undefined
      ? l.owed > 0n
        ? <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-xs">Owe {formatAvax(l.owed)}</span>
        : <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-xs">Paid</span>
      : null;

  return (
    <div className="h-[540px] rounded-2xl bg-gradient-to-b from-white/15 via-white/5 to-transparent p-[1.5px]">
      <div className="group flex h-full flex-col rounded-2xl border border-white/10 bg-black/40 p-4 sm:p-5 shadow-2xl shadow-black/40 backdrop-blur-sm">
        {/* Name */}
        <h3 className="mb-2 bg-gradient-to-r from-fuchsia-400 via-purple-300 to-fuchsia-400 bg-clip-text text-center text-2xl font-extrabold tracking-tight text-transparent drop-shadow-[0_1px_0_rgba(0,0,0,0.6)]">
          {l.name || 'Unnamed League'}
        </h3>

        {/* Addresses side-by-side */}
        <div className="mb-3 space-y-1 text-[12px] sm:text-[13px]">
          <div className="flex items-center justify-center gap-2">
            <span className="shrink-0 font-semibold text-yellow-300">League Address</span>
            <code className="max-w-full break-all font-mono text-white/90">{l.addr}</code>
            <button onClick={() => copy(l.addr)} className="rounded-md border border-white/10 bg-white/10 px-2 py-1 text-[11px] hover:bg-white/15">
              Copy
            </button>
          </div>
          <div className="flex items-center justify-center gap-2">
            <span className="shrink-0 font-semibold text-blue-400">Wallet Address</span>
            <code className="max-w-full break-all font-mono text-white/90">{walletAddr ?? '—'}</code>
            <button
              onClick={() => walletAddr && copy(walletAddr)}
              disabled={!walletAddr}
              className="rounded-md border border-white/10 bg-white/10 px-2 py-1 text-[11px] hover:bg-white/15 disabled:opacity-40"
            >
              Copy
            </button>
          </div>
        </div>

        {/* Chips */}
        <div className="mb-2 flex flex-wrap items-center justify-center gap-2 text-xs">
          {paymentBadge}
          {l.isCommissioner && <span className="rounded-full border border-purple-400/40 bg-purple-500/10 px-2 py-1 text-purple-200">Commissioner</span>}
          {l.passwordRequired && <span className="rounded-full border border-white/15 bg-white/10 px-2 py-1">Password required</span>}
          {l.escrowNative !== undefined && <span className="rounded-full border border-white/15 bg-white/10 px-2 py-1">Escrow: {formatAvax(l.escrowNative)}</span>}
        </div>

        {/* Payments progress */}
        <div className="mx-auto mb-3 w-full max-w-md">
          <div className="mb-1 flex items-center justify-between text-[11px] text-gray-400">
            <span>Payments</span>
            <span>{isFreeLeague ? 'Free' : `${paidProgress}/${l.filled} (${progressPct}%)`}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/10">
            <div
              className={`h-2 rounded-full ${isFreeLeague ? 'bg-emerald-400' : 'bg-gradient-to-r from-emerald-400 to-emerald-500'}`}
              style={{ width: `${isFreeLeague ? 100 : progressPct}%` }}
            />
          </div>

          {/* Teams fullness (pre-draft only) */}
          {preDraft && (
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between text-[11px] text-gray-400">
                <span>Teams</span>
                <span>{l.filled}/{l.cap} ({fullnessPct}%)</span>
              </div>
              <div className="h-2 w-full rounded-full bg-white/10">
                <div className="h-2 rounded-full bg-gradient-to-r from-sky-400 to-blue-500" style={{ width: `${fullnessPct}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="mb-3 space-x-4 text-center text-xs sm:text-sm text-gray-300">
          <span><span className="text-gray-400">Buy-In:</span> {formatAvax(l.buyIn)}</span>
          <span><span className="text-gray-400">Teams:</span> {l.filled}/{l.cap}</span>
        </div>

        {/* Main content */}
        <div className="min-h-[150px] rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.02] p-4">
          {!l.draftCompleted ? (
            <>
              <div className="mb-0 text-center text-[11px] uppercase tracking-[0.2em] text-purple-200/80">Draft</div>
              {draftDate ? (
                <>
                  <div className="mt-2 text-center text-lg font-extrabold">
                    {draftDate.toLocaleDateString()} • {draftDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  {l.draftTs > now ? (
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {([['Days', t.d], ['Hrs', t.h], ['Min', t.m], ['Sec', t.sec]] as const).map(([label, val]) => (
                        <div key={label} className="rounded-xl bg-gradient-to-b from-purple-500/15 to-fuchsia-500/10 px-3 py-2 text-center ring-1 ring-purple-400/30">
                          <div className="text-xl font-black tabular-nums">{val}</div>
                          <div className="text-[10px] text-purple-200/90">{label}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-center font-semibold text-green-400">Draft window open</div>
                  )}
                </>
              ) : (
                <div className="text-center">
                  <div className="text-gray-300 text-lg font-semibold">Draft not scheduled</div>
                  <div className="mt-2 space-y-1 text-sm text-gray-300">
                    <p>Set your draft time in Draft Settings</p>
                    <p>Invite users by sending the <span className="font-semibold">League Address</span> above and the <span className="font-semibold">password</span> (if set)</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mb-2 text-center text-[11px] uppercase tracking-[0.2em] text-purple-200/80">Matchup</div>
              <Link href={`/league/${l.addr}/scoreboard`} className="group block w-full rounded-xl border border-white/10 bg-black/30 p-4 transition hover:border-fuchsia-400/60" title="Open Scoreboard">
                <div className="grid grid-cols-3 items-center">
                  <Side name={homeProf.name || l.homeName} score={l.homeScore} proj={l.homeProj} ytp={9} />
                  <div className="flex items-center justify-center">
                    <div className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-white/10 text-xs text-white/80">VS</div>
                  </div>
                  <Side name={awayProf.name || l.awayName} score={l.awayScore} proj={l.awayProj} ytp={9} />
                </div>
              </Link>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="mt-3 flex gap-2">
          <Link href={`/league/${l.addr}/my-team`} className="flex-1 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 px-3 py-2 text-center font-semibold shadow-lg shadow-fuchsia-500/20 hover:from-fuchsia-500 hover:to-purple-500 focus:outline-none focus:ring-2 focus:ring-white/60">
            My Team
          </Link>

          {/* PERMISSIONS:
              - Pre-draft & Commissioner => "Draft Settings"
              - Pre-draft & NOT Commissioner => "Enter League"
              - Post-draft (everyone) => "League"
          */}
          {l.draftCompleted ? (
            <Link href={`/league/${l.addr}`} className="flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-center font-semibold text-gray-200 hover:border-purple-400/60 focus:outline-none focus:ring-2 focus:ring-white/40">
              League
            </Link>
          ) : l.isCommissioner ? (
            <Link href={`/league/${l.addr}/settings/draft-settings`} className="flex-1 rounded-xl border border-fuchsia-400/50 bg-fuchsia-500/5 px-3 py-2 text-center font-semibold text-fuchsia-200 hover:border-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-300/50">
              Draft Settings
            </Link>
          ) : (
            <Link href={`/league/${l.addr}`} className="flex-1 rounded-xl border border-fuchsia-400/50 bg-fuchsia-500/5 px-3 py-2 text-center font-semibold text-fuchsia-200 hover:border-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-300/50">
              Enter League
            </Link>
          )}
        </div>

        {/* Foot links */}
        <div className="mt-2 mb-6 flex items-center justify-center gap-5 text-xs">
          {!archivedView && <button className="text-red-400 hover:underline" onClick={() => archive(l.addr)}>Archive</button>}
          {archivedView && <button className="text-blue-400 hover:underline" onClick={() => restore(l.addr)}>Restore</button>}
          <a href={`https://testnet.snowtrace.io/address/${l.addr}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline">
            Snowtrace →
          </a>
        </div>
      </div>
    </div>
  );
}

/* Small helper for scoreboard card */
function Side({ name, score, proj, ytp }: { name: string; score: number; proj: number; ytp: number }) {
  return (
    <div className="px-2 text-center">
      <div className="break-words font-semibold leading-tight">{name}</div>
      <div className="mt-1 text-3xl font-black tabular-nums">{score}</div>
      <div className="mt-1 text-[11px] text-gray-400">Proj {proj}</div>
      <div className="text-[11px] text-gray-400">Yet to Play {ytp}</div>
    </div>
  );
}
