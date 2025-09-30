// src/app/league/[address]/draft/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import { useTeamProfile } from '@/lib/teamProfile';
import { loadDraftState, saveDraftState, type DraftState } from '@/lib/draft-storage';

type Address = `0x${string}`;
const ZERO: Address = '0x0000000000000000000000000000000000000000';

const ZIMA = '#37c0f6';
const EGGSHELL = '#F0EAD6';
const RED = '#ef4444';
const ORANGE = '#f59e0b';

const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getTeams', stateMutability: 'view', inputs: [], outputs: [{ type: 'tuple[]', components: [{ name: 'owner', type: 'address' }, { name: 'name', type: 'string' }]}] },
  // draftType(uint8), draftTimestamp(uint64), orderMode(uint8), completed(bool), manual(address[]), picksTrading(bool)
  { type: 'function', name: 'getDraftSettings', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }, { type: 'uint64' }, { type: 'uint8' }, { type: 'bool' }, { type: 'address[]' }, { type: 'bool' }] },
  // NEW: authoritative chip settings
  {
    type: 'function', name: 'getDraftExtras', stateMutability: 'view', inputs: [],
    outputs: [{
      type: 'tuple', components: [
        { name: 'timePerPickSeconds', type: 'uint32' },
        { name: 'thirdRoundReversal', type: 'bool' },
        { name: 'salaryCapBudget',    type: 'uint32' },
        { name: 'playerPool',         type: 'uint8'  },
      ]
    }]
  },
  { type: 'function', name: 'commissioner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

type Team = { owner: Address; name: string };

const short = (a?: string) => (a ? `${a.slice(0,6)}…${a.slice(-4)}` : '');

const fmtClock = (s: number) => {
  const sec = Math.max(0, Math.floor(s));
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};
const timeLabel = (secs: number) => {
  if (secs === 0) return 'No Limit per Pick';
  if (secs < 60) return `${secs}S per Pick`;
  if (secs < 3600) return `${Math.round(secs/60)}M per Pick`;
  return `${Math.round(secs/3600)}H per Pick`;
};

// Local time like 09/30/2025 - 3:15 PM PDT
function fmtLocal(ts: number) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const date = d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  const tz = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(d).find(p => p.type === 'timeZoneName')?.value || '';
  return `${date} - ${time} ${tz}`;
}

// deterministic shuffle for Random order mode
function seededShuffle<T>(arr: T[], seed: number): T[] {
  let s = (seed >>> 0) || 1;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ---------------- Draft Room ---------------- */
export default function DraftRoom() {
  const { address: league } = useParams<{ address: Address }>();
  const { address: wallet } = useAccount();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /* reads */
  const nameRes = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' });
  const teamsRes = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getTeams',
    query: { refetchInterval: 5000, staleTime: 0 }
  });
  const settingsRes = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getDraftSettings',
    query: { refetchInterval: 5000, staleTime: 0 }
  });
  // NEW: authoritative chip settings
  const extrasRes = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getDraftExtras',
    query: { refetchInterval: 5000, staleTime: 0 }
  });
  const commishRes = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'commissioner' });

  const leagueName = (nameRes.data as string) || 'League';
  const teams = (Array.isArray(teamsRes.data) ? (teamsRes.data as Team[]) : []) as Team[];

  const commissioner = (commishRes.data as string | undefined)?.toLowerCase() || '';
  const isCommish = !!(wallet && wallet.toLowerCase() === commissioner);

  // [type, ts, orderMode, completed, manual, picksTrading]
  const [draftType, draftTs, orderMode, draftCompleted, manualOrder] =
    ((settingsRes.data as any) || [0, 0n, 0, false, [], false]) as [number, bigint, number, boolean, Address[], boolean];

  // ---- Authoritative chips from chain ----
  const extras = extrasRes.data as undefined | {
    timePerPickSeconds: number; thirdRoundReversal: boolean; salaryCapBudget: number; playerPool: number;
  };

  const timePerPickSeconds = extras ? Number(extras.timePerPickSeconds || 0) : 60;
  const thirdRoundReversal = !!extras?.thirdRoundReversal;
  const salaryBudget = extras ? Number(extras.salaryCapBudget || 400) : 400;
  const playerPool = (extras?.playerPool === 1 ? 'rookies' : extras?.playerPool === 2 ? 'vets' : 'all') as 'all'|'rookies'|'vets';

  const timePerPickText = timeLabel(timePerPickSeconds);
  const leagueFormat = 'Redraft'; // placeholder
  const draftTypeLabel = ['Snake', 'Salary Cap', 'Autopick', 'Offline'][draftType] || 'Snake';

  /* ----- ORDER SYNC (manual overrides any cached order) ----- */
  const [sharedOrder, setSharedOrder] = useState<Address[]>(() => {
    const boot = loadDraftState(league) as any;
    return Array.isArray(boot?.order) ? (boot.order as Address[]) : [];
  });

  const teamOrderR1 = useMemo<Address[]>(() => {
    // 1) Prefer MANUAL order from chain (canonical)
    if (Array.isArray(manualOrder) && manualOrder.some(a => a && a !== ZERO)) {
      const base = manualOrder.filter(Boolean) as Address[];
      while (base.length < teams.length) base.push(ZERO);
      return base;
    }

    // 2) Otherwise, accept a commish-broadcasted order (only if host == commissioner)
    const boot = loadDraftState(league) as any;
    const host = boot?.host as string | undefined;
    if (sharedOrder.length && host && host.toLowerCase() === commissioner) {
      return [...sharedOrder];
    }

    // 3) Otherwise, Random (deterministic)
    if (orderMode === 0) {
      const owners = teams.map(t => t.owner);
      const leaguePart = typeof league === 'string' && league.length >= 10 ? parseInt(league.slice(2, 10), 16) : 0;
      const tsPart = Number(draftTs ? Number(draftTs) & 0xffffffff : 0);
      const seed = (leaguePart ^ tsPart) >>> 0;
      const shuffled = seededShuffle(owners, seed);
      while (shuffled.length < teams.length) shuffled.push(ZERO);
      return shuffled;
    }

    // 4) Fallback: joined order
    const joined = teams.map(t => t.owner);
    while (joined.length < teams.length) joined.push(ZERO);
    return joined;
  }, [manualOrder, sharedOrder, teams, orderMode, league, draftTs, commissioner]);

  // header entries with names (teams fixed left→right; order logic is per-round)
  const header = useMemo(() => teamOrderR1.map((owner, i) => {
    const t = teams.find(tt => tt.owner?.toLowerCase() === owner?.toLowerCase());
    return { owner, name: t?.name || (owner === ZERO ? `Team ${i+1}` : `${owner.slice(0,6)}…${owner.slice(-4)}`) };
  }), [teamOrderR1, teams]);

  /* live clock & state sync (BroadcastChannel) */
  const startAt = Number(draftTs) || 0;
  const [now, setNow] = useState(() => Math.floor(Date.now()/1000));
  useEffect(() => { const id = setInterval(() => setNow(Math.floor(Date.now()/1000)), 1000); return () => clearInterval(id); }, []);
  const isLiveByTime = startAt > 0 && now >= startAt && !draftCompleted;
  const inLobbyHour = startAt > 0 && now < startAt && (startAt - now) <= 3600;

  // local persisted state (cross-tabs via BC)
  const boot = (): Partial<DraftState & {
    remaining?: number;
    ended?: boolean;
    order?: Address[];
    host?: string;
  }> => loadDraftState(league) || {};

  const [paused, setPaused] = useState<boolean>(() => !!boot().paused);
  const [curRound, setCurRound] = useState<number>(() => boot().currentRound || 1);
  const [curIndex, setCurIndex] = useState<number>(() => boot().currentPickIndex || 0);
  const [pickStartedAt, setPickStartedAt] = useState<number>(() => boot().startedAt || 0);
  const [remaining, setRemaining] = useState<number>(() => (boot() as any).remaining ?? timePerPickSeconds);
  const [ended, setEnded] = useState<boolean>(() => !!(boot() as any).ended);
  const [showEndModal, setShowEndModal] = useState<boolean>(false);

  const isLive = isLiveByTime && !ended;

  const chanRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    try { chanRef.current = new BroadcastChannel(`draft:${league}`); }
    catch { chanRef.current = null; }
    const onStorage = (ev: StorageEvent | { key?: string; newValue?: string }) => {
      if (ev.key !== `draft:${league}` || !ev.newValue) return;
      try {
        const s = JSON.parse(ev.newValue);
        if (typeof s.paused === 'boolean') setPaused(!!s.paused);
        if (typeof s.currentRound === 'number') setCurRound(s.currentRound);
        if (typeof s.currentPickIndex === 'number') setCurIndex(s.currentPickIndex);
        if (typeof s.pickStartedAt === 'number') setPickStartedAt(s.pickStartedAt);
        if (typeof s.remaining === 'number') setRemaining(s.remaining);
        if (typeof s.ended === 'boolean') setEnded(!!s.ended);

        // keep host and any commish-broadcasted order (not chips)
        if (s.host) {
          const prev = loadDraftState(league) || {};
          saveDraftState(league, { ...prev, host: s.host, order: Array.isArray(s.order) ? s.order : prev['order'] } as any);
          if (Array.isArray(s.order)) setSharedOrder(s.order as Address[]);
        }
      } catch {}
    };
    window.addEventListener('storage', onStorage as any);
    const ch = chanRef.current;
    if (ch) ch.onmessage = (e) => onStorage({ key: `draft:${league}`, newValue: JSON.stringify(e.data) } as any);
    return () => { window.removeEventListener('storage', onStorage as any); if (ch) ch.close(); };
  }, [league]);

  const broadcast = (patch: any) => {
    const prev = loadDraftState(league) || {};
    const next = {
      ...prev,
      ...patch,
      ...(isCommish ? { host: commissioner, order: teamOrderR1 } : {})
    };
    saveDraftState(league, next as any);
    try { localStorage.setItem(`draft:${league}`, JSON.stringify(next)); } catch {}
    const ch = chanRef.current; if (ch) ch.postMessage(next);
  };

  // Commish announces authoritative order host on mount/changes
  useEffect(() => {
    if (!isCommish) return;
    broadcast({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCommish, commissioner, teams.length, manualOrder?.length, orderMode, draftTs]);

  // helper: check if current pick is the last pick on the board
  const rounds = 15;
  const isLastPickCell = (round: number, index: number, totalTeams: number) =>
    round >= rounds && index >= (totalTeams - 1);

  // Tick the tile/large clocks
  useEffect(() => {
    if (!isLive || paused || timePerPickSeconds <= 0) return;
    const id = setInterval(() => {
      if (pickStartedAt <= 0) return;
      const left = timePerPickSeconds - (Math.floor(Date.now()/1000) - pickStartedAt);
      setRemaining(Math.max(0, left));
    }, 250);
    return () => clearInterval(id);
  }, [isLive, paused, timePerPickSeconds, pickStartedAt]);

  // When timer hits zero → advance or end
  useEffect(() => {
    if (!isLive || paused || timePerPickSeconds <= 0) return;
    if (remaining > 0) return;

    const nTeams = header.length || 1;

    if (isLastPickCell(curRound, curIndex, nTeams)) {
      handleEndDraft();
      return;
    }

    const nextIndex = (curIndex + 1) % nTeams;
    const wrap = nextIndex === 0;
    const nextRound = wrap ? curRound + 1 : curRound;

    setCurIndex(nextIndex);
    setCurRound(nextRound);

    const start = Math.floor(Date.now()/1000);
    setPickStartedAt(start);
    setRemaining(timePerPickSeconds);
    broadcast({ currentPickIndex: nextIndex, currentRound: nextRound, pickStartedAt: start, remaining: timePerPickSeconds });
  }, [remaining, isLive, paused, timePerPickSeconds, curRound, curIndex, header.length]);

  // Auto-start the first pick when live begins (don’t unpause on refresh)
  useEffect(() => {
    if (!isLive) return;
    const s = loadDraftState(league) as DraftState | null;
    if (!s || !s.startedAt) {
      const start = Math.floor(Date.now()/1000);
      setPickStartedAt(start);
      setRemaining(timePerPickSeconds);
      broadcast({ startedAt: start, pickStartedAt: start, remaining: timePerPickSeconds, currentRound: 1, currentPickIndex: 0, paused: false });
    } else if (isCommish) {
      broadcast({});
    }
  }, [isLive, isCommish, timePerPickSeconds]);

  // Pause/Resume (commissioner)
  const togglePause = () => {
    if (!isCommish || !isLive) return;
    if (paused) {
      const start = Math.floor(Date.now()/1000) - (timePerPickSeconds - remaining);
      setPickStartedAt(start);
      setPaused(false);
      broadcast({ paused: false, pickStartedAt: start });
    } else {
      setPaused(true);
      broadcast({ paused: true, remaining });
    }
  };

  /* snake + R3 reversal */
  const isSnakeLike = draftType === 0 || draftType === 2;
  const reverseRound = (r: number) => {
    if (!isSnakeLike) return false;
    return thirdRoundReversal ? (r < 3 ? (r % 2 === 0) : (r % 2 === 1)) : (r % 2 === 0);
  };

  // Which visible column is "on the clock" this round?
  const currentCol = useMemo(() => {
    if (!isSnakeLike) return curIndex;
    return reverseRound(curRound) ? (header.length - 1) - curIndex : curIndex;
  }, [curIndex, curRound, header.length, isSnakeLike]);

  // Next pick (visible coordinates)
  const nextPickInfo = (() => {
    const n = header.length || 1;
    const nextI = (curIndex + 1) % n;
    const wrap = nextI === 0;
    const r = wrap ? curRound + 1 : curRound;
    const col = isSnakeLike
      ? (reverseRound(r) ? (n - 1) - nextI : nextI)
      : nextI;
    return { round: r, colVisible: col };
  })();

  // arrow direction relative to visible grid
  type ArrowDir = 'left' | 'right' | 'down' | null;
  function arrowDirection(): ArrowDir {
    if (!isLive || ended) return null;
    const colNext = nextPickInfo.colVisible;
    if (nextPickInfo.round > curRound) return 'down';
    if (colNext > currentCol) return 'right';
    if (colNext < currentCol) return 'left';
    return null;
  }

  // Next pick owner (for side tile)
  const nextPick = (() => {
    const n = header.length || 1;
    if (ended) return { round: curRound, pickInRound: currentCol + 1, owner: undefined as Address | undefined, name: '—' };
    const np = nextPickInfo;
    const h = header[np.colVisible];
    const pickInRound = np.colVisible + 1;
    return { round: np.round, pickInRound, owner: h?.owner, name: h?.name || '—' };
  })();

  // My team
  const me = teams.find(t => wallet && t.owner.toLowerCase() === wallet.toLowerCase());
  const myProf = useTeamProfile(league, (wallet as Address) || undefined, { name: me?.name || 'My Team' });
  const myCol = useMemo(() => {
    if (!wallet) return -1;
    return header.findIndex(h => h.owner?.toLowerCase() === wallet.toLowerCase());
  }, [wallet, header]);

  /* tabs & settings modal */
  type Tab = 'draft' | 'queue' | 'history' | 'team' | 'all';
  const [tab, setTab] = useState<Tab>('draft');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Pre-draft countdown
  const secsUntilStart = Math.max(0, startAt - now);
  const preDraftLobby = !isLive && startAt > 0 && !ended;

  // Helpers
  const pickLabelFor = (round: number, col: number, n: number) =>
    `${round}.${reverseRound(round) ? (n - col) : (col + 1)}`;
  const isCurrentHeader = (col: number) => isLive && (col === currentCol) && !paused;
  const cellIsCurrent = (round: number, col: number) => isLive && round === curRound && col === currentCol;

  // Reversal highlight: ONLY the true reversal entry (round 3, pick 1 visible)
  function isTrueReversalCell(round: number, col: number, n: number): boolean {
    if (!thirdRoundReversal || !isSnakeLike) return false;
    if (round !== 3) return false;
    const firstVisibleCol = reverseRound(3) ? (n - 1) : 0;
    return col === firstVisibleCol;
  }

  function handleEndDraft() {
    setEnded(true);
    setPaused(true);
    broadcast({ ended: true, paused: true });
    setShowEndModal(true);
    attemptAutoFinalizeOnChain();
  }

  function exportDraftCSV() {
    const s = loadDraftState(league);
    const picks = (s?.picks || []) as Array<{ overall?: number; round: number; pickInRound?: number; slot?: number; owner: Address; player?: string }>;
    const withNums = picks.map((p, i) => ({
      overall: p.overall ?? (i + 1),
      round: p.round,
      pickInRound: p.pickInRound ?? p.slot ?? 0,
      owner: p.owner,
      player: p.player ?? ''
    })).sort((a,b)=> (a.overall - b.overall));
    const headerRow = 'Overall,Round,PickInRound,Owner,Player\n';
    const rows = withNums.map(p =>
      `${p.overall},${p.round},${p.pickInRound},"${p.owner}","${p.player.replace(/"/g,'""')}"`
    ).join('\n');
    const blob = new Blob([headerRow + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${league}-draft-results.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function attemptAutoFinalizeOnChain() {
    console.warn('[Draft] Auto-finalize on-chain stub called.');
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 to-black text-white px-4 sm:px-6 py-4">
      {/* Title + Team pill (top-right) */}
      <div className="relative mb-3">
        <h1 className="text-center text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight" style={{ color: ZIMA }}>
          <span className="block lg:inline">{leagueName} </span>
          <span className="block lg:inline uppercase">DRAFT ROOM</span>
        </h1>
        <div className="absolute right-0 top-0">
          <Link
            href={`/league/${league}/my-team`}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm hover:border-white/30"
            title="My Team"
          >
            {myProf.logo && <img src={myProf.logo} alt={myProf.name || 'My Team'} className="h-6 w-6 rounded-xl border border-white/20 object-cover" />}
            <div className="leading-tight text-left">
              <div className="font-medium">{myProf.name || 'My Team'}</div>
              {wallet && <div className="text-[11px] font-mono opacity-70">{short(wallet)}</div>}
            </div>
          </Link>
        </div>
      </div>

      {/* Chips */}
      {mounted && (
        <div className="mx-auto mb-2 flex max-w-6xl flex-wrap items-center justify-center gap-2">
          <Pill>{timePerPickText}</Pill>
          <Pill>{leagueFormat}{playerPool === 'rookies' ? ' · Rookies' : playerPool === 'vets' ? ' · Veterans' : ''}</Pill>
          <Pill>
            {draftTypeLabel}
            {draftType === 1 && <span className="ml-2 rounded-md border border-white/15 bg-white/10 px-2 py-[2px] text-xs">Budget: {salaryBudget}</span>}
            {thirdRoundReversal && (draftType === 0 || draftType === 2) && (
              <span className="ml-2 rounded-md border border-white/15 bg-white/10 px-2 py-[2px] text-xs">R3 Reversal</span>
            )}
          </Pill>
          <Pill>
            Draft Start: {fmtLocal(startAt)} · {ended ? <span className="text-emerald-400">Completed</span> : (isLive ? (paused ? <span className="text-amber-300">Paused</span> : <span className="text-emerald-400">Live</span>) : (inLobbyHour ? 'Starting Soon' : 'Scheduled'))}
          </Pill>
        </div>
      )}

      {/* Pause banner */}
      {isLive && paused && (
        <div className="mx-auto mb-2 max-w-6xl rounded-xl border border-red-500/50 bg-red-500/10 px-3 py-2 text-center font-semibold" style={{ color: RED }}>
          Draft is paused — your commissioner will resume shortly.
        </div>
      )}

      {/* Top tiles (side by side) */}
      <div className="mx-auto mb-2 grid max-w-6xl grid-cols-1 gap-2 sm:grid-cols-3">
        {/* Left tile (no arrows here) */}
        <div className="rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 flex items-center justify-center">
          {ended ? (
            <div className="text-center">
              <div className="text-xl sm:text-2xl font-extrabold tracking-wide" style={{ color: EGGSHELL }}>
                DRAFT IS COMPLETE
              </div>
            </div>
          ) : (
            <div className="w-full">
              <div className="text-center text-[11px] uppercase tracking-wider text-gray-300">
                {preDraftLobby ? 'PRE DRAFT' : 'ON THE CLOCK'}
              </div>
              <div
                className="text-center text-4xl font-black tabular-nums"
                style={{
                  color: (isLive && (draftType === 0 || draftType === 2) && timePerPickSeconds > 0 && remaining <= 10) ? RED : EGGSHELL
                }}
              >
                {preDraftLobby
                  ? fmtClock(secsUntilStart)
                  : (isLive && (draftType === 0 || draftType === 2) && timePerPickSeconds > 0)
                    ? fmtClock(remaining)
                    : '—'}
              </div>
              {!preDraftLobby && isLive && (
                <div className="mt-2 text-center font-semibold" style={{ color: ZIMA }}>
                  {header[currentCol]?.name || '—'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Most Recent */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div className="text-center">
            <div className="mb-1 font-semibold" style={{ color: ZIMA }}>Most Recent Pick</div>
            {(() => {
              const s = loadDraftState(league);
              const rp = s?.recentPick as any;
              if (!rp) return <div className="opacity-70 text-center">No picks yet.</div>;
              return (
                <div className="inline-flex flex-wrap items-center justify-center gap-2">
                  <span className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 font-mono">#{rp.overall} ({rp.round}.{rp.pickInRound})</span>
                  <span className="font-semibold">{rp.playerName}</span>
                  <span className="opacity-80">{rp.playerTeam} · {rp.position}</span>
                  <span className="opacity-80">by</span>
                  <TeamInline league={league} owner={rp.owner} />
                </div>
              );
            })()}
          </div>
        </div>

        {/* Next Pick */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div className="text-center">
            <div className="mb-1 font-semibold" style={{ color: ZIMA }}>Next Pick</div>
            <div className="inline-flex items-center gap-2">
              <span className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 font-mono" style={{ color: ZIMA }}>
                {preDraftLobby ? 'Round 1 Pick 1' : ended ? '—' : `Round ${nextPick.round} Pick ${nextPick.pickInRound}`}
              </span>
            </div>
            <div className="mt-1 text-center">
              <TeamInline
                league={league}
                owner={preDraftLobby ? header[0]?.owner || ZERO : (nextPick.owner || ZERO)}
                labelOverride={preDraftLobby ? (header[0]?.name || '—') : (ended ? '—' : nextPick.name)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs row (no outer box) */}
      <div className="mx-auto mb-3 flex max-w-6xl flex-wrap items-center justify-center gap-2">
        {(['draft','queue','history','team','all'] as const).map(k => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-2xl px-3 py-1.5 text-sm transition border ${tab === k ? 'bg-white/10' : 'hover:bg-white/5'}`}
            style={{ color: EGGSHELL, borderColor: k === 'draft' ? ZIMA : 'rgba(255,255,255,.16)' }}
          >
            {k === 'draft' ? 'Draft' : k === 'queue' ? 'Queue' : k === 'history' ? 'History' : k === 'team' ? 'Team' : 'All Teams'}
          </button>
        ))}
        <button
          onClick={() => setSettingsOpen(true)}
          className="rounded-2xl border border-white/15 bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
          title="Draft Settings"
          style={{ color: EGGSHELL }}
        >
          Settings
        </button>
        {isCommish && isLive && (
          <button
            onClick={togglePause}
            className={`rounded-2xl px-3 py-1.5 text-sm font-semibold ${paused ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}
          >
            {paused ? 'Resume Draft' : 'Pause Draft'}
          </button>
        )}
      </div>

      {/* Panels */}
      {tab === 'draft' && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="overflow-x-auto">
            {/* header row */}
            <div className="grid gap-3 min-w-max" style={{ gridTemplateColumns: `repeat(${header.length}, minmax(160px,1fr))` }}>
              {header.map((h, i) => {
                const mine = myCol >= 0 && i === myCol;
                return (
                  <div
                    key={`${h.owner}-${i}`}
                    className="rounded-2xl border px-3 py-3 text-center"
                    style={{
                      borderColor: mine ? EGGSHELL : (isCurrentHeader(i) ? 'rgba(240,234,214,0.40)' : 'rgba(255,255,255,.10)'),
                      background: mine ? 'rgba(240,234,214,0.08)' : (isCurrentHeader(i) ? 'rgba(240,234,214,0.10)' : 'rgba(0,0,0,.30)')
                    }}
                  >
                    <HeaderCell league={league} owner={h.owner} name={h.name} />
                  </div>
                );
              })}
            </div>

            {/* board */}
            <div className="mt-3 space-y-3 min-w-max">
              {Array.from({ length: rounds }, (_, r) => r + 1).map((round) => (
                <div
                  key={`round-${round}`}
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(${header.length}, minmax(160px,1fr))` }}
                >
                  {header.map((_, col) => {
                    const isCur = cellIsCurrent(round, col);
                    const showTimer = isCur && timePerPickSeconds > 0 && (draftType === 0 || draftType === 2) && !ended;
                    const n = header.length;

                    const trueReversal = isTrueReversalCell(round, col, n);

                    const borderColor = isCur ? ZIMA : (trueReversal ? ORANGE : 'rgba(255,255,255,.10)');
                    const background = isCur ? 'rgba(55,192,246,0.10)' : 'rgba(0,0,0,.40)';

                    const dir = isCur ? arrowDirection() : null;

                    return (
                      <div
                        key={`cell-${round}-${col}`}
                        className="relative h-16 rounded-2xl border grid place-items-center text-sm"
                        style={{ borderColor, background }}
                      >
                        {showTimer ? (
                          <span className="inline-flex items-center gap-1">
                            {dir === 'left' && <span className="text-xs font-semibold" style={{ color: ZIMA }}>←</span>}
                            <span
                              className="rounded px-2 py-[3px] text-[13px] font-mono"
                              style={{
                                color: (remaining <= 10 ? RED : EGGSHELL),
                                background: 'rgba(255,255,255,.08)'
                              }}
                            >
                              {fmtClock(remaining)}
                            </span>
                            {dir === 'right' && <span className="text-xs font-semibold" style={{ color: ZIMA }}>→</span>}
                          </span>
                        ) : (
                          <span className="text-gray-300">
                            {pickLabelFor(round, col, header.length)}
                          </span>
                        )}

                        {isCur && dir === 'down' && (
                          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs font-semibold" style={{ color: ZIMA }}>↓</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === 'queue' && (
        <Section title="Queue" center>
          <p className="text-sm text-gray-300 text-center">Your queued players will appear here.</p>
        </Section>
      )}

      {tab === 'history' && (
        <Section title="History" center>
          <p className="text-sm text-gray-300 text-center">No picks have been made yet.</p>
        </Section>
      )}

      {tab === 'team' && (
        <Section title="My Team" center>
          <p className="text-sm text-gray-300 text-center">Your drafted players will appear here.</p>
        </Section>
      )}

      {tab === 'all' && (
        <Section title="All Teams" center>
          <AllTeamsPanel league={league} header={header} teams={teams} />
        </Section>
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          startAt={startAt}
          isManual={!!(manualOrder && manualOrder.length)}
          order={header.map(h => h.name)}
          draftTypeLabel={draftTypeLabel}
          playerPoolLabel={playerPool === 'rookies' ? 'Rookies' : playerPool === 'vets' ? 'Veterans' : 'All Players'}
          timePerPickText={timePerPickText}
          trr={thirdRoundReversal}
          pickTrading={false}
        />
      )}

      {/* End-of-draft modal */}
      {showEndModal && (
        <EndDraftModal
          league={league}
          ownerAddress={(wallet as string) || undefined}
          onClose={() => setShowEndModal(false)}
          onExportCSV={exportDraftCSV}
        />
      )}
    </main>
  );
}

/* ---------- UI bits ---------- */
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex h-9 items-center rounded-2xl border px-3 text-sm"
      style={{ borderColor: 'rgba(255,255,255,.16)', background: 'rgba(255,255,255,.06)', color: EGGSHELL }}
    >
      {children}
    </span>
  );
}
function Section({ title, center, children }: { title: string; center?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className={['mb-2 text-sm uppercase tracking-[0.15em]', center ? 'text-center' : ''].join(' ')} style={{ color: ZIMA }}>
        {title}
      </div>
      {children}
    </section>
  );
}
function HeaderCell({ league, owner, name }: { league: Address; owner: Address; name: string }) {
  const p = owner === ZERO ? { name, logo: undefined } : useTeamProfile(league, owner, { name });
  return (
    <div className="flex items-center justify-center gap-2 truncate">
      {p.logo && <img src={p.logo} alt={p.name || 'Team'} className="h-6 w-6 rounded-xl border border-white/20 object-cover shrink-0" />}
      <div className="truncate text-center">{p.name || name}</div>
    </div>
  );
}
function TeamInline({ league, owner, labelOverride }: { league: Address; owner: Address; labelOverride?: string }) {
  const p = owner ? useTeamProfile(league, owner, { name: labelOverride || `${owner.slice(0,6)}…${owner.slice(-4)}` }) : { name: labelOverride, logo: undefined };
  return (
    <span className="inline-flex items-center gap-2">
      {p.logo && <img src={p.logo} className="h-4 w-4 rounded-xl border border-white/20 object-cover" alt={p.name || 'Team'} />}
      <span>{labelOverride || p.name}</span>
    </span>
  );
}

/* ---- All Teams panel (team name + logo only) ---- */
function AllTeamsPanel({ league, header }: {
  league: Address;
  header: { owner: Address; name: string }[];
  teams: Team[];
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const state = loadDraftState(league);
  const picks = (state?.picks || []) as { round: number; slot: number; owner: Address; player?: string }[];

  const picksByOwner = useMemo(() => {
    const m = new Map<Address, { round: number; slot: number; player?: string }[]>();
    picks.forEach(p => {
      const arr = m.get(p.owner) || [];
      arr.push({ round: p.round, slot: p.slot, player: p.player });
      m.set(p.owner, arr);
    });
    return m;
  }, [picks]);

  const activeOwner = header[activeIdx]?.owner || ZERO;
  const activeName = header[activeIdx]?.name || `Team ${activeIdx + 1}`;
  const activePicks = picksByOwner.get(activeOwner) || [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
        {header.map((h, i) => {
          const p = h.owner === ZERO ? { name: h.name, logo: undefined } : useTeamProfile(league, h.owner, { name: h.name });
          return (
            <button
              key={`${h.owner}-${i}`}
              onClick={() => setActiveIdx(i)}
              className={`rounded-full border px-3 py-1.5 text-sm flex items-center gap-2 ${i === activeIdx ? 'bg-white/10 border-white/20' : 'hover:bg-white/5 border-white/10'}`}
            >
              {p.logo && <img src={p.logo} className="h-4 w-4 rounded-xl border border-white/20 object-cover" alt={p.name || 'Team'} />}
              <span className="truncate">{p.name || h.name}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
        <div className="mb-2 font-semibold" style={{ color: ZIMA }}>{activeName}</div>
        {activePicks.length === 0 ? (
          <div className="text-sm text-gray-300">No players drafted yet.</div>
        ) : (
          <ul className="mx-auto max-w-md space-y-1 text-sm">
            {activePicks
              .sort((a,b)=> (a.round - b.round) || (a.slot - b.slot))
              .map((p, idx) => (
                <li key={`${p.round}-${p.slot}-${idx}`} className="rounded border border-white/10 bg-black/30 px-2 py-1">
                  Round {p.round} · Pick {p.slot} — <span className="font-semibold">{p.player || 'Player'}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---- Settings modal ---- */
function SettingsModal({
  onClose, startAt, isManual, order, draftTypeLabel, playerPoolLabel, timePerPickText, trr, pickTrading,
}: {
  onClose: () => void;
  startAt: number;
  isManual: boolean;
  order: string[];
  draftTypeLabel: string;
  playerPoolLabel: string;
  timePerPickText: string;
  trr: boolean;
  pickTrading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/12 bg-[#0b0b12] p-6 shadow-2xl">
        <button
          className="absolute right-3 top-3 rounded-md border border-white/15 bg-white/10 px-2 py-1 text-sm hover:bg-white/15"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>

        <div className="mb-4 text-center text-lg font-bold" style={{ color: ZIMA }}>Draft Settings</div>

        <div className="space-y-2 text-sm">
          <Row k="Start" v={fmtLocal(startAt)} />
          <Row k="Type" v={draftTypeLabel} />
          <Row k="Player Pool" v={playerPoolLabel} />
          <Row k="Time per Pick" v={timePerPickText} />
          <Row k="Third Round Reversal" v={trr ? 'On' : 'Off'} />
          <Row k="Pick Trading" v={pickTrading ? 'Enabled' : 'Disabled'} />
          <Row k="Order Mode" v={isManual ? 'Manual' : 'Random'} />
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs uppercase tracking-wider text-gray-300 text-center">Draft Order</div>
          <ol className="space-y-1 text-center">
            {order.map((name, i) => (
              <li key={`${name}-${i}`} className="text-white/90">
                {i + 1}. {name}
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-5 flex justify-center">
          <button onClick={onClose} className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 hover:bg-white/15">Close</button>
        </div>
      </div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-gray-300">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}

/* ---- End-of-draft modal ---- */
function EndDraftModal({ league, ownerAddress, onClose, onExportCSV }: {
  league: Address;
  ownerAddress?: string;
  onClose: () => void;
  onExportCSV: () => void;
}) {
  const teamHref = ownerAddress ? `/league/${league}/team/${ownerAddress}` : `/league/${league}`;
  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/12 bg-[#0b0b12] p-6 shadow-2xl text-center">
        <button
          className="absolute right-3 top-3 rounded-md border border-white/15 bg-white/10 px-2 py-1 text-sm hover:bg-white/15"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
        <div className="text-xl font-bold mb-2" style={{ color: ZIMA }}>Thanks for drafting!</div>
        <p className="text-sm text-gray-300 mb-5">
          Your draft is complete. Teams and results will finalize automatically.
        </p>
        <div className="flex flex-col gap-2">
          <div className="flex justify-center gap-2">
            <Link
              href={teamHref}
              className="rounded-xl px-4 py-2 font-semibold"
              style={{ background: ZIMA, color: '#001018' }}
            >
              My Team
            </Link>
            <Link
              href={`/league/${league}`}
              className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 hover:bg-white/15"
            >
              League Home
            </Link>
          </div>
          <button
            onClick={onExportCSV}
            className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 hover:bg-white/15"
            title="Export Draft Results (CSV)"
          >
            Export to CSV
          </button>
        </div>
      </div>
    </div>
  );
}
