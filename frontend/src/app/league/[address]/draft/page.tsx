// src/app/league/[address]/draft/page.tsx
'use client';

import {
  loadDraftState,
  saveDraftState,
  type DraftState,
} from '@/lib/draft-storage';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import { useTeamProfile } from '@/lib/teamProfile';

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
  // authoritative chips
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
  const sec = Math.max(0, Math.ceil(s)); // ceil to eliminate flicker
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

function fmtLocal(ts: number) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const date = d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  const tz = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(d).find(p => p.type === 'timeZoneName')?.value || '';
  return `${date} - ${time} ${tz}`;
}

// deterministic shuffle
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

/* simple CSV parser for the bottom drawer */
type PlayerRow = { rank: number; name: string; position: string; team: string };
async function fetchTop300(): Promise<PlayerRow[]> {
  const resp = await fetch('/hashmark-top300.csv', { cache: 'no-store' });
  const text = await resp.text();
  const lines = text.trim().split(/\r?\n/);
  // expect header: rank,name,position,team (case-insensitive)
  const body = lines.slice(1);
  return body
    .map((ln) => {
      const parts = ln.split(',').map(s => s.trim());
      return { rank: Number(parts[0]), name: parts[1], position: parts[2], team: parts[3] } as PlayerRow;
    })
    .filter(p => !!p.name);
}

export default function DraftRoom() {
  const { address: league } = useParams<{ address: Address }>();
  const search = useSearchParams();
  const router = useRouter();
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

  // authoritative chips
  const extras = extrasRes.data as undefined | {
    timePerPickSeconds: number; thirdRoundReversal: boolean; salaryCapBudget: number; playerPool: number;
  };

  const timePerPickSeconds = extras ? Number(extras.timePerPickSeconds || 0) : 60;
  const thirdRoundReversal = !!extras?.thirdRoundReversal;
  const salaryBudget = extras ? Number(extras.salaryCapBudget || 400) : 400;
  const playerPool = (extras?.playerPool === 1 ? 'rookies' : extras?.playerPool === 2 ? 'vets' : 'all') as 'all'|'rookies'|'vets';

  const leagueFormat = 'Redraft'; // placeholder
  const draftTypeLabel = ['Snake', 'Salary Cap', 'Autopick', 'Offline'][draftType] || 'Snake';
  const timePerPickText = timeLabel(timePerPickSeconds);

  /* ----- ORDER ----- */
  const [sharedOrder, setSharedOrder] = useState<Address[]>(() => {
    const boot = loadDraftState(league) as any;
    return Array.isArray(boot?.order) ? (boot.order as Address[]) : [];
  });

  const teamOrderR1 = useMemo<Address[]>(() => {
    if (Array.isArray(manualOrder) && manualOrder.some(a => a && a !== ZERO)) {
      const base = manualOrder.filter(Boolean) as Address[];
      while (base.length < teams.length) base.push(ZERO);
      return base;
    }
    const boot = loadDraftState(league) as any;
    const host = boot?.host as string | undefined;
    if (sharedOrder.length && host && host.toLowerCase() === commissioner) return [...sharedOrder];

    if (orderMode === 0) {
      const owners = teams.map(t => t.owner);
      const leaguePart = typeof league === 'string' && league.length >= 10 ? parseInt(league.slice(2, 10), 16) : 0;
      const tsPart = Number(draftTs ? Number(draftTs) & 0xffffffff : 0);
      const seed = (leaguePart ^ tsPart) >>> 0;
      const shuffled = seededShuffle(owners, seed);
      while (shuffled.length < teams.length) shuffled.push(ZERO);
      return shuffled;
    }

    const joined = teams.map(t => t.owner);
    while (joined.length < teams.length) joined.push(ZERO);
    return joined;
  }, [manualOrder, sharedOrder, teams, orderMode, league, draftTs, commissioner]);

  const header = useMemo(() => teamOrderR1.map((owner, i) => {
    const t = teams.find(tt => tt.owner?.toLowerCase() === owner?.toLowerCase());
    return { owner, name: t?.name || (owner === ZERO ? `Team ${i+1}` : `${owner.slice(0,6)}…${owner.slice(-4)}`) };
  }), [teamOrderR1, teams]);

  /* clocks & sync */
  const startAt = Number(draftTs) || 0;
  const [now, setNow] = useState(() => Math.floor(Date.now()/1000));
  useEffect(() => { const id = setInterval(() => setNow(Math.floor(Date.now()/1000)), 1000); return () => clearInterval(id); }, []);
  const isLiveByTime = startAt > 0 && now >= startAt && !draftCompleted;

  // Grace is 180s once scheduled start time hits
  const graceSecs = Math.max(0, isLiveByTime ? 180 - (now - startAt) : 0);
  const inGrace = isLiveByTime && graceSecs > 0;

  // BEFORE REAL START = before or during grace
  const beforeRealStart = startAt > 0 && (now < startAt + 180);

  // local persisted state
  const boot = (): Partial<DraftState & {
    remaining?: number;
    ended?: boolean;
    order?: Address[];
    host?: string;
    recentPick?: any;
  }> => loadDraftState(league) || {};

  const [paused, setPaused] = useState<boolean>(() => !!boot().paused);
  const [curRound, setCurRound] = useState<number>(() => boot().currentRound || 1);
  const [curIndex, setCurIndex] = useState<number>(() => boot().currentPickIndex || 0);
  const [pickStartedAt, setPickStartedAt] = useState<number>(() => boot().startedAt || 0);
  const [remaining, setRemaining] = useState<number>(() => (boot() as any).remaining ?? timePerPickSeconds); // snapshot only when paused
  const [ended, setEnded] = useState<boolean>(() => !!(boot() as any).ended);
  const [showEndModal, setShowEndModal] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState(false);

  const isLive = isLiveByTime && !ended && !inGrace; // picks start after grace

  // compute remaining for display — **never** trust inbound "remaining" while not paused
  const derivedRemaining = (!isLive || paused || timePerPickSeconds <= 0 || pickStartedAt <= 0)
    ? remaining
    : Math.max(0, timePerPickSeconds - (now - pickStartedAt));

  // broadcast + storage + polling fallback
  const chanRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    try { chanRef.current = new BroadcastChannel(`draft:${league}`); }
    catch { chanRef.current = null; }

    const syncFrom = (raw?: string) => {
      if (!raw) return;
      try {
        const s = JSON.parse(raw);
        if (typeof s.paused === 'boolean') setPaused(!!s.paused);
        if (typeof s.currentRound === 'number') setCurRound(s.currentRound);
        if (typeof s.currentPickIndex === 'number') setCurIndex(s.currentPickIndex);
        if (typeof s.pickStartedAt === 'number') setPickStartedAt(s.pickStartedAt);
        // ⚠️ do NOT overwrite `remaining` unless paused snapshot; prevents oscillation
        if (typeof s.remaining === 'number' && s.paused) setRemaining(s.remaining);
        if (typeof s.ended === 'boolean') setEnded(!!s.ended);
        if (s.host) {
          const prev = loadDraftState(league) || {};
          saveDraftState(league, { ...prev, host: s.host, order: Array.isArray(s.order) ? s.order : prev['order'] } as any);
          if (Array.isArray(s.order)) setSharedOrder(s.order as Address[]);
        }
      } catch {}
    };

    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== `draft:${league}` || !ev.newValue) return;
      syncFrom(ev.newValue);
    };
    window.addEventListener('storage', onStorage);

    const ch = chanRef.current;
    if (ch) ch.onmessage = (e) => syncFrom(JSON.stringify(e.data));

    // fallback polling
    const poll = setInterval(() => {
      try {
        const raw = localStorage.getItem(`draft:${league}`);
        if (raw) syncFrom(raw);
      } catch {}
    }, 750);

    return () => {
      window.removeEventListener('storage', onStorage);
      if (ch) ch.close();
      clearInterval(poll);
    };
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

  // Commish announces host/order on changes
  useEffect(() => {
    if (!isCommish) return;
    broadcast({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCommish, commissioner, teams.length, manualOrder?.length, orderMode, draftTs]);

  const rounds = 15;
  const isLastPickCell = (round: number, index: number, totalTeams: number) =>
    round >= rounds && index >= (totalTeams - 1);

  // tick: only updates `now`; display uses derivedRemaining
  // (handled above by the 1s now-timer)

  // advance on zero
  useEffect(() => {
    if (!isLive || paused || timePerPickSeconds <= 0) return;
    if (derivedRemaining > 0) return;

    advancePick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedRemaining, isLive, paused, timePerPickSeconds]);

  function advancePick() {
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
    setRemaining(timePerPickSeconds); // base snapshot if we pause later
    broadcast({ currentPickIndex: nextIndex, currentRound: nextRound, pickStartedAt: start });
  }

  // auto-start after grace ends
  useEffect(() => {
    if (!isLive) return; // still in grace or ended
    const s = loadDraftState(league) as DraftState | null;
    if (!s || !s.startedAt) {
      const start = Math.floor(Date.now()/1000);
      setPickStartedAt(start);
      setRemaining(timePerPickSeconds);
      broadcast({ startedAt: start, pickStartedAt: start, currentRound: 1, currentPickIndex: 0, paused: false });
    } else if (isCommish) {
      broadcast({});
    }
  }, [isLive, isCommish, timePerPickSeconds]);

  // Pause/Resume (commissioner only)
  const togglePause = () => {
    if (!isCommish) return;
    if (paused) {
      // resume: recompute pickStartedAt so derivedRemaining continues smoothly
      const start = Math.floor(Date.now()/1000) - (timePerPickSeconds - remaining);
      setPickStartedAt(start);
      setPaused(false);
      broadcast({ paused: false, pickStartedAt: start });
    } else {
      const snap = derivedRemaining;
      setRemaining(snap);
      setPaused(true);
      broadcast({ paused: true, remaining: snap });
    }
  };

  /* snake + R3 reversal */
  const isSnakeLike = draftType === 0 || draftType === 2;
  const reverseRound = (r: number) => {
    if (!isSnakeLike) return false;
    return thirdRoundReversal ? (r < 3 ? (r % 2 === 0) : (r % 2 === 1)) : (r % 2 === 0);
  };

  const currentCol = useMemo(() => {
    if (!isSnakeLike) return curIndex;
    return reverseRound(curRound) ? (header.length - 1) - curIndex : curIndex;
  }, [curIndex, curRound, header.length, isSnakeLike]);

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

  type ArrowDir = 'left' | 'right' | 'down' | null;
  function arrowDirection(): ArrowDir {
    if (!isLive || ended) return null;
    const colNext = nextPickInfo.colVisible;
    if (nextPickInfo.round > curRound) return 'down';
    if (colNext > currentCol) return 'right';
    if (colNext < currentCol) return 'left';
    return null;
  }

  const nextPick = (() => {
    if (ended) return { round: curRound, pickInRound: currentCol + 1, owner: undefined as Address | undefined, name: '—' };
    const np = nextPickInfo;
    const h = header[np.colVisible];
    const pickInRound = np.colVisible + 1;
    return { round: np.round, pickInRound, owner: h?.owner, name: h?.name || '—' };
  })();

  // me pill
  const me = teams.find(t => wallet && t.owner.toLowerCase() === wallet.toLowerCase());
  const myProf = useTeamProfile(league, (wallet as Address) || ZERO, { name: me?.name || 'My Team' });
  const myCol = useMemo(() => {
    if (!wallet) return -1;
    return header.findIndex(h => h.owner?.toLowerCase() === wallet.toLowerCase());
  }, [wallet, header]);

  /* tabs via query */
  type Tab = 'draft' | 'queue' | 'history' | 'team' | 'all';
  const initialTab = (search.get('tab') as Tab) || 'draft';
  const [tab, setTab] = useState<Tab>(initialTab);

  // keep internal tab in sync with URL (fixes “click does nothing”)
  useEffect(() => {
    const qTab = (search.get('tab') as Tab) || 'draft';
    if (qTab !== tab) setTab(qTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    const q = new URLSearchParams(search);
    q.set('tab', tab);
    router.replace(`?${q.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const selectedOwnerFromQuery = (search.get('team') || '').toLowerCase();

  /* helpers */
  const pickLabelFor = (round: number, col: number, n: number) =>
    `${round}.${reverseRound(round) ? (n - col) : (col + 1)}`;
  const isCurrentHeader = (col: number) => isLive && (col === currentCol) && !paused;
  const cellIsCurrent = (round: number, col: number) => isLive && round === curRound && col === currentCol;

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

  /* drafting from the bottom drawer */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [playerList, setPlayerList] = useState<PlayerRow[]>([]);
  useEffect(() => {
    fetchTop300().then(setPlayerList).catch(() => setPlayerList([]));
  }, []);

  function handleDraftPlayer(p: PlayerRow) {
    if (!isLive || paused || !nextPick.owner) return;

    const st = loadDraftState(league);
    const picks = (st?.picks || []) as any[];

    const overall = picks.length + 1;
    const pick = {
      overall,
      round: nextPick.round,
      pickInRound: nextPick.pickInRound,
      slot: nextPick.pickInRound,
      owner: nextPick.owner as Address,
      player: p.name,
      playerName: p.name,
      playerTeam: p.team,
      position: p.position,
    };

    const next = {
      ...(st || {}),
      picks: [...picks, pick],
      recentPick: pick,
    } as any;

    saveDraftState(league, next);
    try { localStorage.setItem(`draft:${league}`, JSON.stringify(next)); } catch {}
    const ch = chanRef.current; if (ch) ch.postMessage(next);

    // remove from drawer
    setPlayerList(prev => prev.filter(x => x.name !== p.name));

    // advance pick and restart clock
    advancePick();
  }

  /* ────────────────────────────── UI ────────────────────────────── */

  // phase pill helper
  const phasePill = (() => {
    if (ended) return <StatePill color="DONE">Completed</StatePill>;
    if (paused) return <StatePill color="PAUSED">Paused</StatePill>;
    if (beforeRealStart) return <StatePill color={inGrace ? 'GRACE' : 'SOON'}>{inGrace ? 'Grace' : 'Starting Soon'}</StatePill>;
    return <StatePill color="LIVE">Live</StatePill>;
  })();

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 to-black text-white px-4 sm:px-6 py-4 pb-24">
      {/* Title + My Team pill */}
      <div className="relative mb-3">
        <h1 className="text-center text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight" style={{ color: ZIMA }}>
          <span className="block lg:inline">{leagueName} </span>
          <span className="block lg:inline uppercase">DRAFT ROOM</span>
        </h1>

        <div className="absolute right-0 top-0">
          <Link
            href={`/league/${league}/my-team`}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm no-underline hover:bg-white/10"
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

      {/* Tabs + controls row (in one line) */}
      <div className="mx-auto mb-3 flex max-w-6xl flex-wrap items-center gap-2">
        {(['draft','queue','history','team','all'] as const).map(k => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-2xl px-3 py-1.5 text-sm transition border ${tab === k ? 'bg-white/10' : 'hover:bg-white/5'}`}
            style={{ color: EGGSHELL, borderColor: k === 'draft' ? ZIMA : 'rgba(255,255,255,.16)' }}
          >
            {k === 'draft' ? 'Draft' : k === 'queue' ? 'Queue' : k === 'history' ? 'History' : k === 'team' ? 'My Team' : 'All Teams'}
          </button>
        ))}

        {/* Right side actions */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-lg border px-3 py-1.5 text-sm no-underline hover:bg-white/10"
            title="Draft Settings"
          >
            Settings
          </button>
          {phasePill}
          {isCommish && (
            <button
              onClick={togglePause}
              className={`rounded-lg border px-3 py-1.5 text-sm no-underline ${paused ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-700/50' : 'bg-amber-600 hover:bg-amber-700 border-amber-700/50'}`}
              title={paused ? 'Resume Draft' : 'Pause Draft'}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
          )}
        </div>
      </div>

      {/* Paused banner */}
      {paused && !ended && (
        <div className="mx-auto mb-2 max-w-6xl rounded-md border border-red-600/40 bg-red-900/20 text-red-200 px-3 py-2 text-sm text-center">
          The draft is paused by the commissioner.
        </div>
      )}

      {/* Top tiles */}
      <div className="mx-auto mb-2 grid max-w-6xl grid-cols-1 gap-2 sm:grid-cols-3">
        {/* Left tile: PRE DRAFT / GRACE PERIOD / ON THE CLOCK */}
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
                {beforeRealStart ? (inGrace ? 'GRACE PERIOD' : 'PRE DRAFT') : 'ON THE CLOCK'}
              </div>
              <div
                className={`text-center font-black tabular-nums ${beforeRealStart ? 'text-5xl' : 'text-3xl'}`}
                style={{
                  color: beforeRealStart
                    ? (inGrace ? (graceSecs <= 60 ? RED : EGGSHELL) : EGGSHELL)
                    : (isLive && (draftType === 0 || draftType === 2) && timePerPickSeconds > 0 && derivedRemaining <= 60) ? RED : EGGSHELL
                }}
              >
                {beforeRealStart
                  ? fmtClock(inGrace ? graceSecs : Math.max(0, Number(draftTs) - now))
                  : (isLive && (draftType === 0 || draftType === 2) && timePerPickSeconds > 0)
                    ? fmtClock(derivedRemaining)
                    : '—'}
              </div>
              {!beforeRealStart && isLive && (
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
              const href = `/league/${league}/draft?tab=all&team=${(rp.owner as string) || ''}`;
              return (
                <div className="inline-flex flex-wrap items-center justify-center gap-2">
                  <span className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 font-mono">#{rp.overall} ({rp.round}.{rp.pickInRound ?? rp.slot})</span>
                  <span className="font-semibold">{rp.playerName ?? rp.player}</span>
                  <span className="opacity-80">{rp.playerTeam} · {rp.position}</span>
                  <span className="opacity-80">by</span>
                  <Link href={href} className="no-underline hover:bg-white/10 rounded px-1">
                    <TeamInline league={league} owner={rp.owner} />
                  </Link>
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
                {beforeRealStart ? 'Round 1 Pick 1' : ended ? '—' : `Round ${nextPick.round} Pick ${nextPick.pickInRound}`}
              </span>
            </div>
            <div className="mt-1 text-center">
              {(() => {
                const owner = beforeRealStart ? header[0]?.owner || ZERO : (nextPick.owner || ZERO);
                const label = beforeRealStart ? (header[0]?.name || '—') : (ended ? '—' : nextPick.name);
                const href = `/league/${league}/draft?tab=all&team=${owner}`;
                return owner && owner !== ZERO ? (
                  <Link href={href} className="no-underline hover:bg-white/10 rounded px-1">
                    <TeamInline league={league} owner={owner} labelOverride={label} />
                  </Link>
                ) : (
                  <TeamInline league={league} owner={owner} labelOverride={label} />
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Panels */}
      {tab === 'draft' && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="overflow-x-auto">
            {/* header row: each cell name links to All Teams view */}
            <div className="grid gap-3 min-w-max" style={{ gridTemplateColumns: `repeat(${header.length}, minmax(160px,1fr))` }}>
              {header.map((h, i) => {
                const mine = myCol >= 0 && i === myCol;
                const wrapperStyle = {
                  borderColor: mine ? EGGSHELL : (isCurrentHeader(i) ? 'rgba(240,234,214,0.40)' : 'rgba(255,255,255,.10)'),
                  background: mine ? 'rgba(240,234,214,0.08)' : (isCurrentHeader(i) ? 'rgba(240,234,214,0.10)' : 'rgba(0,0,0,.30)')
                } as const;

                return (
                  <div key={`${h.owner}-${i}`} className="rounded-2xl border px-3 py-3 text-center" style={wrapperStyle}>
                    {h.owner && h.owner !== ZERO
                      ? <Link
                          href={`?tab=all&team=${h.owner}`}
                          className="block no-underline hover:bg-white/5 rounded"
                        >
                          <HeaderCell league={league} owner={h.owner} name={h.name} />
                        </Link>
                      : <HeaderCell league={league} owner={h.owner} name={h.name} />}
                  </div>
                );
              })}
            </div>

            {/* board */}
            <Board
              header={header}
              rounds={rounds}
              isSnakeLike={isSnakeLike}
              reverseRound={reverseRound}
              currentCol={currentCol}
              cellIsCurrent={cellIsCurrent}
              arrowDirection={arrowDirection}
              timePerPickSeconds={timePerPickSeconds}
              draftType={draftType}
              ended={ended}
              remaining={derivedRemaining}
              isTrueReversalCell={isTrueReversalCell}
              pickLabelFor={pickLabelFor}
            />
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
          <AllTeamsPanel
            league={league}
            header={header}
            selectedOwnerLower={selectedOwnerFromQuery}
            onSelectOwner={(owner) => {
              const q = new URLSearchParams(search);
              q.set('tab', 'all');
              if (owner) q.set('team', owner);
              router.replace(`?${q.toString()}`, { scroll: false });
            }}
          />
        </Section>
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

      {/* Settings modal (centered; shows order; budget only if auction) */}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          summary={{
            timePerPickSeconds,
            thirdRoundReversal,
            draftType,
            draftTypeLabel,
            salaryBudget,
            startAt: Number(draftTs),
            order: header, // Round 1 order
          }}
        />
      )}

      {/* Bottom Drawer: Top 300 */}
      <PlayerDrawer
        open={drawerOpen}
        onToggle={() => setDrawerOpen(v => !v)}
        players={playerList}
        onDraft={handleDraftPlayer}
      />
    </main>
  );
}

/* -------------- subcomponents -------------- */

function StatePill({ children, color }: { children: React.ReactNode; color: 'SOON'|'GRACE'|'LIVE'|'PAUSED'|'DONE' }) {
  const map = {
    SOON: 'bg-yellow-500/20 text-yellow-300 border-yellow-700/40',
    GRACE: 'bg-orange-500/20 text-orange-300 border-orange-700/40',
    LIVE: 'bg-emerald-500/20 text-emerald-300 border-emerald-700/40',
    PAUSED: 'bg-red-500/20 text-red-300 border-red-700/40',
    DONE: 'bg-zinc-500/20 text-zinc-200 border-zinc-700/40',
  } as const;
  return (
    <span className={`inline-flex h-9 items-center rounded-2xl border px-3 text-sm ${map[color]}`}>
      {children}
    </span>
  );
}

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
  const prof = useTeamProfile(league, owner || ZERO, { name });
  const label = prof?.name || name;
  return (
    <div className="flex items-center justify-center gap-2 truncate">
      {prof.logo && <img src={prof.logo} alt={label || 'Team'} className="h-6 w-6 rounded-xl border border-white/20 object-cover shrink-0" />}
      <div className="truncate text-center">{label}</div>
    </div>
  );
}

function TeamInline({ league, owner, labelOverride }: { league: Address; owner: Address; labelOverride?: string }) {
  const p = useTeamProfile(league, owner || ZERO, { name: labelOverride || `${owner.slice(0,6)}…${owner.slice(-4)}` });
  return (
    <span className="inline-flex items-center gap-2">
      {p.logo && <img src={p.logo} className="h-4 w-4 rounded-xl border border-white/20 object-cover" alt={p.name || 'Team'} />}
      <span>{labelOverride || p.name}</span>
    </span>
  );
}

function Board({
  header, rounds, isSnakeLike, reverseRound, currentCol, cellIsCurrent,
  arrowDirection, timePerPickSeconds, draftType, ended, remaining,
  isTrueReversalCell, pickLabelFor,
}: {
  header: { owner: Address; name: string }[];
  rounds: number;
  isSnakeLike: boolean;
  reverseRound: (r: number) => boolean;
  currentCol: number;
  cellIsCurrent: (round: number, col: number) => boolean;
  arrowDirection: () => 'left' | 'right' | 'down' | null;
  timePerPickSeconds: number;
  draftType: number;
  ended: boolean;
  remaining: number;
  isTrueReversalCell: (round: number, col: number, n: number) => boolean;
  pickLabelFor: (round: number, col: number, n: number) => string;
}) {
  return (
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
                        color: (remaining <= 60 ? RED : EGGSHELL),
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
  );
}

/* ---- All Teams panel ---- */
function AllTeamsPanel({
  league,
  header,
  selectedOwnerLower,
  onSelectOwner,
}: {
  league: Address;
  header: { owner: Address; name: string }[];
  selectedOwnerLower?: string;
  onSelectOwner?: (owner?: string) => void;
}) {
  const initialIdx = useMemo(() => {
    if (!selectedOwnerLower) return 0;
    const i = header.findIndex(h => h.owner?.toLowerCase() === selectedOwnerLower);
    return i >= 0 ? i : 0;
  }, [header, selectedOwnerLower]);

  const [activeIdx, setActiveIdx] = useState(initialIdx);
  useEffect(() => setActiveIdx(initialIdx), [initialIdx]);

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
        {header.map((h, i) => (
          <TeamChip
            key={`${h.owner}-${i}`}
            league={league}
            owner={h.owner}
            name={h.name}
            chosen={i === activeIdx}
            href={`?tab=all&team=${h.owner}`}
            onClick={(e) => {
              e.preventDefault();
              setActiveIdx(i);
              onSelectOwner?.(h.owner);
            }}
          />
        ))}
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

function TeamChip({
  league, owner, name, chosen, href, onClick,
}: {
  league: Address;
  owner: Address;
  name: string;
  chosen: boolean;
  href: string;
  onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const p = useTeamProfile(league, owner || ZERO, { name });
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm flex items-center gap-2 no-underline ${chosen ? 'bg-white/10 border-white/20' : 'hover:bg-white/5 border-white/10'}`}
    >
      {p.logo && <img src={p.logo} className="h-4 w-4 rounded-xl border border-white/20 object-cover" alt={p.name || 'Team'} />}
      <span className="truncate">{p.name || name}</span>
    </Link>
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
              className="rounded-xl px-4 py-2 font-semibold no-underline"
              style={{ background: ZIMA, color: '#001018' }}
            >
              My Team
            </Link>
            <Link
              href={`/league/${league}`}
              className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 hover:bg-white/15 no-underline"
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

/* ---- Settings modal (centered; shows order; budget only if auction) ---- */
function SettingsModal({
  onClose,
  summary,
}: {
  onClose: () => void;
  summary: {
    timePerPickSeconds: number;
    thirdRoundReversal: boolean;
    draftType: number;
    draftTypeLabel: string;
    salaryBudget: number;
    startAt: number;
    order: { owner: Address; name: string }[];
  };
}) {
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/12 bg-[#0b0b12] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold mx-auto" style={{ color: EGGSHELL }}>Draft Settings</div>
          <button onClick={onClose} className="absolute right-3 top-3 rounded-md border border-white/15 bg-white/10 px-2 py-1 text-sm hover:bg-white/15">✕</button>
        </div>
        <div className="space-y-3 text-sm text-center">
          <div>Type: <span className="font-medium">{summary.draftTypeLabel}</span></div>
          <div>Time per Pick: <span className="font-medium">{timeLabel(summary.timePerPickSeconds)}</span></div>
          <div>Third Round Reversal: <span className="font-medium">{summary.thirdRoundReversal ? 'On' : 'Off'}</span></div>
          {summary.draftType === 1 && (
            <div>Budget: <span className="font-medium">{summary.salaryBudget}</span></div>
          )}
          <div>Scheduled: <span className="font-medium">{fmtLocal(summary.startAt)}</span></div>

          <div className="pt-2">
            <div className="uppercase tracking-wide text-xs opacity-80 mb-1">Round 1 Order</div>
            <ol className="inline-block text-left text-sm space-y-1">
              {summary.order.map((h, i) => (
                <li key={`${h.owner}-${i}`} className="flex items-center gap-2">
                  <span className="inline-block w-6 text-right font-mono">{i+1}.</span>
                  <span className="font-medium">{h.name}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Bottom Drawer: Top 300 ---- */
function PlayerDrawer({
  open, onToggle, players, onDraft,
}: {
  open: boolean;
  onToggle: () => void;
  players: PlayerRow[];
  onDraft: (p: PlayerRow) => void;
}) {
  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-[50] transition-transform duration-300"
        style={{ transform: open ? 'translateY(0)' : 'translateY(calc(50vh - 2.5rem))' }}
      >
        <div className="mx-auto max-w-6xl">
          <button
            onClick={onToggle}
            className="mx-auto block rounded-t-2xl border-x border-t border-white/15 bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
            title={open ? 'Collapse players' : 'Show players'}
          >
            {open ? '▼ Hide Players' : '▲ Show Players'}
          </button>
        </div>
        <div className="mx-auto max-w-6xl h-[50vh] overflow-y-auto rounded-t-2xl border-x border-t border-white/15 bg-black/70 backdrop-blur px-3 py-2">
          {players.length === 0 ? (
            <div className="text-center text-sm text-gray-300 py-6">
              No players loaded. Ensure <span className="font-mono">/hashmark-top300.csv</span> exists with
              <span className="font-mono"> rank,name,position,team</span>.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-black/80">
                <tr className="text-left">
                  <th className="py-2 px-2 w-14">#</th>
                  <th className="py-2 px-2">Name</th>
                  <th className="py-2 px-2 w-20">Pos</th>
                  <th className="py-2 px-2 w-24">Team</th>
                  <th className="py-2 px-2 w-28 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {players.map(p => (
                  <tr key={`${p.rank}-${p.name}`} className="border-t border-white/10">
                    <td className="py-1.5 px-2 font-mono">{p.rank}</td>
                    <td className="py-1.5 px-2">{p.name}</td>
                    <td className="py-1.5 px-2">{p.position}</td>
                    <td className="py-1.5 px-2">{p.team}</td>
                    <td className="py-1.5 px-2 text-right">
                      <button
                        onClick={() => onDraft(p)}
                        className="rounded-md border border-emerald-600/50 bg-emerald-600/20 px-2 py-1 text-xs hover:bg-emerald-600/30"
                        title="Draft player"
                      >
                        Draft
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
