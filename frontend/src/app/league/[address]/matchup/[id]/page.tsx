// src/app/league/[address]/matchup/[id]/page.tsx
'use client';

import { useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import { useTeamProfile, generatedLogoFor } from '@/lib/teamProfile';
import React, { useEffect, useMemo, useState } from 'react';

/* --------------------------------- Consts --------------------------------- */

const BYE_ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`;
const BYE_SENTINEL = '0x000000000000000000000000000000000000BEEF' as `0x${string}`;

const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
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

type PlayerSlot = {
  name?: string;
  pts?: number | string;
  stats?: string;
  team?: string;
  pos?: string;
};

/* ------------------------------- Utilities -------------------------------- */

const lc = (a?: string) => (a || '').toLowerCase();
const shortAddr = (a?: string, head = 6, tail = 4) =>
  !a ? '—' : a.length > head + tail + 2 ? `${a.slice(0, head + 2)}…${a.slice(-tail)}` : a;

function initials(n?: string) {
  const s = (n || '').trim();
  if (!s) return 'TM';
  const p = s.split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || 'TM';
}

function isHexAddressLike(a?: string): a is `0x${string}` {
  return !!a && /^0x[0-9a-fA-F]{40}$/.test(a);
}
function isBye(a?: string) {
  if (!a) return true;
  const s = lc(a);
  return (
    s === lc(BYE_ZERO) ||
    s === lc(BYE_SENTINEL) ||
    s === 'bye' || s === 'byeweek' || s === 'bye_week' ||
    !isHexAddressLike(a)
  );
}
function coerceAddr(a?: string): `0x${string}` {
  return isBye(a) ? BYE_ZERO : (a as `0x${string}`);
}

function toNum(v: number | string | undefined): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^\d.-]/g, ''));
    return isFinite(n) ? n : 0;
  }
  return 0;
}

/* positional color */
function posTextColor(p?: string) {
  switch (p) {
    case 'QB':  return 'text-rose-300';
    case 'RB':  return 'text-emerald-300';
    case 'WR':  return 'text-sky-300';
    case 'TE':  return 'text-orange-300';
    case 'FLEX':return 'text-slate-300';
    case 'K':   return 'text-amber-300';
    case 'D/ST':return 'text-violet-300';
    case 'DL':
    case 'LB':
    case 'DB':  return 'text-rose-300';
    default:    return 'text-gray-300';
  }
}

/* default stat label per pos when stats missing */
function defaultStatLabel(pos?: string) {
  if (!pos) return '';
  if (pos === 'QB') return 'PASS YDS';
  if (pos === 'RB') return 'RUSH YDS';
  if (pos === 'WR' || pos === 'TE' || pos === 'FLEX') return 'REC YDS';
  if (pos === 'K') return '0/0 K';
  if (pos === 'D/ST') return '0 PTS ALLOWED';
  return 'YDS';
}

/* --------------------------------- Page ---------------------------------- */

const scoresKey = (league: `0x${string}`, week: number) => `scores:${league}:${week}`;

// Build starters & counts from settings
function shapeFrom(raw?: any) {
  const n = (x:any,d=0)=>Number(x??d);
  const starters: string[] = [];
  starters.push(...Array(n(raw?.qb,1)).fill('QB'));
  starters.push(...Array(n(raw?.rb,2)).fill('RB'));
  starters.push(...Array(n(raw?.wr,2)).fill('WR'));
  starters.push(...Array(n(raw?.te,1)).fill('TE'));
  starters.push(...Array(n(raw?.flexWRT,1)+n(raw?.flexWR,0)+n(raw?.flexWT,0)+n(raw?.superFlexQWRT,0)+n(raw?.idpFlex,0)).fill('FLEX'));
  starters.push(...Array(n(raw?.dst,1)).fill('D/ST'));
  starters.push(...Array(n(raw?.k,1)).fill('K'));
  starters.push(...Array(n(raw?.dl,0)).fill('DL'));
  starters.push(...Array(n(raw?.lb,0)).fill('LB'));
  starters.push(...Array(n(raw?.db,0)).fill('DB'));
  const bench = n(raw?.bench,5);
  const ir = n(raw?.ir,1);
  return { starters, bench, ir };
}

export default function MatchupPage() {
  const { address: leagueParam, id: rawId } = useParams<{ address: `0x${string}`; id: string }>();
  const { address: wallet } = useAccount();

  // Parse id "week:away:home"
  let week = 1;
  let awayAddr: `0x${string}` = BYE_ZERO;
  let homeAddr: `0x${string}` = BYE_ZERO;

  try {
    const decoded = decodeURIComponent(rawId || '');
    const [w, a, h] = decoded.split(':');
    if (w && /^\d+$/.test(w)) week = parseInt(w, 10);
    awayAddr = coerceAddr(a);
    homeAddr = coerceAddr(h);
  } catch {}

  const league = leagueParam;

  useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' });

  // Roster settings → dynamic starters & bench length
  const { data: rosterRaw } = useReadContract({ abi: ROSTER_ABI, address: league, functionName: 'getRosterSettings' });
  const { starters: START_POS, bench: BENCH_COUNT } = useMemo(() => shapeFrom(rosterRaw), [rosterRaw]);

  // Profiles
  const awayProf = useTeamProfile(league, awayAddr);
  const homeProf = useTeamProfile(league, homeAddr);
  const myProf   = useTeamProfile(league, (wallet ?? BYE_ZERO) as `0x${string}`);

  const awayIsBye = isBye(awayAddr);
  const homeIsBye = isBye(homeAddr);

  const awayName = awayIsBye ? 'Bye Week' : (awayProf?.name?.trim() || 'Team');
  const homeName = homeIsBye ? 'Bye Week' : (homeProf?.name?.trim() || 'Team');

  // Colorful, fixed BYE pattern
  const byePatternUrl =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'>
        <defs>
          <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
            <stop offset='0' stop-color='#22c55e'/>
            <stop offset='1' stop-color='#8b5cf6'/>
          </linearGradient>
          <pattern id='p' width='12' height='12' patternUnits='userSpaceOnUse'>
            <rect width='12' height='12' fill='#0b0b14'/>
            <circle cx='6' cy='6' r='5' fill='url(#g)' opacity='0.85'/>
          </pattern>
        </defs>
        <rect width='80' height='80' fill='url(#p)'/>
      </svg>`
    );

  const awayLogo = awayIsBye ? byePatternUrl : (awayProf?.logo || generatedLogoFor(awayAddr));
  const homeLogo = homeIsBye ? byePatternUrl : (homeProf?.logo || generatedLogoFor(homeAddr));

  // Scores & projections (auto-update)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, []);
  const scores = useMemo(() => {
    try {
      const raw = localStorage.getItem(scoresKey(league, week));
      return raw ? (JSON.parse(raw) as Record<string, { live?: number | string; proj?: number | string }>) : {};
    } catch { return {}; }
  }, [league, week, tick]);

  const aKey = lc(awayAddr);
  const hKey = lc(homeAddr);
  const liveAway = awayIsBye ? 0 : toNum(scores[aKey]?.live ?? '—');
  const liveHome = homeIsBye ? 0 : toNum(scores[hKey]?.live ?? '—');
  const projAway = awayIsBye ? 0 : toNum(scores[aKey]?.proj ?? '—');
  const projHome = homeIsBye ? 0 : toNum(scores[hKey]?.proj ?? '—');

  // Win probabilities
  let winA = 0.5, winH = 0.5;
  if (awayIsBye && !homeIsBye) { winA = 0; winH = 1; }
  else if (homeIsBye && !awayIsBye) { winA = 1; winH = 0; }
  else {
    const A = Math.max(0, projAway), H = Math.max(0, projHome);
    const sum = A + H;
    if (sum > 0) { winA = A / sum; winH = H / sum; }
  }

  // Lineups (dynamic length)
  const makeByeStarters = (slots: string[]): PlayerSlot[] =>
    slots.map((pos) => ({ name: undefined, team: undefined, pos, pts: 0 }));

  const awayStarters: PlayerSlot[] = awayIsBye ? makeByeStarters(START_POS) : new Array(START_POS.length).fill(undefined);
  const homeStarters: PlayerSlot[] = homeIsBye ? makeByeStarters(START_POS) : new Array(START_POS.length).fill(undefined);

  const padBench = (arr: PlayerSlot[]) =>
    arr.length >= BENCH_COUNT ? arr.slice(0, BENCH_COUNT) : [...arr, ...new Array(BENCH_COUNT - arr.length).fill(undefined)];
  const awayBench: PlayerSlot[] = padBench(awayIsBye ? [] : []);
  const homeBench: PlayerSlot[] = padBench(homeIsBye ? [] : []);

  // Totals
  const startersLiveAway = liveAway;
  const startersLiveHome = liveHome;
  const startersProjAway = projAway;
  const startersProjHome = projHome;

  /* ----------------------------- Presentational ---------------------------- */

  function Avatar({ name, url, size = 9 }: { name?: string; url?: string; size?: 7 | 8 | 9 }) {
    const safe = name?.trim() || '—';
    const cls = `h-${size} w-${size} rounded-xl object-cover ring-1 ring-white/15 bg-white/5`;
    return url
      ? <img src={url} alt={safe} className={cls} />
      : <div className={`h-${size} w-${size} rounded-xl bg-white/10 grid place-items-center text-xs font-semibold`}>{initials(safe)}</div>;
  }

  function SmallMeta({ team, pos }: { team?: string; pos?: string }) {
    if (!team && !pos) return null;
    const posColor = posTextColor(pos);
    return (
      <span className="text-[11px] font-semibold tracking-wide whitespace-nowrap">
        {team && <span className="text-white/90">{team.toUpperCase()}</span>}
        {team && pos && <span className="mx-1 text-white/30">•</span>}
        {pos && <span className={posColor}>{pos}</span>}
      </span>
    );
  }

  function statLine(slot?: PlayerSlot) {
    if (!slot?.name) return '';
    if (slot.stats && slot.stats.trim() !== '') return slot.stats;
    switch (slot.pos) {
      case 'WR':
      case 'TE':
      case 'FLEX':
        return '0 REC YDS';
      case 'QB':
        return '0 PASS YDS';
      case 'RB':
        return '0 RUSH YDS';
      case 'K':
        return '0/0 K';
      case 'D/ST':
        return '0 PTS ALLOWED';
      default: {
        const label = defaultStatLabel(slot.pos);
        return label ? `0 ${label}` : '';
      }
    }
  }

  function PlayerTile({ slot, side }: { slot?: PlayerSlot; side: 'left'|'right' }) {
    const has = Boolean(slot?.name);
    const name = has ? (slot!.name!) : 'Empty';
    const stats = has ? statLine(slot) : '';
    const pts = has ? (slot?.pts ?? '—') : '—';
    const score = <div className="shrink-0 tabular-nums font-semibold text-sm px-2">{typeof pts === 'number' ? pts : (pts || '—')}</div>;
    const content =
      <div className="min-w-0">
        <div className={`flex items-baseline gap-2 min-w-0 ${side==='right' ? 'justify-end' : ''}`}>
          <div className={`font-medium truncate ${side==='right' ? 'text-right' : ''}`}>{name}</div>
          <SmallMeta team={slot?.team} pos={slot?.pos} />
        </div>
        {stats && <div className={`text-[11px] text-gray-400 truncate ${side==='right' ? 'text-right' : ''}`}>{stats}</div>}
      </div>;
    return (
      <div className="rounded-xl ring-1 ring-white/10 bg-white/[0.04] h-12 px-3 flex items-center justify-between">
        {side==='left' ? (<>{content}{score}</>) : (<>{score}{content}</>)}
      </div>
    );
  }

  function PosPill({ pos }: { pos: string }) {
    const tone = {
      'QB':'text-rose-300', 'RB':'text-emerald-300', 'WR':'text-sky-300',
      'TE':'text-orange-300', 'FLEX':'text-slate-300', 'K':'text-amber-300',
      'D/ST':'text-violet-300', 'DL':'text-rose-300', 'LB':'text-rose-300', 'DB':'text-rose-300'
    }[pos] || 'text-gray-300';
    return (
      <span className={`inline-grid place-items-center h-9 w-9 rounded-full border border-white/30 bg-neutral-800/60 text-xs font-semibold ${tone}`}>{pos}</span>
    );
  }

  function StarterRow({ i }: { i: number }) {
    const pos = START_POS[i];
    const L = awayStarters[i];
    const R = homeStarters[i];

    return (
      <div className="grid grid-cols-12 gap-3 items-center">
        <div className="col-span-5"><PlayerTile slot={L} side="left" /></div>
        <div className="col-span-2 grid place-items-center"><PosPill pos={pos}/></div>
        <div className="col-span-5"><PlayerTile slot={R} side="right" /></div>
      </div>
    );
  }

  function BenchRow({ left, right }:{ left?: PlayerSlot; right?: PlayerSlot }){
    return (
      <div className="grid grid-cols-12 gap-3 items-center">
        <div className="col-span-5"><PlayerTile slot={left} side="left" /></div>
        <div className="col-span-2 grid place-items-center text-[11px] text-gray-400">Bench</div>
        <div className="col-span-5"><PlayerTile slot={right} side="right" /></div>
      </div>
    );
  }

  function IRRow(){
    return (
      <div className="grid grid-cols-12 gap-3 items-center pt-2">
        <div className="col-span-5"><PlayerTile slot={undefined} side="left" /></div>
        <div className="col-span-2 grid place-items-center text-[11px] text-gray-400">IR</div>
        <div className="col-span-5"><PlayerTile slot={undefined} side="right" /></div>
      </div>
    );
  }

  /* --------------------------------- Render -------------------------------- */

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-4 sm:px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Title centered + Your Team pill on the right (clickable) */}
        <div className="grid grid-cols-3 items-start">
          <div />
          <div className="text-center">
            <h1 className="text-3xl font-extrabold">Matchup</h1>
            <p className="text-sm text-gray-400 mt-1">Week {week}</p>
          </div>
          <div className="justify-self-end">
            {wallet && (
              <a
                href={`/league/${league}/team/${wallet}`}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 hover:bg-white/10 transition"
              >
                <img src={myProf?.logo || generatedLogoFor(wallet)} alt="you" className="h-7 w-7 rounded-xl object-cover ring-1 ring-white/15"/>
                <div className="leading-tight">
                  <div className="text-base font-semibold truncate max-w-[180px]">{(myProf?.name || 'Team').trim()}</div>
                  <div className="text-[11px] text-gray-400 font-mono">{shortAddr(wallet)}</div>
                </div>
              </a>
            )}
          </div>
        </div>

        {/* Teams header card */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <div className="px-3 py-4 sm:px-4 sm:py-5">
            <div className="grid grid-cols-12 items-center gap-3">
              {/* Away */}
              <div className="col-span-5 sm:col-span-4 flex items-center gap-3">
                <img src={awayLogo as string} alt={awayName} className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/15"/>
                <div className={`min-w-0 ${awayIsBye ? 'opacity-60' : ''}`}>
                  <div className="text-xl font-semibold truncate">{awayName}</div>
                  {!awayIsBye && <div className="text-[11px] text-gray-400 font-mono">{shortAddr(awayAddr)}</div>}
                  {!awayIsBye && <div className="text-[11px] text-gray-400">Record 0-0-0</div>}
                </div>
              </div>

              {/* Center: Score + Projected centered */}
              <div className="col-span-2 sm:col-span-4 text-center">
                <div className="text-xs text-gray-400">Score</div>
                <div className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">
                  {startersLiveAway} <span className="mx-1 text-white/50">·</span> {startersLiveHome}
                </div>
                <div className="mt-1 text-xs text-gray-400">Projected</div>
                <div className="text-sm text-gray-200 tabular-nums">
                  {startersProjAway} <span className="mx-1 text-white/40">·</span> {startersProjHome}
                </div>
              </div>

              {/* Home */}
              <div className="col-span-5 sm:col-span-4 flex items-center justify-end gap-3">
                <div className={`min-w-0 text-right ${homeIsBye ? 'opacity-60' : ''}`}>
                  <div className="text-xl font-semibold truncate">{homeName}</div>
                  {!homeIsBye && <div className="text-[11px] text-gray-400 font-mono">{shortAddr(homeAddr)}</div>}
                  {!homeIsBye && <div className="text-[11px] text-gray-400">Record 0-0-0</div>}
                </div>
                <img src={homeLogo as string} alt={homeName} className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/15"/>
              </div>
            </div>
          </div>
        </section>

        {/* Starters (TOTAL row inside) */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <h3 className="text-lg font-semibold text-center mb-4">Starters</h3>
          <div className="space-y-3">
            {START_POS.map((_, i) => <StarterRow key={`sr-${i}`} i={i} />)}

            {/* TOTAL row */}
            <div className="grid grid-cols-12 gap-3 items-center pt-2">
              <div className="col-span-5">
                <div className="rounded-xl px-3 py-2 ring-1 ring-white/10 bg-white/[0.04] font-semibold text-right tabular-nums">
                  {startersLiveAway.toFixed ? startersLiveAway.toFixed(1) : startersLiveAway}
                </div>
              </div>
              <div className="col-span-2 grid place-items-center text-sm tracking-wider text-gray-300">TOTAL</div>
              <div className="col-span-5">
                <div className="rounded-xl px-3 py-2 ring-1 ring-white/10 bg-white/[0.04] font-semibold tabular-nums">
                  {startersLiveHome.toFixed ? startersLiveHome.toFixed(1) : startersLiveHome}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Bench + IR */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <h3 className="text-lg font-semibold text-center mb-4">Bench</h3>
          <div className="space-y-2">
            {Array.from({ length: BENCH_COUNT }, (_, i) => (
              <BenchRow key={`bn-${i}`} left={undefined} right={undefined} />
            ))}
            <IRRow />
          </div>
        </section>
      </div>
    </main>
  );
}
