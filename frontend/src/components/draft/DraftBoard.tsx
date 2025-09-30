'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildRoundOrder, nextPickPointer } from '@/lib/draft-helpers';
import { type DraftState } from '@/lib/draft-storage';

type Team = { owner: `0x${string}`; name: string };
const ZERO = '0x0000000000000000000000000000000000000000' as const;

type Props = {
  league: `0x${string}`;
  isCommish: boolean;
  teams: Team[];
  teamCap: number;
  orderRound1: `0x${string}`[];    // round 1 order incl. ZERO placeholders
  thirdRoundReversal: boolean;
  totalRounds: number;
  pickSeconds: number;              // 0 = no limit
  draftDate: Date;
  state: DraftState;
  onState: (next: DraftState) => void;
  onReset: () => void;
};

const EGGSHELL = '#F0EAD6';
const ZIMA = '#37c0f6';

export default function DraftBoard(props: Props) {
  const {
    league, isCommish, teams, teamCap, orderRound1, thirdRoundReversal, totalRounds,
    pickSeconds, draftDate, state, onState, onReset
  } = props;

  // Build all round orders upfront
  const orders = useMemo(() => {
    const arr: (`0x${string}`[])[] = [];
    for (let r = 1; r <= totalRounds; r++) {
      arr.push(buildRoundOrder(orderRound1, r, thirdRoundReversal));
    }
    return arr;
  }, [orderRound1, totalRounds, thirdRoundReversal]);

  // Countdown to auto start
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const msUntil = Math.max(0, draftDate.getTime() - now);
  const started = state.startedAt > 0 || msUntil === 0;

  useEffect(() => {
    if (!started && msUntil === 0) {
      // auto start at T0
      onState({ ...state, startedAt: Date.now(), paused: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msUntil, started]);

  // per-pick timer
  const [tick, setTick] = useState<number>(0);
  useEffect(() => {
    if (!started || state.paused || state.ended || pickSeconds === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [started, state.paused, state.ended, pickSeconds]);

  const { currentRound, currentPickIndex } = state;
  const currentOwner = orders[currentRound - 1]?.[currentPickIndex] as `0x${string}` | undefined;

  const pickDeadline = useMemo(() => {
    if (!started || state.paused || pickSeconds === 0) return 0;
    // crude approach: deadline = startedAt + elapsed picks * pickSeconds
    // For demo: recalc on each pick/round change by resetting startedAtPick
    return 0;
  }, [started, state.paused, pickSeconds]);

  // Pause/Resume (commissioner only)
  function pause() {
    if (!isCommish) return;
    if (!started || state.ended) return;
    onState({ ...state, paused: true });
  }
  function resume() {
    if (!isCommish) return;
    if (!started || state.ended) return;
    onState({ ...state, paused: false });
  }

  // Make a pick (demo: stores only owner+playerName string)
  function makePick(playerName: string) {
    if (!started || state.paused || state.ended) return;
    if (!currentOwner) return;

    const nextPicks = [...state.picks, {
      round: state.currentRound,
      slot: state.currentPickIndex + 1,
      owner: currentOwner,
      player: playerName,
    }];

    // Advance pointer
    const pointer = nextPickPointer({
      currentRound: state.currentRound,
      currentPickIndex: state.currentPickIndex,
      totalRounds,
      teamCap,
    });

    const nextState: DraftState = {
      ...state,
      picks: nextPicks,
      currentRound: pointer.currentRound,
      currentPickIndex: pointer.currentPickIndex,
      ended: pointer.ended,
    };

    onState(nextState);

    if (nextState.ended) {
      // TODO: trigger on-chain “draftCompleted” + roster assignment + league state = matchup
      // For now we just mark ended in local state.
    }
  }

  // Simple player quick-pick input (for demo)
  const [quickName, setQuickName] = useState('');
  function handleQuickPick() {
    if (!quickName.trim()) return;
    makePick(quickName.trim());
    setQuickName('');
  }

  // UI helpers
  const teamLabel = (addr: `0x${string}` | typeof ZERO) => {
    if (!addr || addr === ZERO) return '—';
    const t = teams.find(t => t.owner.toLowerCase() === addr.toLowerCase());
    return t?.name || `${addr.slice(0,6)}…${addr.slice(-4)}`;
  };

  return (
    <div className="rounded-2xl border border-gray-800 bg-black/30 p-4 sm:p-6">
      {/* Top controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm" style={{ color: EGGSHELL }}>
          Draft Start:&nbsp;
          {draftDate.toLocaleString()}&nbsp;·&nbsp;
          {started
            ? (state.paused ? <span className="text-yellow-300">Paused</span> : <span className="text-green-400">Live</span>)
            : <Countdown ms={msUntil} />}
        </div>
        <div className="flex items-center gap-2">
          {isCommish && started && !state.ended && (
            state.paused
              ? <button onClick={resume} className="rounded-lg bg-green-600 hover:bg-green-700 px-3 py-1.5 font-semibold">Resume</button>
              : <button onClick={pause} className="rounded-lg bg-amber-600 hover:bg-amber-700 px-3 py-1.5 font-semibold">Pause</button>
          )}
          <button onClick={onReset} className="rounded-lg bg-gray-800 hover:bg-gray-700 px-3 py-1.5 text-sm border border-gray-700">Reset (local)</button>
        </div>
      </div>

      {/* Teams row */}
      <div className="mb-3 grid" style={{ gridTemplateColumns: `repeat(${teamCap}, minmax(120px, 1fr))`, gap: '8px' }}>
        {orders[0]?.map((addr, i) => (
          <div key={`team-${i}`} className="rounded-xl border border-white/10 bg-white/5 p-2 text-center">
            <div className="text-xs text-gray-400 mb-1">Pos {i + 1}</div>
            <div className="font-semibold">{teamLabel(addr)}</div>
          </div>
        ))}
      </div>

      {/* Board grid: columns = teams, rows = rounds */}
      <div className="overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${teamCap}, minmax(120px, 1fr))`, gap: '8px' }}>
          {Array.from({ length: totalRounds }).map((_, rIdx) => {
            const rowOrder = orders[rIdx] || [];
            return rowOrder.map((addr, cIdx) => {
              const pick = state.picks.find(p => p.round === (rIdx + 1) && p.slot === (cIdx + 1));
              const isCurrent = started && !state.paused && !state.ended &&
                state.currentRound === (rIdx + 1) && state.currentPickIndex === cIdx;

              return (
                <div key={`cell-${rIdx}-${cIdx}`} className={[
                  'h-16 rounded-xl border p-2 text-sm flex items-center justify-center',
                  isCurrent ? 'border-fuchsia-600 bg-fuchsia-600/10' : 'border-white/10 bg-white/5'
                ].join(' ')}>
                  {pick
                    ? <span className="text-white font-semibold">{pick.player}</span>
                    : isCurrent
                      ? <span className="text-fuchsia-300">On the clock…</span>
                      : <span className="text-gray-400">—</span>}
                </div>
              );
            });
          })}
        </div>
      </div>

      {/* Quick pick (demo) */}
      {started && !state.paused && !state.ended && (
        <div className="mt-4 flex items-center gap-2">
          <input
            value={quickName}
            onChange={(e) => setQuickName(e.target.value)}
            placeholder={`Enter player for ${teamLabel(currentOwner || ZERO as any)}`}
            className="flex-1 bg-black/40 text-white p-2 rounded-lg border border-gray-700"
          />
          <button onClick={handleQuickPick} className="rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700 px-4 py-2 font-semibold">
            Pick
          </button>
        </div>
      )}

      {state.ended && (
        <div className="mt-4 text-center text-green-400 font-semibold">
          Draft complete! (TODO: set league to matchup state & assign rosters on-chain)
        </div>
      )}
    </div>
  );
}

function Countdown({ ms }: { ms: number }) {
  const d = Math.floor(ms / (24*3600*1000));
  const h = Math.floor((ms % (24*3600*1000)) / (3600*1000));
  const m = Math.floor((ms % (3600*1000)) / (60*1000));
  const s = Math.floor((ms % (60*1000)) / 1000);
  return <span style={{ color: EGGSHELL }}>{d}d {h}h {m}m {s}s</span>;
}
