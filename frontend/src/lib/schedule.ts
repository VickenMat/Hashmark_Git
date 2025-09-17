// src/lib/schedule.ts

export type Team = { owner: `0x${string}`; name: string };
export type Pairing =
  | { away: Team; home: Team; bye?: never }
  | { bye: `0x${string}`; away?: never; home?: never };

const ZERO = '0x0000000000000000000000000000000000000000';
const BYE_ADDR = '0x000000000000000000000000000000000000BEEF';

/**
 * Round-robin that matches your spec:
 * Week 1: 1–N, 2–N-1, 3–N-2, ...
 * Week 2: 1–2, 3–N, 4–N-1, 5–N-2, ...
 * Rotation: rotate subarray [1..N-1] one step LEFT each week.
 * After N-1 weeks, restart in the original order but flip home/away.
 */
export function buildSeasonSchedule(
  teamsIn: Team[],
  totalWeeks: number
): Record<number, Pairing[]> {
  const teams = dedupeAndSort(teamsIn);
  if (!teams.length || totalWeeks <= 0) return {};

  // if odd, add BYE sentinel
  const BYE: Team = { owner: BYE_ADDR as `0x${string}`, name: 'BYE' };
  const initial = [...teams];
  if (initial.length % 2 === 1) initial.push(BYE);

  const n = initial.length; // even
  const weeksPerCycle = n - 1;

  const out: Record<number, Pairing[]> = {};
  let week = 1;

  for (let cycle = 0; week <= totalWeeks; cycle++) {
    const flip = cycle % 2 === 1; // flip home/away each cycle
    let order = [...initial];     // restart “in order” each cycle

    for (let r = 0; r < weeksPerCycle && week <= totalWeeks; r++) {
      const rows: Pairing[] = [];
      for (let j = 0; j < n / 2; j++) {
        const a = order[j];
        const b = order[n - 1 - j];

        // bye handling
        if (a.owner.toLowerCase() === BYE_ADDR.toLowerCase()) {
          rows.push({ bye: b.owner });
          continue;
        }
        if (b.owner.toLowerCase() === BYE_ADDR.toLowerCase()) {
          rows.push({ bye: a.owner });
          continue;
        }

        // deterministic home/away, flip per cycle for fairness
        const [lo, hi] = a.owner.toLowerCase() < b.owner.toLowerCase() ? [a, b] : [b, a];
        rows.push(flip ? { away: hi, home: lo } : { away: lo, home: hi });
      }
      out[week++] = rows;

      // rotate subarray [1..n-1] one step LEFT
      const moved = order.splice(1, 1)[0];
      order.push(moved);
    }
  }

  return out;
}

/** Best-effort validation for a single week. Returns list of messages (empty ⇒ OK). */
export function validateWeek(rows: Pairing[], teams: Team[]): string[] {
  const errs: string[] = [];
  const tset = new Set(teams.map(t => t.owner.toLowerCase()));
  const seen = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if ('bye' in r) {
      const k = r.bye.toLowerCase();
      if (!tset.has(k)) errs.push(`Row ${i + 1}: BYE address not in league`);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    } else {
      const a = r.away.owner.toLowerCase();
      const h = r.home.owner.toLowerCase();
      if (!tset.has(a) || !tset.has(h)) errs.push(`Row ${i + 1}: team not in league`);
      if (a === h) errs.push(`Row ${i + 1}: team plays itself`);
      seen.set(a, (seen.get(a) ?? 0) + 1);
      seen.set(h, (seen.get(h) ?? 0) + 1);
    }
  }

  // Any team with zero or >1 uses should be flagged (editor normalizer fixes these)
  for (const t of tset) {
    const c = seen.get(t) ?? 0;
    if (c !== 1) errs.push(`Team ${short(t)} used ${c} time(s) this week`);
  }
  return errs;
}

/** Normalize a week after edits: resolves duplicates, removes invalids, ensures BYEs for free teams. */
export function normalizeWeek(rows: Pairing[], teams: Team[]): Pairing[] {
  const league = new Map(teams.map(t => [t.owner.toLowerCase(), t] as const));
  const out: Pairing[] = [];

  const used = new Set<string>();
  const pushBye = (addr:`0x${string}`) => out.push({ bye: addr });

  for (const r of rows) {
    if (!r) continue;

    if ('bye' in r) {
      const k = r.bye.toLowerCase();
      if (league.has(k) && !used.has(k)) {
        used.add(k); pushBye(`0x${k.slice(2)}` as `0x${string}`);
      }
      continue;
    }

    // valid match?
    const a = r.away?.owner?.toLowerCase();
    const h = r.home?.owner?.toLowerCase();
    if (!a || !h || a === h || !league.has(a) || !league.has(h)) {
      // drop malformed row
      continue;
    }

    const awayDup = used.has(a);
    const homeDup = used.has(h);

    if (awayDup && homeDup) {
      // both already used elsewhere – drop row entirely
      continue;
    } else if (awayDup) {
      // away already used → opponent gets a bye
      if (!used.has(h)) { used.add(h); pushBye(`0x${h.slice(2)}` as `0x${string}`); }
    } else if (homeDup) {
      if (!used.has(a)) { used.add(a); pushBye(`0x${a.slice(2)}` as `0x${string}`); }
    } else {
      out.push({ away: league.get(a)!, home: league.get(h)! });
      used.add(a); used.add(h);
    }
  }

  // fill any missing teams with BYE
  for (const [k, t] of league) {
    if (!used.has(k)) pushBye(t.owner);
  }

  // Stable order: matches first, then BYEs, all sorted to keep UI deterministic
  const matches = out.filter(p => !('bye' in p)) as Extract<Pairing, { away: Team; home: Team }>[];
  const byes = out.filter(p => 'bye' in p) as Extract<Pairing, { bye: `0x${string}` }>[];
  matches.sort((x,y)=> (x.away.owner+y.home.owner).localeCompare(y.away.owner+x.home.owner));
  byes.sort((x,y)=> x.bye.localeCompare(y.bye));
  return [...matches, ...byes];
}

/* ---------- helpers ---------- */

function short(a:string){ return `${a.slice(0,6)}…${a.slice(-4)}`; }

function dedupeAndSort(list: Team[]): Team[] {
  const seen = new Set<string>();
  const out: Team[] = [];
  for (const t of list) {
    const key = (t.owner || '').toLowerCase();
    if (!key || key === ZERO) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner: (`0x${key.slice(2)}` as `0x${string}`), name: (t.name || '').trim() });
  }
  // deterministic “1..N” by address; change if you want seed/draft order
  out.sort((a, b) => a.owner.localeCompare(b.owner));
  return out;
}
