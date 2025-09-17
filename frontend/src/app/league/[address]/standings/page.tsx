'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import { useTeamProfile } from '@/lib/teamProfile';

/* ---------- On-chain ABI ---------- */
const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getTeamByAddress', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'string' }] },
  // Expecting array of (address owner, string name). Loose typing for wagmi:
  { type: 'function', name: 'getTeams', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }, { type: 'string' }] as any },
] as const;

/* ---------- Types / constants ---------- */
const REG_SEASON_WEEKS = 14;

type TeamOnSchedule = { owner: `0x${string}`; name: string };
type Pairing = { away?: TeamOnSchedule; home?: TeamOnSchedule; bye?: `0x${string}` | null };
type WeekStatus = 'pre' | 'live' | 'final';

type StandRow = {
  owner: `0x${string}`;
  name: string;
  gp: number; w: number; l: number; t: number;
  pf: number; pa: number; diff: number; pct: number;
  last3: string; streak: string;
};

const BYE_ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`;

/* ---------- helpers ---------- */
function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(' '); }
function initials(n?: string){ const s=(n||'').trim(); if(!s) return 'TM'; const p=s.split(/\s+/); return ((p[0]?.[0]??'')+(p[1]?.[0]??'')).toUpperCase()||'TM'; }
function short3(a?: string){ if(!a) return '—'; return `${a.slice(0,5)}…${a.slice(-3)}`; }
function num(v:any){ if(v===null||v===undefined) return undefined; if(typeof v==='string'){ const t=v.trim(); if(!t||t==='—') return undefined; const n=Number(t); return Number.isFinite(n)?n:undefined; } if(typeof v==='number'&&Number.isFinite(v)) return v; return undefined; }

/* ---------- localStorage keys (normalized) ---------- */
const lsScheduleKey = (leagueLc: string) => `schedule:${leagueLc}`;
const lsScoresKey   = (leagueLc: string, week: number) => `scores:${leagueLc}:${week}`;
const publishFlagKey = (leagueLc: string) => `published:${leagueLc}`;

function migrateLocalStorageKeys(leagueRaw: string) {
  try {
    const lc = leagueRaw.toLowerCase();
    const oldSchedKey = `schedule:${leagueRaw}`; const newSchedKey = lsScheduleKey(lc);
    if (!localStorage.getItem(newSchedKey) && localStorage.getItem(oldSchedKey)) {
      localStorage.setItem(newSchedKey, localStorage.getItem(oldSchedKey)!);
    }
    for (let w=1; w<=REG_SEASON_WEEKS; w++){
      const oldScoreKey = `scores:${leagueRaw}:${w}`; const newScoreKey = lsScoresKey(lc,w);
      if (!localStorage.getItem(newScoreKey) && localStorage.getItem(oldScoreKey)) {
        localStorage.setItem(newScoreKey, localStorage.getItem(oldScoreKey)!);
      }
    }
  } catch {}
}

/* ---------- shape normalizer ---------- */
function normalizeSchedule(data: any): { pairings: Record<number, Pairing[]>; status: Record<number, WeekStatus> } {
  if (!data) return { pairings: {}, status: {} };
  const pairings = data.pairings ?? data.pairingsByWeek ?? data.schedule ?? {};
  const status   = data.status   ?? data.statusByWeek   ?? data.weekStatus ?? {};
  return { pairings, status };
}

/* ---------- API helpers ---------- */
async function apiGetSchedule(leagueLc: string) {
  try { const r = await fetch(`/api/league/${leagueLc}/schedule`, { cache: 'no-store' }); if (!r.ok) return null; return await r.json(); } catch { return null; }
}
async function apiPostSchedule(leagueLc: string, body: any) {
  try { await fetch(`/api/league/${leagueLc}/schedule`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); } catch {}
}
async function apiGetScores(leagueLc: string, week: number) {
  try { const r = await fetch(`/api/league/${leagueLc}/scores/${week}`, { cache: 'no-store' }); if (!r.ok) return null; return await r.json(); } catch { return null; }
}
async function apiPostScores(leagueLc: string, week: number, body: any) {
  try { await fetch(`/api/league/${leagueLc}/scores/${week}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); } catch {}
}

/* ---------- UI bits ---------- */
function Avatar({ name, url, size = 28 }: { name?: string; url?: string; size?: number }) {
  const safe = name?.trim() || '—';
  const cls = `rounded-lg object-cover ring-1 ring-white/15`;
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={safe} className={cls} style={{ width:size, height:size }} /> :
    <div className={`grid place-items-center bg-white/10 ${cls}`} style={{ width:size, height:size }}>
      <span className="text-[10px] font-semibold">{initials(safe)}</span>
    </div>;
}
function TeamBadge({ name, logo, wallet }: { name?: string; logo?: string; wallet?: `0x${string}` | undefined }) {
  const safe = name?.trim() || '—';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 shadow-sm">
      <Avatar name={safe} url={logo} />
      <div className="leading-tight">
        <div className="text-[10px] text-gray-400">Your Team</div>
        <div className="font-semibold truncate max-w-[220px]" title={safe}>{safe}</div>
        {wallet && <div className="text-[10px] text-gray-500 font-mono truncate max-w-[220px]">{short3(wallet)}</div>}
      </div>
    </div>
  );
}
function TeamCell({ league, owner, fallbackName, highlight }: { league: `0x${string}`; owner: `0x${string}`; fallbackName: string; highlight?: boolean }) {
  const prof = useTeamProfile(league, owner, { name: fallbackName });
  const name = (prof.name || fallbackName || '—').trim();
  const href = `/league/${league}/team/${owner}`;
  return (
    <Link href={href} className="flex items-center gap-2">
      <Avatar name={name} url={prof.logo} />
      <span className={cx('truncate max-w-[220px]', highlight && 'font-semibold')} title={name}>{name}</span>
    </Link>
  );
}
function StatCard({ label, value, sub, hint }: { label: string; value: string | number; sub?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col items-center text-center">
      <div className="text-xs text-gray-400">
        {label}{hint ? <span className="ml-1 text-[10px] text-gray-500">({hint})</span> : null}
      </div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
      {sub ? <div className="text-[10px] text-gray-400 mt-1 font-mono">{sub}</div> : null}
    </div>
  );
}

/* ---------- Page ---------- */
export default function StandingsPage() {
  const { address: leagueParam } = useParams<{ address: `0x${string}` }>();
  const leagueLc = (leagueParam || '').toLowerCase() as `0x${string}`;
  const { address: wallet } = useAccount();

  /* Chain data */
  const { data: leagueName } = useReadContract({ abi: LEAGUE_ABI, address: leagueParam, functionName: 'name' });
  const { data: onChainMyName } = useReadContract({
    abi: LEAGUE_ABI, address: leagueParam, functionName: 'getTeamByAddress',
    args: [wallet ?? BYE_ZERO], query: { enabled: !!wallet },
  });
  const { data: teamsData } = useReadContract({ abi: LEAGUE_ABI, address: leagueParam, functionName: 'getTeams' });

  const profile = useTeamProfile(leagueParam, wallet, { name: onChainMyName as string });
  const myDisplayName = (profile.name || (onChainMyName as string) || '').trim() || undefined;

  /* Shared schedule + scores (API-first, local fallback; auto-publish once) */
  const [pairingsByWeek, setPairingsByWeek] = useState<Record<number, Pairing[]>>({});
  const [statusByWeek, setStatusByWeek] = useState<Record<number, WeekStatus>>({});
  const [scoresByWeek, setScoresByWeek] = useState<Record<number, Record<string, { live?: number | string; proj?: number | string }>>>({});

  useEffect(() => {
    if (!leagueLc) return;
    migrateLocalStorageKeys(leagueParam);

    let cancelled = false;
    (async () => {
      // 1) API-first read
      const apiRaw = await apiGetSchedule(leagueLc);
      const apiNorm = normalizeSchedule(apiRaw);
      const apiEmpty = !Object.keys(apiNorm.pairings || {}).length && !Object.keys(apiNorm.status || {}).length;

      // 2) Auto-publish once if API empty but local has data
      if (apiEmpty) {
        try {
          const already = localStorage.getItem(publishFlagKey(leagueLc));
          const raw = localStorage.getItem(lsScheduleKey(leagueLc));
          const parsed = normalizeSchedule(raw ? JSON.parse(raw) : null);
          if (!already && (Object.keys(parsed.pairings||{}).length || Object.keys(parsed.status||{}).length)) {
            await apiPostSchedule(leagueLc, parsed);
            for (let w=1; w<=REG_SEASON_WEEKS; w++){
              const sraw = localStorage.getItem(lsScoresKey(leagueLc, w));
              if (sraw) {
                const sObj = JSON.parse(sraw);
                if (Object.keys(sObj || {}).length) await apiPostScores(leagueLc, w, sObj);
              }
            }
            localStorage.setItem(publishFlagKey(leagueLc), '1');
          }
        } catch {}
      }

      // 3) Use API if present; else fallback local
      const apiRaw2 = await apiGetSchedule(leagueLc);
      const finalNorm = normalizeSchedule(apiRaw2);
      if (!cancelled && (finalNorm.pairings || finalNorm.status)) {
        setPairingsByWeek(finalNorm.pairings || {});
        setStatusByWeek(finalNorm.status || {});
      } else {
        try {
          const raw = localStorage.getItem(lsScheduleKey(leagueLc));
          const parsed = normalizeSchedule(raw ? JSON.parse(raw) : null);
          if (!cancelled) {
            setPairingsByWeek(parsed.pairings || {});
            setStatusByWeek(parsed.status || {});
          }
        } catch {}
      }

      // 4) Preload scores all weeks (idle)
      const loadScores = async () => {
        const scores: Record<number, Record<string, { live?: number | string; proj?: number | string }>> = {};
        for (let w=1; w<=REG_SEASON_WEEKS; w++){
          const apiScores = await apiGetScores(leagueLc, w);
          if (apiScores && Object.keys(apiScores).length) { scores[w] = apiScores; continue; }
          try { const raw = localStorage.getItem(lsScoresKey(leagueLc, w)); if (raw) scores[w] = JSON.parse(raw); } catch {}
        }
        if (!cancelled) setScoresByWeek(scores);
      };
      const idle = (cb: () => void) => {
        if (typeof (window as any).requestIdleCallback === 'function') (window as any).requestIdleCallback(cb, { timeout: 1200 });
        else setTimeout(cb, 200);
      };
      idle(loadScores);
    })();

    return () => { cancelled = true; };
  }, [leagueLc, leagueParam]);

  /* ---------- Standings math ---------- */
  const rows = useMemo<StandRow[]>(() => {
    if (!leagueLc) return [];

    const onChainTeams: { owner: `0x${string}`; name: string }[] =
      ((teamsData as any) as { owner: `0x${string}`; name: string }[]) || [];

    const allOwners = new Map<string, { owner: `0x${string}`; name: string }>();
    // include chain teams so page isn't blank
    for (const t of onChainTeams) allOwners.set(t.owner.toLowerCase(), t);

    // include any owners found in schedule
    for (const w of Object.keys(pairingsByWeek)) {
      const ps = pairingsByWeek[Number(w)] || [];
      for (const p of ps) {
        if (p.away?.owner) allOwners.set(p.away.owner.toLowerCase(), { owner: p.away.owner, name: p.away.name });
        if (p.home?.owner) allOwners.set(p.home.owner.toLowerCase(), { owner: p.home.owner, name: p.home.name });
        if (p.bye) allOwners.set(p.bye.toLowerCase(), { owner: p.bye, name: allOwners.get(p.bye.toLowerCase())?.name || '' });
      }
    }

    // seed rows
    const base: Record<string, StandRow> = {};
    for (const { owner, name } of allOwners.values()) {
      base[owner.toLowerCase()] = { owner, name: (name||'').trim(), gp:0,w:0,l:0,t:0,pf:0,pa:0,diff:0,pct:0,last3:'',streak:'' };
    }

    const history: Record<string, string[]> = {};
    const pushRes = (addr: `0x${string}`, res:'W'|'L'|'T') => { const k=addr.toLowerCase(); (history[k] ||= []).push(res); };

    for (let w=1; w<=REG_SEASON_WEEKS; w++){
      const includeRes = statusByWeek[w] === 'live' || statusByWeek[w] === 'final';
      const pairings = pairingsByWeek[w] || [];
      const weekScores = scoresByWeek[w] || {};

      for (const m of pairings){
        if (m.bye || !m.away || !m.home) continue;

        const aKey = m.away.owner.toLowerCase();
        const hKey = m.home.owner.toLowerCase();

        const aScore = num(weekScores[aKey]?.live);
        const hScore = num(weekScores[hKey]?.live);

        if (includeRes){
          if (typeof aScore==='number') base[aKey].pf += aScore;
          if (typeof hScore==='number') base[hKey].pf += hScore;
          if (typeof hScore==='number') base[aKey].pa += hScore;
          if (typeof aScore==='number') base[hKey].pa += aScore;
        }

        if (includeRes && typeof aScore==='number' && typeof hScore==='number'){
          base[aKey].gp += 1; base[hKey].gp += 1;
          if (aScore>hScore){ base[aKey].w += 1; base[hKey].l += 1; pushRes(m.away.owner,'W'); pushRes(m.home.owner,'L'); }
          else if (aScore<hScore){ base[hKey].w += 1; base[aKey].l += 1; pushRes(m.home.owner,'W'); pushRes(m.away.owner,'L'); }
          else { base[aKey].t += 1; base[hKey].t += 1; pushRes(m.home.owner,'T'); pushRes(m.away.owner,'T'); }
        }
      }
    }

    const out = Object.values(base).map(r=>{
      const pct = r.gp ? (r.w + 0.5*r.t)/r.gp : 0;
      const diff = r.pf - r.pa;
      const hist = history[r.owner.toLowerCase()] || [];
      let streak = '—';
      if (hist.length){ const last=hist[hist.length-1]; let n=1; for(let i=hist.length-2;i>=0;i--){ if(hist[i]===last) n++; else break; } streak = `${last}${n}`; }
      const last3 = hist.slice(-3).join('-') || '—';
      return { ...r, pct, diff, streak, last3 };
    });

    out.sort((a,b)=> b.pct!==a.pct ? b.pct-a.pct : b.pf!==a.pf ? b.pf-a.pf : a.pa-b.pa || a.name.localeCompare(b.name));
    return out;
  }, [leagueLc, teamsData, pairingsByWeek, statusByWeek, scoresByWeek]);

  /* ---------- Advanced stats (always visible) ---------- */
  const leagueDefaults = useMemo(() => {
    const onChainTeams: { owner: `0x${string}`; name: string }[] =
      ((teamsData as any) as { owner: `0x${string}`; name: string }[]) || [];
    return { totalTeams: onChainTeams.length };
  }, [teamsData]);

  const advancedLeague = useMemo(() => {
    if (!rows.length) {
      return {
        totalTeams: leagueDefaults.totalTeams, totalGames: 0,
        avgPFPerTeam: 0, avgPAPerTeam: 0,
        offenseLeader: { owner: '0x0000000000000000000000000000000000000000' as `0x${string}`, pf: 0 } as any,
        defenseLeader: { owner: '0x0000000000000000000000000000000000000000' as `0x${string}`, pa: 0 } as any,
        bestPct: { owner: '0x0000000000000000000000000000000000000000' as `0x${string}`, pct: 0 } as any,
        parityIndex: 0,
      };
    }
    const totalTeams = rows.length;
    const totalGames = rows.reduce((s,r)=>s+r.gp,0)/2;
    const avgPFPerTeam = rows.reduce((s,r)=>s+r.pf,0)/totalTeams;
    const avgPAPerTeam = rows.reduce((s,r)=>s+r.pa,0)/totalTeams;
    const offenseLeader = [...rows].sort((a,b)=>b.pf-a.pf)[0];
    const defenseLeader = [...rows].sort((a,b)=>a.pa-b.pa)[0];
    const bestPct = [...rows].sort((a,b)=>b.pct-a.pct)[0];
    const meanPct = rows.reduce((s,r)=>s+r.pct,0)/totalTeams;
    const variance = rows.reduce((s,r)=>s+Math.pow(r.pct-meanPct,2),0)/totalTeams;
    const parityIndex = Math.sqrt(variance);
    return { totalTeams,totalGames,avgPFPerTeam,avgPAPerTeam,offenseLeader,defenseLeader,bestPct,parityIndex };
  }, [rows, leagueDefaults]);

  const myStats = useMemo(() => {
    const zero = { rank:0, record:'0-0', winPct:0, pf:0, pa:0, diff:0, ppg:0, pag:0, streak:'—', last3:'—' };
    if (!wallet || !rows.length) return zero;
    const idx = rows.findIndex(r=>r.owner.toLowerCase()===wallet.toLowerCase());
    if (idx===-1) return zero;
    const r = rows[idx];
    const rank = idx+1;
    const winPct = r.pct*100;
    const ppg = r.gp ? r.pf/r.gp : 0;
    const pag = r.gp ? r.pa/r.gp : 0;
    return { rank, record:`${r.w}-${r.l}${r.t?`-${r.t}`:''}`, winPct, pf:r.pf, pa:r.pa, diff:r.diff, ppg, pag, streak:r.streak, last3:r.last3 };
  }, [rows, wallet]);

  /* ---------- table header ---------- */
  const HEADERS: Array<{ key: string; title: string; align?: 'left'|'center' }> = [
    { key:'rank', title:'Rank', align:'center' },
    { key:'team', title:'Team', align:'left' }, // left-justified team name
    { key:'owner', title:'Owner', align:'center' },
    { key:'w', title:'W', align:'center' },
    { key:'l', title:'L', align:'center' },
    { key:'t', title:'T', align:'center' },
    { key:'pct', title:'PCT', align:'center' },
    { key:'pf', title:'PF', align:'center' },
    { key:'pa', title:'PA', align:'center' },
    { key:'diff', title:'DIFF', align:'center' },
    { key:'strk', title:'STRK', align:'center' },
    { key:'l3', title:'L3', align:'center' },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header: centered title + boxy pill */}
        <header className="grid grid-cols-3 items-center">
          <div className="h-10" />
          <h1 className="text-3xl font-extrabold text-center">Standings</h1>
          <div className="flex justify-end">
            <TeamBadge name={myDisplayName || (leagueName as string)} logo={profile.logo} wallet={wallet} />
          </div>
        </header>

        {/* Table */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-6 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="text-gray-400 text-xs uppercase tracking-wide">
              <tr className="border-b border-white/10">
                {HEADERS.map(h => (
                  <th key={h.key} className={cx('py-2 px-2', h.key==='rank'?'w-14':'', h.align==='left'?'text-left':'text-center')}>
                    {h.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-gray-100 text-sm">
              {rows.map((r, i) => {
                const isMe = wallet && r.owner.toLowerCase() === wallet.toLowerCase();
                const fallbackName = isMe ? (myDisplayName || r.name || '—') : (r.name || '—');
                return (
                  <tr key={r.owner} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 px-2 text-center tabular-nums">{i + 1}</td>
                    <td className="py-2 px-2">
                      <TeamCell league={leagueParam} owner={r.owner} fallbackName={fallbackName} highlight={!!isMe} />
                    </td>
                    <td className="py-2 px-2 text-center font-mono text-gray-300">{short3(r.owner)}</td>
                    <td className="py-2 px-2 text-center tabular-nums">{r.w}</td>
                    <td className="py-2 px-2 text-center tabular-nums">{r.l}</td>
                    <td className="py-2 px-2 text-center tabular-nums">{r.t}</td>
                    {/* PCT: show 0.0% when gp = 0 */}
                    <td className="py-2 px-2 text-center tabular-nums">{`${(r.gp ? r.pct*100 : 0).toFixed(1)}%`}</td>
                    <td className="py-2 px-2 text-center tabular-nums">{r.pf.toFixed(2)}</td>
                    <td className="py-2 px-2 text-center tabular-nums">{r.pa.toFixed(2)}</td>
                    <td className={cx('py-2 px-2 text-center tabular-nums', r.diff===0?'':r.diff>0?'text-emerald-300':'text-rose-300')}>{r.diff.toFixed(2)}</td>
                    <td className="py-2 px-2 text-center">{r.streak}</td>
                    <td className="py-2 px-2 text-center">{r.last3}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={12} className="py-8 text-center text-gray-400">No standings yet. Add a schedule and scores to see live standings.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Your Advanced Stats (always visible) */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-lg font-semibold mb-3 text-center">Your Advanced Stats</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Rank" value={myStats.rank} />
            <StatCard label="Record" value={myStats.record} />
            <StatCard label="Win %" value={`${myStats.winPct.toFixed(1)}%`} />
            <StatCard label="Streak / Last 3" value={myStats.streak} sub={myStats.last3} />
            <StatCard label="PF / PA" value={`${myStats.pf.toFixed(1)} / ${myStats.pa.toFixed(1)}`} />
            <StatCard label="Diff" value={myStats.diff.toFixed(1)} />
            <StatCard label="PPG" value={myStats.ppg.toFixed(1)} />
            <StatCard label="PAG (against)" value={myStats.pag.toFixed(1)} />
          </div>
        </section>

        {/* Advanced League Stats (always visible) */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-lg font-semibold mb-3 text-center">Advanced League Stats</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Teams" value={advancedLeague.totalTeams} />
            <StatCard label="Total Games" value={advancedLeague.totalGames} />
            <StatCard label="Avg PF / Team" value={advancedLeague.avgPFPerTeam.toFixed(1)} />
            <StatCard label="Avg PA / Team" value={advancedLeague.avgPAPerTeam.toFixed(1)} />
            <StatCard label="Top Offense (PF)" value={advancedLeague.offenseLeader.pf.toFixed(1)} sub={short3(advancedLeague.offenseLeader.owner)} />
            <StatCard label="Top Defense (PA)" value={advancedLeague.defenseLeader.pa.toFixed(1)} sub={short3(advancedLeague.defenseLeader.owner)} />
            <StatCard label="Best Win%" value={`${(advancedLeague.bestPct.pct*100).toFixed(1)}%`} sub={short3(advancedLeague.bestPct.owner)} />
            <StatCard label="Parity Index σ(PCT)" value={advancedLeague.parityIndex.toFixed(3)} hint="Lower = more parity" />
          </div>
        </section>

        <p className="text-[11px] text-gray-500">
          Standings read the shared league API (<span className="font-mono">/api/league/&lt;league&gt;/schedule</span> and
          <span className="font-mono"> /scores/&lt;week&gt;</span>). League address is normalized to lowercase across API,
          local storage, and comparisons. If the API is empty and this browser has local data, the page auto-publishes once.
        </p>
      </div>
    </main>
  );
}
