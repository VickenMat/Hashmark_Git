// src/lib/draft-storage.ts
'use client';

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
  startedAt: number;            // ms epoch; 0 = not started (kept for back-compat; page computes seconds)
  paused: boolean;
  currentRound: number;
  currentPickIndex: number;     // 0-based
  picks: PickItem[];
  ended: boolean;
};

const key = (league: string) => `hashmark:draft-state:${league.toLowerCase()}`;

/* ---------- Broadcast utilities ---------- */

const chanName = (league: string) =>
  `hashmark:draft-channel:${league.toLowerCase()}`;

function getChannel(league: string): BroadcastChannel | null {
  try {
    // BroadcastChannel is widely supported (Safari 16.4+, modern Chromium/Firefox)
    return new BroadcastChannel(chanName(league));
  } catch {
    return null;
  }
}

type WireMsg =
  | { type: 'STATE'; state: DraftState }
  | { type: 'RESET' };

export function loadDraftState(league: string): DraftState | null {
  try {
    const raw = localStorage.getItem(key(league));
    return raw ? (JSON.parse(raw) as DraftState) : null;
  } catch {
    return null;
  }
}

/** Save locally and broadcast to other tabs */
export function saveDraftState(league: string, state: DraftState) {
  try {
    localStorage.setItem(key(league), JSON.stringify(state));
  } catch {}
  try {
    const ch = getChannel(league);
    ch?.postMessage({ type: 'STATE', state } as WireMsg);
    // don't keep a channel reference; let GC clean it up
    ch?.close();
  } catch {}
}

export function resetDraftState(league: string) {
  try { localStorage.removeItem(key(league)); } catch {}
  try {
    const ch = getChannel(league);
    ch?.postMessage({ type: 'RESET' } as WireMsg);
    ch?.close();
  } catch {}
}

/**
 * Subscribe to external updates:
 *  - BroadcastChannel messages from other tabs/windows
 *  - 'storage' events as a fallback (same-browser tabs)
 * Returns an unsubscribe function.
 */
export function subscribeDraftState(
  league: string,
  onState: (state: DraftState | null) => void,
): () => void {
  // BroadcastChannel path
  let ch: BroadcastChannel | null = null;
  let offBC: (() => void) | undefined;
  try {
    ch = getChannel(league);
    if (ch) {
      const onMsg = (ev: MessageEvent<WireMsg>) => {
        if (!ev?.data) return;
        if (ev.data.type === 'STATE') onState(ev.data.state);
        if (ev.data.type === 'RESET') onState(null);
      };
      ch.addEventListener('message', onMsg);
      offBC = () => ch?.removeEventListener('message', onMsg);
    }
  } catch {
    // ignore
  }

  // storage fallback (same-browser tabs)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== key(league)) return;
    if (e.newValue) {
      try { onState(JSON.parse(e.newValue) as DraftState); } catch {}
    } else {
      onState(null);
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    try { offBC?.(); ch?.close(); } catch {}
    window.removeEventListener('storage', onStorage);
  };
}
