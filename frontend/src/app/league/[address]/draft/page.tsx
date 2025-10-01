// // src/app/league/[address]/draft/page.tsx
// 'use client';

// import { useEffect, useMemo, useRef, useState } from 'react';
// import Link from 'next/link';
// import { useParams, useRouter, useSearchParams } from 'next/navigation';
// import { useAccount, useReadContract } from 'wagmi';

// /* ─── Theme ─── */
// const ZIMA = '#37c0f6';
// const EGGSHELL = '#F0EAD6';
// const RED = '#ef4444';
// const ORANGE = '#f59e0b';

// /* ─── Types ─── */
// type Address = `0x${string}`;
// const ZERO: Address = '0x0000000000000000000000000000000000000000';

// type Team = { owner: Address; name: string };

// /* ─── On-chain ABI (subset used here) ─── */
// const LEAGUE_ABI = [
//   { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
//   {
//     type: 'function', name: 'getTeams', stateMutability: 'view', inputs: [],
//     outputs: [{ type: 'tuple[]', components: [{ name: 'owner', type: 'address' }, { name: 'name', type: 'string' }]}],
//   },
//   // draftType(uint8), draftTimestamp(uint64), orderMode(uint8), completed(bool), manual(address[]), picksTrading(bool)
//   {
//     type: 'function', name: 'getDraftSettings', stateMutability: 'view', inputs: [],
//     outputs: [{ type: 'uint8' }, { type: 'uint64' }, { type: 'uint8' }, { type: 'bool' }, { type: 'address[]' }, { type: 'bool' }],
//   },
//   // authoritative chips
//   {
//     type: 'function', name: 'getDraftExtras', stateMutability: 'view', inputs: [],
//     outputs: [{
//       type: 'tuple', components: [
//         { name: 'timePerPickSeconds', type: 'uint32' },
//         { name: 'thirdRoundReversal', type: 'bool' },
//         { name: 'salaryCapBudget',    type: 'uint32' },
//         { name: 'playerPool',         type: 'uint8'  },
//       ]
//     }]
//   },
//   { type: 'function', name: 'commissioner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
// ] as const;

// /* ─── Local state & helpers ─── */
// import {
//   type DraftState,
//   loadDraftState,
//   saveDraftState,
//   resetDraftState,
//   subscribeDraftState,
// } from '@/lib/draft-storage';

// import { buildRoundOrder } from '@/lib/draft-helpers';
// import {
//   initStateFromChain,
//   visibleColForPointer,
//   isTrueReversalCell,
//   pickLabel,
//   placePick,
//   advancePick,
//   nextPickSummary,
// } from '@/lib/pick-flow';

// import {
//   AutoPickSource,
//   chooseAutoPick,
//   type RankedPlayerRow,
// } from '@/lib/auto-pick';

// import ControlsRow from '@/components/draft/ControlsRow';
// import PlayersDrawer from '@/components/draft/PlayersDrawer';
// import StatePill from '@/components/draft/StatePill';
// import HeaderCell from '@/components/draft/HeaderCell';
// import TeamInline from '@/components/draft/TeamInline';
// import PanelAllTeams from '@/components/draft/PanelAllTeams';
// import PanelMyTeam from '@/components/draft/PanelMyTeam';
// import PanelHistory from '@/components/draft/PanelHistory';
// import PanelQueue from '@/components/draft/PanelQueue';

// /* ──────────────────────────────────────────────────────────────────────────── */

// const short = (a?: string) => (a ? `${a.slice(0,6)}…${a.slice(-4)}` : '');

// const fmtClock = (s: number) => {
//   const sec = Math.max(0, Math.ceil(s));
//   const m = Math.floor(sec / 60);
//   const r = sec % 60;
//   return `${m}:${String(r).padStart(2, '0')}`;
// };

// const timeLabel = (secs: number) => {
//   if (secs === 0) return 'No Limit per Pick';
//   if (secs < 60) return `${secs}S per Pick`;
//   if (secs < 3600) return `${Math.round(secs/60)}M per Pick`;
//   return `${Math.round(secs/3600)}H per Pick`;
// };

// function fmtLocal(ts: number) {
//   if (!ts) return '—';
//   const d = new Date(ts * 1000);
//   const date = d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' });
//   const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
//   const tz = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
//     .formatToParts(d).find(p => p.type === 'timeZoneName')?.value || '';
//   return `${date} - ${time} ${tz}`;
// }

// /* ──────────────────────────────────────────────────────────────────────────── */

// export default function DraftRoom() {
//   const { address: league } = useParams<{ address: Address }>();
//   const { address: wallet } = useAccount();
//   const search = useSearchParams();
//   const router = useRouter();

//   /* Reads */
//   const nameRes = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' });
//   const teamsRes = useReadContract({
//     abi: LEAGUE_ABI, address: league, functionName: 'getTeams',
//     query: { refetchInterval: 5000, staleTime: 0 },
//   });
//   const settingsRes = useReadContract({
//     abi: LEAGUE_ABI, address: league, functionName: 'getDraftSettings',
//     query: { refetchInterval: 5000, staleTime: 0 },
//   });
//   const extrasRes = useReadContract({
//     abi: LEAGUE_ABI, address: league, functionName: 'getDraftExtras',
//     query: { refetchInterval: 5000, staleTime: 0 },
//   });
//   const commishRes = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'commissioner' });

//   const leagueName = (nameRes.data as string) || 'League';
//   const teams = (Array.isArray(teamsRes.data) ? (teamsRes.data as Team[]) : []) as Team[];

//   const commissioner = (commishRes.data as string | undefined)?.toLowerCase() || '';
//   const isCommish = !!(wallet && wallet.toLowerCase() === commissioner);

//   // settings unpack
//   const [draftType, draftTs, orderMode, draftCompleted, manualOrder] =
//     ((settingsRes.data as any) || [0, 0n, 0, false, [], false]) as [number, bigint, number, boolean, Address[], boolean];

//   // extras unpack
//   const extras = extrasRes.data as undefined | {
//     timePerPickSeconds: number; thirdRoundReversal: boolean; salaryCapBudget: number; playerPool: number;
//   };
//   const timePerPickSeconds = extras ? Number(extras.timePerPickSeconds || 0) : 60;
//   const thirdRoundReversal = !!extras?.thirdRoundReversal;
//   const salaryBudget = extras ? Number(extras.salaryCapBudget || 400) : 400;
//   const playerPool = (extras?.playerPool === 1 ? 'rookies' : extras?.playerPool === 2 ? 'vets' : 'all') as 'all'|'rookies'|'vets';

//   /* Time gates & phase */
//   const startAt = Number(draftTs) || 0;
//   const [now, setNow] = useState(() => Math.floor(Date.now()/1000));
//   useEffect(() => { const id = setInterval(() => setNow(Math.floor(Date.now()/1000)), 1000); return () => clearInterval(id); }, []);

//   const isLiveByTime = startAt > 0 && now >= startAt && !draftCompleted;
//   const graceSecs = Math.max(0, isLiveByTime ? 180 - (now - startAt) : 0);
//   const inGrace = isLiveByTime && graceSecs > 0;
//   const beforeRealStart = startAt > 0 && (now < startAt + 180);
//   const isLive = isLiveByTime && !inGrace;

//   /* Local persistent + cross-tab sync */
//   const [state, setState] = useState<DraftState>(() =>
//     initStateFromChain(league, teams, manualOrder, thirdRoundReversal)
//   );

//   // subscribe to external changes
//   useEffect(() => subscribeDraftState(league, (s) => {
//     if (!s) return; // RESET handled elsewhere
//     setState((prev) => {
//       // trust incoming pointer/picks/paused/ended; preserve totals/orderSignature if not present
//       const merged: DraftState = {
//         ...prev,
//         ...s,
//         order: s.order?.length ? s.order : prev.order,
//         orderSignature: s.orderSignature || prev.orderSignature,
//         totalRounds: s.totalRounds || prev.totalRounds,
//       };
//       return merged;
//     });
//   }), [league]);

//   // re-init if teams/settings signature changes (order invalidation safeguard)
//   useEffect(() => {
//     setState((prev) => {
//       const nextBase = initStateFromChain(league, teams, manualOrder, thirdRoundReversal);
//       if (prev.orderSignature !== nextBase.orderSignature) {
//         const next: DraftState = {
//           ...nextBase,
//           // keep picks that still map to visible slots if any (optional). For simplicity: keep as is.
//           picks: prev.picks || [],
//           startedAt: prev.startedAt,
//           paused: prev.paused,
//           currentRound: prev.currentRound,
//           currentPickIndex: prev.currentPickIndex,
//           ended: prev.ended,
//         };
//         saveDraftState(league, next);
//         return next;
//       }
//       return prev;
//     });
//   }, [league, JSON.stringify(manualOrder), teams.length, thirdRoundReversal]);

//   // auto-start first clock when grace ends
//   useEffect(() => {
//     if (!isLive) return;
//     setState((prev) => {
//       if (prev.startedAt > 0) return prev;
//       const startedAt = Date.now();
//       const next = { ...prev, startedAt, paused: false };
//       saveDraftState(league, next);
//       return next;
//     });
//   }, [isLive]);

//   // derived values
//   const r1Order = state.order; // round 1 order from state
//   const teamCap = r1Order.length || teams.length || 1;
//   const currentVisibleCol = visibleColForPointer({
//     round1: r1Order,
//     currentRound: state.currentRound,
//     currentPickIndex: state.currentPickIndex,
//     thirdRoundReversal,
//   });

//   const roundOrders = useMemo(() => {
//     return Array.from({ length: state.totalRounds }, (_, r) =>
//       buildRoundOrder(r1Order, r + 1, thirdRoundReversal)
//     );
//   }, [r1Order, state.totalRounds, thirdRoundReversal]);

//   const header = useMemo(() => {
//     return r1Order.map((owner, i) => {
//       const t = teams.find(tt => tt.owner?.toLowerCase() === owner?.toLowerCase());
//       return {
//         owner,
//         name: t?.name || (owner === ZERO ? `Team ${i + 1}` : `${owner.slice(0,6)}…${owner.slice(-4)}`),
//       };
//     });
//   }, [r1Order, teams]);

//   // pick timer (derived remaining, no auto-pause on reload)
//   const [tick, setTick] = useState(0);
//   useEffect(() => { const id = setInterval(()=>setTick(t=>t+1), 500); return ()=>clearInterval(id); }, []);
//   const pickClock = (() => {
//     const start = state.startedAt || 0;
//     if (!isLive || state.paused || state.ended || timePerPickSeconds <= 0 || start <= 0) return null;
//     // derive elapsed since state.startedAt, then modulo each time we advance
//     const pickStartedAt = state.__pickStartedAt ?? state.startedAt; // legacy fallback
//     const secs = Math.max(0, timePerPickSeconds - Math.floor((Date.now() - (pickStartedAt as number)) / 1000));
//     return secs;
//   })();

//   // restart pick clock whenever pointer changes or resume
//   const lastPointerRef = useRef(`${state.currentRound}:${state.currentPickIndex}:${state.paused}`);
//   useEffect(() => {
//     const signature = `${state.currentRound}:${state.currentPickIndex}:${state.paused}`;
//     if (signature !== lastPointerRef.current) {
//       lastPointerRef.current = signature;
//       if (!state.paused && isLive) {
//         const next = { ...state, __pickStartedAt: Date.now() } as DraftState & { __pickStartedAt?: number };
//         saveDraftState(league, next);
//         setState(next);
//       }
//     }
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [state.currentRound, state.currentPickIndex, state.paused, isLive]);

//   // zero-clock → autopick
//   useEffect(() => {
//     if (!isLive || state.paused || state.ended) return;
//     if (timePerPickSeconds <= 0) return;
//     if (pickClock === null || pickClock > 0) return;

//     // Timeout → autopick (queue ADP, then board ADP)
//     const draftedSet = new Set((state.picks || []).map(p => p.player));
//     const chosen = chooseAutoPick({
//       league,
//       whoIsUp: roundOrders[state.currentRound - 1]?.[state.currentPickIndex] as Address,
//       draftedSet,
//       source: AutoPickSource.QueueThenBoard, // Queue first, fallback to board
//     });

//     if (chosen) {
//       doDraftPlayer(chosen);
//     } else {
//       // Nothing available (shouldn't happen if board not empty)
//       // Still advance to prevent deadlock
//       const advanced = advancePick({ state, teamCap, totalRounds: state.totalRounds });
//       saveDraftState(league, advanced);
//       setState(advanced);
//     }
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [pickClock, isLive, state.paused, state.ended, timePerPickSeconds, state.currentRound, state.currentPickIndex, state.picks]);

//   /* ─── UI Tabs (below the three top tiles per your request) ─── */
//   type Tab = 'draft' | 'queue' | 'history' | 'team' | 'all';
//   const initialTab = (search.get('tab') as Tab) || 'draft';
//   const [tab, setTab] = useState<Tab>(initialTab);

//   useEffect(() => {
//     const qTab = (search.get('tab') as Tab) || 'draft';
//     if (qTab !== tab) setTab(qTab);
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [search]);

//   useEffect(() => {
//     const q = new URLSearchParams(search);
//     q.set('tab', tab);
//     router.replace(`?${q.toString()}`, { scroll: false });
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [tab]);

//   const selectedOwnerFromQuery = (search.get('team') || '').toLowerCase();

//   /* ─── Draft interactions (DRAFT + Queue star) ─── */

//   // Called by PlayersDrawer when user clicks DRAFT button
//   function doDraftPlayer(p: RankedPlayerRow) {
//     if (!isLive || state.paused || state.ended) return;

//     const owner = roundOrders[state.currentRound - 1]?.[state.currentPickIndex] as Address | undefined;
//     if (!owner || owner === ZERO) return;

//     // ignore if already drafted (double-click race safety)
//     const already = (state.picks || []).some(x => x.player === p.name);
//     if (already) return;

//     // place pick (locks player, updates history, most recent, removes from board/queue)
//     const placed = placePick({
//       league,
//       state,
//       player: p,
//       owner,
//       round: state.currentRound,
//       slot: state.currentPickIndex + 1,
//     });

//     // advance pointer & restart clock
//     const advanced = advancePick({
//       state: placed,
//       teamCap,
//       totalRounds: state.totalRounds,
//     });

//     saveDraftState(league, advanced);
//     setState(advanced);
//   }

//   // Called by PlayersDrawer when ⭐ clicked (adds to my queue in ADP order)
//   function onQueueToggle(p: RankedPlayerRow, add: boolean) {
//     const next = { ...state };
//     const me = (wallet || '').toLowerCase();
//     const key = `queue:${me}`;
//     const raw = localStorage.getItem(key);
//     let q = raw ? (JSON.parse(raw) as RankedPlayerRow[]) : [];

//     if (add) {
//       // dedupe by name
//       if (!q.find(x => x.name === p.name)) {
//         q.push(p);
//         // keep ADP order
//         q.sort((a, b) => (a.adp ?? a.rank ?? 1e9) - (b.adp ?? b.rank ?? 1e9));
//       }
//     } else {
//       q = q.filter(x => x.name !== p.name);
//     }
//     try { localStorage.setItem(key, JSON.stringify(q)); } catch {}

//     // notify drawer/queue panel via storage/broadcast
//     saveDraftState(league, next);
//     setState(next);
//   }

//   /* ─── Phase pill + pause visibility rule ─── */
//   const phasePill = (() => {
//     if (state.ended) return <StatePill color="DONE">Completed</StatePill>;
//     if (state.paused && isLive) return <StatePill color="PAUSED">Paused</StatePill>;
//     if (beforeRealStart) return <StatePill color={inGrace ? 'GRACE' : 'SOON'}>{inGrace ? 'Grace' : 'Starting Soon'}</StatePill>;
//     return <StatePill color="LIVE">Live</StatePill>;
//   })();

//   const canShowPause = isCommish && isLive && !state.ended; // hidden until grace ends (isLive excludes grace)
//   const togglePause = () => {
//     if (!isCommish || !isLive || state.ended) return;
//     const next = { ...state, paused: !state.paused };
//     // When resuming, restart pick clock immediately
//     if (!next.paused) (next as any).__pickStartedAt = Date.now();
//     saveDraftState(league, next);
//     setState(next);
//   };

//   /* ─── Top tiles (1) Pre/On-Clock, (2) Most Recent, (3) Next Pick ─── */

//   const currentOwnerVisible = header[currentVisibleCol]?.owner || ZERO;
//   const onClockTeamName = header[currentVisibleCol]?.name || '—';

//   const nextPick = nextPickSummary({
//     state,
//     roundOrders,
//     thirdRoundReversal,
//     header,
//     beforeRealStart,
//   });

//   // Most recent pick: “Player Team Pos by [team]” (no pick #)
//   const recentPickInline = (() => {
//     const s = loadDraftState(league);
//     const rp = s?.picks?.[s.picks.length - 1] as any;
//     if (!rp) return <div className="opacity-70 text-center">No picks yet.</div>;
//     const href = `/league/${league}/draft?tab=all&team=${(rp.owner as string) || ''}`;
//     return (
//       <div className="inline-flex flex-wrap items-center justify-center gap-2">
//         <span className="font-semibold">{rp.playerName ?? rp.player}</span>
//         <span className="opacity-80">{rp.playerTeam} · {rp.position}</span>
//         <span className="opacity-80">by</span>
//         <Link href={href} className="no-underline hover:bg-white/10 rounded px-1">
//           <TeamInline league={league} owner={rp.owner} />
//         </Link>
//       </div>
//     );
//   })();

//   /* ─── Panels below the three top tiles: (Draft | Queue | History | My Team | All Teams) + Settings + Phase + Pause ─── */

//   // convenience
//   const me = teams.find(t => wallet && t.owner.toLowerCase() === (wallet as string).toLowerCase());
//   const myCol = useMemo(() => {
//     if (!wallet) return -1;
//     return header.findIndex(h => h.owner?.toLowerCase() === wallet.toLowerCase());
//   }, [wallet, header]);

//   return (
//     <main className="min-h-screen bg-gradient-to-br from-gray-950 to-black text-white px-4 sm:px-6 py-4 pb-28">
//       {/* Title + My Team pill */}
//       <div className="relative mb-3">
//         <h1 className="text-center text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight" style={{ color: ZIMA }}>
//           <span className="block lg:inline">{leagueName} </span>
//           <span className="block lg:inline uppercase">DRAFT ROOM</span>
//         </h1>

//         <div className="absolute right-0 top-0">
//           <Link
//             href={`/league/${league}/my-team`}
//             className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm no-underline hover:bg-white/10"
//             title="My Team"
//           >
//             <TeamInline league={league} owner={(me?.owner || ZERO) as Address} labelOverride={me?.name || 'My Team'} />
//             {wallet && <div className="text-[11px] font-mono opacity-70">{short(wallet)}</div>}
//           </Link>
//         </div>
//       </div>

//       {/* Top tiles */}
//       <div className="mx-auto mb-2 grid max-w-6xl grid-cols-1 gap-2 sm:grid-cols-3">
//         {/* 1) PRE / GRACE / ON THE CLOCK */}
//         <div className="rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 flex items-center justify-center">
//           {state.ended ? (
//             <div className="text-center">
//               <div className="text-xl sm:text-2xl font-extrabold tracking-wide" style={{ color: EGGSHELL }}>
//                 DRAFT IS COMPLETE
//               </div>
//             </div>
//           ) : (
//             <div className="w-full">
//               <div className="text-center text-[11px] uppercase tracking-wider text-gray-300">
//                 {beforeRealStart ? (inGrace ? 'GRACE PERIOD' : 'PRE DRAFT') : 'ON THE CLOCK'}
//               </div>
//               <div
//                 className={`text-center font-black tabular-nums ${beforeRealStart ? 'text-5xl' : 'text-3xl'}`}
//                 style={{
//                   color: beforeRealStart
//                     ? (inGrace ? (graceSecs <= 60 ? RED : EGGSHELL) : EGGSHELL)
//                     : (isLive && timePerPickSeconds > 0 && (pickClock ?? 0) <= 60) ? RED : EGGSHELL
//                 }}
//               >
//                 {beforeRealStart
//                   ? fmtClock(inGrace ? graceSecs : Math.max(0, Number(draftTs) - now))
//                   : (isLive && timePerPickSeconds > 0)
//                     ? fmtClock(pickClock ?? timePerPickSeconds)
//                     : '—'}
//               </div>
//               {!beforeRealStart && isLive && (
//                 <div className="mt-2 text-center font-semibold" style={{ color: ZIMA }}>
//                   {onClockTeamName}
//                 </div>
//               )}
//             </div>
//           )}
//         </div>

//         {/* 2) Most Recent (no pick number visible) */}
//         <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
//           <div className="text-center">
//             <div className="mb-1 font-semibold" style={{ color: ZIMA }}>Most Recent Pick</div>
//             {recentPickInline}
//           </div>
//         </div>

//         {/* 3) Next Pick */}
//         <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
//           <div className="text-center">
//             <div className="mb-1 font-semibold" style={{ color: ZIMA }}>Next Pick</div>
//             <div className="inline-flex items-center gap-2">
//               <span className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 font-mono" style={{ color: ZIMA }}>
//                 {nextPick.label}
//               </span>
//             </div>
//             <div className="mt-1 text-center">
//               {nextPick.owner ? (
//                 <Link
//                   href={`/league/${league}/draft?tab=all&team=${nextPick.owner}`}
//                   className="no-underline hover:bg-white/10 rounded px-1"
//                 >
//                   <TeamInline league={league} owner={nextPick.owner} labelOverride={nextPick.name} />
//                 </Link>
//               ) : (
//                 <TeamInline league={league} owner={ZERO} labelOverride={nextPick.name} />
//               )}
//             </div>
//           </div>
//         </div>
//       </div>

//       {/* Pills row BELOW the tiles (as requested) */}
//       <div className="mx-auto mb-3 max-w-6xl">
//         <ControlsRow
//           tab={tab}
//           onTab={setTab}
//           league={league}
//           isCommish={isCommish}
//           phasePill={phasePill}
//           canShowPause={canShowPause}
//           onTogglePause={togglePause}
//           timePerPickText={timeLabel(timePerPickSeconds)}
//           draftType={draftType}
//           salaryBudget={salaryBudget}
//         />
//       </div>

//       {/* Active panel */}
//       <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
//         {tab === 'draft' && (
//           <div className="overflow-x-auto">
//             {/* Header row (team pills) */}
//             <div className="grid gap-3 min-w-max" style={{ gridTemplateColumns: `repeat(${header.length}, minmax(160px,1fr))` }}>
//               {header.map((h, i) => {
//                 const mine = myCol >= 0 && i === myCol;
//                 const isCurrent = isLive && i === currentVisibleCol && !state.paused && !state.ended;
//                 const wrapperStyle = {
//                   borderColor: mine ? EGGSHELL : (isCurrent ? 'rgba(240,234,214,0.40)' : 'rgba(255,255,255,.10)'),
//                   background: mine ? 'rgba(240,234,214,0.08)' : (isCurrent ? 'rgba(240,234,214,0.10)' : 'rgba(0,0,0,.30)')
//                 } as const;

//                 return (
//                   <div key={`${h.owner}-${i}`} className="rounded-2xl border px-3 py-3 text-center" style={wrapperStyle}>
//                     {h.owner && h.owner !== ZERO
//                       ? <Link href={`?tab=all&team=${h.owner}`} className="block no-underline hover:bg-white/5 rounded">
//                           <HeaderCell league={league} owner={h.owner as Address} name={h.name} />
//                         </Link>
//                       : <HeaderCell league={league} owner={h.owner as Address} name={h.name} />}
//                   </div>
//                 );
//               })}
//             </div>

//             {/* Board grid */}
//             <div className="mt-3 space-y-3 min-w-max">
//               {Array.from({ length: state.totalRounds }, (_, r) => r + 1).map((round) => (
//                 <div key={`round-${round}`} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${header.length}, minmax(160px,1fr))` }}>
//                   {header.map((_, col) => {
//                     const ordersForRound = roundOrders[round - 1] || [];
//                     const pickOwner = ordersForRound[col];
//                     const isCur = isLive && !state.paused && !state.ended &&
//                       state.currentRound === round && visibleColForPointer({
//                         round1: r1Order, currentRound: state.currentRound, currentPickIndex: state.currentPickIndex, thirdRoundReversal
//                       }) === col;

//                     const showTimer = isCur && timePerPickSeconds > 0 && (pickClock ?? 0) >= 0;
//                     const trrCell = isTrueReversalCell({ round, col, round1: r1Order, thirdRoundReversal });

//                     const borderColor = isCur ? ZIMA : (trrCell ? ORANGE : 'rgba(255,255,255,.10)');
//                     const background = isCur ? 'rgba(55,192,246,0.10)' : 'rgba(0,0,0,.40)';

//                     // find placed pick for this slot
//                     const placed = state.picks.find(p => p.round === round && p.slot === (col + 1));

//                     return (
//                       <div key={`cell-${round}-${col}`} className="relative h-16 rounded-2xl border grid place-items-center text-sm" style={{ borderColor, background }}>
//                         {placed ? (
//                           <span className="text-white font-semibold">
//                             {placed.player}
//                           </span>
//                         ) : showTimer ? (
//                           <span className="inline-flex items-center gap-1">
//                             <span className="rounded px-2 py-[3px] text-[13px] font-mono"
//                               style={{ color: (pickClock! <= 60 ? RED : EGGSHELL), background: 'rgba(255,255,255,.08)' }}>
//                               {fmtClock(pickClock!)}
//                             </span>
//                           </span>
//                         ) : (
//                           <span className="text-gray-300">{pickLabel({ round, col, round1: r1Order, thirdRoundReversal })}</span>
//                         )}
//                       </div>
//                     );
//                   })}
//                 </div>
//               ))}
//             </div>
//           </div>
//         )}

//         {tab === 'queue' && (
//           <PanelQueue league={league} onDraft={doDraftPlayer} />
//         )}

//         {tab === 'history' && (
//           <PanelHistory league={league} />
//         )}

//         {tab === 'team' && (
//           <PanelMyTeam league={league} header={header} />
//         )}

//         {tab === 'all' && (
//           <PanelAllTeams
//             league={league}
//             header={header}
//             selectedOwnerLower={selectedOwnerFromQuery}
//             onSelectOwner={(owner) => {
//               const q = new URLSearchParams(search);
//               q.set('tab', 'all');
//               if (owner) q.set('team', owner);
//               router.replace(`?${q.toString()}`, { scroll: false });
//             }}
//           />
//         )}
//       </section>

//       {/* Players Drawer (CSV-driven; ADP column; sorts/filters; star queue; DRAFT button) */}
//       <PlayersDrawer
//         league={league}
//         openByDefault={true}
//         timePerPickSeconds={timePerPickSeconds}
//         titleColor={ZIMA}
//         playerColor={EGGSHELL}
//         onDraft={doDraftPlayer}
//         onQueueToggle={onQueueToggle}
//       />
//     </main>
//   );
// }

// src/app/league/[address]/draft/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import {
  initStateFromChain,
  advancePick,
  placePick,
  nextPickSummary,
  type BoardPlayerRow,
} from '@/lib/pick-flow';
import {
  loadDraftState,
  saveDraftState,
  resetDraftState,
  type DraftState,
} from '@/lib/draft-storage';
import PlayersDrawer from '@/components/draft/PlayersDrawer';

const ZIMA = '#37c0f6';
const EGGSHELL = '#F0EAD6';

type Address = `0x${string}`;
const ZERO: Address = '0x0000000000000000000000000000000000000000';

export default function DraftRoom() {
  const params = useParams<{ address: string }>();
  const league = params.address as Address;
  const { address } = useAccount();

  /* ------------------- Mount guard (fix hydration) ------------------- */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="text-center p-8">Loading draft…</div>;

  /* ------------------- Local draft state ------------------- */
  const [state, setState] = useState<DraftState>(() =>
    initStateFromChain(
      league,
      [], // teams will be wired later
      [],
      false
    )
  );

  // Persist state to localStorage
  useEffect(() => {
    if (state) saveDraftState(league, state);
  }, [league, state]);

  const draftedNames = useMemo(
    () => new Set((state.picks || []).map(p => p.playerName || p.player || '')),
    [state.picks]
  );

  const handleDraft = (p: BoardPlayerRow) => {
    const owner = address || ZERO;
    const next = placePick({
      league,
      state,
      player: p,
      owner,
      round: state.currentRound,
      slot: state.currentPickIndex + 1,
    });
    const advanced = advancePick({ state: next, teamCap: state.order.length, totalRounds: state.totalRounds });
    setState(advanced);
  };

  const nextPick = useMemo(() => {
    return nextPickSummary({
      state,
      roundOrders: [state.order],
      thirdRoundReversal: false,
      header: state.order.map(o => ({ owner: o, name: o })),
      beforeRealStart: state.startedAt === 0,
    });
  }, [state]);

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: ZIMA }}>
          Draft Room
        </h1>
        <button
          onClick={() => resetDraftState(league)}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          Reset Draft
        </button>
      </div>

      {/* Next Pick Box */}
      <div className="rounded-xl border border-white/15 bg-black/40 p-4 text-center">
        <div className="text-lg font-semibold" style={{ color: EGGSHELL }}>
          {nextPick.label}
        </div>
        <div className="inline-flex flex-wrap items-center justify-center gap-2 mt-2">
          <span className="font-semibold">{nextPick.name || '—'}</span>
        </div>
      </div>

      {/* Drafted History */}
      <div className="rounded-xl border border-white/15 bg-black/40 p-4">
        <h2 className="text-lg font-semibold mb-3" style={{ color: ZIMA }}>
          Draft History
        </h2>
        {state.picks.length === 0 ? (
          <div className="text-sm opacity-70 text-center">No picks yet</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {state.picks.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center justify-center gap-2">
                <span className="font-semibold">{p.playerName}</span>
                <span className="opacity-80">{p.playerTeam}</span>
                <span className="opacity-80">{p.position}</span>
                <Link
                  href="#"
                  className="no-underline hover:bg-white/10 rounded px-1"
                >
                  Pick {p.round}.{p.slot}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Players Drawer */}
      <PlayersDrawer
        open={true}
        onToggle={() => {}}
        league={league}
        draftedNames={draftedNames}
        onDraft={handleDraft}
        whoAmI={address}
      />
    </div>
  );
}
