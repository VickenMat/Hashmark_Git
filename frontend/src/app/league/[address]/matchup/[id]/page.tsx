'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import { useTeamProfile, generatedLogoFor } from '@/lib/teamProfile';

/* --------------------------------- Consts --------------------------------- */

const ZIMA = '#8ED1FC';

const BYE_ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`;
const BYE_SENTINEL = '0x000000000000000000000000000000000000BEEF' as `0x${string}`;

const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

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

/* --------------------------------- Types ---------------------------------- */

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

const fmt1 = (n: any) => {
  const v = Number(n);
  return isFinite(v) ? v.toFixed(1) : '0.0';
};

function defaultStatLabel(pos?: string) {
  if (!pos) return '';
  if (pos === 'QB') return '0 PASS YDS';
  if (pos === 'RB') return '0 RUSH YDS';
  if (pos === 'WR' || pos === 'TE') return '0 REC YDS';
  if (pos === 'K') return '0/0 K';
  if (pos === 'D/ST') return '0 PTS ALLOWED';
  return 'YDS';
}

/* --------------------------------- Roster shape --------------------------- */

const scoresKey = (league: `0x${string}`, week: number) => `scores:${league}:${week}`;
const rosterKey = (league: `0x${string}`, addr: `0x${string}`, week: number) =>
  `roster:${league}:${lc(addr)}:${week}`;

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

/* --------------------------------- Page ---------------------------------- */

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
  const { starters: START_POS, bench: BENCH_COUNT, ir: IR_COUNT } = useMemo(() => shapeFrom(rosterRaw), [rosterRaw]);

  // Profiles
  const awayProf = useTeamProfile(league, awayAddr);
  const homeProf = useTeamProfile(league, homeAddr);

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

  /* ------------------------- Load roster (saved → CSV) --------------------- */
  type CsvRow = {
    position:string; name:string; team:string; slot:string; score?:string; proj?:string; opp?:string; time?:string; ['rst%']?:string; ['strt%']?:string;
  };
  type Player = {
    name: string; team: string; pos: string; score?: number; proj?: number; opp?: string; time?: string; rst?: number; strt?: number;
  };

  const [leftStarters, setLeftStarters] = useState<(PlayerSlot | undefined)[]>([]);
  const [leftBench, setLeftBench] = useState<PlayerSlot[]>([]);
  const [leftIR, setLeftIR] = useState<PlayerSlot[]>([]);

  // Helper: stat label from pos
  const primaryStat = (pPos?: string) => {
    if (pPos==='QB') return '0 PASS YDS';
    if (pPos==='RB') return '0 RUSH YDS';
    if (pPos==='WR'||pPos==='TE') return '0 REC YDS';
    if (pPos==='K')  return '0/0 K';
    if (pPos==='D/ST') return '0 PTS ALLOWED';
    return 'YDS';
  };

  useEffect(() => {
    let alive = true;

    function loadSaved() {
      try {
        const raw = localStorage.getItem(rosterKey(league as `0x${string}`, awayAddr, week));
        if (!raw) return false;
        const saved = JSON.parse(raw) as {
          starters: any[]; bench: any[]; ir: any[];
        };
        const startersOrdered = START_POS.map((pos, i) => {
          const r = saved.starters?.[i];
          if (!r || r === 'Empty') return undefined;
          const realPos = (r.pos || pos);
          return {
            name: r.name, team: r.team, pos: realPos, pts: r.score ?? r.pts ?? 0,
            stats: primaryStat(realPos)
          } as PlayerSlot;
        });
        const benchSlots = (saved.bench || []).map((r: any) =>
          r === 'Empty' ? undefined : ({ name:r.name, team:r.team, pos:r.pos, pts:r.score ?? r.pts ?? 0, stats: primaryStat(r.pos) } as PlayerSlot)
        ).filter(Boolean) as PlayerSlot[];
        const irSlots = (saved.ir || []).map((r: any) =>
          r === 'Empty' ? undefined : ({ name:r.name, team:r.team, pos:r.pos, pts:r.score ?? r.pts ?? 0, stats: primaryStat(r.pos) } as PlayerSlot)
        ).filter(Boolean) as PlayerSlot[];

        if (alive) {
          setLeftStarters(startersOrdered);
          setLeftBench(benchSlots);
          setLeftIR(irSlots);
        }
        return true;
      } catch { return false; }
    }

    async function loadCsvFallback() {
      try {
        const resp = await fetch('/dummy-roster.csv', { cache: 'no-store' });
        if (!resp.ok) throw new Error('csv missing');
        const text = await resp.text();
        const rows = parseCSV(text);
        const starters: Player[] = rows.filter(r => r.slot.toLowerCase() === 'starter').map(mapPlayer);
        const bench   : Player[] = rows.filter(r => r.slot.toLowerCase() === 'bench').map(mapPlayer);
        const ir      : Player[] = rows.filter(r => r.slot.toLowerCase() === 'ir').map(mapPlayer);

        const ordered: (PlayerSlot|undefined)[] = [];
        const pool = [...starters];

        START_POS.forEach(slot => {
          const i = pool.findIndex(p => p.pos === slot || (slot==='FLEX' && ['RB','WR','TE'].includes(p.pos)));
          if (i >= 0) {
            const p = pool.splice(i,1)[0];
            ordered.push({ name: p.name, team: p.team, pos: p.pos, pts: p.score, stats: primaryStat(p.pos) });
          } else {
            ordered.push(undefined);
          }
        });

        const benchSlots: PlayerSlot[] = bench.map(p => ({ name:p.name, team:p.team, pos:p.pos, pts:p.score, stats: primaryStat(p.pos) }));
        const irSlots   : PlayerSlot[] = ir.map(p => ({ name:p.name, team:p.team, pos:p.pos, pts:p.score, stats: primaryStat(p.pos) }));

        if (alive) {
          setLeftStarters(ordered);
          setLeftBench(benchSlots);
          setLeftIR(irSlots);
        }
      } catch {}
    }

    if (!loadSaved()) loadCsvFallback();

    const handler = (e: StorageEvent) => {
      if (!league) return;
      const key = rosterKey(league, awayAddr, week);
      if (e.key === key || e.key === `${key}:ts`) loadSaved();
    };
    window.addEventListener('storage', handler);

    return () => { alive = false; window.removeEventListener('storage', handler); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, awayAddr, week, START_POS.join(',')]);

  function parseCSV(src:string): CsvRow[] {
    const lines = src.trim().split(/\r?\n/);
    if (lines.length<=1) return [];
    const head = lines[0].split(',').map(h=>h.trim());
    const out: CsvRow[] = [];
    for (let i=1;i<lines.length;i++){
      const cells = splitCSVLine(lines[i]);
      const row:any = {};
      head.forEach((h,j)=> row[h]=cells[j]?.trim() ?? '');
      out.push(row as CsvRow);
    }
    return out;
  }
  function splitCSVLine(line:string){
    const out:string[]=[]; let cur=''; let q=false;
    for (let i=0;i<line.length;i++){
      const c=line[i];
      if (c==='"'){ q=!q; continue; }
      if (!q && c===','){ out.push(cur); cur=''; continue; }
      cur+=c;
    }
    out.push(cur);
    return out;
  }
  function mapPlayer(r: CsvRow): Player {
    const pct = (s?:string)=>{ const n=parseFloat(String(s||'').replace(/[^\d.-]/g,'')); return isFinite(n)?Math.round(Math.max(0,Math.min(100,n))):undefined; };
    const num = (s?:string)=>{ const n=parseFloat(String(s||'').replace(/[^\d.-]/g,'')); return isFinite(n)?n:undefined; };
    return {
      name: r.name?.trim() || '',
      team: r.team?.trim() || '',
      pos : (r.position?.trim().toUpperCase() || 'WR'),
      score: num(r.score),
      proj : num(r.proj),
      opp  : r.opp?.trim(),
      time : r.time?.trim(),
      rst  : pct((r as any)['rst%']),
      strt : pct((r as any)['strt%']),
    };
  }

  /* ---------------- Scores & projections (auto-update) --------------------- */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000);
    const onStorage = (e: StorageEvent) => {
      if (!league) return;
      const key = scoresKey(league, week);
      if (e.key === key || e.key === `${key}:ts`) setTick(t => t + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => { clearInterval(id); window.removeEventListener('storage', onStorage); };
  }, [league, week]);

  const scores = useMemo(() => {
    try {
      const raw = localStorage.getItem(scoresKey(league as `0x${string}`, week));
      return raw ? (JSON.parse(raw) as Record<string, { live?: number | string; proj?: number | string }>) : {};
    } catch { return {}; }
  }, [league, week, tick]);

  const aKey = lc(awayAddr);
  const hKey = lc(homeAddr);
  const projAway = awayIsBye ? 0 : toNum(scores[aKey]?.proj ?? '—');
  const projHome = homeIsBye ? 0 : toNum(scores[hKey]?.proj ?? '—');

  const liveAway = useMemo(
    () => leftStarters.reduce((s, p) => s + toNum(p?.pts), 0),
    [leftStarters]
  );
  const liveHome = homeIsBye ? 0 : toNum(scores[hKey]?.live ?? '—');

  // Write our computed total so other pages (team/scoreboard) can read it.
  useEffect(() => {
    if (!league || awayIsBye) return;
    try {
      const key = scoresKey(league as `0x${string}`, week);
      const raw = localStorage.getItem(key);
      const obj = raw ? JSON.parse(raw) : {};
      obj[aKey] = { live: liveAway, proj: projAway };
      localStorage.setItem(key, JSON.stringify(obj));
      localStorage.setItem(`${key}:ts`, String(Date.now()));
    } catch {}
  }, [league, week, aKey, liveAway, projAway, awayIsBye]);

  // Win probabilities
  let winA = 0.5, winH = 0.5;
  {
    const A = Math.max(0, projAway), H = Math.max(0, projHome);
    const sum = A + H;
    if (sum > 0) { winA = A / sum; winH = H / sum; }
  }

  /* ----------------------------- Presentational ---------------------------- */

  const [detail, setDetail] = useState<PlayerSlot | null>(null);

  function SmallMeta({ team, pos, align = 'left' }: { team?: string; pos?: string; align?: 'left' | 'right' }) {
    if (!team && !pos) return null;
    const txt = align === 'right' ? 'text-right' : '';
    return (
      <span className={`text-[11px] font-semibold tracking-wide whitespace-nowrap ${txt}`}>
        {team && <span className="text-white/90">{team.toUpperCase()}</span>}
        {team && pos && <span className="mx-1 text-white/30">•</span>}
        {pos && <span className={posColor(pos)}>{pos}</span>}
      </span>
    );
  }
  function posColor(p?: string) {
    switch (p) {
      case 'QB': return 'text-rose-300';
      case 'RB': return 'text-emerald-300';
      case 'WR': return 'text-sky-300';
      case 'TE': return 'text-orange-300';
      case 'FLEX': return 'text-fuchsia-300';
      case 'K': return 'text-amber-300';
      case 'D/ST': return 'text-violet-300';
      case 'DL':
      case 'LB':
      case 'DB': return 'text-rose-300';
      default: return 'text-gray-300';
    }
  }

  function PlayerTile({
    slot,
    side,
    highlight = false,
  }: {
    slot?: PlayerSlot;
    side: 'left' | 'right';
    highlight?: boolean;
  }) {
    const has = Boolean(slot?.name);
    const name = has ? slot!.name! : 'Empty';
    const pts = has ? (slot?.pts ?? '—') : '—';
    const realPos = slot?.pos; // show the player's real position even in FLEX

    const scoreBadge = (
      <div
        className={[
          'shrink-0 tabular-nums font-semibold text-sm px-2 rounded-md',
          highlight ? 'bg-emerald-700/40 ring-1 ring-emerald-400' : '',
        ].join(' ')}
      >
        {typeof pts === 'number' ? (pts as number).toFixed(1) : pts || '—'}
      </div>
    );

    const label = slot?.stats || defaultStatLabel(slot?.pos);
    const statCell = label ? (
      <div className="text-[11px] text-gray-400 truncate text-right w-28 md:w-32">{label}</div>
    ) : (
      <div className="w-28 md:w-32" />
    );

    const metaLeft = <SmallMeta team={slot?.team} pos={realPos} align="left" />;
    const metaRight = <SmallMeta team={slot?.team} pos={realPos} align="right" />;

    // No conditional class on the wrapper (avoids hydration mismatch)
    const nameLine = (
      <div className={`font-medium truncate ${side === 'right' ? 'text-right' : ''}`}>{name}</div>
    );

    const subLine =
      side === 'left' ? (
        <div className="mt-0 flex items-center justify-between gap-1">
          <div className="min-w-0 truncate">{metaLeft}</div>
          {statCell}
        </div>
      ) : (
        <div className="mt-0 flex items-center justify-between gap-1">
          {statCell}
          <div className="min-w-0 truncate">{metaRight}</div>
        </div>
      );

    return (
      <button
        type="button"
        onClick={() => has && setDetail(slot!)}
        className="rounded-xl ring-1 ring-white/10 bg-white/[0.04] h-12 px-2.5 flex items-center justify-between w-full text-left active:scale-[.995] transition"
      >
        {side === 'left' ? (
          <>
            <div className="min-w-0">{nameLine}{subLine}</div>
            {scoreBadge}
          </>
        ) : (
          <>
            {scoreBadge}
            <div className="min-w-0">{nameLine}{subLine}</div>
          </>
        )}
      </button>
    );
  }

  function PosPill({ pos }: { pos: string }) {
    const tone = {
      'QB':'text-rose-300', 'RB':'text-emerald-300', 'WR':'text-sky-300',
      'TE':'text-orange-300', 'FLEX':'text-fuchsia-300', 'K':'text-amber-300',
      'D/ST':'text-violet-300', 'DL':'text-rose-300', 'LB':'text-rose-300', 'DB':'text-rose-300'
    }[pos] || 'text-gray-300';
    return (
      <span className={`inline-grid place-items-center h-9 w-9 rounded-full border border-white/30 bg-neutral-800/60 text-xs font-semibold ${tone}`}>{pos}</span>
    );
  }

  function StarterRow({ i }: { i: number }) {
    const pos = START_POS[i];
    const Lraw = leftStarters[i];
    const Rraw = undefined as PlayerSlot | undefined; // right side empty (Bye or unknown)

    // show the slot's pos if tile is empty
    const L: PlayerSlot | undefined = Lraw ? { ...Lraw, pos: Lraw.pos || pos } : { pos };
    const R: PlayerSlot | undefined = Rraw ? { ...Rraw, pos: Rraw.pos || pos } : { pos };

    const lPts = toNum(L?.pts);
    const rPts = toNum(R?.pts);
    const hlLeft  = lPts > rPts;
    const hlRight = rPts > lPts;

    return (
      <div className="grid grid-cols-12 gap-3 items-center">
        <div className="col-span-5"><PlayerTile slot={L} side="left"  highlight={hlLeft} /></div>
        <div className="col-span-2 grid place-items-center"><PosPill pos={pos}/></div>
        <div className="col-span-5"><PlayerTile slot={R} side="right" highlight={hlRight} /></div>
      </div>
    );
  }

  function BenchRow({ left, right }: { left?: PlayerSlot; right?: PlayerSlot }) {
    return (
      <div className="grid grid-cols-12 gap-3 items-center">
        <div className="col-span-5"><PlayerTile slot={left} side="left" /></div>
        <div className="col-span-2 grid place-items-center">
          <span className="inline-grid place-items-center h-9 w-9 rounded-full border border-white/30 bg-neutral-800/60 text-[10px] font-semibold text-gray-300">
            Bench
          </span>
        </div>
        <div className="col-span-5"><PlayerTile slot={right} side="right" /></div>
      </div>
    );
  }

  function IRRow(){
    return (
      <div className="grid grid-cols-12 gap-3 items-center pt-2">
        <div className="col-span-5"><PlayerTile slot={leftIR[0]} side="left" /></div>
        <div className="col-span-2 grid place-items-center">
          <span className="inline-grid place-items-center h-9 w-9 rounded-full border border-white/30 bg-neutral-800/60 text-xs font-extrabold text-rose-400">IR</span>
        </div>
        <div className="col-span-5"><PlayerTile slot={undefined} side="right" /></div>
      </div>
    );
  }

  function DetailModal({ p, onClose }: { p: PlayerSlot; onClose: () => void }) {
    return (
      <div className="fixed inset-0 z-[9999]">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <div className="absolute inset-0 grid place-items-center p-4">
          <div className="w-[min(92vw,560px)] rounded-2xl border border-white/15 bg-gray-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-bold">{p.name}</div>
                <div className="text-sm text-gray-400 mt-0.5">{(p.team||'').toUpperCase()} • <span className={posColor(p.pos)}>{p.pos}</span></div>
              </div>
              <button onClick={onClose} className="rounded-md border border-white/15 px-2 py-1 text-sm">Close</button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/10 p-3">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Season (Weeks 1–18)</div>
                <div className="mt-2 text-gray-300 text-sm">—</div>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">This Game</div>
                <div className="mt-2 text-gray-300 text-sm">{p.stats || defaultStatLabel(p.pos)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------------- Render -------------------------------- */

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-4 sm:px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Title centered */}
        <div className="grid grid-cols-3 items-start">
          <div />
          <div className="text-center">
            <h1 className="text-3xl font-extrabold" style={{color:ZIMA}}>Matchup</h1>
            <p className="text-sm text-gray-400 mt-1">Week {week}</p>
          </div>
          <div />
        </div>

        {/* Teams header card */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <div className="px-3 py-4 sm:px-4 sm:py-5">
            <div className="grid grid-cols-12 items-center gap-3">
              {/* Away */}
              <div className="col-span-5 sm:col-span-4 flex items-center gap-3">
                <img src={awayLogo as string} alt={awayName} className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/15"/>
                <div className={`min-w-0 ${awayIsBye ? 'opacity-60' : ''}`}>
                  <div className="text-xl font-semibold truncate">{awayIsBye ? 'Bye Week' : awayName}</div>
                  {!awayIsBye && <div className="text-[11px] text-gray-400 font-mono">{shortAddr(awayAddr)}</div>}
                  <div className="text-[11px] text-gray-400">Record 0-0-0</div>
                </div>
              </div>

              {/* Center: Score + Projected (projected on top, lighter) */}
              <div className="col-span-2 sm:col-span-4 text-center">
                <div className="text-xs text-gray-400">Score</div>
                <div className="mt-1 text-xs text-gray-400 tabular-nums">
                  {fmt1(projAway)} <span className="mx-1 text-white/40">·</span> {fmt1(projHome)}
                </div>
                <div className="text-2xl font-extrabold tracking-tight tabular-nums">
                  {fmt1(liveAway)} <span className="mx-1 text-white/50">·</span> {fmt1(liveHome)}
                </div>
              </div>

              {/* Home */}
              <div className="col-span-5 sm:col-span-4 flex items-center justify-end gap-3">
                <div className="min-w-0 text-right">
                  <div className="text-xl font-semibold truncate">{homeName}</div>
                  <div className="text-[11px] text-gray-400">{homeIsBye ? 'Record 0-0-0' : <span className="font-mono">{shortAddr(homeAddr)}</span>}</div>
                </div>
                <img src={homeLogo as string} alt={homeName} className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/15"/>
              </div>
            </div>

            {/* Win % bar */}
            <div className="mt-4 flex items-center gap-3">
              <div className="text-[11px] text-gray-400 w-10 text-left">{Math.round(winA*100)}%</div>
              <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-emerald-500/70" style={{ width: `${winA*100}%` }} />
              </div>
              <div className="text-[11px] text-gray-400 w-10 text-right">{Math.round(winH*100)}%</div>
            </div>
          </div>
        </section>

        {/* Starters (TOTAL row inside) */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <h3 className="text-lg font-semibold text-center mb-4" style={{color:ZIMA}}>Starters</h3>
          <div className="space-y-3">
            {START_POS.map((_, i) => <StarterRow key={`sr-${i}`} i={i} />)}

            {/* TOTAL row — right box shows opponent total on the LEFT, no trailing 0.0 */}
            <div className="grid grid-cols-12 gap-3 items-center pt-2">
              <div className="col-span-5">
                <div className="rounded-xl px-3 py-2 ring-1 ring-white/10 bg-white/[0.04] font-semibold text-right tabular-nums">
                  {fmt1(liveAway)}
                </div>
              </div>
              <div className="col-span-2 grid place-items-center text-sm tracking-wider text-gray-300">TOTAL</div>
              <div className="col-span-5">
                <div className="rounded-xl px-3 py-2 ring-1 ring-white/10 bg-white/[0.04] font-semibold tabular-nums text-left">
                  {fmt1(liveHome)}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Bench + IR */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <h3 className="text-lg font-semibold text-center mb-4" style={{color:ZIMA}}>Bench</h3>
          <div className="space-y-2">
            {Array.from({ length: Math.max(BENCH_COUNT,5) }, (_, i) => (
              <BenchRow key={`bn-${i}`} left={leftBench[i]} right={undefined} />
            ))}
            {IR_COUNT > 0 && <IRRow />}
          </div>
        </section>
      </div>

      {detail && <DetailModal p={detail} onClose={() => setDetail(null)} />}
    </main>
  );
}
