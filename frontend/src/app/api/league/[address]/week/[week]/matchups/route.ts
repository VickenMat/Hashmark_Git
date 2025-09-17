// src/app/api/league/[address]/week/[week]/matchups/route.ts
import { NextResponse } from 'next/server';
import { buildSeasonSchedule, type Pairing, type Team as SchedTeam } from '@/lib/schedule';
import type { MatchupsResponse, Matchup, Lineup, PlayerScore, PlayerRef } from '@/lib/matchups';

// ---- Minimal chain read for getTeams (server side) ----
// You can use viem (recommended). Provide RPC via env: RPC_URL and CHAIN_ID.
import { createPublicClient, http, parseAbi } from 'viem';
const RPC_URL  = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || '';
const CHAIN_ID = Number(process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || 43114); // example default
const client = RPC_URL
  ? createPublicClient({ transport: http(RPC_URL), chain: { id: CHAIN_ID, name: 'chain', nativeCurrency:{name:'',symbol:'',decimals:18}, rpcUrls:{default:{http:[RPC_URL]}} } as any })
  : null;

const LEAGUE_ABI = parseAbi([
  'function getTeams() view returns (tuple(address owner, string name)[])',
]);

async function getTeamsOnServer(league: `0x${string}`): Promise<SchedTeam[]> {
  if (!client) return []; // fallback: no RPC configured
  const res = await client.readContract({
    address: league,
    abi: LEAGUE_ABI,
    functionName: 'getTeams',
    args: [],
  }) as { owner: `0x${string}`, name: string }[];
  // Filter empties
  return (res || []).filter(t => t.owner && t.owner !== '0x0000000000000000000000000000000000000000');
}

// ---- MOCK scoring (replace with your real feed when ready) ----
function rnd(min:number,max:number){ return +(min + Math.random()*(max-min)).toFixed(2); }
function mockPlayer(name:string, team:string, pos:string, status:'pre'|'live'|'final'): PlayerScore {
  const pr: PlayerRef = { id: `${team}-${name}`, name, team, pos };
  const live = status === 'pre' ? 0 : rnd(2, 22);
  const proj = rnd(6, 18);
  return { player: pr, opp: 'NYJ', kickoff: Math.floor(Date.now()/1000)+3600, status, live, proj };
}
function mockLineup(status:'pre'|'live'|'final'): Lineup {
  const starters = [
    { slot:'QB',   score: mockPlayer('Josh Allen','BUF','QB',  status) },
    { slot:'RB1',  score: mockPlayer('Bijan Robinson','ATL','RB', status) },
    { slot:'RB2',  score: mockPlayer('Aaron Jones','MIN','RB', status) },
    { slot:'WR1',  score: mockPlayer('CeeDee Lamb','DAL','WR', status) },
    { slot:'WR2',  score: mockPlayer('Amon-Ra St. Brown','DET','WR', status) },
    { slot:'FLEX', score: mockPlayer('Jaylen Waddle','MIA','WR', status) },
    { slot:'TE',   score: mockPlayer('T.J. Hockenson','MIN','TE', status) },
    { slot:'K',    score: mockPlayer('Harrison Butker','KC','K', status) },
    { slot:'D/ST', score: mockPlayer('Cowboys D/ST','DAL','D/ST', status) },
  ];
  const bench = [
    { slot:'BENCH', score: mockPlayer('Tua Tagovailoa','MIA','QB', status) },
    { slot:'BENCH', score: mockPlayer('James Cook','BUF','RB', status) },
    { slot:'BENCH', score: mockPlayer('Chris Godwin','TB','WR', status) },
  ];
  const sum = (a:number,b:number)=>a+(b||0);
  const totals = {
    live: starters.map(s=>s.score?.live||0).reduce(sum,0),
    proj: starters.map(s=>s.score?.proj||0).reduce(sum,0),
  };
  return { starters, bench, totals };
}

export async function GET(
  _req: Request,
  { params }: { params: { address: string; week: string } }
) {
  const league = params.address as `0x${string}`;
  const week   = Math.max(1, Number(params.week || '1') || 1);

  // 1) Get current teams from chain
  const teams = await getTeamsOnServer(league);

  // 2) Build the true round-robin schedule for your configured regular season
  const REG_SEASON_WEEKS = Number(process.env.REG_SEASON_WEEKS || 14);
  const round = buildSeasonSchedule(teams, REG_SEASON_WEEKS)[week] || [];

  // 3) Map that to Matchups (mock scoring here; swap with your provider)
  const status: 'pre'|'live'|'final' = 'live';
  const toId = (a?: `0x${string}`, b?: `0x${string}`) => a && b ? `${week}-${a.toLowerCase()}-${b.toLowerCase()}` : `${week}-bye`;
  const matchups: Matchup[] = round
    .filter(p => !p.bye && p.away && p.home)
    .map((p) => ({
      id: toId(p.away!.owner, p.home!.owner),
      league,
      week,
      homeOwner: p.home!.owner,
      awayOwner: p.away!.owner,
      home: mockLineup(status),
      away: mockLineup(status),
      started: status !== 'pre',
      completed: status === 'final',
      updatedAt: Date.now(),
    }));

  const payload: MatchupsResponse = { week, matchups };
  return NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } });
}
