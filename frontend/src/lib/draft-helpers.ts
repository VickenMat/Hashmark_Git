export type UISettings = {
  salaryCap: string;
  thirdRoundReversal: boolean;
  playerPool: 'all'|'rookies'|'vets';
  timePerPick: 'no-limit'|'15s'|'30s'|'45s'|'60s'|'90s'|'120s'|'180s'|'300s'|'600s'|'1h'|'2h'|'4h'|'8h'|'12h'|'24h';
};

const DEFAULT_UI: UISettings = {
  salaryCap: '400',
  thirdRoundReversal: false,
  playerPool: 'all',
  timePerPick: '60s',
};

export function loadUISettings(league: string): UISettings {
  try {
    const raw = localStorage.getItem(`hashmark:draft-ui:${league.toLowerCase()}`);
    return raw ? { ...DEFAULT_UI, ...JSON.parse(raw) } : DEFAULT_UI;
  } catch {
    return DEFAULT_UI;
  }
}

export function parsePickPresetToSeconds(preset: UISettings['timePerPick']): number {
  if (preset === 'no-limit') return 0;
  if (preset.endsWith('s')) return parseInt(preset, 10);
  if (preset.endsWith('h')) return parseInt(preset, 10) * 3600;
  return 60; // default safety
}

type Team = { owner: `0x${string}`; name: string };
const ZERO = '0x0000000000000000000000000000000000000000' as const;

/**
 * Compute initial Round 1 order from:
 *  - on-chain manualOrder (which includes ZERO placeholders)
 *  - or from current filled teams padded with ZERO
 */
export function getInitialOrder(params: {
  teams: Team[];
  manualOrder: `0x${string}`[];
  thirdRoundReversal: boolean; // not used for R1, but kept for signature uniqueness
}) {
  const { teams, manualOrder, thirdRoundReversal } = params;

  let order: `0x${string}`[] = [];
  if (manualOrder && manualOrder.length) {
    order = manualOrder.slice(0, teams.length) as `0x${string}`[];
    while (order.length < teams.length) order.push(ZERO);
  } else {
    order = teams.map(t => t.owner);
    while (order.length < teams.length) order.push(ZERO);
  }

  const signature = `${order.join(',')}|trr:${thirdRoundReversal ? 1 : 0}`;
  return { order, signature };
}

/**
 * Build order for any round:
 * - Snake: odd rounds = R1 order; even rounds = reversed
 * - Third Round Reversal: round 3 uses the same direction as round 2
 */
export function buildRoundOrder(round1: `0x${string}`[], roundNum: number, trr: boolean): `0x${string}`[] {
  const base = [...round1];
  if (roundNum === 1) return base;
  if (roundNum === 2) return base.slice().reverse();
  if (trr && roundNum === 3) return base.slice().reverse(); // TRR: R3 same as R2
  // standard snake from here
  const even = roundNum % 2 === 0;
  return even ? base.slice().reverse() : base;
}

/**
 * Move pointer to next pick; marks ended when final pick passes last slot
 */
export function nextPickPointer(p: {
  currentRound: number;
  currentPickIndex: number;
  totalRounds: number;
  teamCap: number;
}) {
  let { currentRound, currentPickIndex, totalRounds, teamCap } = p;
  if (currentPickIndex + 1 < teamCap) {
    return { currentRound, currentPickIndex: currentPickIndex + 1, ended: false };
  }
  // next round
  if (currentRound + 1 <= totalRounds) {
    return { currentRound: currentRound + 1, currentPickIndex: 0, ended: false };
  }
  return { currentRound, currentPickIndex, ended: true };
}
