// src/app/api/league/[address]/week/[week]/pairings/route.ts
import { NextResponse } from 'next/server';
import { getAddress, createPublicClient, http } from 'viem';
import { avalancheFuji } from 'viem/chains';

// If you already export LEAGUE_ABI elsewhere, you can import it instead.
// import { LEAGUE_ABI } from '@/lib/LeagueContracts';

/** Minimal ABI needed here: getTeams() -> (address owner, string name)[] */
const LEAGUE_ABI = [
  {
    type: 'function',
    name: 'getTeams',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'name',  type: 'string'  },
        ],
      },
    ],
  },
] as const;

type Team = { owner: `0x${string}`; name: string };

type PairingDTO =
  | { type: 'match'; homeOwner: `0x${string}`; awayOwner: `0x${string}` }
  | { type: 'bye';   owner: `0x${string}` };

const REG_SEASON_WEEKS =
  Number(process.env.NEXT_PUBLIC_REG_SEASON_WEEKS ?? 14);

/** ---------- Helpers ---------- */

const client = createPublicClient({
  chain: avalancheFuji, // default; swap if you route by network elsewhere
  transport: http(),
});

async function getTeamsOnServer(league: `0x${string}`): Promise<Team[]> {
  const raw = (await client.readContract({
    address: league,
    abi: LEAGUE_ABI,
    functionName: 'getTeams',
  })) as readonly { owner: `0x${string}`; name: string }[];

  // filter out empty/zero addresses just in case
  return (raw ?? []).filter(t => t?.owner && t.owner !== zeroAddress);
}

const zeroAddress = '0x0000000000000000000000000000000000000000';

/**
 * Circle Method round-robin scheduler.
 * Returns an array of rounds; each round is a list of pairings as indices into `teams`.
 * If odd # of teams, one BYE per round.
 */
function buildSeasonSchedule<T>(
  teams: readonly T[],
  weeks: number
): { rounds: { matches: [number, number][], bye?: number }[] } {
  const n = teams.length;
  if (n === 0) return { rounds: [] };
  const odd = n % 2 !== 0;

  // Work on an array of indices
  const indices = Array.from({ length: n + (odd ? 1 : 0) }, (_, i) => i);
  const byeIndex = odd ? indices.length - 1 : -1;

  const rounds: { matches: [number, number][], bye?: number }[] = [];

  // Standard circle algorithm
  for (let r = 0; r < Math.max(weeks, n - 1); r++) {
    const roundPairs: [number, number][] = [];
    let bye: number | undefined;

    for (let i = 0; i < indices.length / 2; i++) {
      const a = indices[i];
      const b = indices[indices.length - 1 - i];

      if (a === byeIndex) { bye = b; continue; }
      if (b === byeIndex) { bye = a; continue; }
      roundPairs.push([a, b]);
    }

    rounds.push({ matches: roundPairs, bye });

    // rotate (keep first fixed)
    const fixed = indices[0];
    const rest = indices.slice(1);
    rest.unshift(rest.pop() as number);
    indices.splice(0, indices.length, fixed, ...rest);
  }

  // Trim to requested weeks
  return { rounds: rounds.slice(0, weeks) };
}

/** ---------- Route ---------- */

export async function GET(
  _req: Request,
  ctx: { params: { address: string; week: string } }
) {
  try {
    const league = getAddress(ctx.params.address) as `0x${string}`;
    const weekParam = Number(ctx.params.week);
    const week = Number.isFinite(weekParam) && weekParam > 0 ? weekParam : 1;

    const teams = await getTeamsOnServer(league);
    if (!teams.length) {
      return NextResponse.json(
        { league, week, pairings: [], message: 'No teams yet' },
        { headers: { 'cache-control': 'no-store' } }
      );
    }

    const { rounds } = buildSeasonSchedule(teams, REG_SEASON_WEEKS);
    const round = rounds[Math.min(week - 1, rounds.length - 1)];

    const pairings: PairingDTO[] = [
      ...(round?.matches ?? []).map(([ai, bi]) => ({
        type: 'match' as const,
        homeOwner: teams[ai].owner,
        awayOwner: teams[bi].owner,
      })),
      ...(typeof round?.bye === 'number'
        ? [{ type: 'bye' as const, owner: teams[round.bye].owner }]
        : []),
    ];

    return NextResponse.json(
      { league, week, pairings },
      { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=59' } }
    );
  } catch (err: any) {
    // surface a clean JSON error instead of HTML
    return NextResponse.json(
      {
        error: 'PAIRINGS_ROUTE_ERROR',
        message: err?.message ?? 'Unknown error',
      },
      { status: 500 }
    );
  }
}
