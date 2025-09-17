// src/app/league/[address]/scoreboard/page.tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useTeamProfile, generatedLogoFor } from '@/lib/teamProfile';
import { BYE_ZERO, shortAddr, nameOrBye, computePerc } from '@/lib/matchups';
import { useWeekPairings } from '@/lib/hooks/useWeekPairings';

type Team = { owner: `0x${string}`; name: string };
const REG_SEASON_WEEKS = Number(process.env.NEXT_PUBLIC_REG_SEASON_WEEKS || 14);
const lastMatchupKey = (league: `0x${string}`, a: string) =>
  `hashmark:lastMatchup:${league}:${a.toLowerCase()}`;

/* ------------------------ Local helpers & UI bits ------------------------ */

function initials(n?: string) {
  const s = (n || '').trim();
  if (!s) return 'TM';
  const p = s.split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || 'TM';
}

function Avatar({
  name,
  url,
  size = 9,
}: {
  name?: string;
  url?: string;
  size?: 7 | 8 | 9;
}) {
  const sizeClass = size === 7 ? 'h-7 w-7' : size === 8 ? 'h-8 w-8' : 'h-9 w-9';
  const safe = name?.trim() || '—';
  const cls = `${sizeClass} rounded-2xl object-cover ring-1 ring-white/15 bg-white/5`;
  // eslint-disable-next-line @next/next/no-img-element
  return url ? (
    <img src={url} alt={safe} className={cls} />
  ) : (
    <div
      className={`${sizeClass} rounded-2xl bg-white/10 grid place-items-center text-xs font-semibold`}
    >
      {initials(safe)}
    </div>
  );
}

function Chip({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'blue' | 'purple' | 'neutral';
}) {
  const styles = {
    blue: 'border-sky-500/30 bg-sky-600/20 text-sky-100',
    purple: 'border-fuchsia-500/30 bg-fuchsia-600/20 text-fuchsia-100',
    neutral: 'border-white/10 bg-white/5 text-gray-200',
  }[tone];
  return (
    <span className={`text-[11px] rounded px-2 py-0.5 border ${styles}`}>
      {children}
    </span>
  );
}

function ProfilePill({
  league,
  wallet,
  name,
  logo,
}: {
  league: `0x${string}`;
  wallet?: `0x${string}`;
  name?: string;
  logo?: string;
}) {
  const content = (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 shadow-sm hover:bg-white/[0.06]">
      <Avatar name={name} url={logo} size={8} />
      <div className="leading-tight">
        <div className="font-semibold">{name || 'Team'}</div>
        {wallet && (
          <div className="text-[11px] text-gray-400 font-mono">
            {shortAddr(wallet)}
          </div>
        )}
      </div>
    </div>
  );
  if (!wallet) return <div className="opacity-70">{content}</div>;
  return <Link href={`/league/${league}/team/${wallet}`}>{content}</Link>;
}

function HeaderBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 items-center">
      <div />
      <h1 className="justify-self-center text-4xl font-extrabold leading-tight">
        {title}
      </h1>
      <div className="justify-self-end">{right}</div>
    </div>
  );
}

/** Local “records” reader (W-L-T) from localStorage, hidden on BYE */
function getRecord(league: `0x${string}`, addr: `0x${string}`) {
  try {
    const raw = localStorage.getItem(`records:${league}`);
    if (!raw) return '0-0-0';
    const map = JSON.parse(raw) as Record<string, string>;
    return map[addr.toLowerCase()] || '0-0-0';
  } catch {
    return '0-0-0';
  }
}

/** Center-out win meter (left/right bars meet at center) */
function CenterOutWinMeter({
  leftPct,
  rightPct,
}: {
  leftPct: number;
  rightPct: number;
}) {
  const lp = Math.max(0, Math.min(100, Math.round(leftPct)));
  const rp = Math.max(0, Math.min(100, Math.round(rightPct)));
  return (
    <div className="mt-2 grid grid-cols-2 gap-4 items-center">
      {/* LEFT half */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-400 w-9 text-left">{lp}%</span>
        <div className="relative h-2 flex-1 rounded-full bg-white/12 overflow-hidden">
          <div className="absolute inset-y-0 right-0 bg-emerald-500/80" style={{ width: `${lp}%` }} />
        </div>
      </div>
      {/* RIGHT half */}
      <div className="flex items-center gap-2 justify-end">
        <div className="relative h-2 flex-1 rounded-full bg-white/12 overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-emerald-500/80" style={{ width: `${rp}%` }} />
        </div>
        <span className="text-[11px] text-gray-400 w-9 text-right">{rp}%</span>
      </div>
    </div>
  );
}

/** Static geometric avatar used for BYE */
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

/** Keep % logic in sync with matchup page */
function winPercWithBye(
  aProj?: number,
  bProj?: number,
  aIsBye?: boolean,
  bIsBye?: boolean
) {
  if (aIsBye && !bIsBye) return [0, 100] as const;
  if (bIsBye && !aIsBye) return [100, 0] as const;
  return computePerc(aProj ?? 0, bProj ?? 0);
}

/* -------------------------------- Page -------------------------------- */

export default function ScoreboardPage() {
  const { address: league } = useParams<{ address: `0x${string}` }>();
  const { address: wallet } = useAccount();
  const [activeWeek, setActiveWeek] = useState(1);

  // Server-driven pairings for the chosen week
  const { pairings, loading, error } = useWeekPairings(league, activeWeek);

  // Persist last-matchup deep link (nav helper)
  useEffect(() => {
    if (!league || !wallet || !pairings) return;
    const match = pairings.find(
      (p) =>
        p.type === 'match' &&
        (p.awayOwner.toLowerCase() === wallet.toLowerCase() ||
          p.homeOwner.toLowerCase() === wallet.toLowerCase())
    );
    const href = match
      ? `/league/${league}/matchup/${encodeURIComponent(
          `${activeWeek}:${match.awayOwner}:${match.homeOwner}`
        )}`
      : `/league/${league}/matchup/${encodeURIComponent(
          `${activeWeek}:${wallet}:${BYE_ZERO}`
        )}`;
    try {
      localStorage.setItem(lastMatchupKey(league, wallet), href);
    } catch {}
  }, [league, wallet, activeWeek, pairings]);

  // Header pill info
  const myProf = useTeamProfile(league, (wallet ?? '') as `0x${string}`);
  const myName = (myProf?.name || 'Team').trim();
  const myLogo = wallet ? (myProf?.logo || generatedLogoFor(wallet)) : undefined;

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-4 sm:px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <HeaderBar
          title="Scoreboard"
          right={
            <ProfilePill
              league={league}
              wallet={wallet}
              name={myName}
              logo={myLogo as string}
            />
          }
        />

        {/* Week switcher */}
        <div className="flex flex-col items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-2 py-1.5">
            <button
              onClick={() => setActiveWeek((w) => Math.max(1, w - 1))}
              className="grid place-items-center rounded-full border border-white/15 bg-white/[0.06] w-7 h-7 hover:bg-white/10"
              aria-label="Previous week"
            >
              ‹
            </button>
            <div className="px-3 text-sm font-semibold tracking-wide">
              Week {activeWeek}
            </div>
            <button
              onClick={() =>
                setActiveWeek((w) => Math.min(REG_SEASON_WEEKS, w + 1))
              }
              className="grid place-items-center rounded-full border border-white/15 bg-white/[0.06] w-7 h-7 hover:bg-white/10"
              aria-label="Next week"
            >
              ›
            </button>
          </div>
          <div>
            <Chip tone="blue">Pre-game</Chip>
          </div>
        </div>

        {/* Body */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          {loading && (
            <p className="text-center text-gray-400 text-sm py-8">
              Loading week {activeWeek}…
            </p>
          )}
          {error && !loading && (
            <p className="text-center text-rose-300 text-sm py-8">
              Failed to load: {error}
            </p>
          )}

          {!loading && !error && (!pairings || pairings.length === 0) && (
            <p className="text-center text-gray-400 text-sm py-8">
              No matchups scheduled for this week.
            </p>
          )}

          {!loading && !error && pairings && pairings.length > 0 && (
            <div className="space-y-3">
              {pairings.map((p, i) =>
                p.type === 'bye' ? (
                  <ByeTile
                    key={`bye-${i}`}
                    league={league}
                    week={activeWeek}
                    owner={p.owner}
                  />
                ) : (
                  <MatchTile
                    key={`m-${i}`}
                    league={league}
                    week={activeWeek}
                    away={p.awayOwner}
                    home={p.homeOwner}
                  />
                )
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/* ------------------------------- Tiles -------------------------------- */

function ScoreMini({
  aLive,
  bLive,
  aProj,
  bProj,
}: {
  aLive: number | undefined;
  bLive: number | undefined;
  aProj: number | undefined;
  bProj: number | undefined;
}) {
  const aL = Number.isFinite(Number(aLive)) ? Number(aLive) : 0;
  const bL = Number.isFinite(Number(bLive)) ? Number(bLive) : 0;
  const aP = Number.isFinite(Number(aProj)) ? Number(aProj) : 0;
  const bP = Number.isFinite(Number(bProj)) ? Number(bProj) : 0;
  return (
    <div className="text-center leading-tight">
      <div className="text-xs text-gray-400">Score</div>
      <div className="text-lg font-extrabold tracking-tight">
        {aL} · {bL}
      </div>
      <div className="text-[11px] text-gray-400 mt-0.5">Projected</div>
      <div className="text-sm font-semibold text-gray-200">
        {aP} · {bP}
      </div>
    </div>
  );
}

function TeamGroup({
  league,
  name,
  addr,
  logo,
  align = 'left',
  hideMeta = false, // true for BYE side
}: {
  league: `0x${string}`;
  name: string;
  addr: `0x${string}`;
  logo?: string;
  align?: 'left' | 'right';
  hideMeta?: boolean;
}) {
  const isBye = addr.toLowerCase() === BYE_ZERO.toLowerCase();
  const record = !isBye ? getRecord(league, addr) : null;

  const content = (
    <>
      {align === 'left' && <Avatar name={name} url={logo} size={9} />}
      <div className={align === 'left' ? 'min-w-0' : 'min-w-0 text-right'}>
        <div className="font-semibold truncate">{name}</div>
        {!hideMeta && !isBye && (
          <>
            <div className="text-[11px] text-gray-400 font-mono">
              {shortAddr(addr)}
            </div>
            <div className="text-[11px] text-gray-500">Record {record}</div>
          </>
        )}
      </div>
      {align === 'right' && <Avatar name={name} url={logo} size={9} />}
    </>
  );
  return (
    <div
      className={`flex items-center gap-2 ${
        align === 'right' ? 'justify-end' : ''
      }`}
    >
      {content}
    </div>
  );
}

function ByeTile({
  league,
  week,
  owner,
}: {
  league: `0x${string}`;
  week: number;
  owner: `0x${string}`;
}) {
  const prof = useTeamProfile(league, owner);
  const name = (prof.name || 'Team').trim();
  const logo = prof.logo || generatedLogoFor(owner);
  const href = `/league/${league}/matchup/${encodeURIComponent(
    `${week}:${owner}:${BYE_ZERO}`
  )}`;

  // Non-bye team vs BYE => 100/0
  const [lp, rp] = winPercWithBye(0, 0, false, true);

  return (
    <Link
      href={href}
      className="block rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition p-4"
    >
      <div className="grid grid-cols-12 items-center gap-2">
        <div className="col-span-5 sm:col-span-4">
          <TeamGroup
            league={league}
            name={name}
            addr={owner}
            logo={logo}
            align="left"
          />
        </div>
        <div className="col-span-2 sm:col-span-4">
          <ScoreMini aLive={0} bLive={0} aProj={0} bProj={0} />
        </div>
        <div className="col-span-5 sm:col-span-4">
          {/* BYE: geometric avatar + no wallet/record */}
          <TeamGroup
            league={league}
            name="Bye Week"
            addr={BYE_ZERO}
            logo={BYE_PATTERN_URL}
            align="right"
            hideMeta
          />
        </div>
      </div>
      <CenterOutWinMeter leftPct={lp} rightPct={rp} />
    </Link>
  );
}

function MatchTile({
  league,
  week,
  away,
  home,
}: {
  league: `0x${string}`;
  week: number;
  away: `0x${string}`;
  home: `0x${string}`;
}) {
  const awayProf = useTeamProfile(league, away);
  const homeProf = useTeamProfile(league, home);

  const awayName = nameOrBye(away, awayProf.name);
  const homeName = nameOrBye(home, homeProf.name);

  const awayIsBye = away.toLowerCase() === BYE_ZERO.toLowerCase();
  const homeIsBye = home.toLowerCase() === BYE_ZERO.toLowerCase();

  const awayLogo = awayIsBye
    ? BYE_PATTERN_URL
    : (awayProf.logo || generatedLogoFor(away));
  const homeLogo = homeIsBye
    ? BYE_PATTERN_URL
    : (homeProf.logo || generatedLogoFor(home));

  // When projections are added, pass them in place of 0/0
  const [lp, rp] = winPercWithBye(0, 0, awayIsBye, homeIsBye);

  const href = `/league/${league}/matchup/${encodeURIComponent(
    `${week}:${away}:${home}`
  )}`;

  return (
    <Link
      href={href}
      className="block rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition p-4"
    >
      <div className="grid grid-cols-12 items-center gap-2">
        <div className="col-span-5 sm:col-span-4">
          <TeamGroup
            league={league}
            name={awayName}
            addr={away}
            logo={awayLogo as string}
            align="left"
            hideMeta={awayIsBye}
          />
        </div>
        <div className="col-span-2 sm:col-span-4">
          <ScoreMini aLive={0} bLive={0} aProj={0} bProj={0} />
        </div>
        <div className="col-span-5 sm:col-span-4">
          <TeamGroup
            league={league}
            name={homeName}
            addr={home}
            logo={homeLogo as string}
            align="right"
            hideMeta={homeIsBye}
          />
        </div>
      </div>
      <CenterOutWinMeter leftPct={lp} rightPct={rp} />
    </Link>
  );
}
