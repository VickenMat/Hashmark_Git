'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';

/* Theme */
const ZIMA = '#37c0f6';
const EGGSHELL = '#F0EAD6';
const RED = '#ef4444';
const ORANGE = '#f59e0b';

/* Types */
type Address = `0x${string}`;
const ZERO: Address = '0x0000000000000000000000000000000000000000';
type Team = { owner: Address; name: string };

/* ABI (subset) */
const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  {
    type: 'function', name: 'getTeams', stateMutability: 'view', inputs: [],
    outputs: [{ type: 'tuple[]', components: [{ name: 'owner', type: 'address' }, { name: 'name', type: 'string' }]}],
  },
  {
    type: 'function', name: 'getDraftSettings', stateMutability: 'view', inputs: [],
    outputs: [{ type: 'uint8' }, { type: 'uint64' }, { type: 'uint8' }, { type: 'bool' }, { type: 'address[]' }, { type: 'bool' }],
  },
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

/* Local libs */
import {
  type DraftState,
  loadDraftState,
  saveDraftState,
  resetDraftState,
  subscribeDraftState,
} from '@/lib/draft-storage';
import { buildRoundOrder } from '@/lib/draft-helpers';
import {
  initStateFromChain,
  visibleColForPointer,
  isTrueReversalCell,
  pickLabel,
  placePick,
  advancePick,
  nextPickSummary,
  type RankedPlayerRow,
} from '@/lib/pick-flow';
import { AutoPickSource, chooseAutoPick } from '@/lib/auto-pick';

/* UI components */
import ControlsRow from '@/components/draft/ControlsRow';
import PlayersDrawer from '@/components/draft/PlayersDrawer';
import StatePill from '@/components/draft/StatePill';
import HeaderCell from '@/components/draft/HeaderCell';
import TeamInline from '@/components/draft/TeamInline';
import PanelAllTeams from '@/components/draft/PanelAllTeams';
import PanelMyTeam from '@/components/draft/PanelMyTeam';
import PanelHistory from '@/components/draft/PanelHistory';
import PanelQueue from '@/components/draft/PanelQueue';
import SettingsModal from '@/components/draft/SettingsModal';

/* helpers */
const short = (a?: string) => (a ? `${a.slice(0,6)}…${a.slice(-4)}` : '');
const fmtClock = (s: number) => {
  const sec = Math.max(0, Math.ceil(s));
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};
const timeLabel = (secs: number) => {
  if (secs === 0) return 'No limit';
  if (secs < 60) return `${secs}s / pick`;
  if (secs < 3600) return `${Math.round(secs/60)}m / pick`;
  return `${Math.round(secs/3600)}h / pick`;
};
const fmtLocal = (t: number) => {
  if (!t) return 'Not scheduled';
  const d = new Date(t * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${mm}/${dd}/${yyyy} - ${h}:${m} ${ampm}`;
};

export default function DraftRoom() {
  const { address: league } = useParams<{ address: Address }>();
  const { address: wallet } = useAccount();
  const search = useSearchParams();
  const router = useRouter();

  /* Reads */
  const nameRes = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' });
  const teamsRes = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getTeams',
    query: { refetchInterval: 5000, staleTime: 0 },
  });
  const settingsRes = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getDraftSettings',
    query: { refetchInterval: 5000, staleTime: 0 },
  });
  const extrasRes = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getDraftExtras',
    query: { refetchInterval: 5000, staleTime: 0 },
  });
  const commishRes = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'commissioner' });

  const leagueName = (nameRes.data as string) || 'League';
  const teams = (Array.isArray(teamsRes.data) ? (teamsRes.data as Team[]) : []) as Team[];

  const commissioner = (commishRes.data as string | undefined)?.toLowerCase() || '';
  const isCommish = !!(wallet && wallet.toLowerCase() === commissioner);

  // settings unpack
  const [draftType, draftTs, , draftCompleted, manualOrder] =
    ((settingsRes.data as any) || [0, 0n, 0, false, [], false]) as [number, bigint, number, boolean, Address[], boolean];

  // extras unpack
  const extras = extrasRes.data as undefined | {
    timePerPickSeconds: number; thirdRoundReversal: boolean; salaryCapBudget: number; playerPool: number;
  };
  const timePerPickSeconds = extras ? Number(extras.timePerPickSeconds || 0) : 60;
  const thirdRoundReversal = !!extras?.thirdRoundReversal;
  const salaryBudget = extras ? Number(extras.salaryCapBudget || 400) : 400;

  /* Time gates */
  const startAt = Number(draftTs) || 0;
  const [now, setNow] = useState(() => Math.floor(Date.now()/1000));
  useEffect(() => { const id = setInterval(() => setNow(Math.floor(Date.now()/1000)), 1000); return () => clearInterval(id); }, []);

  const isLiveByTime = startAt > 0 && now >= startAt && !draftCompleted;
  const graceSecs = Math.max(0, isLiveByTime ? 180 - (now - startAt) : 0);
  const inGrace = isLiveByTime && graceSecs > 0;
  const beforeRealStart = startAt > 0 && (now < startAt + 180);
  const isLive = isLiveByTime && !inGrace;

  /* Local draft state */
  const [state, setState] = useState<DraftState>(() =>
    initStateFromChain(league, teams, manualOrder, thirdRoundReversal)
  );

  // cross-tab updates
  useEffect(() => subscribeDraftState(league, (s) => {
    if (!s) return;
    setState((prev) => ({
      ...prev,
      ...s,
      order: s.order?.length ? s.order : prev.order,
      orderSignature: s.orderSignature || prev.orderSignature,
      totalRounds: s.totalRounds || prev.totalRounds,
    }));
  }), [league]);

  // re-init if order changed
  useEffect(() => {
    setState((prev) => {
      const nextBase = initStateFromChain(league, teams, manualOrder, thirdRoundReversal);
      if (prev.orderSignature !== nextBase.orderSignature) {
        const next: DraftState = {
          ...nextBase,
          picks: [],
          startedAt: 0,
          paused: false,
          currentRound: 1,
          currentPickIndex: 0,
          ended: false,
        };
        saveDraftState(league, next);
        return next;
      }
      return prev;
    });
  }, [league, JSON.stringify(manualOrder), teams.length, thirdRoundReversal]);

  // auto-start first clock when grace ends
  useEffect(() => {
    if (!isLive) return;
    setState((prev) => {
      if (prev.startedAt > 0) return prev;
      const startedAt = Date.now();
      const next = { ...prev, startedAt, paused: false, __pickStartedAt: Date.now() } as any;
      saveDraftState(league, next);
      return next;
    });
  }, [isLive]);

  // derived
  const r1Order = state.order;
  const teamCap = r1Order.length || teams.length || 1;

  const roundOrders = useMemo(() => {
    return Array.from({ length: state.totalRounds }, (_, r) =>
      buildRoundOrder(r1Order, r + 1, thirdRoundReversal)
    );
  }, [r1Order, state.totalRounds, thirdRoundReversal]);

  const header = useMemo(() => {
    return r1Order.map((owner, i) => {
      const t = teams.find(tt => tt.owner?.toLowerCase() === owner?.toLowerCase());
      return {
        owner,
        name: t?.name || (owner === ZERO ? `Team ${i + 1}` : `${owner.slice(0,6)}…${owner.slice(-4)}`),
      };
    });
  }, [r1Order, teams]);

  const currentVisibleCol = visibleColForPointer({
    round1: r1Order,
    currentRound: state.currentRound,
    currentPickIndex: state.currentPickIndex,
    thirdRoundReversal,
  });

  // pick clock (purely derived)
  const [, forceTick] = useState(0);
  useEffect(() => { const id = setInterval(() => forceTick(t=>t+1), 500); return ()=>clearInterval(id); }, []);
  const pickClock = (() => {
    const start = state.startedAt || 0;
    if (!isLive || state.ended || timePerPickSeconds <= 0 || start <= 0) return null;
    const marker = (state as any).__pickStartedAt ?? start;
    const elapsed = state.paused ? ((state as any).__remainingAtPause ?? 0)
      : Math.max(0, Math.floor((Date.now() - marker) / 1000));
    return Math.max(0, timePerPickSeconds - elapsed);
  })();

  // pointer/resume marker
  const lastPtrRef = useRef(`${state.currentRound}:${state.currentPickIndex}:${state.paused}`);
  useEffect(() => {
    const sig = `${state.currentRound}:${state.currentPickIndex}:${state.paused}`;
    if (sig !== lastPtrRef.current) {
      lastPtrRef.current = sig;
      if (!state.paused && isLive) {
        const next = { ...state, __pickStartedAt: Date.now() } as DraftState & { __pickStartedAt?: number };
        saveDraftState(league, next);
        setState(next);
      }
    }
  }, [state.currentRound, state.currentPickIndex, state.paused, isLive, league, state]);

  // zero-clock → autopick
  useEffect(() => {
    if (!isLive || state.paused || state.ended) return;
    if (timePerPickSeconds <= 0) return;
    if (pickClock === null || pickClock > 0) return;

    const draftedSet = new Set((state.picks || []).map(p => p.player));
    const chosen = chooseAutoPick({
      league,
      whoIsUp: roundOrders[state.currentRound - 1]?.[state.currentPickIndex] as Address,
      draftedSet,
      source: AutoPickSource.QueueThenBoard,
    });

    if (chosen) {
      doDraftPlayer(chosen);
    } else {
      const advanced = advancePick({ state, teamCap, totalRounds: state.totalRounds });
      saveDraftState(league, advanced);
      setState(advanced);
    }
  }, [pickClock, isLive, state.paused, state.ended, timePerPickSeconds, state.currentRound, state.currentPickIndex, state.picks, league, roundOrders, teamCap]);

  /* Tabs */
  type Tab = 'draft' | 'queue' | 'history' | 'team' | 'all';
  const initialTab = (search.get('tab') as Tab) || 'draft';
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => {
    const qTab = (search.get('tab') as Tab) || 'draft';
    if (qTab !== tab) setTab(qTab);
  }, [search, tab]);
  useEffect(() => {
    const q = new URLSearchParams(search);
    q.set('tab', tab);
    router.replace(`?${q.toString()}`, { scroll: false });
  }, [tab, router, search]);

  const selectedOwnerFromQuery = (search.get('team') || '').toLowerCase();

  /* interactions */
  function doDraftPlayer(p: RankedPlayerRow) {
    if (!isLive || state.paused || state.ended) return;

    const owner = roundOrders[state.currentRound - 1]?.[state.currentPickIndex] as Address | undefined;
    if (!owner || owner === ZERO) return;

    const already = (state.picks || []).some(x => x.player === p.name);
    if (already) return;

    const placed = placePick({
      league,
      state,
      player: p,
      owner,
      round: state.currentRound,
      slot: state.currentPickIndex + 1,
    });

    const advanced = advancePick({
      state: placed,
      teamCap,
      totalRounds: state.totalRounds,
    });

    saveDraftState(league, advanced);
    setState(advanced);
  }

  /* Phase pill + pause visibility */
  const phasePill = (() => {
    if (state.ended) return <StatePill color="DONE">Completed</StatePill>;
    if (state.paused && isLive) return <StatePill color="PAUSED">Paused</StatePill>;
    if (beforeRealStart) return <StatePill color={inGrace ? 'GRACE' : 'SOON'}>{inGrace ? 'Grace' : 'Starting Soon'}</StatePill>;
    return <StatePill color="LIVE">Live</StatePill>;
  })();

  const canShowPause = isCommish && isLive && !state.ended;
  const togglePause = () => {
    if (!isCommish || !isLive || state.ended) return;
    const next: any = { ...state, paused: !state.paused };
    if (next.paused) {
      const marker = (state as any).__pickStartedAt ?? state.startedAt;
      const elapsed = Math.max(0, Math.floor((Date.now() - marker) / 1000));
      next.__remainingAtPause = Math.max(0, timePerPickSeconds - elapsed);
    } else {
      const remain = (state as any).__remainingAtPause ?? timePerPickSeconds;
      next.__pickStartedAt = Date.now() - (timePerPickSeconds - remain) * 1000;
      delete next.__remainingAtPause;
    }
    saveDraftState(league, next);
    setState(next);
  };

  const [settingsOpen, setSettingsOpen] = useState(false);

  /* On-clock owner & canDraft computation */
  const onClockOwner = roundOrders[state.currentRound - 1]?.[state.currentPickIndex] as Address | undefined;
  const canDraftNow = !!(wallet && onClockOwner && (wallet as string).toLowerCase() === onClockOwner.toLowerCase() && isLive && !state.paused && !state.ended);

  /* Top area helpers */
  const currentVisibleCol = visibleColForPointer({
    round1: r1Order,
    currentRound: state.currentRound,
    currentPickIndex: state.currentPickIndex,
    thirdRoundReversal,
  });
  const onClockTeamName = header[currentVisibleCol]?.name || '—';
  const nextPick = nextPickSummary({ state, roundOrders, thirdRoundReversal, header, beforeRealStart });

  const s = loadDraftState(league);
  const rp = s?.picks?.[s.picks.length - 1] as any;

  const me = teams.find(t => wallet && t.owner.toLowerCase() === (wallet as string).toLowerCase());
  const myCol = useMemo(() => {
    if (!wallet) return -1;
    return header.findIndex(h => h.owner?.toLowerCase() === wallet.toLowerCase());
  }, [wallet, header]);

  const infoBar = (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
      <span className="rounded-2xl border px-3 py-1.5 text-xs"
            style={{ color: EGGSHELL, borderColor: 'rgba(255,255,255,0.18)' }}>
        {timeLabel(timePerPickSeconds)}
      </span>
      <span className="rounded-2xl border px-3 py-1.5 text-xs"
            style={{ color: EGGSHELL, borderColor: 'rgba(255,255,255,0.18)' }}>
        {draftType === 1 ? 'Auction' : draftType === 2 ? 'Linear' : 'Snake'}
      </span>
      <span className="rounded-2xl border px-3 py-1.5 text-xs"
            style={{ color: EGGSHELL, borderColor: 'rgba(255,255,255,0.18)' }}>
        Start: {fmtLocal(startAt)}
      </span>
      {draftType === 1 && (
        <span className="rounded-2xl border px-3 py-1.5 text-xs"
              style={{ color: EGGSHELL, borderColor: 'rgba(255,255,255,0.18)' }}>
          Budget: {salaryBudget}
        </span>
      )}
    </div>
  );

  // players drawer open/close
  const [playersOpen, setPlayersOpen] = useState(true);

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 to-black text-white px-4 sm:px-6 py-4 pb-28">
      {state.paused && isLive && !state.ended && (
        <div className="mx-auto mb-2 max-w-6xl rounded-md border border-red-600/40 bg-red-900/30 text-red-200 px-3 py-2 text-sm text-center font-semibold">
          🚨 Draft is Paused
        </div>
      )}

      {/* Title */}
      <div className="relative mb-2">
        <h1 className="text-center text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight" style={{ color: ZIMA }}>
          <span className="lg:inline">{leagueName} </span>
          <span className="lg:inline uppercase">DRAFT ROOM</span>
        </h1>
        <div className="absolute right-0 top-0">
          <Link
            href={`/league/${league}/my-team`}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm no-underline hover:bg-white/10"
            title="My Team"
          >
            <TeamInline league={league} owner={(me?.owner || ZERO) as Address} labelOverride={me?.name || 'My Team'} />
            {wallet && <div className="text-[11px] font-mono opacity-70">{short(wallet)}</div>}
          </Link>
        </div>
      </div>

      {/* Info bar */}
      <div className="mx-auto mb-2 max-w-6xl">{infoBar}</div>

      {/* Tiles */}
      <div className="mx-auto mb-2 grid max-w-6xl grid-cols-1 gap-2 sm:grid-cols-3">
        {/* On the Clock */}
        <div className="rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 flex items-center justify-center">
          {state.ended ? (
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
                    : (state.paused ? RED : (isLive && timePerPickSeconds > 0 && (pickClock ?? 0) <= 60) ? RED : EGGSHELL)
                }}
              >
                {beforeRealStart ? (
                  fmtClock(inGrace ? graceSecs : Math.max(0, Number(draftTs) - now))
                ) : state.paused ? (
                  'PAUSED'
                ) : (isLive && timePerPickSeconds > 0) ? (
                  fmtClock(pickClock ?? timePerPickSeconds)
                ) : (
                  '—'
                )}
              </div>
              {!beforeRealStart && isLive && (
                <div className="mt-2 text-center font-semibold" style={{ color: ZIMA }}>
                  {onClockTeamName}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Most Recent */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div className="text-center">
            <div className="mb-1 font-semibold" style={{ color: ZIMA }}>Most Recent Pick</div>
            {!rp ? (
              <div className="opacity-70 text-center">No picks yet.</div>
            ) : (
              <div className="inline-flex flex-wrap items-center justify-center gap-2">
                <span className="font-semibold">{rp.playerName ?? rp.player}</span>
                <span className="opacity-80">{rp.playerTeam} · {rp.position}</span>
                <span className="opacity-80">by</span>
                <Link href={`/league/${league}/draft?tab=all&team=${rp.owner || ''}`} className="no-underline hover:bg-white/10 rounded px-1">
                  <TeamInline league={league} owner={rp.owner as Address} />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Next Pick */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div className="text-center">
            <div className="mb-1 font-semibold" style={{ color: ZIMA }}>Next Pick</div>
            <div className="inline-flex items-center gap-2">
              <span className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 font-mono" style={{ color: ZIMA }}>
                {nextPick.label}
              </span>
            </div>
            <div className="mt-1 text-center">
              {nextPick.owner ? (
                <Link href={`/league/${league}/draft?tab=all&team=${nextPick.owner}`} className="no-underline hover:bg-white/10 rounded px-1">
                  <TeamInline league={league} owner={nextPick.owner as Address} labelOverride={nextPick.name} />
                </Link>
              ) : (
                <TeamInline league={league} owner={ZERO} labelOverride={nextPick.name} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs row */}
      <div className="mx-auto mb-3 max-w-6xl">
        <ControlsRow
          tab={tab}
          onTab={setTab}
          league={league}
          isCommish={isCommish}
          phasePill={(() => {
            if (state.ended) return <StatePill color="DONE">Completed</StatePill>;
            if (state.paused && isLive) return <StatePill color="PAUSED">Paused</StatePill>;
            if (beforeRealStart) return <StatePill color={inGrace ? 'GRACE' : 'SOON'}>{inGrace ? 'Grace' : 'Starting Soon'}</StatePill>;
            return <StatePill color="LIVE">Live</StatePill>;
          })()}
          canShowPause={canShowPause}
          paused={!!state.paused}
          onTogglePause={togglePause}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      {/* Main panel */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        {tab === 'draft' && (
          <div className="overflow-x-auto">
            {/* header row */}
            <div className="grid gap-3 min-w-max" style={{ gridTemplateColumns: `repeat(${header.length}, minmax(160px,1fr))` }}>
              {header.map((h, i) => {
                const mine = myCol >= 0 && i === myCol;
                const isCurrent = isLive && i === currentVisibleCol && !state.ended;
                const wrapperStyle = {
                  borderColor: mine ? EGGSHELL : (isCurrent ? 'rgba(240,234,214,0.40)' : 'rgba(255,255,255,.10)'),
                  background: mine ? 'rgba(240,234,214,0.08)' : (isCurrent ? 'rgba(240,234,214,0.10)' : 'rgba(0,0,0,.30)')
                } as const;

                return (
                  <div key={`${h.owner}-${i}`} className="rounded-2xl border px-3 py-3 text-center" style={wrapperStyle}>
                    {h.owner && h.owner !== ZERO
                      ? <Link href={`?tab=all&team=${h.owner}`} className="block no-underline hover:bg-white/5 rounded">
                          <HeaderCell league={league} owner={h.owner as Address} name={h.name} />
                        </Link>
                      : <HeaderCell league={league} owner={h.owner as Address} name={h.name} />}
                  </div>
                );
              })}
            </div>

            {/* board grid */}
            <div className="mt-3 space-y-3 min-w-max">
              {Array.from({ length: state.totalRounds }, (_, r) => r + 1).map((round) => (
                <div key={`round-${round}`} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${header.length}, minmax(160px,1fr))` }}>
                  {header.map((_, col) => {
                    const isCur = isLive && !state.ended &&
                      state.currentRound === round &&
                      visibleColForPointer({
                        round1: r1Order, currentRound: state.currentRound, currentPickIndex: state.currentPickIndex, thirdRoundReversal
                      }) === col;

                    const showTimer = isCur && timePerPickSeconds > 0;
                    const trrCell = isTrueReversalCell({ round, col, round1: r1Order, thirdRoundReversal });

                    const borderColor = isCur ? ZIMA : (trrCell ? ORANGE : 'rgba(255,255,255,.10)');
                    const background = isCur ? 'rgba(55,192,246,0.10)' : 'rgba(0,0,0,.40)';

                    const placed = state.picks.find(p => p.round === round && p.slot === (col + 1));
                    const pausedCell = isCur && state.paused;

                    return (
                      <div key={`cell-${round}-${col}`} className="relative h-16 rounded-2xl border grid place-items-center text-sm" style={{ borderColor, background }}>
                        {placed ? (
                          <span className="text-white font-semibold">{placed.player}</span>
                        ) : showTimer ? (
                          pausedCell ? (
                            <span className="inline-flex items-center gap-1 text-red-400 font-semibold">
                              <span className="rounded px-2 py-[3px] text-[13px] font-mono bg-red-900/30 border border-red-800/50">
                                PAUSED · {fmtClock(pickClock ?? timePerPickSeconds)}
                              </span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <span className="rounded px-2 py-[3px] text-[13px] font-mono"
                                style={{ color: ((pickClock ?? 0) <= 60 ? RED : EGGSHELL), background: 'rgba(255,255,255,.08)' }}>
                                {fmtClock(pickClock ?? timePerPickSeconds)}
                              </span>
                            </span>
                          )
                        ) : (
                          <span className="text-gray-300">
                            {pickLabel({ round, col, round1: r1Order, thirdRoundReversal })}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'queue' && (
          <PanelQueue
            whoAmI={wallet as Address | undefined}
            draftedNames={new Set((state.picks || []).map(p => p.player).filter(Boolean) as string[])}
            onDraft={doDraftPlayer}
            canDraft={canDraftNow}
          />
        )}

        {tab === 'history' && (
          <PanelHistory league={league} picks={state.picks || []} />
        )}

        {tab === 'team' && (
          <PanelMyTeam league={league} picks={state.picks || []} owner={wallet as Address | undefined} />
        )}

        {tab === 'all' && (
          <PanelAllTeams
            league={league}
            header={header}
            picks={state.picks || []}
            selectedOwnerLower={selectedOwnerFromQuery}
            onSelectOwner={(owner) => {
              const q = new URLSearchParams(search);
              q.set('tab', 'all');
              if (owner) q.set('team', owner);
              router.replace(`?${q.toString()}`, { scroll: false });
            }}
          />
        )}
      </section>

      {/* Players Drawer (now controlled) */}
      <PlayersDrawer
        open={playersOpen}
        onToggle={() => setPlayersOpen(o => !o)}
        league={league}
        draftedNames={new Set((state.picks || []).map(p => p.player).filter(Boolean) as string[])}
        onDraft={doDraftPlayer}
        whoAmI={wallet as Address | undefined}
        canDraft={canDraftNow}
      />

      {/* Settings popup */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        isCommish={isCommish}
        onReset={() => {
          // wipe everything and return to grace for everyone
          resetDraftState(league);
          const base = initStateFromChain(league, teams, manualOrder, thirdRoundReversal);
          const fresh: DraftState = {
            ...base,
            picks: [],
            startedAt: 0,
            paused: false,
            currentRound: 1,
            currentPickIndex: 0,
            ended: false,
          };
          saveDraftState(league, fresh); // broadcast
          setState(fresh);
        }}
        info={{
          timePerPickText: timeLabel(timePerPickSeconds),
          draftTypeText: draftType === 1 ? 'Auction' : draftType === 2 ? 'Linear' : 'Snake',
          startLocalText: fmtLocal(startAt),
          salaryBudget,
        }}
        round1Order={header}
      />
    </main>
  );
}
