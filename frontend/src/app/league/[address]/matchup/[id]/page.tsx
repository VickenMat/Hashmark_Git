// src/app/league/[address]/team/[ownerAddress]/page.tsx
'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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

type SlotKey = 'QB' | 'RB' | 'WR' | 'FLEX' | 'TE' | 'K' | 'D/ST' | 'DL' | 'LB' | 'DB' | 'TOTAL' | null;
type Player = {
  name: string;
  team: string;
  pos: Exclude<SlotKey, 'FLEX' | 'TOTAL' | null>;
  opp?: string;
  time?: string;
  rst?: number;    // rostered %
  strt?: number;   // started %
  score?: number;  // decimal
  proj?: number;   // decimal
};
type Row = Player | 'Empty';

const FLEX_SET = new Set<SlotKey>(['RB','WR','TE']);

/* palette (via CSS variables with fallbacks) */
const ZIMA = 'var(--zima, #8ED1FC)';       // titles
const EGGSHELL = 'var(--eggshell, #F0EAD6)'; // borders

/* POS text color (idle state) */
function posColor(label: Exclude<SlotKey, null>): string {
  switch (label) {
    case 'QB': return 'text-rose-300';
    case 'RB': return 'text-emerald-300';
    case 'WR': return 'text-sky-300';
    case 'TE': return 'text-orange-300';
    case 'D/ST': return 'text-violet-300';
    case 'K': return 'text-amber-300';
    case 'FLEX': return 'text-fuchsia-300';
    case 'DL':
    case 'LB':
    case 'DB': return 'text-rose-300';
    case 'TOTAL': return 'text-gray-300';
    default: return 'text-white';
  }
}
/* Ring color when selected / eligible */
function posRing(label: Exclude<SlotKey, null>): string {
  switch (label) {
    case 'QB': return 'ring-rose-400 border-rose-400';
    case 'RB': return 'ring-emerald-400 border-emerald-400';
    case 'WR': return 'ring-sky-400 border-sky-400';
    case 'TE': return 'ring-orange-400 border-orange-400';
    case 'D/ST': return 'ring-violet-400 border-violet-400';
    case 'K': return 'ring-amber-400 border-amber-400';
    case 'FLEX': return 'ring-fuchsia-400 border-fuchsia-400';
    case 'DL':
    case 'LB':
    case 'DB': return 'ring-rose-400 border-rose-400';
    case 'TOTAL': return 'ring-gray-300 border-gray-300';
    default: return 'ring-white border-white';
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

/** scores storage key shared with Matchup/Scoreboard */
const scoresKey = (league: `0x${string}`, week: number) => `scores:${league}:${week}`;

/** Tiny centered portal so modal ignores transformed ancestors */
function BodyPortal({ children }: { children: React.ReactNode }) {
  const [host] = useState(() => document.createElement('div'));
  useEffect(() => {
    host.style.position = 'relative';
    host.style.zIndex = '9999';
    document.body.appendChild(host);
    return () => { document.body.removeChild(host); };
  }, [host]);
  return createPortal(children, host);
}

/** =======================================================
 * Team Page (centered layout, and writes live/proj into localStorage)
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

  /* =================== CSV: load dummy-roster.csv =================== */
  type CsvRow = {
    name: string; team: string; pos: string; opp?: string; time?: string;
    rst?: string; strt?: string; score?: string; proj?: string; slot?: string;
  };
  const [csvPlayers, setCsvPlayers] = useState<Player[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const resp = await fetch('/dummy-roster.csv', { cache: 'no-store' });
        if (!resp.ok) throw new Error('csv not found');
        const text = await resp.text();
        const rows: CsvRow[] = parseCSV(text);
        const players: Player[] = rows.map(r => ({
          name: r.name?.trim() || '',
          team: r.team?.trim() || '',
          pos: (r.pos?.trim() as any) || 'WR',
          opp: r.opp?.trim(),
          time: r.time?.trim(),
          rst: toPct(r.rst),
          strt: toPct(r.strt),
          score: toNum(r.score),
          proj: toNum(r.proj),
        })).filter(p => p.name);
        if (alive) setCsvPlayers(players);
      } catch (e) {
        // no CSV? leave empty
      }
    })();
    return () => { alive = false; };
  }, []);

  function toNum(s?: string) {
    const n = parseFloat(String(s ?? '').replace(/[^\d.-]/g,''));
    return isFinite(n) ? n : 0;
  }
  function toPct(s?: string) {
    const n = parseFloat(String(s ?? '').replace(/[^\d.-]/g,''));
    if (!isFinite(n)) return undefined;
    return Math.max(0, Math.min(100, Math.round(n)));
  }
  function parseCSV(src: string): CsvRow[] {
    const lines = src.trim().split(/\r?\n/);
    if (lines.length <= 1) return [];
    const head = lines[0].split(',').map(h => h.trim().toLowerCase());
    const out: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCSVLine(lines[i]);
      const row: any = {};
      head.forEach((h, j) => row[h] = (cells[j] ?? '').trim());
      out.push(row);
    }
    return out;
  }
  function splitCSVLine(line: string): string[] {
    const out: string[] = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { q = !q; continue; }
      if (!q && c === ',') { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  /* ===== Build initial rows from CSV (by slot column) ===== */
  const [starters, setStarters] = useState<Row[]>([]);
  const [bench, setBench] = useState<Row[]>([]);
  const [irList, setIrList] = useState<Row[]>([]);

  useEffect(() => {
    // from CSV into starters/bench/ir; fall back to Empty fillers
    const bySlot = {
      Starter: csvPlayers.filter(p => (p as any).slot?.toLowerCase?.() === 'starter'),
      Bench:   csvPlayers.filter(p => (p as any).slot?.toLowerCase?.() === 'bench'),
      IR:      csvPlayers.filter(p => (p as any).slot?.toLowerCase?.() === 'ir'),
    };

    // order starters to match STARTERS layout
    const startersOrdered: Row[] = [];
    const pool = [...bySlot.Starter];
    STARTERS.forEach(slot => {
      let idx = pool.findIndex(p => p.pos === slot || (slot === 'FLEX' && FLEX_SET.has(p.pos as any)));
      if (idx === -1) idx = pool.findIndex(p => FLEX_SET.has(p.pos as any) && slot !== 'QB' && slot !== 'D/ST' && slot !== 'K');
      if (idx === -1) startersOrdered.push('Empty');
      else startersOrdered.push(pool.splice(idx,1)[0]);
    });

    const benchRows: Row[] = [...bySlot.Bench];
    while (benchRows.length < Math.max(1, BENCH_COUNT)) benchRows.push('Empty');

    const irRows: Row[] = [...bySlot.IR];
    if (irRows.length < Math.max(1, IR_COUNT)) {
      for (let i=irRows.length;i<IR_COUNT;i++) irRows.push('Empty');
    }

    setStarters(startersOrdered);
    setBench(benchRows.slice(0, BENCH_COUNT));
    setIrList(irRows);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvPlayers, STARTERS.join(','), BENCH_COUNT, IR_COUNT]);

  /* -------- Selection / swap logic -------- */
  const [sel, setSel] = useState<{ section: 'starters'|'bench'|'ir'; index: number }|null>(null);

  function rowPosOf(r: Row): SlotKey {
    if (r === 'Empty') return null;
    return r.pos;
  }

  function eligibleForSlot(playerPos: SlotKey, targetSlot: SlotKey) {
    if (!playerPos || !targetSlot) return false;
    if (targetSlot === 'FLEX') return FLEX_SET.has(playerPos);
    return playerPos === targetSlot;
  }

  function onPillClick(section: 'starters'|'bench'|'ir', index: number) {
    if (sel && sel.section === section && sel.index === index) { setSel(null); return; }
    setSel({ section, index });
  }

  function doSwapOrMove(target: { section: 'starters'|'bench'|'ir'; index: number }) {
    if (!sel) return;

    // IR → elsewhere rule: only into an EMPTY slot; must have an empty eligible slot somewhere
    const fromIR = sel.section === 'ir';
    if (fromIR) {
      const fromRow = irList[sel.index];
      const pPos = rowPosOf(fromRow);
      if (!pPos || fromRow === 'Empty') { setSel(null); return; }

      // target must be empty & eligible
      const getRow = (s: typeof target.section, i: number) => s === 'starters' ? starters[i] : (s === 'bench' ? bench[i] : irList[i]);
      const trgRow = getRow(target.section, target.index);
      const trgSlot = target.section === 'starters' ? STARTERS[target.index] : 'FLEX'; // bench: allow any empty
      const eligible = (target.section === 'bench') ? (trgRow === 'Empty') : (trgRow === 'Empty' && eligibleForSlot(pPos, trgSlot));

      const anyEmpty = starters.some((r, i) => r === 'Empty' && eligibleForSlot(pPos, STARTERS[i])) || bench.some(r => r === 'Empty');
      if (!anyEmpty) { setIrBlockOpen(true); return; }
      if (!eligible) return; // only empty

      // move IR player into that empty spot (no swapping)
      if (target.section === 'starters') {
        const nextS = [...starters];
        nextS[target.index] = fromRow as Player;
        setStarters(nextS);
      } else if (target.section === 'bench') {
        const nextB = [...bench];
        nextB[target.index] = fromRow as Player;
        setBench(nextB);
      }
      const nextIR = [...irList];
      nextIR[sel.index] = 'Empty';
      setIrList(nextIR);
      setSel(null);
      return;
    }

    // regular swap between starters/bench
    const copyS = [...starters];
    const copyB = [...bench];

    const fromList = sel.section === 'starters' ? copyS : copyB;
    const toList   = target.section === 'starters' ? copyS : copyB;

    const fromRow = fromList[sel.index];
    const toRow   = toList[target.index];

    const fromPos = rowPosOf(fromRow);
    const targetSlot = target.section === 'starters' ? STARTERS[target.index] : rowPosOf(toRow) || 'FLEX';

    // Eligibility checks:
    if (fromRow !== 'Empty' && target.section === 'starters' && !eligibleForSlot(fromPos, targetSlot)) return;
    if (toRow !== 'Empty' && sel.section === 'starters') {
      const toPos = rowPosOf(toRow);
      const fromSlot = STARTERS[sel.index];
      if (!eligibleForSlot(toPos, fromSlot)) return;
    }

    // swap
    fromList[sel.index] = toRow;
    toList[target.index] = fromRow;

    setStarters(copyS);
    setBench(copyB);
    setSel(null);
  }

  /* -------- Totals -------- */
  const startersTotals = useMemo(() => {
    let score = 0, proj = 0;
    starters.forEach((r, idx) => {
      if (r !== 'Empty') {
        score += Number(r.score || 0);
        proj  += Number(r.proj  || 0);
      }
    });
    return {
      score: Math.round(score * 10) / 10,
      proj : Math.round(proj  * 10) / 10,
    };
  }, [starters]);

  /* ---- write to localStorage so matchup/scoreboard pick it up ---- */
  useEffect(() => {
    if (!league || !owner) return;
    try {
      const key = scoresKey(league, week);
      const raw = localStorage.getItem(key);
      const obj = raw ? JSON.parse(raw) : {};
      obj[String(owner).toLowerCase()] = {
        live: startersTotals.score,
        proj: startersTotals.proj,
      };
      localStorage.setItem(key, JSON.stringify(obj));
      // bump heartbeat so listeners update immediately
      localStorage.setItem(`${key}:ts`, String(Date.now()));
    } catch {}
  }, [league, owner, week, startersTotals.score, startersTotals.proj]);

  /* -------- Activity metrics (dummy/local) -------- */
  const [pendingTrades, setPendingTrades] = useState(0);
  const [waiverClaims, setWaiverClaims] = useState(0);
  useEffect(() => {
    try {
      const ownerKey = (owner || '').toLowerCase();
      setPendingTrades(Number(localStorage.getItem(`trades:${league}:${ownerKey}`) || 0));
      setWaiverClaims(Number(localStorage.getItem(`claims:${league}:${ownerKey}`) || 0));
    } catch {}
  }, [league, owner]);

  /* -------- Selection decoration helpers -------- */
  function pillClass(baseSlot: SlotKey, section: 'starters'|'bench'|'ir', index: number) {
    const base = 'mx-auto w-[84px] font-semibold rounded-full py-2 transition bg-white/[0.08] hover:bg-white/[0.14] border';
    if (!sel) return base + ' border-transparent';
    const fromRow = sel.section === 'starters' ? starters[sel.index] : sel.section === 'bench' ? bench[sel.index] : irList[sel.index];
    const fromPos = rowPosOf(fromRow);
    if (sel.section === 'ir') {
      // highlight eligible EMPTY slots only
      const row = section === 'starters' ? starters[index] : bench[index];
      if (section === 'starters') {
        return (row === 'Empty' && eligibleForSlot(fromPos, baseSlot)) ? `${base} ${posRing(baseSlot as any)}` : `${base} border-transparent`;
      }
      // bench: any empty is fine
      return (row === 'Empty') ? `${base} ring-1 ${posRing((fromPos || 'RB') as any)}` : `${base} border-transparent`;
    }
    // regular: highlight compatible swap targets
    if (section === 'starters') {
      const ok = (fromPos && eligibleForSlot(fromPos, baseSlot)) ||
                 (sel.section === 'starters' && index === sel.index);
      return ok ? `${base} ${posRing(baseSlot as any)}` : `${base} border-transparent`;
    }
    // bench pill always says Bench; color by selected player's pos
    if (sel.section === 'starters' || sel.section === 'bench') {
      return `${base} ${fromPos ? posRing(fromPos) : 'border-transparent'}`;
    }
    return `${base} border-transparent`;
  }

  /* -------- IR popup -------- */
  const [irBlockOpen, setIrBlockOpen] = useState(false);
  useEffect(() => {
    if (irBlockOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [irBlockOpen]);

  /* -------- Header -------- */
  const avatar = (
    <div className="relative h-16 w-16 rounded-2xl overflow-hidden ring-2 ring-white/20 bg-white/5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mounted ? (profile.logo || EMPTY_SVG) : EMPTY_SVG} alt="team logo" className="absolute inset-0 h-full w-full object-cover" decoding="async" loading="eager" />
      <span
        suppressHydrationWarning
        aria-hidden={!showInitials}
        className={cn('relative z-10 grid h-full w-full place-items-center text-xl font-black transition-opacity', showInitials ? 'opacity-100' : 'opacity-0')}
      >
        {initials(safeTeamName)}
      </span>
    </div>
  );

  /* --------------------------------- Render -------------------------------- */
  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-8">

        {/* ===== Top Bar: centered title ===== */}
        <div className="grid grid-cols-3 items-center">
          <div />
          <h2 className="justify-self-center text-3xl font-extrabold tracking-tight" style={{ color: ZIMA }}>My Team</h2>
          <div />
        </div>

        {/* ===== Header ===== */}
        <header className="pt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {avatar}
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

          {/* Right actions (centered cut page link shows a centered layout there) */}
          <aside className="flex flex-col gap-3 sm:items-end">
            <div className="grid grid-cols-2 gap-4">
              <Link
                href={`/league/${league}/claims/add`}
                className="rounded-xl bg-emerald-700/40 hover:bg-emerald-700/55 px-4 py-2 text-center font-semibold border border-emerald-500/40"
              >
                Add
              </Link>
              <Link
                href={`/league/${league}/claims/cut`}
                className="rounded-xl bg-rose-700/40 hover:bg-rose-700/55 px-4 py-2 text-center font-semibold border border-rose-500/40"
              >
                Cut
              </Link>
            </div>
          </aside>
        </header>

        {/* ===== Week row (centered controls) ===== */}
        <section className="grid grid-cols-3 items-center mb-6 sm:mb-8 lg:mb-10">
          <div className="justify-self-start">
            <Link
              href={`/league/${league}/schedule`}
              className="rounded-lg bg-[#8ED1FC] text-black hover:brightness-105 px-4 py-2 text-sm font-semibold"
              style={{ backgroundColor: ZIMA }}
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
              <div className="text-sm font-semibold mt-0.5">Nov 26, 2025</div>
            </div>
          </div>
        </section>

        {/* ===== Summary Row: Matchup (left) + Activity (right) ===== */}
        <section className="rounded-2xl border" style={{ borderColor: EGGSHELL }}>
          <div className="grid grid-cols-12 gap-6 items-stretch p-5">
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
              <aside className="rounded-2xl border" style={{ borderColor: EGGSHELL }}>
                <div className="p-4 flex flex-col lg:h-full">
                  <div className="text-sm font-semibold text-center" style={{ color: ZIMA }}>Activity</div>

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
                </div>
              </aside>
            </div>
          </div>
        </section>

        {/* ===== Starters table ===== */}
        <section className="mt-6 sm:mt-8 lg:mt-10 rounded-2xl border overflow-hidden" style={{ borderColor: EGGSHELL }}>
          <div className="px-4 py-3 font-semibold text-center" style={{ color: ZIMA }}>Starters</div>

          {/* Header row */}
          <div className="grid grid-cols-12 bg-black/40 text-[11px] uppercase tracking-wide text-gray-300">
            <div className="col-span-2 px-2 py-1.5 text-center">POS</div>
            <div className="col-span-4 px-2 py-1.5">Name</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Score</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Proj</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Opp</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Time</div>
            <div className="col-span-1 px-1 py-1.5 text-left">RST %</div>
            <div className="col-span-1 px-1 py-1.5 text-left">STRT %</div>
          </div>

{STARTERS.map((slotLabel, idx) => {
  const r = starters[idx];
  const isPlayer = !!r && r !== 'Empty';

  const score = isPlayer ? (r as any).score ?? 0 : undefined;
  const proj  = isPlayer ? (r as any).proj  ?? 0 : undefined;
  const over  = isPlayer && typeof score === 'number' && typeof proj === 'number' && score > proj;

  return (
    <div key={`${slotLabel}-${idx}`} className="grid grid-cols-12">
      {/* POS / whatever else you render */}
      {/* left side */}
      <div className="col-span-2 px-2 py-3 text-center font-semibold">
        {/* your pill/button component here */}
      </div>

      {/* Name + meta */}
      <div className="col-span-4 px-2 py-3">
        {!isPlayer ? (
          <span className="text-gray-400">Empty</span>
        ) : (
          <div>
            <div className="truncate">{(r as any).name}</div>
            <div className="text-[11px] text-gray-400">
              <span className="mr-2">{(r as any).team?.toUpperCase()}</span>
              {/* if you keep pos coloring */}
              {/* <span className={posColor((r as any).pos)}>{(r as any).pos}</span> */}
            </div>
          </div>
        )}
      </div>

      {/* Score */}
      <div className="col-span-1 px-1 py-3 tabular-nums font-bold">
        {!isPlayer ? '—' : (Number(score)).toFixed(1)}
      </div>

      {/* Proj */}
      <div className="col-span-1 px-1 py-3 tabular-nums">
        {!isPlayer ? '—' : (Number(proj)).toFixed(1)}
      </div>

      {/* …the rest of your columns (opp/time/etc.) also wrapped with !isPlayer guards */}
    </div>
  );
})}


          {/* TOTAL row */}
          <div className="grid grid-cols-12 items-center border-t border-white/10">
            <div className="col-span-2 px-2 py-3 text-center font-semibold text-gray-300">TOTAL</div>
            <div className="col-span-4 px-2 py-3 text-gray-300"></div>
            <div className="col-span-1 px-1 py-3 tabular-nums text-2xl font-extrabold">{startersTotals.score.toFixed(1)}</div>
            <div className="col-span-1 px-1 py-3 tabular-nums">{startersTotals.proj.toFixed(1)}</div>
            <div className="col-span-1 px-1 py-3"></div>
            <div className="col-span-1 px-1 py-3"></div>
            <div className="col-span-1 px-1 py-3"></div>
            <div className="col-span-1 px-1 py-3"></div>
          </div>
        </section>

        {/* ===== Bench ===== */}
        <section className="mt-6 rounded-2xl border overflow-hidden" style={{ borderColor: EGGSHELL }}>
          <div className="px-4 py-2 font-semibold text-center" style={{ color: ZIMA }}>Bench</div>

          {/* Header */}
          <div className="grid grid-cols-12 bg-black/40 text-[11px] uppercase tracking-wide text-gray-300">
            <div className="col-span-2 px-2 py-1.5 text-center">Pos</div>
            <div className="col-span-4 px-2 py-1.5">Name</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Score</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Proj</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Opp</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Time</div>
            <div className="col-span-1 px-1 py-1.5 text-left">RST %</div>
            <div className="col-span-1 px-1 py-1.5 text-left">STRT %</div>
          </div>

          {bench.map((r, i) => {
            const pPos = r === 'Empty' ? null : r.pos;
            return (
              <div key={`bench-${i}`} className="grid grid-cols-12">
                <div className="col-span-2 px-2 py-3 text-center font-semibold">
                  <button
                    onClick={() => onPillClick('bench', i)}
                    className={cn(pillClass(pPos || 'RB', 'bench', i))}
                  >
                    <span className={posColor((pPos || 'RB') as any)}>{'Bench'}</span>
                  </button>
                </div>
                <div className="col-span-4 px-2 py-3">
                  {r === 'Empty' ? <span className="text-gray-400">Empty</span> : (
                    <div>
                      <div className="truncate">{r.name}</div>
                      <div className="text-[11px] text-gray-400">
                        <span className="mr-2">{r.team.toUpperCase()}</span>
                        <span className={cn(posColor(r.pos))}>{r.pos}</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="col-span-1 px-1 py-3 tabular-nums font-bold">{r === 'Empty' ? '—' : (r.score ?? 0).toFixed(1)}</div>
                <div className="col-span-1 px-1 py-3 tabular-nums">{r === 'Empty' ? '—' : (r.proj ?? 0).toFixed(1)}</div>
                <div className="col-span-1 px-1 py-3">{r === 'Empty' ? '—' : (r.opp || '—')}</div>
                <div className="col-span-1 px-1 py-3">{r === 'Empty' ? '—' : (r.time || '—')}</div>
                <div className="col-span-1 px-1 py-3">{r === 'Empty' ? '—' : `${r.rst ?? 0}%`}</div>
                <div className="col-span-1 px-1 py-3">{r === 'Empty' ? '—' : `${r.strt ?? 0}%`}</div>
              </div>
            );
          })}
        </section>

        {/* ===== IR rows (based on settings) ===== */}
        <section className="mt-6 rounded-2xl border overflow-hidden" style={{ borderColor: EGGSHELL }}>
          <div className="px-4 py-2 font-semibold text-center" style={{ color: ZIMA }}>IR</div>
          {irList.map((r, idx) => (
            <div key={`ir-${idx}`} className="grid grid-cols-12">
              <div className="col-span-2 px-2 py-3 font-semibold text-center">
                <button
                  onClick={() => onPillClick('ir', idx)}
                  className={cn('mx-auto w-[84px] rounded-full py-2 text-white transition bg-rose-700/30 ring-1 ring-rose-500/50 border border-rose-400')}
                >
                  IR
                </button>
              </div>
              <div className="col-span-4 px-3 py-3 text-gray-300">{r === 'Empty' ? 'Empty' : r.name}</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">{r === 'Empty' ? '—' : (r.score ?? 0).toFixed(1)}</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">{r === 'Empty' ? '—' : (r.proj ?? 0).toFixed(1)}</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">{r === 'Empty' ? '—' : (r.opp || '—')}</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">{r === 'Empty' ? '—' : (r.time || '—')}</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">{r === 'Empty' ? '—' : `${r.rst ?? 0}%`}</div>
              <div className="col-span-1 px-3 py-3 text-center text-gray-300">{r === 'Empty' ? '—' : `${r.strt ?? 0}%`}</div>
            </div>
          ))}
        </section>
      </div>

      {/* --- hidden buttons to make the grid clickable for swaps/moves --- */}
      <div className="hidden" aria-hidden>
        {STARTERS.map((_, idx) => (
          <button key={`s-${idx}`} onClick={() => doSwapOrMove({ section: 'starters', index: idx })} />
        ))}
        {bench.map((_, i) => (
          <button key={`b-${i}`} onClick={() => doSwapOrMove({ section: 'bench', index: i })} />
        ))}
        {irList.map((_, i) => (
          <button key={`i-${i}`} onClick={() => doSwapOrMove({ section: 'ir', index: i })} />
        ))}
      </div>

      {/* Centered IR modal via portal */}
      {irBlockOpen && (
        <BodyPortal>
          <div className="fixed inset-0 bg-black/60" onClick={() => setIrBlockOpen(false)} />
          <div className="fixed inset-0 grid place-items-center p-4">
            <div className="w-[min(92vw,520px)] rounded-2xl border border-white/15 bg-gray-950 p-5 shadow-2xl">
              <h3 className="text-lg font-bold" style={{ color: ZIMA }}>
                No Free Roster Spot
              </h3>
              <p className="mt-2 opacity-90">
                To activate an IR player, you need at least one empty starter or bench slot.
              </p>
              <div className="mt-4 flex justify-end gap-3">
                <button
                  className="rounded-md border border-white/15 px-3 py-1.5"
                  onClick={() => setIrBlockOpen(false)}
                >
                  Close
                </button>
                <Link
                  href={`/league/${league}/claims/cut`}
                  className="rounded-md px-3 py-1.5 font-semibold bg-rose-600 hover:bg-rose-700 text-white"
                >
                  Go to Cut
                </Link>
              </div>
            </div>
          </div>
        </BodyPortal>
      )}
    </main>
  );
}
