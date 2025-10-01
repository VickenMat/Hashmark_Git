// src/lib/auto-pick.ts
export type RankedPlayerRow = {
  rank: number;
  adp?: number;
  name: string;
  position: string;
  team: string;
};

export enum AutoPickSource {
  QueueThenBoard = 'QueueThenBoard',
}

/**
 * Autopick strategy used on timeout:
 *  1) Highest ADP from the picking team's queue (key: "queue:<ownerLower>")
 *  2) Highest ADP from the cached board list (key: "players:board")
 *
 * NOTE: This is synchronous so it can be called in a timeout handler.
 * Ensure PlayersDrawer stores the board list in localStorage under "players:board".
 */
export function chooseAutoPick(params: {
  league: string;
  whoIsUp?: `0x${string}`;
  draftedSet: Set<string>;
  source: AutoPickSource;
}): RankedPlayerRow | null {
  const { whoIsUp, draftedSet } = params;

  try {
    // 1) team queue
    if (whoIsUp) {
      const qKey = `queue:${whoIsUp.toLowerCase()}`;
      const rawQ = localStorage.getItem(qKey);
      if (rawQ) {
        const queue = JSON.parse(rawQ) as RankedPlayerRow[];
        const available = queue.filter(p => !draftedSet.has(p.name));
        if (available.length) {
          available.sort((a, b) => (num(a.adp, a.rank) - num(b.adp, b.rank)));
          return available[0];
        }
      }
    }

    // 2) global board cache
    const rawB = localStorage.getItem('players:board');
    if (rawB) {
      const board = JSON.parse(rawB) as RankedPlayerRow[];
      const available = board.filter(p => !draftedSet.has(p.name));
      if (available.length) {
        available.sort((a, b) => (num(a.adp, a.rank) - num(b.adp, b.rank)));
        return available[0];
      }
    }
  } catch {
    // fall through
  }

  return null;
}

function num(a?: number, fallback?: number) {
  if (Number.isFinite(a)) return a as number;
  if (Number.isFinite(fallback)) return fallback as number;
  return Number.MAX_SAFE_INTEGER;
}
