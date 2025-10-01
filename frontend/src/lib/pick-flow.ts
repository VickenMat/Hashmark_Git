// src/lib/pick-flow.ts
import { nextPickPointer, ZERO } from './draft-helpers';
import { type DraftState, type PickItem, loadDraftState } from './draft-storage';

type Address = `0x${string}`;

/** Board player row type (renamed to avoid collision with auto-pick’s RankedPlayerRow) */
export type BoardPlayerRow = {
  rank: number;
  adp?: number;
  name: string;
  position: string;
  team: string;
};

/* ────────────────────────────── Initialization ───────────────────────────── */

export function initStateFromChain(
  league: string,
  teams: { owner: Address; name: string }[],
  manualOrder: Address[],
  thirdRoundReversal: boolean
): DraftState {
  // Prefer pre-existing compatible state (avoid wiping picks on refresh)
  const existing = loadDraftState(league);

  // Build round 1 order from manual or from joined owners, padded with ZERO
  const derivedRound1 = (() => {
    if (manualOrder && manualOrder.length) {
      const clone = manualOrder.slice(0, teams.length) as Address[];
      while (clone.length < teams.length) clone.push(ZERO as Address);
      return clone;
    }
    const owners = teams.map(t => t.owner);
    while (owners.length < teams.length) owners.push(ZERO as Address);
    return owners as Address[];
  })();

  const signature = derivedRound1.join(',') + `|TRR:${thirdRoundReversal ? 1 : 0}`;
  if (existing && existing.orderSignature === signature) return existing;

  return {
    league: league as Address,
    order: derivedRound1,
    orderSignature: signature,
    totalRounds: 15,
    startedAt: 0,
    paused: true,
    currentRound: 1,
    currentPickIndex: 0,
    picks: [],
    ended: false,
  };
}

/* ────────────────────── Visibility helpers (snake + TRR) ─────────────────── */

export function visibleColForPointer(params: {
  round1: Address[];
  currentRound: number;
  currentPickIndex: number; // index into the logical order for that round (0..n-1)
  thirdRoundReversal: boolean;
}) {
  const { round1, currentRound, currentPickIndex, thirdRoundReversal } = params;
  const n = round1.length || 1;

  if (currentRound === 1) return currentPickIndex;
  if (currentRound === 2) return (n - 1) - currentPickIndex;
  if (thirdRoundReversal && currentRound === 3) return (n - 1) - currentPickIndex;

  // standard snake: even rounds reversed, odd as-is
  return currentRound % 2 === 0 ? (n - 1) - currentPickIndex : currentPickIndex;
}

export function isTrueReversalCell(params: {
  round: number;
  col: number;
  round1: Address[];
  thirdRoundReversal: boolean;
}) {
  const { round, col, round1, thirdRoundReversal } = params;
  if (!thirdRoundReversal || round !== 3) return false;
  const n = round1.length || 1;
  // Round 3 mimics round 2 (even), so the first visible column is the last col
  const firstVisibleCol = (round % 2 === 0) ? (n - 1) : 0;
  return col === firstVisibleCol;
}

export function pickLabel(params: {
  round: number;
  col: number;
  round1: Address[];
  thirdRoundReversal: boolean;
}) {
  const { round, col, round1, thirdRoundReversal } = params;
  const n = round1.length || 1;

  let visibleIndex = col;
  if (round === 2) visibleIndex = (n - 1) - col;
  if (thirdRoundReversal && round === 3) visibleIndex = (n - 1) - col;
  if (round > 3) visibleIndex = round % 2 === 0 ? (n - 1) - col : col;

  return `${round}.${visibleIndex + 1}`;
}

/* ───────────────────────────── Place pick & Advance ──────────────────────── */

export function placePick(params: {
  league: string;
  state: DraftState;
  player: BoardPlayerRow;
  owner: Address;
  round: number;
  slot: number; // 1-based within round
}): DraftState {
  const { league, state, player, owner, round, slot } = params;

  const nextPick: PickItem = {
    round,
    slot,
    owner,
    player: player.name,
    playerName: player.name,
    playerTeam: player.team,
    position: player.position,
  };

  const next: DraftState = {
    ...state,
    picks: [...(state.picks || []), nextPick],
  };

  // Remove from queues & cached board, and broadcast a “recent” hint
  try {
    // Purge any queue entries across teams
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (k.startsWith('queue:')) {
        const arr = JSON.parse(localStorage.getItem(k) || '[]') as BoardPlayerRow[];
        const filtered = arr.filter(x => x.name !== player.name);
        if (filtered.length !== arr.length) localStorage.setItem(k, JSON.stringify(filtered));
      }
    }
    // Remove from cached players list
    const raw = localStorage.getItem('players:board');
    if (raw) {
      const list = (JSON.parse(raw) as BoardPlayerRow[]).filter(x => x.name !== player.name);
      localStorage.setItem('players:board', JSON.stringify(list));
    }
    localStorage.setItem(`recent-pick:${league}`, JSON.stringify(nextPick));
  } catch {
    // ignore storage errors
  }

  return next;
}

export function advancePick(params: {
  state: DraftState;
  teamCap: number;
  totalRounds: number;
}): DraftState {
  const { state, teamCap, totalRounds } = params;
  const ptr = nextPickPointer({
    currentRound: state.currentRound,
    currentPickIndex: state.currentPickIndex,
    totalRounds,
    teamCap,
  });

  const next: DraftState = {
    ...state,
    currentRound: ptr.currentRound,
    currentPickIndex: ptr.currentPickIndex,
    ended: ptr.ended,
    startedAt: state.startedAt || Date.now(),
    paused: ptr.ended ? true : state.paused,
  };

  // Mark a fresh pick-start timestamp for display timers (local only)
  (next as any).__pickStartedAt = Date.now();
  return next;
}

/* ─────────────────────────── Next pick summary ───────────────────────────── */

export function nextPickSummary(params: {
  state: DraftState;
  roundOrders: Address[][];
  thirdRoundReversal: boolean;
  header: { owner: Address; name: string }[];
  beforeRealStart: boolean;
}) {
  const { state, roundOrders, header, beforeRealStart } = params;

  if (state.ended) return { label: '—', owner: undefined, name: '—' };
  if (beforeRealStart) {
    const firstOwner = header[0]?.owner;
    return { label: 'Round 1 Pick 1', owner: firstOwner, name: header[0]?.name || '—' };
  }

  const n = header.length || 1;
  const nextI = (state.currentPickIndex + 1) % n;
  const wrap = nextI === 0;
  const round = wrap ? state.currentRound + 1 : state.currentRound;
  const owner = roundOrders[round - 1]?.[nextI];
  const name = (header.find(h => h.owner === owner)?.name) || '—';

  return { label: `Round ${round} Pick ${nextI + 1}`, owner, name };
}
