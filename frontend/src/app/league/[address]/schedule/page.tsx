// src/app/league/[address]/schedule/page.tsx
'use client';

import Link from 'next/link';
import { useMemo, useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import { useTeamProfile, generatedLogoFor } from '@/lib/teamProfile';
import {
  buildSeasonSchedule,
  normalizeWeek,
  validateWeek,
  type Team as SchedTeam,
  type Pairing as SchedPairing,
} from '@/lib/schedule';

/* ---------------- Chain / ABI ---------------- */

const ZERO = '0x0000000000000000000000000000000000000000';
const REG_SEASON_WEEKS = 14;         // tweak if you like
const CACHE_VERSION = 'sched.v3';    // bump to force regeneration

const LEAGUE_ABI = [
  { type:'function', name:'name', stateMutability:'view', inputs:[], outputs:[{type:'string'}] },
  { type:'function', name:'getTeamByAddress', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'string'}] },
  {
    type:'function',
    name:'getTeams',
    stateMutability:'view',
    inputs:[],
    outputs:[{
      type:'tuple[]',
      components:[ { name:'owner', type:'address' }, { name:'name', type:'string' } ],
    }],
  },
] as const;

type Team = { owner: `0x${string}`; name: string };
type Pairing = SchedPairing;

/* ---------------- Tiny UI helpers ---------------- */

function initials(n?: string){
  const s=(n||'').trim(); if(!s) return 'TM';
  const p=s.split(/\s+/); return ((p[0]?.[0]??'')+(p[1]?.[0]??'')).toUpperCase() || 'TM';
}
function Avatar({ name, url, size='7' }:{ name?:string; url?:string; size?:'6'|'7'|'8' }){
  const safe = name?.trim() || '—';
  const cls = `h-${size} w-${size} rounded-lg object-cover ring-1 ring-white/15`;
  return url
    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={url} alt={safe} className={cls}/>
    : <div className={`h-${size} w-${size} rounded-lg bg-white/10 grid place-items-center text-[10px] font-semibold`}>{initials(safe)}</div>;
}
const shortWallet = (addr?: string, head=4, tail=4) =>
  !addr ? '—' : addr.length <= head+tail+2 ? addr : `${addr.slice(0,2+head)}…${addr.slice(-tail)}`;

/* --------- My Stats (stubbed) --------- */
const myStats = { record: '0-0-0', rank: 1, totalTeams: 12, homeWins: 0, awayWins: 0, pointsFor: 0, pointsAgainst: 0 };
function StatBox({ label, value }: { label:string; value:string|number }){
  return (
    <div className="flex flex-col items-center px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

/* -------- Stubs for records / scores -------- */
const recordsByWeek: Record<number, Record<string,{w:number;l:number;t:number}>> = {};
const scoresByWeek:  Record<number, Record<string,{projected:number|string; live:number|string}>> = {};
const fmtRec = (r?: {w:number;l:number;t:number}) => r ? `${r.w}-${r.l}-${r.t}` : '0-0-0';
const score = (w:number, addr:`0x${string}`) => {
  const m = scoresByWeek[w]?.[addr.toLowerCase()];
  return { projected: m?.projected ?? '—', live: m?.live ?? '—' };
};

/* ---------------- Persistence + signatures ---------------- */

type WeekStatus = 'pre'|'live'|'final';

const storageKey = (league:`0x${string}`) => `schedule:${league}`;
const rosterSignature = (teams: Team[]) =>
  `${CACHE_VERSION}:${REG_SEASON_WEEKS}:${teams.map(t=>t.owner.toLowerCase()).sort().join(',')}`;

/* ---------------- Page ---------------- */

export default function SchedulePage(){
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const { address: wallet } = useAccount();

  useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' }); // not displayed yet
  const { data: myOnChain }  = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName:'getTeamByAddress',
    args:[wallet ?? ZERO], query:{ enabled: !!wallet }
  });
  const { data: teamsRaw }   = useReadContract({ abi: LEAGUE_ABI, address: league, functionName:'getTeams' });

  const myProfile     = useTeamProfile(league, wallet, { name: myOnChain as string });
  const myDisplayName = (myProfile.name || (myOnChain as string) || '').trim() || undefined;
  const myLogo        = (wallet && (myProfile.logo || generatedLogoFor(wallet))) || undefined;

  const teams: Team[] = useMemo(()=>{
    const list = (teamsRaw as unknown as Team[] | undefined) ?? [];
    return list.filter(t => t.owner && (t.owner as string).toLowerCase() !== ZERO);
  }, [teamsRaw]);

  const [pairingsByWeek, setPairingsByWeek] = useState<Record<number, Pairing[]>>({});
  const [weekStatus, setWeekStatus] = useState<Record<number, WeekStatus>>({});
  const [cacheSig, setCacheSig] = useState<string | null>(null);

  // history stacks for UNDO
  const [historyPairings, setHistoryPairings] = useState<Record<number, Pairing[][]>>({});
  const [historyStatus,   setHistoryStatus]   = useState<Record<number, WeekStatus[]>>({});

  // Seed or re-seed when roster or logic changes
  useEffect(()=>{
    if (!league) return;
    try{
      const raw = localStorage.getItem(storageKey(league));
      const sigNow = rosterSignature(teams);
      if (raw){
        const parsed = JSON.parse(raw) as { pairings: Record<number, Pairing[]>; status: Record<number, WeekStatus>; sig?: string };
        if (parsed.sig !== sigNow) {
          const fresh = freshSchedule(teams);
          setPairingsByWeek(fresh.pairings);
          setWeekStatus(fresh.status);
          setCacheSig(sigNow);
          persist(fresh.pairings, fresh.status, sigNow);
        } else {
          setPairingsByWeek(parsed.pairings || {});
          setWeekStatus(parsed.status || {});
          setCacheSig(parsed.sig || sigNow);
        }
      } else {
        const fresh = freshSchedule(teams);
        setPairingsByWeek(fresh.pairings);
        setWeekStatus(fresh.status);
        setCacheSig(sigNow);
        persist(fresh.pairings, fresh.status, sigNow);
      }
    }catch{}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, teams.length]);

  useEffect(()=>{
    if (!league) return;
    const sigNow = rosterSignature(teams);
    if (cacheSig && sigNow !== cacheSig) {
      const fresh = freshSchedule(teams);
      setPairingsByWeek(fresh.pairings);
      setWeekStatus(fresh.status);
      setCacheSig(sigNow);
      persist(fresh.pairings, fresh.status, sigNow);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams]);

  function freshSchedule(tms: Team[]){
    const sched = buildSeasonSchedule((tms as unknown as SchedTeam[]), REG_SEASON_WEEKS);
    for (let w=1; w<=REG_SEASON_WEEKS; w++) sched[w] = normalizeWeek(sched[w] ?? [], tms);
    const st: Record<number, WeekStatus> = {};
    for(let w=1; w<=REG_SEASON_WEEKS; w++) st[w] = 'pre';
    return { pairings: sched, status: st };
  }

  function persist(nextPairings: Record<number, Pairing[]>, nextStatus: Record<number, WeekStatus>, sig = cacheSig){
    try{
      localStorage.setItem(storageKey(league), JSON.stringify({ pairings: nextPairings, status: nextStatus, sig }));
    }catch{}
  }

  /* ------- Editing state ------- */
  const [editingWeek, setEditingWeek] = useState<number|null>(null);
  const [selectedAddrs, setSelectedAddrs] = useState<Set<string>>(new Set());
  const [editingStatus, setEditingStatus] = useState<WeekStatus>('pre');

  useEffect(()=>{
    if (editingWeek==null) return;
    setEditingStatus(weekStatus[editingWeek] ?? 'pre');
  }, [editingWeek, weekStatus]);

  /* ------- Lookup ------- */

  const teamMap = useMemo(()=>{
    const m = new Map<string, Team>();
    for (const t of teams) m.set(t.owner.toLowerCase(), t);
    return m;
  }, [teams]);
  const getTeam = (addr:`0x${string}`): Team =>
    teamMap.get(addr.toLowerCase()) ?? { owner: addr, name: 'Team' };

  function findPos(rows: Pairing[], addrLower: string){
    for (let i=0;i<rows.length;i++){
      const r = rows[i];
      if ('away' in r && r.away?.owner.toLowerCase()===addrLower) return { i, side:'away' as const };
      if ('home' in r && r.home?.owner.toLowerCase()===addrLower) return { i, side:'home' as const };
      if ('bye' in r && r.bye?.toLowerCase()===addrLower)          return { i, side:'bye'  as const };
    }
    return null;
  }

  function pushHistory(week:number){
    setHistoryPairings(p=>({ ...p, [week]: [ ...(p[week]??[]), JSON.parse(JSON.stringify(pairingsByWeek[week] ?? [])) ] }));
    setHistoryStatus  (p=>({ ...p, [week]: [ ...(p[week]??[]), (weekStatus[week] ?? 'pre') ] }));
  }

  function undoWeek(){
    if (editingWeek == null) return;
    const w = editingWeek;

    setHistoryPairings(prev=>{
      const stack = [...(prev[w] ?? [])];
      if (!stack.length) return prev;
      const lastPairs = stack.pop()!;
      setPairingsByWeek(pb=>({ ...pb, [w]: lastPairs }));
      persist({ ...pairingsByWeek, [w]: lastPairs }, weekStatus);
      return { ...prev, [w]: stack };
    });

    setHistoryStatus(prev=>{
      const stack = [...(prev[w] ?? [])];
      if (!stack.length) return prev;
      const lastStatus = stack.pop()!;
      setEditingStatus(lastStatus);
      setWeekStatus(ws=>({ ...ws, [w]: lastStatus }));
      persist(pairingsByWeek, { ...weekStatus, [w]: lastStatus });
      return { ...prev, [w]: stack };
    });
  }

  function resetWeek(){
    if (editingWeek == null) return;
    const { pairings } = freshSchedule(teams);
    const rebuilt = pairings[editingWeek] ?? [];
    const nextPairs = { ...pairingsByWeek, [editingWeek]: rebuilt };
    const nextStatus = { ...weekStatus, [editingWeek]: 'pre' as WeekStatus };
    setPairingsByWeek(nextPairs);
    setWeekStatus(nextStatus);
    setHistoryPairings(h=>({ ...h, [editingWeek]: [] }));
    setHistoryStatus(h=>({ ...h, [editingWeek]: [] }));
    persist(nextPairs, nextStatus);
    setSelectedAddrs(new Set());
  }

  /* ------- Editing actions (hardened) ------- */

  // Selected team -> BYE (opponent BYE too)
  const assignBye = () => {
    if (editingWeek == null || selectedAddrs.size !== 1) return;
    const [addr] = Array.from(selectedAddrs);
    const key = addr.toLowerCase();

    pushHistory(editingWeek);
    setPairingsByWeek(prev=>{
      let rows = [...(prev[editingWeek] ?? [])];
      const pos = findPos(rows, key);
      if (!pos) return prev;

      if (pos.side === 'bye') {
        rows = normalizeWeek(rows, teams);
      } else {
        const row = rows[pos.i] as Extract<Pairing, { away: Team; home: Team }>;
        const me   = (row as any)[pos.side] as Team;
        const opp  = (pos.side === 'away' ? row.home : row.away) as Team;
        rows.splice(pos.i, 1, { bye: me.owner }, { bye: opp.owner });
        rows = normalizeWeek(rows, teams);
      }
      const next = { ...prev, [editingWeek]: rows };
      persist(next, weekStatus); return next;
    });
    setSelectedAddrs(new Set());
  };

  // Swap two selections (BYE↔match or match↔match)
  const switchTeams = () => {
    if (editingWeek == null || selectedAddrs.size !== 2) return;
    const [a,b] = Array.from(selectedAddrs);
    const la = a.toLowerCase(), lb = b.toLowerCase();

    pushHistory(editingWeek);
    setPairingsByWeek(prev=>{
      let rows = [...(prev[editingWeek] ?? [])];
      const posA = findPos(rows, la); const posB = findPos(rows, lb);
      if (!posA || !posB) return prev;
      if (posA.side === 'bye' && posB.side === 'bye') return prev; // use Create Matchup

      const put = (ri:number, side:'away'|'home', t:Team) => {
        const r = rows[ri] as Extract<Pairing, { away: Team; home: Team }>;
        side==='away' ? r.away = t : r.home = t;
        rows[ri] = { ...r };
      };

      if (posA.side === 'bye' || posB.side === 'bye') {
        const byePos = posA.side==='bye' ? posA : posB;
        const matchPos = posA.side==='bye' ? posB : posA;
        const byeAddr  = posA.side==='bye' ? a as `0x${string}` : b as `0x${string}`;

        const mr = rows[matchPos.i] as Extract<Pairing, { away: Team; home: Team }>;
        const displaced = (mr as any)[matchPos.side] as Team;
        put(matchPos.i, matchPos.side, getTeam(byeAddr));
        rows[byePos.i] = { bye: displaced.owner };
      } else {
        if (posA.i === posB.i) {
          const row = rows[posA.i] as Extract<Pairing, { away: Team; home: Team }>;
          const tmp = row.away; row.away = row.home; row.home = tmp;
          rows[posA.i] = { ...row };
        } else {
          const rowA = rows[posA.i] as Extract<Pairing, { away: Team; home: Team }>;
          const rowB = rows[posB.i] as Extract<Pairing, { away: Team; home: Team }>;
          const teamA = (rowA as any)[posA.side] as Team;
          const teamB = (rowB as any)[posB.side] as Team;
          (rowA as any)[posA.side] = teamB;
          (rowB as any)[posB.side] = teamA;
          rows[posA.i] = { ...rowA }; rows[posB.i] = { ...rowB };
        }
      }

      rows = normalizeWeek(rows, teams);
      const next = { ...prev, [editingWeek]: rows };
      persist(next, weekStatus); return next;
    });
    setSelectedAddrs(new Set());
  };

  // Two BYEs -> create a matchup
  const createMatchup = () => {
    if (editingWeek == null || selectedAddrs.size !== 2) return;
    const [a,b] = Array.from(selectedAddrs).map(s=>s.toLowerCase());
    pushHistory(editingWeek);
    setPairingsByWeek(prev=>{
      let rows = [...(prev[editingWeek] ?? [])];
      const pa = findPos(rows, a); const pb = findPos(rows, b);
      if (!pa || !pb || pa.side!=='bye' || pb.side!=='bye') return prev;

      const idxs = [pa.i, pb.i].sort((x,y)=>y-x);
      for (const i of idxs) rows.splice(i,1);

      const ta = getTeam(`0x${a.slice(2)}` as `0x${string}`);
      const tb = getTeam(`0x${b.slice(2)}` as `0x${string}`);
      const pair = a < b ? { away: ta, home: tb } : { away: tb, home: ta };
      rows.push(pair);

      rows = normalizeWeek(rows, teams);
      const next = { ...prev, [editingWeek]: rows };
      persist(next, weekStatus); return next;
    });
    setSelectedAddrs(new Set());
  };

  const saveChanges = () => {
    if (editingWeek == null) return;
    // soft validation (won’t block save, but we could if desired)
    const errs = validateWeek(pairingsByWeek[editingWeek] ?? [], teams);
    if (errs.length) console.warn('Schedule warnings:', errs);

    const nextStatus = { ...weekStatus, [editingWeek]: editingStatus };
    setWeekStatus(nextStatus);
    persist(pairingsByWeek, nextStatus);
    setEditingWeek(null);
    setSelectedAddrs(new Set());
  };

  const statusChip = (w:number) => {
    const s:WeekStatus = weekStatus[w] ?? 'pre';
    if (s==='final')  return { label:'Completed', tone:'neutral' as const };
    if (s==='live')   return { label:'Live',      tone:'purple'  as const };
    return              { label:'Pre-game',       tone:'blue'    as const };
  };

  const canUndo = editingWeek!=null && ((historyPairings[editingWeek!]?.length ?? 0) > 0 || (historyStatus[editingWeek!]?.length ?? 0) > 0);
  const weekLocked = editingWeek!=null && (weekStatus[editingWeek] === 'final');

  /* ---------------- Render ---------------- */

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-4 sm:px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Title bar — centered "Schedule" + clickable team pill */}
        <div className="grid grid-cols-3 items-start">
          <div />
          <div className="text-center">
            <h1 className="text-3xl font-extrabold">Schedule</h1>
          </div>
          <div className="justify-self-end">
            {wallet && (
              <a
                href={`/league/${league}/team/${wallet}`}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 hover:bg-white/10 transition"
              >
                <Avatar name={myDisplayName || 'Team'} url={myLogo as string} />
                <div className="leading-tight">
                  <div className="text-base font-semibold truncate max-w-[180px]">
                    {(myDisplayName || 'Team').trim()}
                  </div>
                  <div className="text-[11px] text-gray-400 font-mono">
                    {shortWallet(wallet)}
                  </div>
                </div>
              </a>
            )}
          </div>
        </div>

        {/* My Stats (compact) */}
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
            <StatBox label="Record" value={myStats.record}/>
            <StatBox label="Rank" value={`#${myStats.rank} / ${myStats.totalTeams}`}/>
            <StatBox label="Home Wins" value={myStats.homeWins}/>
            <StatBox label="Away Wins" value={myStats.awayWins}/>
            <StatBox label="Points For" value={myStats.pointsFor}/>
            <StatBox label="Points Against" value={myStats.pointsAgainst}/>
          </div>
        </section>

        {/* EDIT MODE */}
        {editingWeek != null ? (
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-lg font-semibold">Edit NFL Week {editingWeek}</h2>
                <span className="text-[11px] text-gray-400 hidden sm:inline">
                  Select teams (2 to swap, 1 to set BYE). Two BYE teams can be paired.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">Status:</label>
                <select
                  value={editingStatus}
                  onChange={(e)=>setEditingStatus(e.target.value as WeekStatus)}
                  className="rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-sm"
                >
                  <option value="pre">Pre-game</option>
                  <option value="live">Live</option>
                  <option value="final">Completed</option>
                </select>
              </div>
            </div>

            {/* Slim toolbar */}
            {(() => {
              const rows = pairingsByWeek[editingWeek] ?? [];
              const arr = Array.from(selectedAddrs);
              const byesSelected = arr.filter(a => findPos(rows, a.toLowerCase())?.side === 'bye');
              const exactlyTwoByes = byesSelected.length === 2 && arr.length === 2;

              const Btn = ({children, disabled, onClick, tone='neutral', title}:{children:React.ReactNode; disabled?:boolean; onClick?:()=>void; tone?:'neutral'|'accent'|'danger'|'success'|'muted'; title?:string})=>{
                const styles = {
                  neutral: 'border-white/15 bg-white/[0.05] hover:bg-white/[0.1]',
                  accent:  'border-fuchsia-500/30 bg-fuchsia-600/20 text-fuchsia-100 hover:border-fuchsia-400/60',
                  success: 'border-emerald-500/30 bg-emerald-600/20 text-emerald-100 hover:border-emerald-400/60',
                  danger:  'border-rose-500/30 bg-rose-600/20 text-rose-100 hover:border-rose-400/60',
                  muted:   'border-white/10 bg-white/[0.03]',
                }[tone];
                return (
                  <button
                    onClick={onClick}
                    disabled={disabled || weekLocked}
                    title={title}
                    className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50 ${styles}`}
                  >
                    {children}
                  </button>
                );
              };

              return (
                <div className="flex flex-wrap items-center gap-2">
                  <Btn onClick={assignBye} disabled={selectedAddrs.size!==1} title="Selected team + opponent get BYE">Assign BYE</Btn>
                  <Btn onClick={switchTeams} disabled={selectedAddrs.size!==2} tone="accent" title="Swap teams (supports BYE↔match)">Switch</Btn>
                  <Btn onClick={createMatchup} disabled={!exactlyTwoByes} tone="success" title="Make a match from two BYE teams">Create Matchup</Btn>
                  <span className="flex-1" />
                  <Btn onClick={undoWeek} disabled={!canUndo} tone="muted">Undo</Btn>
                  <Btn onClick={resetWeek} tone="muted" title="Rebuild week from defaults">Reset</Btn>
                  <button
                    onClick={saveChanges}
                    disabled={weekLocked}
                    className="rounded-lg bg-purple-600 hover:bg-purple-700 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                  >
                    Save Changes
                  </button>
                  <Btn onClick={()=>{ setEditingWeek(null); setSelectedAddrs(new Set()); }} tone="neutral">Cancel</Btn>
                </div>
              );
            })()}

            {/* Unified editable list (less clutter than table) */}
            <EditableWeekList
              league={league}
              week={editingWeek}
              rows={(pairingsByWeek[editingWeek] ?? [])}
              selectedAddrs={selectedAddrs}
              onToggle={(addr)=>setSelectedAddrs(s=>{
                const n=new Set(s); const k=addr.toLowerCase();
                n.has(k) ? n.delete(k) : n.add(k); return n;
              })}
            />
          </section>
        ) : (
          /* VIEW MODE */
          Array.from({ length: REG_SEASON_WEEKS }, (_, i)=>i+1).map((week) => {
            const rows = pairingsByWeek[week] ?? [];
            const st = statusChip(week);
            const locked = weekStatus[week]==='final';
            return (
              <section key={`week-${week}`} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold">NFL Week {week}</h2>
                  <Chip tone={st.tone}>{st.label}</Chip>
                  <div className="ml-auto">
                    <button
                      onClick={()=>{ setEditingWeek(week); setSelectedAddrs(new Set()); }}
                      className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm hover:bg-white/[0.1]"
                    >
                      {locked ? 'View' : 'Edit'}
                    </button>
                  </div>
                </div>

                <WeekList league={league} week={week} rows={rows}/>
              </section>
            );
          })
        )}
      </div>
    </main>
  );
}

/* ---------------- Presentational cells ---------------- */

function Chip({ children, tone='neutral' }:{ children: React.ReactNode; tone?: 'blue'|'purple'|'neutral' }){
  const styles = {
    blue:    'border-sky-500/30 bg-sky-600/20 text-sky-100',
    purple:  'border-fuchsia-500/30 bg-fuchsia-600/20 text-fuchsia-100',
    neutral: 'border-white/10 bg-white/5 text-gray-200',
  }[tone];
  return <span className={`text-[11px] rounded px-2 py-0.5 border ${styles}`}>{children}</span>;
}

function CellTeam({ league, t, rec, right }:{ league:`0x${string}`; t:Team; rec:string; right?:boolean }){
  const prof = useTeamProfile(league, t.owner, { name: t.name });
  const name = (t.name || prof.name || '').trim() || 'Team';
  const logo = prof.logo || generatedLogoFor(t.owner);
  return (
    <div className={`flex items-center ${right ? 'justify-end text-right' : ''} gap-2`}>
      {!right && <Avatar name={name} url={logo}/>}
      <div className="min-w-0">
        <div className="font-semibold truncate">{name}</div>
        <div className="text-[10px] text-gray-500 font-mono">{shortWallet(t.owner)}</div>
      </div>
      {right && <Avatar name={name} url={logo}/>}
    </div>
  );
}

function RowView({ league, week, p }:{ league:`0x${string}`; week:number; p:Pairing }){
  if ('bye' in p){
    return (
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-gray-300">
        <span className="text-[10px] rounded bg-white/5 px-2 py-0.5 border border-white/10">BYE</span>
        <span className="font-mono">{shortWallet(p.bye)}</span>
      </div>
    );
  }
  const awayRec = fmtRec(recordsByWeek[week]?.[p.away.owner.toLowerCase()]);
  const homeRec = fmtRec(recordsByWeek[week]?.[p.home.owner.toLowerCase()]);
  const sAway   = score(week, p.away.owner);
  const sHome   = score(week, p.home.owner);
  const scoreStr = `${sAway.live} — ${sHome.live}`;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <CellTeam league={league} t={p.away} rec={awayRec}/>
        <div className="mx-2 ml-auto mr-auto text-sm font-semibold shrink-0">{scoreStr}</div>
        <CellTeam league={league} t={p.home} rec={homeRec} right/>
      </div>
    </div>
  );
}

function WeekList({ league, week, rows }:{
  league:`0x${string}`; week:number; rows: Pairing[];
}){
  return (
    <div className="mt-3 space-y-2">
      {rows.length===0
        ? <div className="text-center text-gray-400 text-sm py-6 rounded-xl border border-white/10 bg-black/20">No scheduled matchups.</div>
        : rows.map((p, idx)=><RowView key={`v-${week}-${idx}`} league={league} week={week} p={p}/>)
      }
    </div>
  );
}

/* ---------------- Editable list ---------------- */

function EditableWeekList({
  league,
  week,
  rows,
  selectedAddrs,
  onToggle,
}: {
  league:`0x${string}`;
  week:number;
  rows: Pairing[];
  selectedAddrs: Set<string>;
  onToggle(addr:string): void;
}) {
  return (
    <div className="space-y-2">
      {rows.length===0 ? (
        <div className="text-center text-gray-400 text-sm py-6 rounded-xl border border-white/10 bg-black/20">No scheduled matchups.</div>
      ) : rows.map((p, idx) => {
        if ('bye' in p) {
          const a = p.bye!;
          const sel = selectedAddrs.has(a.toLowerCase());
          return (
            <div key={`bye-${idx}`} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${sel ? 'border-fuchsia-400/60 bg-fuchsia-600/20 text-fuchsia-100' : 'border-white/10 bg-white/[0.02]'}`}>
              <span className="text-[10px] rounded bg-white/5 px-2 py-0.5 border border-white/10">BYE</span>
              <button
                type="button"
                onClick={()=>onToggle(a)}
                className="font-mono rounded px-2 py-0.5 border border-white/10 bg-white/5"
                title="Select this team"
              >
                {a}
              </button>
            </div>
          );
        }
        const awayRec = fmtRec(recordsByWeek[week]?.[p.away!.owner.toLowerCase()]);
        const homeRec = fmtRec(recordsByWeek[week]?.[p.home!.owner.toLowerCase()]);
        const selAway = selectedAddrs.has(p.away!.owner.toLowerCase());
        const selHome = selectedAddrs.has(p.home!.owner.toLowerCase());

        return (
          <div key={`row-${idx}`} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <EditableTeamCell
                league={league}
                t={p.away!}
                right={false}
                rec={awayRec}
                selected={selAway}
                onToggle={onToggle}
              />
              <div className="mx-2 ml-auto mr-auto text-gray-400">—</div>
              <EditableTeamCell
                league={league}
                t={p.home!}
                right
                rec={homeRec}
                selected={selHome}
                onToggle={onToggle}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EditableTeamCell({
  league,
  t,
  rec,
  selected,
  right,
  onToggle,
}:{
  league:`0x${string}`;
  t: Team;
  rec: string;
  selected: boolean;
  right?: boolean;
  onToggle(addr:string): void;
}){
  const prof = useTeamProfile(league, t.owner, { name: t.name });
  const name = (t.name || prof.name || '').trim() || 'Team';
  const logo = prof.logo || generatedLogoFor(t.owner);
  return (
    <button
      type="button"
      onClick={()=>onToggle(t.owner)}
      className={`w-full flex items-center ${right ? 'justify-end text-right' : ''} gap-2 rounded-md border px-2 py-2
        ${selected ? 'border-fuchsia-400/60 bg-fuchsia-600/20 shadow-[0_0_24px_-8px_rgba(217,70,239,0.7)]' : 'border-white/10 hover:bg-white/[0.06]'}`}
      title="Click to select"
    >
      {!right && <Avatar name={name} url={logo}/>}
      <div className="min-w-0">
        <div className="font-semibold truncate">{name}</div>
        <div className="text-[10px] text-gray-500 font-mono">({rec}) • {shortWallet(t.owner)}</div>
      </div>
      {right && <Avatar name={name} url={logo}/>}
    </button>
  );
}
