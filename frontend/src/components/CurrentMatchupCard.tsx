'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  BYE_ZERO,
  scoresKey,
  computePerc,
  parseNum,
  nameOrBye,
  getRecord,
} from '@/lib/matchups';
import { useTeamProfile, generatedLogoFor } from '@/lib/teamProfile';
import { useWeekPairings, type WeekPairing } from '@/lib/hooks/useWeekPairings';

/* ────────── BYE geometric avatar ────────── */
const BYE_PATTERN_URL =
  'data:image/svg+xml;utf8,' +
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

const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');

/* ────────── Small UI bits ────────── */
function Avatar({ name, url, size = 8 }: { name?: string; url?: string; size?: 7 | 8 | 9 }) {
  const sizeClass = size === 7 ? 'h-7 w-7' : size === 8 ? 'h-8 w-8' : 'h-9 w-9';
  const safe = (name || '').trim() || '—';
  const cls = `${sizeClass} rounded-2xl object-cover ring-1 ring-white/15 bg-white/5`;
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={safe} className={cls} /> : (
    <div className={`${sizeClass} rounded-2xl bg-white/10 grid place-items-center text-xs font-semibold`}>
      {(safe.split(/\s+/).map(s => s[0]?.toUpperCase() || '').join('') || 'TM').slice(0, 2)}
    </div>
  );
}
function TeamGroup({
  league, name, addr, logo, align = 'left', hideMeta = false,
}: {
  league: `0x${string}`; name: string; addr: `0x${string}`; logo?: string;
  align?: 'left' | 'right'; hideMeta?: boolean;
}) {
  const record = getRecord(league, addr);
  return (
    <div className={`flex items-center gap-2 ${align === 'right' ? 'justify-end' : ''}`}>
      {align === 'left' && <Avatar name={name} url={logo} size={8} />}
      <div className={align === 'right' ? 'min-w-0 text-right' : 'min-w-0'}>
        <div className="font-extrabold truncate">{name}</div>
        {!hideMeta && (
          <>
            <div className="text-[11px] text-gray-400 font-mono">{shortAddr(addr)}</div>
            <div className="text-[11px] text-gray-500">Record {record}</div>
          </>
        )}
      </div>
      {align === 'right' && <Avatar name={name} url={logo} size={8} />}
    </div>
  );
}
function ScoreMini({ aLive, bLive, aProj, bProj, size = 'md' }:{
  aLive: number | string; bLive: number | string; aProj: number | string; bProj: number | string;
  size?: 'md'|'lg';
}) {
  const aL = parseNum(aLive), bL = parseNum(bLive);
  const aP = parseNum(aProj), bP = parseNum(bProj);
  const scoreSize = size === 'lg' ? 'text-2xl' : 'text-lg';
  return (
    <div className="text-center leading-tight">
      <div className="text-white text-sm mb-1">Current Matchup</div>
      <div className={`${scoreSize} font-extrabold tracking-tight`}>{aL} · {bL}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">Projected</div>
      <div className="text-sm font-semibold text-gray-200">{aP} · {bP}</div>
    </div>
  );
}
function CenterOutWinMeter({ leftPct, rightPct }:{ leftPct:number; rightPct:number }) {
  const lp = Math.max(0, Math.min(100, Math.round(leftPct)));
  const rp = Math.max(0, Math.min(100, Math.round(rightPct)));
  return (
    <div className="mt-2 grid grid-cols-2 gap-4 items-center">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-400 w-9 text-left">{lp}%</span>
        <div className="relative h-2 flex-1 rounded-full bg-white/12 overflow-hidden">
          <div className="absolute inset-y-0 right-0 bg-emerald-500/80" style={{ width: `${lp}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-2 justify-end">
        <div className="relative h-2 flex-1 rounded-full bg-white/12 overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-emerald-500/80" style={{ width: `${rp}%` }} />
        </div>
        <span className="text-[11px] text-gray-400 w-9 text-right">{rp}%</span>
      </div>
    </div>
  );
}
function winPercWithBye(aProj?: number, bProj?: number, aIsBye?: boolean, bIsBye?: boolean){
  if (aIsBye && !bIsBye) return [0, 100] as const;
  if (bIsBye && !aIsBye) return [100, 0] as const;
  return computePerc(aProj ?? 0, bProj ?? 0);
}

/* ────────── Card ────────── */
export default function CurrentMatchupCard({
  league,
  owner,
  week,
  variant = 'default',
}: {
  league: `0x${string}`;
  owner: `0x${string}`;
  week: number;
  variant?: 'default' | 'team';
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { pairings, loading } = useWeekPairings(league, week);

  /** Select my pairing deterministically, then freeze addresses for hooks */
  const sel = useMemo(() => {
    const res: { mode:'none'|'bye'|'game'; away:`0x${string}`; home:`0x${string}` } =
      { mode: 'none', away: BYE_ZERO, home: BYE_ZERO };
    if (!pairings || !pairings.length) return res;
    const me = owner.toLowerCase();
    const bye = pairings.find(p => p.type === 'bye' && p.owner.toLowerCase() === me);
    if (bye) return { mode: 'bye', away: owner, home: BYE_ZERO };
    const game = pairings.find(p => p.type === 'match' && (p.awayOwner.toLowerCase() === me || p.homeOwner.toLowerCase() === me)) as
      | { type:'match'; awayOwner:`0x${string}`; homeOwner:`0x${string}` } | undefined;
    if (game) return { mode: 'game', away: game.awayOwner, home: game.homeOwner };
    return res;
  }, [pairings, owner]);

  /* Call hooks in a stable order every render */
  const myProf   = useTeamProfile(league, owner);
  const awayProf = useTeamProfile(league, sel.away);
  const homeProf = useTeamProfile(league, sel.home);

  const scores = useMemo(() => {
    if (!mounted) return {};
    try {
      const raw = localStorage.getItem(scoresKey(league, week));
      return (raw ? JSON.parse(raw) : {}) || {};
    } catch { return {}; }
  }, [league, week, mounted]);

  /* Skeleton / empty states */
  if (!mounted || loading) {
    return (
      <div className="h-full rounded-3xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-sm text-white text-center mb-3">Current Matchup</div>
        <div className="h-24 rounded-2xl bg-white/[0.04] animate-pulse" />
      </div>
    );
  }
  if (sel.mode === 'none') {
    return (
      <div className="h-full rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-center text-gray-400">
        <div className="text-sm text-white text-center mb-3">Current Matchup</div>
        No matchups scheduled for this week.
      </div>
    );
  }

  /* BYE tile */
  if (sel.mode === 'bye') {
    const myName = (myProf?.name || 'Team').trim();
    const myLogo = myProf?.logo || generatedLogoFor(owner);
    const id = encodeURIComponent(`${week}:${owner}:${BYE_ZERO}`);
    const [lp, rp] = winPercWithBye(0, 0, false, true);
    return (
      <Link href={`/league/${league}/matchup/${id}`} className="block h-full rounded-3xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition p-4">
        <div className="grid grid-cols-12 items-center gap-2">
          <div className="col-span-5 sm:col-span-4"><TeamGroup league={league} name={myName} addr={owner} logo={myLogo} /></div>
          <div className="col-span-2 sm:col-span-4"><ScoreMini aLive={0} bLive={0} aProj={0} bProj={0} size={variant==='team'?'lg':'md'} /></div>
          <div className="col-span-5 sm:col-span-4"><TeamGroup league={league} name="Bye Week" addr={BYE_ZERO} logo={BYE_PATTERN_URL} align="right" hideMeta /></div>
        </div>
        <CenterOutWinMeter leftPct={lp} rightPct={rp} />
      </Link>
    );
  }

  /* Normal matchup */
  const away = sel.away;
  const home = sel.home;

  const awayIsBye = away.toLowerCase() === BYE_ZERO.toLowerCase();
  const homeIsBye = home.toLowerCase() === BYE_ZERO.toLowerCase();

  const awayName = nameOrBye(away, awayProf?.name);
  const homeName = nameOrBye(home, homeProf?.name);

  const awayLogo = awayIsBye ? BYE_PATTERN_URL : (awayProf?.logo || generatedLogoFor(away));
  const homeLogo = homeIsBye ? BYE_PATTERN_URL : (homeProf?.logo || generatedLogoFor(home));

  const aKey = away.toLowerCase(); const hKey = home.toLowerCase();
  const aLive = parseNum(scores[aKey]?.live); const hLive = parseNum(scores[hKey]?.live);
  const aProj = parseNum(scores[aKey]?.proj); const hProj = parseNum(scores[hKey]?.proj);
  const [lp, rp] = winPercWithBye(aProj, hProj, awayIsBye, homeIsBye);

  const id = encodeURIComponent(`${week}:${away}:${home}`);

  return (
    <Link href={`/league/${league}/matchup/${id}`} className="block h-full rounded-3xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition p-4">
      <div className="grid grid-cols-12 items-center gap-2">
        <div className="col-span-5 sm:col-span-4">
          <TeamGroup league={league} name={awayName} addr={away} logo={awayLogo as string} align="left" hideMeta={awayIsBye} />
        </div>
        <div className="col-span-2 sm:col-span-4">
          <ScoreMini aLive={aLive} bLive={hLive} aProj={aProj} bProj={hProj} size={variant==='team'?'lg':'md'} />
        </div>
        <div className="col-span-5 sm:col-span-4">
          <TeamGroup league={league} name={homeName} addr={home} logo={homeLogo as string} align="right" hideMeta={homeIsBye} />
        </div>
      </div>
      <CenterOutWinMeter leftPct={lp} rightPct={rp} />
    </Link>
  );
}
