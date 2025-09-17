// src/app/league/[address]/team/[ownerAddress]/page.tsx
'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useReadContract } from 'wagmi';

import {
  useTeamProfile,
  useSaveTeamProfile,
  PROFILE_ABI,
} from '@/lib/teamProfile';

import CurrentMatchupCard from '@/components/CurrentMatchupCard';
import { activeWeekKey } from '@/lib/matchups';

/** -------------------- On-chain ABI -------------------- */
const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getTeamByAddress', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'string' }] },
  {
    type: 'function',
    name: 'getDraftSettings',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { type: 'uint8' },
      { type: 'uint64' },
      { type: 'uint8' },
      { type: 'bool' },
      { type: 'address[]' },
      { type: 'bool' },
    ],
  },
] as const;

/** Roster settings ABI (same tuple used in roster-settings) */
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

/** -------------------- Small helpers -------------------- */
function cn(...a: (string | false | undefined | null)[]) { return a.filter(Boolean).join(' '); }
function initials(name?: string) {
  const s = (name || '').trim();
  if (!s) return 'TM';
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || 'TM';
}
const EMPTY_SVG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');

/** 4th Wednesday of November (local time) */
function fourthWednesdayOfNovember(year: number) {
  const NOV = 10; // 0-indexed
  const d = new Date(year, NOV, 1);
  const day = d.getDay(); // 0 Sun ... 3 Wed
  const diffToWed = (3 - day + 7) % 7;
  const firstWed = 1 + diffToWed;
  const fourthWed = firstWed + 21;
  return new Date(year, NOV, fourthWed);
}

type SlotKey = 'QB' | 'RB' | 'WR' | 'FLEX' | 'TE' | 'K' | 'D/ST' | 'DL' | 'LB' | 'DB' | 'TOTAL' | null;

/* POS text color (idle state) */
function posColor(label: Exclude<SlotKey, null>): string {
  switch (label) {
    case 'QB': return 'text-red-400';
    case 'RB': return 'text-green-400';
    case 'WR': return 'text-blue-400';
    case 'TE': return 'text-orange-400';
    case 'D/ST': return 'text-purple-400';
    case 'K': return 'text-yellow-300';
    case 'FLEX': return 'text-pink-400';
    case 'DL':
    case 'LB':
    case 'DB': return 'text-rose-300';
    case 'TOTAL': return 'text-gray-300';
    default: return 'text-white';
  }
}
/* Ring color when selected */
function posRing(label: Exclude<SlotKey, null>): string {
  switch (label) {
    case 'QB': return 'ring-red-400';
    case 'RB': return 'ring-green-400';
    case 'WR': return 'ring-blue-400';
    case 'TE': return 'ring-orange-400';
    case 'D/ST': return 'ring-purple-400';
    case 'K': return 'ring-yellow-300';
    case 'FLEX': return 'ring-pink-400';
    case 'DL':
    case 'LB':
    case 'DB': return 'ring-rose-400';
    case 'TOTAL': return 'ring-gray-300';
    default: return 'ring-white';
  }
}

/** Build starters/bench/ir from on-chain roster settings */
function computeShape(raw?: any) {
  const n = (x: any, d=0) => Number(x ?? d);
  const qb = n(raw?.qb,1), rb=n(raw?.rb,2), wr=n(raw?.wr,2), te=n(raw?.te,1);
  const k=n(raw?.k,1), dst=n(raw?.dst,1);
  const dl=n(raw?.dl,0), lb=n(raw?.lb,0), db=n(raw?.db,0);
  const flex = n(raw?.flexWRT,1)+n(raw?.flexWR,0)+n(raw?.flexWT,0)+n(raw?.superFlexQWRT,0)+n(raw?.idpFlex,0);
  const starters: Exclude<SlotKey,null>[] = [];
  starters.push(...Array(qb).fill('QB'));
  starters.push(...Array(rb).fill('RB'));
  starters.push(...Array(wr).fill('WR'));
  starters.push(...Array(te).fill('TE'));
  starters.push(...Array(flex).fill('FLEX'));
  starters.push(...Array(dst).fill('D/ST'));
  starters.push(...Array(k).fill('K'));
  starters.push(...Array(dl).fill('DL'));
  starters.push(...Array(lb).fill('LB'));
  starters.push(...Array(db).fill('DB'));
  const bench = n(raw?.bench,5);
  const ir = n(raw?.ir,1);
  return { starters, bench, ir };
}

/** =======================================================
 * Team Page
 * ======================================================= */
export default function TeamPage() {
  const { address: league, ownerAddress } = useParams<{ address: `0x${string}`; ownerAddress: `0x${string}` }>();
  const owner = ownerAddress as `0x${string}` | undefined;

  /* -------- On-chain reads -------- */
  const { data: leagueName } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' });
  const { data: onChainTeamName } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'getTeamByAddress', args: [owner] });

  /* Roster settings (dynamic slots) */
  const { data: rosterRaw } = useReadContract({ abi: ROSTER_ABI, address: league, functionName: 'getRosterSettings' });
  const shape = useMemo(() => computeShape(rosterRaw), [rosterRaw]);
  const STARTERS = shape.starters; // array of labels (no TOTAL)
  const BENCH_COUNT = shape.bench;
  const IR_COUNT = shape.ir;

  /* -------- Profile (resolved) -------- */
  const profile = useTeamProfile(league, owner, { name: onChainTeamName as string });

  /* Also read raw profile to preserve current logoURI on save */
  const { data: rawProfile, refetch: refetchRaw } = useReadContract({
    abi: PROFILE_ABI,
    address: league,
    functionName: 'getTeamProfile',
    args: owner ? [owner] : undefined,
    query: { enabled: !!(league && owner) },
  });
  const onChainLogoURI = ((rawProfile?.[1] as string) || '');

  /* -------- UI state -------- */
  const [openSettings, setOpenSettings] = useState(false);
  const [teamNameLocal, setTeamNameLocal] = useState<string>('');
  const [teamLogoUpload, setTeamLogoUpload] = useState<string>('');
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (openSettings) {
      setTeamNameLocal(profile.name || '');
      setTeamLogoUpload('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSettings]);

  const doSaveProfile = useSaveTeamProfile(league);
  async function saveSettings() {
    if (!league || !owner) return;
    try {
      await doSaveProfile(owner, {
        name: teamNameLocal?.trim() || profile.name || '',
        logoDataUrl: teamLogoUpload || undefined,
        logoURI: teamLogoUpload ? undefined : onChainLogoURI,
      });
      setOpenSettings(false);
      setTeamLogoUpload('');
      await refetchRaw?.();
    } catch (e) { console.error(e); }
  }

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const raw: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onerror = () => rej(r.error);
        r.onload = () => res(String(r.result || ''));
        r.readAsDataURL(file);
      });

      const img = document.createElement('img');
      img.src = raw;
      await img.decode();

      const maxSide = 320, quality = 0.72;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      setTeamLogoUpload(canvas.toDataURL('image/webp', quality));
    } catch {
      const reader = new FileReader();
      reader.onload = () => setTeamLogoUpload(String(reader.result || ''));
      reader.readAsDataURL(file);
    }
  }

  /* -------- Week (sync with scoreboard) -------- */
  const [week, setWeek] = useState(1);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(activeWeekKey);
      if (stored && /^\d+$/.test(stored)) setWeek(parseInt(stored, 10));
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(activeWeekKey, String(week)); } catch {}
  }, [week]);

  /* -------- Name/Logo for header -------- */
  const safeTeamName = mounted
    ? (profile.name?.trim() || (onChainTeamName as string) || 'My Team')
    : ((onChainTeamName as string) || 'My Team');
  const avatarSrc = mounted ? (profile.logo || EMPTY_SVG) : EMPTY_SVG;
  const showInitials = !mounted || !avatarSrc;

  const record = '0–0–0'; // W–L–T display

  /* -------- Activity metrics (local) -------- */
  const [pendingTrades, setPendingTrades] = useState(0);
  const [waiverClaims, setWaiverClaims] = useState(0);
  useEffect(() => {
    try {
      const ownerKey = (owner || '').toLowerCase();
      setPendingTrades(Number(localStorage.getItem(`trades:${league}:${ownerKey}`) || 0));
      setWaiverClaims(Number(localStorage.getItem(`claims:${league}:${ownerKey}`) || 0));
    } catch {}
  }, [league, owner]);

  /* -------- Totals (placeholder 0 for now) -------- */
  const totalScore = useMemo(() => 0, []);
  const benchTotal = useMemo(() => 0, []);

  /* -------- Bench rows (length from settings) -------- */
  const [bench, setBench] = useState<string[]>([]);
  useEffect(() => {
    setBench(Array(Math.max(0, BENCH_COUNT)).fill('Empty'));
  }, [BENCH_COUNT]);
  const [benchSel, setBenchSel] = useState<number | null>(null);
  function onBenchClick(i: number) {
    if (benchSel === null) setBenchSel(i);
    else if (benchSel === i) setBenchSel(null);
    else {
      const next = [...bench];
      [next[i], next[benchSel]] = [next[benchSel], next[i]];
      setBench(next);
      setBenchSel(null);
    }
  }

  /* -------- Trade deadline default (4th Wed of Nov) -------- */
  const tradeDeadline = useMemo(() => {
    const d = fourthWednesdayOfNovember(new Date().getFullYear());
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* ===== Top Bar: centered title + nicer Scoreboard link ===== */}
        <div className="grid grid-cols-3 items-center">
          <div />
          <h2 className="justify-self-center text-3xl font-extrabold tracking-tight">My Team</h2>
          <div className="justify-self-end">
            <Link
              href={`/league/${league}/scoreboard?week=${week}`}
              className="inline-flex items-center rounded-full border border-white/20 bg-white/[0.06] backdrop-blur px-4 py-1.5 text-sm font-semibold hover:bg-white/10 shadow-sm"
            >
              Scoreboard
            </Link>
          </div>
        </div>

        {/* ===== Header ===== */}
        <header className="pt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 rounded-2xl overflow-hidden ring-2 ring-white/20 bg-white/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarSrc} alt="team logo" className="absolute inset-0 h-full w-full object-cover" decoding="async" loading="eager" />
              <span
                suppressHydrationWarning
                aria-hidden={!showInitials}
                className={cn('relative z-10 grid h-full w-full place-items-center text-xl font-black transition-opacity', showInitials ? 'opacity-100' : 'opacity-0')}
              >
                {initials(safeTeamName)}
              </span>
            </div>
            <div>
              <h1 suppressHydrationWarning className="text-4xl font-extrabold leading-tight">{safeTeamName}</h1>
              <div className="text-xs text-gray-400 font-mono">{shortAddr(owner)}</div>
              <div className="text-[15px] font-bold text-gray-100">Record: {record}</div>
              <div className="mt-1 text-sm text-gray-400 flex flex-wrap items-center gap-2">
                <Link href={`/league/${league}`} className="text-blue-300 hover:underline font-semibold">
                  {String(leagueName || 'League')}
                </Link>
                <span>•</span>
                <span className="font-mono">{owner}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              onClick={() => setOpenSettings(true)}
              className="rounded-2xl border border-white/15 bg-white/[0.06] p-2.5 hover:bg-white/10"
              aria-label="Team Settings"
              title="Team Settings"
            >
              <Image src="/gear.png" width={22} height={22} alt="Settings" />
            </button>
          </div>
        </header>

        {/* ===== Summary Row: Matchup (left) + Activity (right) ===== */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="grid grid-cols-12 gap-6 items-stretch">
            {/* Left: matchup card */}
            <div className="col-span-12 lg:col-span-8 h-full">
              {league && owner ? (
                <div className="h-full">
                  <CurrentMatchupCard league={league} owner={owner} week={week} variant="team" />
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-gray-400 h-full">
                  Connect a wallet to see your matchup.
                </div>
              )}
            </div>

            {/* Right: activity panel */}
            <div className="col-span-12 lg:col-span-4">
              <aside className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 flex flex-col lg:h-full">
                <div className="text-sm font-semibold text-center">Activity</div>

                {/* Metrics */}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Link
                    href={`/league/${league}/trades`}
                    className="group rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] transition p-3 flex flex-col items-center justify-center h-24 sm:h-24 lg:h-20 text-center"
                  >
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Pending Trades</div>
                    <div className="mt-1 text-2xl font-extrabold">{pendingTrades}</div>
                    <div className="mt-2 text-xs text-gray-400 group-hover:text-gray-300">View history →</div>
                  </Link>

                  <Link
                    href={`/league/${league}/claims`}
                    className="group rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] transition p-3 flex flex-col items-center justify-center h-24 sm:h-24 lg:h-20 text-center"
                  >
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Waiver Claims</div>
                    <div className="mt-1 text-2xl font-extrabold">{waiverClaims}</div>
                    <div className="mt-2 text-xs text-gray-400 group-hover:text-gray-300">View history →</div>
                  </Link>
                </div>

                {/* add spacing between metrics and buttons */}
                <div className="mt-6" />

                {/* Buttons pinned to bottom on lg */}
                <div className="grid grid-cols-2 gap-4">
                  <Link
                    href={`/league/${league}/claims/add`}
                    className="rounded-lg border border-white/10 bg-emerald-600/20 hover:bg-emerald-600/30 px-3 py-2 text-center font-semibold"
                  >
                    Add
                  </Link>
                  <Link
                    href={`/league/${league}/claims/cut`}
                    className="rounded-lg border border-white/10 bg-rose-600/20 hover:bg-rose-600/30 px-3 py-2 text-center font-semibold"
                  >
                    Cut
                  </Link>
                </div>
              </aside>
            </div>
          </div>
        </section>

        {/* ===== Week row ===== */}
        <section className="grid grid-cols-3 items-center">
          <div className="justify-self-start">
            <Link
              href={`/league/${league}/schedule`}
              className="rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 text-sm font-semibold"
            >
              Open Schedule
            </Link>
          </div>

          <div className="justify-self-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-2 py-1.5">
              <button
                onClick={() => setWeek((w) => Math.max(1, w - 1))}
                className="grid place-items-center rounded-full border border-white/15 bg-white/[0.06] w-7 h-7 hover:bg-white/10"
                aria-label="Previous week"
              >
                ‹
              </button>
              <div className="px-3 text-sm font-semibold tracking-wide">Week {week}</div>
              <button
                onClick={() => setWeek((w) => w + 1)}
                className="grid place-items-center rounded-full border border-white/15 bg-white/[0.06] w-7 h-7 hover:bg-white/10"
                aria-label="Next week"
              >
                ›
              </button>
            </div>
          </div>

          <div className="justify-self-end">
            <div className="rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-center">
              <div className="text-xs uppercase tracking-wide text-gray-400">Trade Deadline</div>
              <div className="text-sm font-semibold mt-0.5">{tradeDeadline}</div>
            </div>
          </div>
        </section>

        {/* ===== Starters table ===== */}
        <section className="rounded-2xl border border-white/10 overflow-hidden">
          <div className="bg-white/[0.04] px-4 py-3 font-semibold text-center">Starters</div>

          {/* Header row */}
          <div className="grid grid-cols-12 bg-black/40 text-[11px] uppercase tracking-wide text-gray-400">
            <div className="col-span-2 px-2 py-1.5 text-center">POS</div>
            <div className="col-span-4 px-2 py-1.5">Name</div>
            <div className="col-span-1 px-2 py-1.5 text-center">Score</div>
            <div className="col-span-1 px-2 py-1.5 text-center">Proj</div>
            <div className="col-span-1 px-2 py-1.5 text-center">Opp</div>
            <div className="col-span-1 px-2 py-1.5 text-center">Time</div>
            <div className="col-span-1 px-2 py-1.5 text-center">RST %</div>
            <div className="col-span-1 px-2 py-1.5 text-center">STRT %</div>
          </div>

          {STARTERS.map((label, idx) => {
            const isTotal = false;
            const ring = posRing(label);
            return (
              <div key={`${label}-${idx}`} className="grid grid-cols-12">
                {/* POS cell */}
                <div className={cn('col-span-2 px-2 py-3 text-center font-semibold', isTotal && 'text-gray-300')}>
                  <button
                    type="button"
                    className={cn(
                      'mx-auto w-[84px] font-semibold rounded-full py-2 transition',
                      'bg-white/[0.12] hover:bg-white/[0.18] ',
                      posColor(label)
                    )}
                  >
                    {label}
                  </button>
                </div>

                {/* Name */}
                <div className="col-span-4 px-3 py-3 text-gray-300 truncate">Empty</div>
                {/* Score */}
                <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
                {/* Proj */}
                <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
                {/* Opp */}
                <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
                {/* Time */}
                <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
                {/* RST % */}
                <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
                {/* STRT % */}
                <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
              </div>
            );
          })}

          {/* TOTAL row */}
          <div className="grid grid-cols-12">
            <div className="col-span-2 px-2 py-3 text-center font-semibold text-gray-300">TOTAL</div>
            <div className="col-span-4 px-3 py-3 text-gray-300"></div>
            <div className="col-span-1 px-3 py-3 text-center text-gray-300">{totalScore}</div>
            <div className="col-span-1 px-3 py-3 text-center text-gray-300"></div>
            <div className="col-span-1 px-3 py-3 text-center text-gray-300"></div>
            <div className="col-span-1 px-3 py-3 text-center text-gray-300"></div>
            <div className="col-span-1 px-3 py-3 text-center text-gray-300"></div>
            <div className="col-span-1 px-3 py-3 text-center text-gray-300"></div>
          </div>

          {/* Bench label bar */}
          <div className="bg-white/[0.04] px-4 py-2 font-semibold text-center">Bench</div>

          {bench.map((name, i) => (
            <div key={`bench-${i}`} className={cn('grid grid-cols-12 transition')}>
              <div className="col-span-2 px-2 py-3 font-semibold text-center">
                <button
                  onClick={() => onBenchClick(i)}
                  className={cn(
                    'mx-auto w-[84px] rounded-full py-2 text-white transition',
                    benchSel === i ? 'bg-transparent ring-2 ring-white' : 'bg-white/[0.12] hover:bg-white/[0.18]'
                  )}
                >
                  Bench
                </button>
              </div>
              <div className="col-span-4 px-3 py-3 text-gray-300">{name}</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
            </div>
          ))}

          {/* Bench TOTAL */}
          <div className="grid grid-cols-12">
            <div className="col-span-2 px-2 py-3 text-center font-semibold text-gray-300">TOTAL</div>
            <div className="col-span-4 px-3 py-3 text-gray-300"></div>
            <div className="col-span-1 px-3 py-3 text-center text-gray-300">{benchTotal}</div>
            <div className="col-span-1 px-3 py-3 text-center text-gray-300"></div>
            <div className="col-span-1 px-3 py-3 text-center text-gray-300"></div>
            <div className="col-span-1 px-3 py-3 text-center text-gray-300"></div>
            <div className="col-span-1 px-3 py-3 text-center text-gray-300"></div>
            <div className="col-span-1 px-3 py-3 text-center text-gray-300"></div>
          </div>

          {/* IR rows (based on settings) */}
          {Array.from({ length: Math.max(1, IR_COUNT) }, (_, idx) => (
            <div key={`ir-${idx}`} className="grid grid-cols-12">
              <div className="col-span-2 px-2 py-3 font-semibold text-center">
                <div className="mx-auto w-[84px] rounded-full bg-rose-600/20 py-2 text-rose-300">IR</div>
              </div>
              <div className="col-span-4 px-3 py-3 text-gray-300">Empty</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">—</div>
            </div>
          ))}
        </section>
      </div>

      {/* Team Settings Slide-over */}
      {openSettings && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpenSettings(false)} />
          <aside className="absolute right-0 top-0 h-full w-full max-w-md bg-gray-950 border-l border-white/10 shadow-xl">
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-xl font-bold">Team Settings</h2>
              <button onClick={() => setOpenSettings(false)} className="rounded-md px-2 py-1 bg-white/10 hover:bg-white/20">✕</button>
            </div>
            <div className="p-5 space-y-6">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Team Name</label>
                <input
                  type="text"
                  value={teamNameLocal}
                  onChange={(e) => setTeamNameLocal(e.target.value)}
                  placeholder={String(onChainTeamName || profile.name || '')}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-600"
                />
                <p className="mt-1 text-xs text-gray-500">Change the display name for your team.</p>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Team Logo</label>
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 rounded-xl overflow-hidden ring-2 ring-white/15 bg-white/5 grid place-items-center">
                    {teamLogoUpload ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={teamLogoUpload} alt="logo preview" className="h-14 w-14 object-cover" />
                    ) : profile.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profile.logo} alt="current logo" className="h-14 w-14 object-cover" />
                    ) : (
                      <span className="text-lg font-black">{initials(safeTeamName)}</span>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onLogoFile}
                    className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-purple-600 file:px-3 file:py-2 file:text-white hover:file:bg-purple-700"
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">If you don’t upload a logo, a deterministic avatar is shown across the app.</p>
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button onClick={saveSettings} className="rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 font-semibold">Save</button>
                <button onClick={() => setOpenSettings(false)} className="rounded-lg border border-white/15 px-4 py-2">Cancel</button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
