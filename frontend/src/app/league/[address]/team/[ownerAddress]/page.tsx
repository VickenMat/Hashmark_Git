'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useReadContract } from 'wagmi';

import {
  useTeamProfile,
  useSaveTeamProfile,
  PROFILE_ABI,
} from '@/lib/teamProfile';

import CurrentMatchupCard from '@/components/CurrentMatchupCard';
import { activeWeekKey } from '@/lib/matchups';

/* ---------------- On-chain ABI ---------------- */
const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getTeamByAddress', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'string' }] },
] as const;

const ROSTER_ABI = [
  {
    type:'function', name:'getRosterSettings', stateMutability:'view', inputs:[], outputs:[{
      type:'tuple', components:[
        { name:'qb',           type:'uint8' },
        { name:'rb',           type:'uint8' },
        { name:'wr',           type:'uint8' },
        { name:'te',           type:'uint8' },
        { name:'flexWRT',      type:'uint8' },
        { name:'flexWR',       type:'uint8' },
        { name:'flexWT',       type:'uint8' },
        { name:'superFlexQWRT',type:'uint8' },
        { name:'idpFlex',      type:'uint8' },
        { name:'k',            type:'uint8' },
        { name:'dst',          type:'uint8' },
        { name:'dl',           type:'uint8' },
        { name:'lb',           type:'uint8' },
        { name:'db',           type:'uint8' },
        { name:'bench',        type:'uint8' },
        { name:'ir',           type:'uint8' },
      ]
    }]},
] as const;

/* ---------------- Helpers / UI ---------------- */
function cn(...a:(string|false|null|undefined)[]){ return a.filter(Boolean).join(' '); }
function initials(s?: string){ const t=(s||'').trim(); if(!t) return 'TM'; const p=t.split(/\s+/); return ((p[0]?.[0]||'')+(p[1]?.[0]||'')).toUpperCase()||'TM'; }
const EMPTY_SVG='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const shortAddr=(a?:string)=>a?`${a.slice(0,6)}…${a.slice(-4)}`:'—';

type SlotKey='QB'|'RB'|'WR'|'TE'|'FLEX'|'K'|'D/ST'|'DL'|'LB'|'DB'|null;
type Player={ name:string; team:string; pos:Exclude<SlotKey,'FLEX'|null>; opp?:string; time?:string; rst?:number; strt?:number; score?:number; proj?:number; };
type Row=Player|'Empty';

const FLEX_SET=new Set<SlotKey>(['RB','WR','TE']);
const ZIMA='var(--zima,#8ED1FC)';
const scoresKey=(league:`0x${string}`,week:number)=>`scores:${league}:${week}`;

function posColor(p:Exclude<NonNullable<SlotKey>,'FLEX'>){
  switch(p){
    case 'QB':return 'text-rose-300';
    case 'RB':return 'text-emerald-300';
    case 'WR':return 'text-sky-300';
    case 'TE':return 'text-orange-300';
    case 'K': return 'text-amber-300';
    case 'D/ST':return 'text-violet-300';
    case 'DL':
    case 'LB':
    case 'DB':return 'text-rose-300';
    default:return 'text-gray-300';
  }
}
function posRing(p:Exclude<NonNullable<SlotKey>,'FLEX'>){
  switch(p){
    case 'QB':return 'ring-rose-400 border-rose-400';
    case 'RB':return 'ring-emerald-400 border-emerald-400';
    case 'WR':return 'ring-sky-400 border-sky-400';
    case 'TE':return 'ring-orange-400 border-orange-400';
    case 'K': return 'ring-amber-400 border-amber-400';
    case 'D/ST':return 'ring-violet-400 border-violet-400';
    case 'DL':
    case 'LB':
    case 'DB':return 'ring-rose-400 border-rose-400';
    default:return 'ring-gray-400 border-gray-400';
  }
}

/* roster shape */
function computeShape(raw?:any){
  const n=(x:any,d=0)=>Number(x??d);
  const starters:Exclude<SlotKey,null>[]=[];
  starters.push(...Array(n(raw?.qb,1)).fill('QB'));
  starters.push(...Array(n(raw?.rb,2)).fill('RB'));
  starters.push(...Array(n(raw?.wr,2)).fill('WR'));
  starters.push(...Array(n(raw?.te,1)).fill('TE'));
  starters.push(...Array(n(raw?.flexWRT,1)+n(raw?.flexWR,0)+n(raw?.flexWT,0)+n(raw?.superFlexQWRT,0)+n(raw?.idpFlex,0)).fill('FLEX'));
  starters.push(...Array(n(raw?.dst,1)).fill('D/ST'));
  starters.push(...Array(n(raw?.k,1)).fill('K'));
  starters.push(...Array(n(raw?.dl,0)).fill('DL'));
  starters.push(...Array(n(raw?.lb,0)).fill('LB'));
  starters.push(...Array(n(raw?.db,0)).fill('DB'));
  return { starters, bench:n(raw?.bench,5), ir:n(raw?.ir,1) };
}

/* ---------- CSV ---------- */
type CsvRow={ position?:string; pos?:string; name?:string; team?:string; slot?:string; score?:string; proj?:string; opp?:string; time?:string; 'rst%'?:string; 'strt%'?:string; };
function toNum(s?:string){ const n=parseFloat(String(s??'').replace(/[^\d.-]/g,'')); return isFinite(n)?n:0; }
function toPct(s?:string){ const n=parseFloat(String(s??'').replace(/[^\d.-]/g,'')); return isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):undefined; }
function normalizePos(p?:string):Exclude<SlotKey,'FLEX'|null>{
  const s=(p||'').trim().toUpperCase();
  if(['DST','DEF','DEFENSE','D/ST'].includes(s)) return 'D/ST' as any;
  if(['QB','RB','WR','TE','K','DL','LB','DB'].includes(s)) return s as any;
  return 'WR';
}
function parseCSV(text:string):CsvRow[]{
  const lines=text.trim().split(/\r?\n/);
  if(lines.length<=1) return [];
  const head=lines[0].split(',').map(h=>h.trim());
  const out:CsvRow[]=[];
  for(let i=1;i<lines.length;i++){
    const line=lines[i];
    const cells:string[]=[]; let cur='',q=false;
    for(let j=0;j<line.length;j++){
      const c=line[j];
      if(c==='"'){ q=!q; continue; }
      if(!q && c===','){ cells.push(cur); cur=''; continue; }
      cur+=c;
    }
    cells.push(cur);
    const row:any={}; head.forEach((h,j)=>row[h]=(cells[j]??'').trim());
    out.push(row);
  }
  return out;
}

export default function TeamPage(){
  const { address:league, ownerAddress } = useParams<{ address:`0x${string}`; ownerAddress:`0x${string}` }>();
  const owner = ownerAddress as `0x${string}`|undefined;

  const { data:leagueName } = useReadContract({ abi:LEAGUE_ABI, address:league, functionName:'name' });
  const { data:onChainTeamName } = useReadContract({ abi:LEAGUE_ABI, address:league, functionName:'getTeamByAddress', args:[owner] });

  const { data: rosterRaw } = useReadContract({ abi:ROSTER_ABI, address:league, functionName:'getRosterSettings' });
  const shape = useMemo(()=>computeShape(rosterRaw),[rosterRaw]);
  const STARTERS = shape.starters;
  const BENCH_COUNT = shape.bench;
  const IR_COUNT = shape.ir;

  const profile = useTeamProfile(league, owner, { name:onChainTeamName as string });
  const { data: rawProfile, refetch: refetchRaw } = useReadContract({
    abi:PROFILE_ABI, address:league, functionName:'getTeamProfile',
    args: owner ? [owner] : undefined, query:{ enabled:!!(league && owner) },
  });
  const onChainLogoURI = ((rawProfile?.[1] as string) || '');

  const [mounted,setMounted]=useState(false); useEffect(()=>setMounted(true),[]);

  const [week,setWeek]=useState(1);
  useEffect(()=>{ try{ const s=localStorage.getItem(activeWeekKey); if(s&&/^\d+$/.test(s)) setWeek(parseInt(s,10)); }catch{} },[]);
  useEffect(()=>{ try{ localStorage.setItem(activeWeekKey,String(week)); }catch{} },[week]);

  const safeTeamName = mounted ? (profile.name?.trim() || (onChainTeamName as string) || 'My Team') : ((onChainTeamName as string) || 'My Team');
  const avatarSrc = mounted ? (profile.logo || EMPTY_SVG) : EMPTY_SVG;
  const showInitials = !mounted || !avatarSrc;


  
  /* ---- CSV load ---- */
  const [csvPlayers,setCsvPlayers]=useState<Player[]>([]);
  const [csvSlotByName,setCsvSlotByName]=useState<Map<string,string>>(new Map());
  useEffect(()=>{
    let alive=true;
    (async ()=>{
      try{
        const resp=await fetch('/dummy-roster.csv',{ cache:'no-store' });
        if(!resp.ok) throw new Error('no csv');
        const text=await resp.text();
        const rows=parseCSV(text);
        const players:Player[]=rows.map((r:any)=>({
          name:String(r.name||'').trim(),
          team:String(r.team||'').trim(),
          pos: normalizePos(r.position ?? r.pos),
          opp: (r.opp||'')||undefined,
          time:(r.time||'')||undefined,
          rst: toPct(r['rst%'] ?? r.rst),
          strt:toPct(r['strt%'] ?? r.strt),
          score: toNum(r.score),
          proj:  toNum(r.proj),
        })).filter(p=>p.name);
        const slotMap=new Map<string,string>();
        rows.forEach((r:any)=>slotMap.set(String(r.name||'').trim(), String(r.slot||'').trim().toLowerCase()));
        if(alive){ setCsvPlayers(players); setCsvSlotByName(slotMap); }
      }catch{ if(alive){ setCsvPlayers([]); setCsvSlotByName(new Map()); } }
    })();
    return()=>{ alive=false; };
  },[]);

  /* ---- Build rows ---- */
  const [starters,setStarters]=useState<Row[]>([]);
  const [bench,setBench]=useState<Row[]>([]);
  const [irList,setIrList]=useState<Row[]>([]);

  useEffect(()=>{
    const startersPool:Player[]=[]; const benchPool:Player[]=[]; const irPool:Player[]=[];
    csvPlayers.forEach(p=>{
      const slot=csvSlotByName.get(p.name)||'bench';
      if(slot==='starter') startersPool.push(p);
      else if(slot==='ir') irPool.push(p);
      else benchPool.push(p);
    });

    const sOrdered:Row[]=[]; const pool=[...startersPool];
    STARTERS.forEach(slot=>{
      let idx=pool.findIndex(p=>p.pos===slot || (slot==='FLEX'&&FLEX_SET.has(p.pos as any)));
      if(idx===-1) idx=pool.findIndex(p=>FLEX_SET.has(p.pos as any) && !['QB','D/ST','K'].includes(String(slot)));
      if(idx===-1) sOrdered.push('Empty'); else sOrdered.push(pool.splice(idx,1)[0]);
    });

    const bRows:Row[]=[...benchPool];
    while(bRows.length<Math.max(1,BENCH_COUNT)) bRows.push('Empty');

    const iRows:Row[]=[...irPool];
    while(iRows.length<Math.max(1,IR_COUNT)) iRows.push('Empty');

    setStarters(sOrdered);
    setBench(bRows.slice(0,BENCH_COUNT));
    setIrList(iRows.slice(0,IR_COUNT));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[csvPlayers, STARTERS.join(','), BENCH_COUNT, IR_COUNT]);

  /* ---- selection / swaps ---- */
  const [sel,setSel]=useState<{section:'starters'|'bench'|'ir'; index:number}|null>(null);
  const [note,setNote]=useState<string|null>(null);
  const notify=(m:string)=>{ setNote(m); window.clearTimeout((notify as any)._t); (notify as any)._t=window.setTimeout(()=>setNote(null),2600); };

  // SAFE: tolerate undefined (extra bench row)
  const rowPos = (r?: Row): SlotKey => (!r || r === 'Empty') ? null : r.pos;
  const eligible=(playerPos:SlotKey,slot:SlotKey)=> slot==='FLEX' ? (!!playerPos && FLEX_SET.has(playerPos)) : (!!playerPos && playerPos===slot);

  // helper: is the selected starter an *empty FLEX*?
  const selIsEmptyFlex = sel?.section==='starters' && STARTERS[sel.index]==='FLEX' && starters[sel.index]==='Empty';

  // Clicking a different pill while one is selected tries the move immediately
  function onPillClick(section:'starters'|'bench'|'ir', index:number){
    // NEW: If IR pill is being selected and bench is full (no empties), show popup and abort selection
    if(!sel && section==='ir'){
      const hasEmptyBench = bench.some(r=>r==='Empty');
      if(!hasEmptyBench){
        notify('No free bench spot. Go to Cut to free a roster spot.');
        return;
      }
    }

    if(sel && (sel.section!==section || sel.index!==index)){
      doSwapOrMove({ section, index });
      return;
    }
    if(sel && sel.section===section && sel.index===index){ setSel(null); return; }
    setSel({ section, index });
  }

  function doSwapOrMove(target:{section:'starters'|'bench'|'ir'; index:number}){
    if(!sel) return;

    // local readers
    const sRow=(section:'starters'|'bench'|'ir', i:number)=> section==='starters'?starters[i]:section==='bench'?bench[i]:irList[i];

    /* ---- IR moves: only to EMPTY bench; clicking starters does nothing ---- */
    if(sel.section==='ir'){
      if(target.section!=='bench') { return; } // NEW hard guard: IR can only go to bench
      const fromRow=sRow('ir', sel.index); const pPos=rowPos(fromRow);
      if(!pPos || fromRow==='Empty'){ setSel(null); return; }
      const nb=[...bench];
      if(target.index>=nb.length) nb.push('Empty'); // allow clicking extra empty slot
      const trgRow = nb[target.index];
      const ok=(trgRow==='Empty'); // just empty bench, no slot constraint
      if(!ok) return;
      nb[target.index]=fromRow as Player;
      const ni=[...irList]; ni[sel.index]='Empty';
      setBench(nb); setIrList(ni); setSel(null); return;
    }

    /* ---- Regular moves ---- */
    const copyS=[...starters], copyB=[...bench];

    // If target is the extra bench row, append it first
    if(target.section==='bench' && target.index>=copyB.length){
      copyB.push('Empty');
    }

    const fromList = sel.section==='starters'?copyS:copyB;
    const toList   = target.section==='starters'?copyS:copyB;

    const fromRow=fromList[sel.index];
    const toRow=toList[target.index];

    const fromPos=rowPos(fromRow);
    const originSlot:SlotKey = sel.section==='starters' ? STARTERS[sel.index] : (rowPos(fromRow) || 'FLEX');
    const targetSlot:SlotKey = target.section==='starters' ? STARTERS[target.index] : (rowPos(toRow) || 'FLEX');

    // Bench -> Starter
    if(sel.section==='bench' && target.section==='starters'){
      if(fromRow!=='Empty' && !eligible(fromPos,targetSlot)) return;
      fromList[sel.index]=toRow;
      toList[target.index]=fromRow;
      setStarters(copyS); setBench(copyB); setSel(null);
      return;
    }

    // Starter -> Bench (only to empty OR same POS)
    if(sel.section==='starters' && target.section==='bench'){
      const samePos = (toRow!=='Empty') && (rowPos(toRow)===fromPos);
      const emptyOk = (toRow==='Empty');
      if(!(samePos || emptyOk)) return;
      fromList[sel.index]=toRow; // swap with same-pos or move into empty
      toList[target.index]=fromRow;
      setStarters(copyS); setBench(copyB); setSel(null);
      return;
    }

    // Starter -> Starter (forward + reverse eligibility)
    if(sel.section==='starters' && target.section==='starters'){
      if(fromRow!=='Empty' && !eligible(fromPos,targetSlot)) return;
      if(toRow!=='Empty'){
        const toPos=rowPos(toRow);
        const reverseOK=eligible(toPos, originSlot);
        if(!reverseOK){
          const fromLbl=String(fromPos||'—'); const toLbl=String(targetSlot||'—');
          notify(`Cannot place ${fromLbl} in ${toLbl} due to position mismatch. Please clear the ${toLbl} spot then try again.`);
          return;
        }
      }
      fromList[sel.index]=toRow;
      toList[target.index]=fromRow;
      setStarters(copyS); setBench(copyB); setSel(null);
    }
  }

  /* ---- totals + write-through ---- */
  const startersTotals=useMemo(()=>{
    let score=0, proj=0;
    starters.forEach(r=>{ if(r!=='Empty'){ score+=Number(r.score||0); proj+=Number(r.proj||0); } });
    return { score:Math.round(score*10)/10, proj:Math.round(proj*10)/10 };
  },[starters]);

  useEffect(()=>{
    if(!league||!owner) return;
    try{
      const key=scoresKey(league,week);
      const raw=localStorage.getItem(key);
      const obj=raw?JSON.parse(raw):{};
      obj[String(owner).toLowerCase()]={ live:startersTotals.score, proj:startersTotals.proj };
      localStorage.setItem(key,JSON.stringify(obj));
      localStorage.setItem(`${key}:ts`,String(Date.now()));
    }catch{}
  },[league,owner,week,startersTotals.score,startersTotals.proj]);

  /* ---- activity metrics placeholders ---- */
  const [pendingTrades,setPendingTrades]=useState(0);
  const [waiverClaims,setWaiverClaims]=useState(0);
  useEffect(()=>{ try{ const k=(owner||'').toLowerCase(); setPendingTrades(Number(localStorage.getItem(`trades:${league}:${k}`)||0)); setWaiverClaims(Number(localStorage.getItem(`claims:${league}:${k}`)||0)); }catch{} },[league,owner]);

  /* ---- pill visual states (ADDED highlighting rules) ---- */
  function pillClass(
    baseSlot: SlotKey,
    section: 'starters'|'bench'|'ir',
    index: number,
    currentRow?: Row,         // pass row to avoid undefined
  ){
    const base='mx-auto w-[86px] rounded-full py-1.5 px-2.5 text-sm font-semibold bg-white/[0.08] hover:bg-white/[0.14] border transition whitespace-nowrap';

    // IR pill itself renders neutral; IR selection highlights only empty bench (handled below)
    if(section==='ir') return `${base} border-white/20`;

    // BENCH pill highlighting:
    if(section==='bench'){
      const row=currentRow ?? bench[index] ?? 'Empty';

      // 1) Starter selected: highlight empty bench or same-POS bench
      if(sel?.section==='starters'){
        const sRow=starters[sel.index];
        const sPos=rowPos(sRow) as Exclude<SlotKey,null> | null;

        // 3) Special case: selected starter is an *empty FLEX* slot → show RB/WR/TE sources
        if(selIsEmptyFlex){
          const rPos=rowPos(row);
          if(rPos && FLEX_SET.has(rPos)) return `${base} ring-1 ${posRing(rPos as any)}`;
          return `${base} border-transparent`;
        }

        const isEmpty = row==='Empty';
        const samePos = sPos && !isEmpty && rowPos(row)===sPos;
        if(sPos && (isEmpty || samePos)) return `${base} ring-1 ${posRing(sPos)}`;
        return `${base} border-transparent`;
      }

      // 2) Bench selected: border the selected bench pill and all same-POS bench rows
      if(sel?.section==='bench'){
        const selPos=rowPos(bench[sel.index]);
        const isSel = sel.section==='bench' && sel.index===index;
        const samePos = (row!=='Empty') && rowPos(row)===selPos;
        if(isSel || samePos) return `${base} ring-1 ${selPos ? posRing(selPos as any) : 'ring-white/30 border-white/30'}`;
        return `${base} border-transparent`;
      }

      // 4) IR selected: only empty bench spots open
      if(sel?.section==='ir'){
        const isEmpty=row==='Empty';
        return isEmpty ? `${base} ring-1 ring-rose-400 border-rose-400` : `${base} border-transparent`;
      }

      return `${base} border-transparent`;
    }

    // STARTERS pill highlighting:
    if(!sel) return `${base} border-transparent`;

    // 2) Bench selected → highlight starters that accept bench player's POS
    if(sel.section==='bench'){
      const bRow=bench[sel.index];
      const bPos=rowPos(bRow);
      const ok = !!bPos && (
        (baseSlot==='FLEX' && FLEX_SET.has(bPos)) ||
        (baseSlot===bPos)
      );
      return ok ? `${base} ${posRing((bPos as any)||'WR')}` : `${base} border-transparent`;
    }

    // 3) Empty FLEX selected → highlight starters that can move into FLEX (RB/WR/TE)
    if(selIsEmptyFlex){
      const r=starters[index];
      const rPos=rowPos(r);
      const ok = !!rPos && FLEX_SET.has(rPos);
      return ok ? `${base} ${posRing((rPos as any)||'WR')}` : `${base} border-transparent`;
    }

    // default: starter selected → valid target (your existing rule)
    const fromRow = sel.section==='starters'?starters[sel.index]:bench[sel.index];
    const fromPos = rowPos(fromRow);
    const ok =
      (fromPos && baseSlot && (baseSlot==='FLEX' ? FLEX_SET.has(fromPos) : fromPos===baseSlot)) ||
      (sel.section==='starters' && sel.index===index);
    return ok ? `${base} ${posRing((baseSlot as any)||'WR')}` : `${base} border-transparent`;
  }

  /* ---- view helpers ---- */
  const avatar=(
    <div className="relative h-16 w-16 rounded-2xl overflow-hidden ring-2 ring-white/20 bg-white/5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avatarSrc} alt="team logo" className="absolute inset-0 h-full w-full object-cover" />
      <span suppressHydrationWarning aria-hidden={!showInitials} className={cn('relative z-10 grid h-full w-full place-items-center text-xl font-black transition-opacity', showInitials?'opacity-100':'opacity-0')}>{initials(safeTeamName)}</span>
    </div>
  );

  /* ---- render ---- */
  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Title */}
{/* ===== Top Bar: centered title ===== */}
{/* <div className="grid grid-cols-3 items-center">
  <div />
  <h2 className="justify-self-center text-3xl font-extrabold tracking-tight" style={{ color: ZIMA }}>
    My Team
  </h2>
  <div />
</div> */}

{/* ===== Header (team name + wallet + league link) ===== */}
<header className="pt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
  <div className="flex items-center gap-4">
    {/* avatar */}
    <div className="relative h-16 w-16 rounded-2xl overflow-hidden ring-2 ring-white/20 bg-white/5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatarSrc}
        alt="team logo"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <span
        suppressHydrationWarning
        aria-hidden={!showInitials}
        className={cn(
          'relative z-10 grid h-full w-full place-items-center text-xl font-black transition-opacity',
          showInitials ? 'opacity-100' : 'opacity-0'
        )}
      >
        {initials(safeTeamName)}
      </span>
    </div>

    {/* name + wallet + league */}
    <div>
      <h1 suppressHydrationWarning className="text-4xl font-extrabold leading-tight">
        {safeTeamName}
      </h1>
      <div className="text-xs text-gray-400 font-mono">{shortAddr(owner)}</div>
      <div className="text-[15px] font-bold text-gray-100">Record: 0–0–0</div>

      <div className="mt-1 text-sm text-gray-400 flex flex-wrap items-center gap-2">
        <Link
          href={`/league/${league}`}
          className="text-blue-300 hover:underline font-semibold"
        >
          {String(leagueName || 'League')}
        </Link>
        <span>•</span>
        <span className="font-mono">{owner}</span>
      </div>
    </div>
  </div>

  {/* (no buttons here; Add/Cut remain in Activity as requested) */}
  <div />
</header>


        {/* Summary row (no borders) */}
        <section>
          <div className="grid grid-cols-12 gap-6 items-stretch">
            <div className="col-span-12 lg:col-span-8">
              <div className="rounded-2xl bg-white/[0.03] p-5">
                {league && owner ? <CurrentMatchupCard league={league} owner={owner} week={week} variant="team" /> : <div className="text-center text-gray-400">Connect a wallet to see your matchup.</div>}
              </div>
            </div>

            {/* Activity with wider metrics + narrower Add/Cut (ADDED widths) */}
            <div className="col-span-12 lg:col-span-4">
              <aside className="rounded-2xl bg-white/[0.03]">
                <div className="p-4 flex flex-col lg:h-full">
                  <div className="text-sm font-semibold mb-3" style={{ color: ZIMA }}>Activity</div>

                  {/* grid widened: 5 cols -> 2+2+1 spans */}
                  <div className="grid grid-cols-5 gap-3 items-stretch">
                    <Link
                      href={`/league/${league}/trades`}
                      className="group rounded-xl bg-white/[0.04] hover:bg-white/[0.07] transition p-4 flex flex-col items-center justify-center text-center col-span-2"
                    >
                      <div className="text-[11px] uppercase tracking-wide text-gray-400 whitespace-nowrap">Pending Trades</div>
                      <div className="mt-1 text-2xl font-extrabold">{pendingTrades}</div>
                      <div className="mt-2 text-xs text-gray-400 group-hover:text-gray-300">View history →</div>
                    </Link>

                    <Link
                      href={`/league/${league}/claims`}
                      className="group rounded-xl bg-white/[0.04] hover:bg-white/[0.07] transition p-4 flex flex-col items-center justify-center text-center col-span-2"
                    >
                      <div className="text-[11px] uppercase tracking-wide text-gray-400 whitespace-nowrap">Waiver Claims</div>
                      <div className="mt-1 text-2xl font-extrabold">{waiverClaims}</div>
                      <div className="mt-2 text-xs text-gray-400 group-hover:text-gray-300">View history →</div>
                    </Link>

                    <div className="flex flex-col justify-stretch gap-2 items-stretch col-span-1">
                      <Link href={`/league/${league}/claims/add`} className="rounded-lg text-sm bg-emerald-700/40 hover:bg-emerald-700/55 px-2 py-1.5 text-center font-semibold border border-emerald-500/40">Add</Link>
                      <Link href={`/league/${league}/claims/cut`} className="rounded-lg text-sm bg-rose-700/40 hover:bg-rose-700/55 px-2 py-1.5 text-center font-semibold border border-rose-500/40">Cut</Link>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>

        {/* Week/Schedule/Deadline */}
        <section className="grid grid-cols-3 items-center mb-6 sm:mb-8 lg:mb-10">
          <div className="justify-self-start">
            <Link href={`/league/${league}/schedule`} className="rounded-lg bg-[#8ED1FC] text-black hover:brightness-105 px-4 py-2 text-sm font-semibold" style={{ backgroundColor: ZIMA }}>Open Schedule</Link>
          </div>
          <div className="justify-self-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-2 py-1.5">
              <button onClick={()=>setWeek(w=>Math.max(1,w-1))} className="grid place-items-center rounded-full border border-white/15 bg-white/[0.06] w-7 h-7 hover:bg-white/10" aria-label="Previous week">‹</button>
              <div className="px-3 text-sm font-semibold tracking-wide">Week {week}</div>
              <button onClick={()=>setWeek(w=>w+1)} className="grid place-items-center rounded-full border border-white/15 bg-white/[0.06] w-7 h-7 hover:bg-white/10" aria-label="Next week">›</button>
            </div>
          </div>
          <div className="justify-self-end">
            <div className="rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-center">
              <div className="text-xs uppercase tracking-wide text-gray-400">Trade Deadline</div>
              <div className="text-sm font-semibold mt-0.5">Nov 26, 2025</div>
            </div>
          </div>
        </section>

        {/* Starters */}
        <section className="rounded-2xl border border-white/10 overflow-hidden">
          <div className="px-4 py-3 font-semibold text-center" style={{ color: ZIMA }}>Starters</div>

          {/* Header */}
          <div className="grid grid-cols-12 bg-black/40 text-[11px] uppercase tracking-wide text-gray-300">
            <div className="col-span-2 px-2 py-1.5 text-center">POS</div>
            <div className="col-span-3 md:col-span-4 px-2 py-1.5">Name</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Score</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Proj</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Opp</div>
            <div className="col-span-2 md:col-span-1 px-1 py-1.5 text-left">Time</div>
            <div className="col-span-1 px-1 py-1.5 text-left">RST %</div>
            <div className="col-span-1 px-1 py-1.5 text-left">STRT %</div>
          </div>

          {STARTERS.map((slotLabel, idx)=>{
            const r=starters[idx]; const isPlayer=!!r && r!=='Empty';
            const over = isPlayer && typeof (r as any).score === 'number' && typeof (r as any).proj === 'number' && (r as any).score > (r as any).proj; // NEW: over/under
            return (
              <div key={`${slotLabel}-${idx}`} className="grid grid-cols-12">
                <div className="col-span-2 px-2 py-3 text-center font-semibold">
                  <button type="button" onClick={()=>onPillClick('starters',idx)} className={cn(pillClass(slotLabel,'starters',idx))}>
                    <span className={posColor((slotLabel==='FLEX' && isPlayer ? (r as any).pos : slotLabel) as any)}>{slotLabel}</span>
                  </button>
                </div>
                <div className="col-span-3 md:col-span-4 px-2 py-3">
                  {!isPlayer ? <span className="text-gray-400">Empty</span> : (
                    <div>
                      <div className="truncate">{(r as any).name}</div>
                      <div className="text-[11px] text-gray-400 whitespace-nowrap">
                        <span className="mr-2">{(r as any).team?.toUpperCase()}</span>
                        <span className={posColor((r as any).pos)}>{(r as any).pos}</span>
                      </div>
                    </div>
                  )}
                </div>
                {/* NEW: Score green when > proj */}
                <div className={cn("col-span-1 px-1 py-3 tabular-nums font-bold whitespace-nowrap", over && "text-emerald-400")}>
                  {!isPlayer?'—':Number((r as any).score ?? 0).toFixed(1)}
                </div>
                <div className="col-span-1 px-1 py-3 tabular-nums whitespace-nowrap">{!isPlayer?'—':Number((r as any).proj ?? 0).toFixed(1)}</div>
                <div className="col-span-1 px-1 py-3 whitespace-nowrap">{!isPlayer?'—':((r as any).opp||'—')}</div>
                <div className="col-span-2 md:col-span-1 px-1 py-3 whitespace-nowrap">{!isPlayer?'—':((r as any).time||'—')}</div>
                <div className="col-span-1 px-1 py-3 whitespace-nowrap">{!isPlayer?'—':`${(r as any).rst ?? 0}%`}</div>
                <div className="col-span-1 px-1 py-3 whitespace-nowrap">{!isPlayer?'—':`${(r as any).strt ?? 0}%`}</div>
              </div>
            );
          })}

          {/* TOTAL row — score/proj in their columns, proj smaller & not bold */}
          <div className="grid grid-cols-12 items-center border-t border-white/10">
            <div className="col-span-2 px-2 py-3 text-center font-semibold text-gray-300">TOTAL</div>
            <div className="col-span-3 md:col-span-4 px-2 py-3"></div>
            <div className="col-span-1 px-1 py-3 tabular-nums font-extrabold text-lg">{startersTotals.score.toFixed(1)}</div>
            <div className="col-span-1 px-1 py-3 tabular-nums font-normal text-base text-gray-200">{startersTotals.proj.toFixed(1)}</div>
            <div className="col-span-1"></div>
            <div className="col-span-2 md:col-span-1"></div>
            <div className="col-span-1"></div>
            <div className="col-span-1"></div>
          </div>
        </section>

        {/* Bench (+ IR) */}
        <section className="mt-6 rounded-2xl border border-white/10 overflow-hidden">
          <div className="px-4 py-2 font-semibold text-center" style={{ color: ZIMA }}>Bench</div>

          <div className="grid grid-cols-12 bg-black/40 text-[11px] uppercase tracking-wide text-gray-300">
            <div className="col-span-2 px-2 py-1.5 text-center">Bench</div>
            <div className="col-span-3 md:col-span-4 px-2 py-1.5">Name</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Score</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Proj</div>
            <div className="col-span-1 px-1 py-1.5 text-left">Opp</div>
            <div className="col-span-2 md:col-span-1 px-1 py-1.5 text-left">Time</div>
            <div className="col-span-1 px-1 py-1.5 text-left">RST %</div>
            <div className="col-span-1 px-1 py-1.5 text-left">STRT %</div>
          </div>

          {(() => {
            const extra = sel?.section==='starters' ? 1 : 0; // extra drop slot when a starter is selected
            const rows=[...bench, ...Array.from({length:extra},()=> 'Empty' as Row)];
            return rows.map((r,i)=>{
              const isPlayer=!!r && r!=='Empty';
              return (
                <div key={`bench-${i}`} className="grid grid-cols-12">
                  <div className="col-span-2 px-2 py-3 text-center font-semibold">
                    <button onClick={()=>onPillClick('bench', i)} className={pillClass(rowPos(r) as any,'bench',i, r)}>
                      <span className="text-gray-300">Bench</span>
                    </button>
                  </div>
                  <div className="col-span-3 md:col-span-4 px-2 py-3">
                    {!isPlayer ? <span className="text-gray-400">Empty</span> : (
                      <div>
                        <div className="truncate">{(r as any).name}</div>
                        <div className="text-[11px] text-gray-400 whitespace-nowrap">
                          <span className="mr-2">{(r as any).team?.toUpperCase()}</span>
                          <span className={posColor((r as any).pos)}>{(r as any).pos}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="col-span-1 px-1 py-3 tabular-nums font-bold whitespace-nowrap">{!isPlayer?'—':Number((r as any).score ?? 0).toFixed(1)}</div>
                  <div className="col-span-1 px-1 py-3 tabular-nums whitespace-nowrap">{!isPlayer?'—':Number((r as any).proj ?? 0).toFixed(1)}</div>
                  <div className="col-span-1 px-1 py-3 whitespace-nowrap">{!isPlayer?'—':((r as any).opp||'—')}</div>
                  <div className="col-span-2 md:col-span-1 px-1 py-3 whitespace-nowrap">{!isPlayer?'—':((r as any).time||'—')}</div>
                  <div className="col-span-1 px-1 py-3 whitespace-nowrap">{!isPlayer?'—':`${(r as any).rst ?? 0}%`}</div>
                  <div className="col-span-1 px-1 py-3 whitespace-nowrap">{!isPlayer?'—':`${(r as any).strt ?? 0}%`}</div>
                </div>
              );
            });
          })()}

          {/* IR rows (letters red, pill neutral) */}
          {irList.map((r, idx)=>{
            const isPlayer=!!r && r!=='Empty';
            return (
              <div key={`ir-${idx}`} className="grid grid-cols-12">
                <div className="col-span-2 px-2 py-3 text-center font-semibold">
                  <button onClick={()=>onPillClick('ir', idx)} className="mx-auto w-[86px] rounded-full py-1.5 px-2.5 text-sm font-semibold bg-white/[0.08] hover:bg-white/[0.14] border border-white/20">
                    <span className="text-red-400">IR</span>
                  </button>
                </div>
                <div className="col-span-3 md:col-span-4 px-3 py-3 text-gray-300">{!isPlayer?'Empty':(r as any).name}</div>
                <div className="col-span-1 px-3 py-3 tabular-nums whitespace-nowrap">{!isPlayer?'—':Number((r as any).score ?? 0).toFixed(1)}</div>
                <div className="col-span-1 px-3 py-3 tabular-nums whitespace-nowrap">{!isPlayer?'—':Number((r as any).proj ?? 0).toFixed(1)}</div>
                <div className="col-span-1 px-3 py-3 whitespace-nowrap">{!isPlayer?'—':((r as any).opp||'—')}</div>
                <div className="col-span-2 md:col-span-1 px-3 py-3 whitespace-nowrap">{!isPlayer?'—':((r as any).time||'—')}</div>
                <div className="col-span-1 px-3 py-3 whitespace-nowrap">{!isPlayer?'—':`${(r as any).rst ?? 0}%`}</div>
                <div className="col-span-1 px-3 py-3 whitespace-nowrap">{!isPlayer?'—':`${(r as any).strt ?? 0}%`}</div>
              </div>
            );
          })}
        </section>
      </div>

      {/* tiny toast */}
      {note && (
        <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-[9999]">
          <div className="rounded-full bg-black/80 text-white text-sm px-4 py-2 border border-white/15 shadow-lg">
            {note}
          </div>
        </div>
      )}
    </main>
  );
}
