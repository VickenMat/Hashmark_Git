export type PickItem = {
  round: number;
  slot: number;                 // 1-based within round
  owner: `0x${string}`;
  player: string;               // Demo: store player name/ID
};

export type DraftState = {
  league: `0x${string}`;
  order: `0x${string}`[];       // Round 1 order
  orderSignature: string;       // for invalidation if settings change
  totalRounds: number;
  startedAt: number;            // ms epoch; 0 = not started
  paused: boolean;
  currentRound: number;
  currentPickIndex: number;     // 0-based
  picks: PickItem[];
  ended: boolean;
};

const key = (league: string) => `hashmark:draft-state:${league.toLowerCase()}`;

export function loadDraftState(league: string): DraftState | null {
  try {
    const raw = localStorage.getItem(key(league));
    return raw ? JSON.parse(raw) as DraftState : null;
  } catch {
    return null;
  }
}

export function saveDraftState(league: string, state: DraftState) {
  try {
    localStorage.setItem(key(league), JSON.stringify(state));
  } catch {}
}

export function resetDraftState(league: string) {
  try { localStorage.removeItem(key(league)); } catch {}
}
