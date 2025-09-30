'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import { toast } from 'react-hot-toast';
import { useTeamProfile, generatedLogoFor } from '@/lib/teamProfile';

/* Theme */
const ZIMA = '#37c0f6';
const EGGSHELL = '#F0EAD6';

/* ABI */
const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  {
    type: 'function', name: 'getTeams', stateMutability: 'view', inputs: [],
    outputs: [{ type: 'tuple[]', components: [{ name: 'owner', type: 'address' }, { name: 'name', type: 'string' }]}],
  },
  {
    type: 'function', name: 'getDraftSettings', stateMutability: 'view', inputs: [],
    outputs: [
      { type: 'uint8' }, { type: 'uint64' }, { type: 'uint8' },
      { type: 'bool' }, { type: 'address[]' }, { type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'setDraftSettings', stateMutability: 'nonpayable',
    inputs: [
      { name: '_draftType', type: 'uint8' },
      { name: '_draftTimestamp', type: 'uint64' },
      { name: '_orderMode', type: 'uint8' },
      { name: '_manualOrder', type: 'address[]' },
      { name: '_draftCompleted', type: 'bool' },
      { name: '_draftPickTradingEnabled', type: 'bool' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'commissioner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

type Team = { owner: `0x${string}`; name: string };
const ZERO = '0x0000000000000000000000000000000000000000' as const;

const DraftTypeMap = { snake: 0, salary: 1, autopick: 2, offline: 3 } as const;
type DraftTypeKey = keyof typeof DraftTypeMap;

const DraftTypeDesc: Record<DraftTypeKey, string> = {
  snake: 'Classic snake draft. Each round reverses the order for balance.',
  salary: 'Auction draft with team budgets. Highest bidder wins each player.',
  autopick: 'Teams are auto-picked from rankings. Fastest way to start.',
  offline: 'Run the draft elsewhere; import or enter results later.',
};

const OrderModeMap = { random: 0, manual: 1 } as const;
type OrderModeKey = keyof typeof OrderModeMap;

/* helpers */
function shortAddr(a?: string) { if (!a) return '—'; return `${a.slice(0,6)}…${a.slice(-4)}`; }
function fmtYMD(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function arraysEqual(a: readonly string[], b: readonly string[]) { if (a.length!==b.length) return false; for (let i=0;i<a.length;i++) if (a[i]!==b[i]) return false; return true; }

function useOnClickOutside(ref: React.RefObject<HTMLElement>, fn: () => void) {
  useEffect(() => {
    function onDown(e: MouseEvent) { if (!ref.current) return; if (!ref.current.contains(e.target as Node)) fn(); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ref, fn]);
}
function Calendar({ value, onChange }: { value?: string; onChange: (d: string) => void }) {
  const [view, setView] = useState(() => new Date(value ? value : Date.now()));
  useEffect(() => { if (value) setView(new Date(value)); }, [value]);
  const days = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const startDay = first.getDay(); const grid: Date[] = [];
    for (let i = 0; i < startDay; i++) grid.push(new Date(view.getFullYear(), view.getMonth(), -startDay + i + 1));
    const lastDate = new Date(view.getFullYear(), view.getMonth()+1, 0).getDate();
    for (let d = 1; d <= lastDate; d++) grid.push(new Date(view.getFullYear(), view.getMonth(), d));
    while (grid.length % 7 !== 0) { const last = grid[grid.length-1]; grid.push(new Date(last.getFullYear(), last.getMonth(), last.getDate()+1)); }
    return grid;
  }, [view]);
  const selected = value ? new Date(value) : undefined;
  const WEEKDAYS = ['S','M','T','W','T','F','S'];
  return (
    <div className="rounded-xl border border-gray-700 bg-[#0b0b12] p-3 w-72 text-sm shadow-xl">
      <div className="flex items-center justify-between mb-2">
        <button className="px-2 py-1 rounded border border-gray-700 hover:border-white/60"
          onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth()-1, 1))}>‹</button>
        <div className="font-semibold">{view.toLocaleString(undefined,{month:'long',year:'numeric'})}</div>
        <button className="px-2 py-1 rounded border border-gray-700 hover:border-white/60"
          onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth()+1, 1))}>›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-gray-400 mb-1">{WEEKDAYS.map((d,i)=><div key={i}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {days.map((d,i)=> {
          const inMonth = d.getMonth()===view.getMonth();
          const isSel = selected && fmtYMD(d)===fmtYMD(selected);
          return (
            <button key={`${fmtYMD(d)}-${i}`} onClick={()=>onChange(fmtYMD(d))}
              className={['py-1 rounded', inMonth?'text-white':'text-gray-500',
                isSel?'bg-fuchsia-600':'hover:bg-white/10 border border-transparent hover:border-white/10'].join(' ')}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
function timeOptions12h() {
  const out: { label: string; value24: string }[] = [];
  for (let h=0; h<24; h++) for (let m=0; m<60; m+=15) {
    const hour12 = ((h + 11) % 12) + 1; const ampm = h<12 ? 'AM' : 'PM';
    out.push({ label: `${hour12}:${String(m).padStart(2,'0')} ${ampm}`, value24: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`});
  }
  return out;
}

/* UI persistence */
type UIState = {
  salaryCap: string;
  thirdRoundReversal: boolean;
  playerPool: 'all'|'rookies'|'vets';
  timePerPick: 'no-limit'|'15s'|'30s'|'45s'|'60s'|'90s'|'120s'|'180s'|'300s'|'600s'|'1h'|'2h'|'4h'|'8h'|'12h'|'24h';
};
const DEFAULT_UI: UIState = { salaryCap: '400', thirdRoundReversal: false, playerPool: 'all', timePerPick: '60s' };
const uiKey = (league: string) => `hashmark:draft-ui:${(league||'').toLowerCase()}`;
const loadUI = (league: string): UIState => {
  if (typeof window === 'undefined') return DEFAULT_UI;
  try { const raw = localStorage.getItem(uiKey(league)); return raw ? { ...DEFAULT_UI, ...JSON.parse(raw) } : DEFAULT_UI; }
  catch { return DEFAULT_UI; }
};
const saveUI = (league: string, ui: UIState) => {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(uiKey(league), JSON.stringify(ui)); } catch {}
};

export default function DraftSettings() {
  const { address: league } = useParams<{ address: `0x${string}` }>();
  const router = useRouter();
  const { address: wallet } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();

  // permissions
  const { data: commish } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'commissioner' });
  const isCommish = !!(wallet && commish && wallet.toLowerCase() === (commish as string).toLowerCase());
  useEffect(() => { if (commish && (!wallet || !isCommish)) router.replace(`/league/${league}`); },
    [commish, isCommish, wallet, router, league]);

  // reads
  const { data: teamsData } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'getTeams' });
  const teams = ((teamsData as any[]) || []) as Team[];
  const filledTeams = teams.filter(t => t.owner !== ZERO);

  const { data: settings } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'getDraftSettings' });
  const [currentType, currentTs, currentOrderMode, currentCompleted, currentManualOrder, currentPickTrading] =
    (settings as [number, bigint, number, boolean, string[], boolean] | undefined) || [0, 0n, 0, false, [], false];

  /* ---------------- LOCK: within 1h to start OR live ---------------- */
  const nowSec = Math.floor(Date.now()/1000);
  const startAt = Number(currentTs || 0n);
  const withinHour = startAt > 0 && nowSec >= (startAt - 3600) && !currentCompleted;
  const live = startAt > 0 && nowSec >= startAt && !currentCompleted;
  const settingsLocked = withinHour || live;

  /* header look only */
  useTeamProfile?.(league as string, wallet as string);

  /* state */
  const [draftType, setDraftType] = useState<DraftTypeKey>('snake');
  const [salaryCap, setSalaryCap] = useState<string>('400');
  const [thirdRoundReversal, setThirdRoundReversal] = useState<boolean>(false);

  const [date, setDate] = useState<string>('');  // yyyy-mm-dd
  const [time24, setTime24] = useState<string>('20:00');
  const [orderMode, setOrderMode] = useState<OrderModeKey>('random');

  const [orderList, setOrderList] = useState<`0x${string}`[]>([]);
  const [draftCompleted, setDraftCompleted] = useState<boolean>(false);
  const [draftPickTradingEnabled, setDraftPickTradingEnabled] = useState<boolean>(false);

  type PlayerPool = 'all'|'rookies'|'vets';
  const PICK_PRESETS = ['no-limit','15s','30s','45s','60s','90s','120s','180s','300s','600s','1h','2h','4h','8h','12h','24h'] as const;
  type PickPreset = typeof PICK_PRESETS[number];
  const [playerPool, setPlayerPool] = useState<PlayerPool>('all');
  const [timePerPick, setTimePerPick] = useState<PickPreset>('60s');

  // load persisted UI
  useEffect(() => {
    if (!league) return;
    const ui = loadUI(league);
    setSalaryCap(ui.salaryCap);
    setThirdRoundReversal(ui.thirdRoundReversal);
    setPlayerPool(ui.playerPool);
    setTimePerPick(ui.timePerPick);
  }, [league]);

  // persist UI whenever these change
  useEffect(() => {
    if (!league) return;
    saveUI(league, { salaryCap, thirdRoundReversal, playerPool, timePerPick });
  }, [league, salaryCap, thirdRoundReversal, playerPool, timePerPick]);

  // prefill from chain
  useEffect(() => {
    setDraftType((['snake','salary','autopick','offline'] as DraftTypeKey[])[currentType] ?? 'snake');
    setOrderMode((['random','manual'] as OrderModeKey[])[currentOrderMode] ?? 'random');
    setDraftCompleted(Boolean(currentCompleted));
    setDraftPickTradingEnabled(Boolean(currentPickTrading));

    const ts = Number(currentTs);
    if (ts > 0) {
      const d = new Date(ts * 1000);
      setDate(fmtYMD(d));
      setTime24(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
    }

    const fromChain = (currentManualOrder || []) as `0x${string}`[];
    const base = fromChain.length ? [...fromChain] : [...filledTeams.map(t => t.owner)];
    while (base.length < teams.length) base.push(ZERO);
    setOrderList(base.slice(0, teams.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentType, currentTs, currentOrderMode, currentCompleted, currentPickTrading, JSON.stringify(currentManualOrder), teams.length]);

  // ensure skeleton when MANUAL
  useEffect(() => {
    if (orderMode !== 'manual') return;
    setOrderList(prev => {
      const next = [...prev]; while (next.length < teams.length) next.push(ZERO);
      return next.slice(0, teams.length);
    });
  }, [orderMode, teams.length]);

  // randomize when joined owners change (only in Random mode)
  const ownersSig = useMemo(() => filledTeams.map(t=>t.owner.toLowerCase()).join(','), [filledTeams]);
  useEffect(() => {
    if (orderMode !== 'random') return;
    const owners = [...filledTeams.map(t=>t.owner)];
    for (let i=owners.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [owners[i],owners[j]]=[owners[j],owners[i]]; }
    while (owners.length < teams.length) owners.push(ZERO);
    setOrderList(prev => arraysEqual(prev, owners) ? prev : owners as `0x${string}`[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownersSig, orderMode, teams.length]);

  // build array to send (full length, padded with ZERO)
  const manualOrderArray = useMemo(() => {
    const out = new Array<string>(teams.length).fill(ZERO);
    for (let i=0; i<Math.min(orderList.length, out.length); i++) out[i] = orderList[i] || ZERO;
    return out as `0x${string}`[];
  }, [orderList, teams.length]);

  // calendar
  const [calOpen, setCalOpen] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);
  const closeCal = useCallback(() => setCalOpen(false), []);
  useOnClickOutside(calRef, closeCal);

  const timeOptions = useMemo(() => timeOptions12h(), []);
  const draftTimestamp = useMemo(() => {
    if (!date || !time24) return 0;
    const [yyyy, mm, dd] = date.split('-').map(Number);
    const [hh, mi] = time24.split(':').map(Number);
    return Math.floor(new Date(yyyy, mm-1, dd, hh, mi, 0, 0).getTime()/1000);
  }, [date, time24]);

  const moveTeam = (idx: number, dir: -1 | 1) => {
    setOrderList(prev => {
      const next = [...prev]; const j = idx+dir; if (j<0 || j>=next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]]; return next;
    });
  };

  const validateBeforeSave = () => {
    if (draftType === 'salary') {
      const n = Number(salaryCap);
      if (!Number.isFinite(n) || n <= 0) { toast.error('Salary cap must be a positive number.'); return false; }
    }
    return true;
  };

  // SAVE — send manual order *only when* in Manual mode (prevents “sticky” arrays)
  const handleSave = async () => {
    try {
      if (!validateBeforeSave()) return;

      // Persist UI right before write
      saveUI(league, { salaryCap, thirdRoundReversal, playerPool, timePerPick });

      const id = toast.loading('Submitting transaction…');
      const hash = await writeContractAsync({
        abi: LEAGUE_ABI,
        address: league,
        functionName: 'setDraftSettings',
        args: [
          DraftTypeMap[draftType],
          BigInt(draftTimestamp),
          OrderModeMap[orderMode],
          orderMode === 'manual' ? manualOrderArray : ([] as `0x${string}`[]),
          draftCompleted,
          draftPickTradingEnabled,
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash });
      toast.success('Draft settings confirmed on-chain.', { id });
      router.refresh();
    } catch (e: any) {
      toast.error(e?.shortMessage || e?.message || 'Failed to save settings');
    }
  };

  // EARLY RETURN when locked
  if (!commish || !wallet) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
        <div className="mx-auto max-w-2xl"><p className="text-sm text-gray-400">Checking permissions…</p></div>
      </main>
    );
  }
  if (!isCommish) return null;

  if (settingsLocked) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
        <div className="mx-auto max-w-xl text-center rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <div className="text-2xl font-bold mb-2" style={{ color: ZIMA }}>Draft Settings Locked</div>
          <p className="text-sm text-gray-300">
            Settings are locked within 1 hour of the scheduled start and during the live draft.
          </p>
          <div className="mt-4">
            <Link
              href={`/league/${league}`}
              className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 inline-block hover:bg-white/15"
            >
              Go to Draft Room
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const nameForAddress = (addr: `0x${string}`, idx: number) => {
    if (addr === ZERO) return `Team ${idx + 1}`;
    const t = filledTeams.find(t => t.owner.toLowerCase() === addr.toLowerCase());
    return t?.name || shortAddr(addr);
  };
  const avatarForAddress = (addr: `0x${string}`) => generatedLogoFor?.(addr) || '';

  const chipClass = (selected: boolean) =>
    selected ? 'rounded-xl px-4 py-2 font-semibold border'
             : 'rounded-xl px-4 py-2 font-semibold border bg-gray-800 border-gray-700 hover:border-white';
  const chipStyle = (selected: boolean) =>
    selected ? { background: EGGSHELL, color: '#000', borderColor: EGGSHELL } : { color: EGGSHELL };

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div className="w-14" />
            <h1 className="text-3xl font-extrabold text-center" style={{ color: ZIMA }}>Draft Settings</h1>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5">
              <div className="relative h-6 w-6 overflow-hidden rounded-full bg-gray-800">
                <Image src={generatedLogoFor?.(commish as `0x${string}`) || '/placeholder.png'} alt="" fill sizes="24px" />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold">Commissioner</div>
                <div className="text-[11px] text-gray-300">{shortAddr(commish as string)}</div>
              </div>
            </div>
          </div>
        </header>

        <div className="space-y-8 rounded-2xl border border-gray-800 bg-black/30 p-6">
          {/* Draft Type */}
          <div className="text-center">
            <label className="block mb-3 text-lg font-bold" style={{ color: ZIMA }}>Draft Type</label>
            <div className="flex flex-wrap justify-center gap-2">
              {(['snake','salary','autopick','offline'] as DraftTypeKey[]).map((key) => {
                const selected = draftType === key;
                return (
                  <button key={key} onClick={() => setDraftType(key)} className={chipClass(selected)} style={chipStyle(selected)} title={DraftTypeDesc[key]}>
                    {key === 'snake' ? 'Snake' : key === 'salary' ? 'Salary Cap' : key === 'autopick' ? 'Autopick' : 'Offline'}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-sm" style={{ color: EGGSHELL }}>{DraftTypeDesc[draftType]}</p>

            {draftType === 'salary' && (
              <div className="mt-4 flex items-center justify-center gap-3">
                <label className="text-sm" style={{ color: EGGSHELL }}>Team Budget</label>
                <input
                  inputMode="numeric" value={salaryCap} onChange={(e) => setSalaryCap(e.target.value)}
                  className="w-28 bg-black/40 text-white p-2 rounded-lg border border-gray-700 text-center"
                  placeholder="400" title="Default is 400"
                />
                <span className="text-xs italic" style={{ color: EGGSHELL }}>(400 is default)</span>
              </div>
            )}

            {draftType === 'snake' && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <input type="checkbox" checked={thirdRoundReversal} onChange={(e) => setThirdRoundReversal(e.target.checked)} />
                <span className="text-sm" style={{ color: EGGSHELL }}>
                  Third Round Reversal (Round 3 follows Round 2 order; helps balance elite picks)
                </span>
              </div>
            )}
          </div>

          {/* Date & Time + Player Pool + Time Per Pick */}
          <div className="text-center">
            <label className="block mb-3 text-lg font-bold" style={{ color: ZIMA }}>Draft Date & Time</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="relative" ref={calRef}>
                <button onClick={() => setCalOpen((s)=>!s)} className="w-full text-center bg-black/40 text-white p-3 rounded-xl border border-gray-700 focus:ring-2 focus:ring-fuchsia-600 outline-none">
                  {date ? new Date(date).toLocaleDateString() : <span style={{ color: EGGSHELL }}>Pick a date</span>}
                </button>
                {calOpen && (
                  <div className="absolute z-10 mt-2">
                    <Calendar value={date} onChange={(d)=>{ setDate(d); setCalOpen(false); }} />
                  </div>
                )}
              </div>
              <select value={time24} onChange={(e)=>setTime24(e.target.value)} className="w-full text-center bg-black/40 text-white p-3 rounded-xl border border-gray-700 focus:ring-2 focus:ring-fuchsia-600 outline-none">
                {timeOptions.map((t)=> <option key={t.value24} value={t.value24}>{t.label}</option>)}
              </select>
            </div>

            <div className="mt-6">
              <label className="block mb-2 text-lg font-bold" style={{ color: ZIMA }}>Player Pool</label>
              <div className="flex flex-wrap justify-center gap-2">
                {[
                  { key: 'all', label: 'All Players' },
                  { key: 'rookies', label: 'Rookies Only' },
                  { key: 'vets', label: 'Vets Only' },
                ].map((opt) => {
                  const selected = playerPool === (opt.key as PlayerPool);
                  return (
                    <button key={opt.key} onClick={()=>setPlayerPool(opt.key as PlayerPool)}
                      className={chipClass(selected)} style={chipStyle(selected)}>{opt.label}</button>
                  );
                })}
              </div>
            </div>

            <div className="mt-6">
              <label className="block mb-2 text-lg font-bold" style={{ color: ZIMA }}>Time per Pick</label>
              <div className="flex flex-wrap justify-center gap-2">
                {PICK_PRESETS.map((p) => {
                  const selected = timePerPick === p;
                  return (
                    <button key={p} onClick={()=>setTimePerPick(p)}
                      className={selected ? 'rounded-xl px-3 py-1.5 text-sm font-semibold border'
                                           : 'rounded-xl px-3 py-1.5 text-sm font-semibold border bg-gray-800 border-gray-700 hover:border-white'}
                      style={selected ? { background: EGGSHELL, color: '#000', borderColor: EGGSHELL } : { color: EGGSHELL }}>
                      {p === 'no-limit' ? 'No Limit' : p.endsWith('s') ? `${parseInt(p)}S` : `${parseInt(p)}H`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Draft Order */}
          <div className="text-center">
            <label className="block mb-3 text-lg font-bold" style={{ color: ZIMA }}>Draft Order</label>
            <div className="flex flex-wrap gap-6 justify-center mb-2" style={{ color: EGGSHELL }}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="order" checked={orderMode==='random'} onChange={()=>setOrderMode('random')} /> Random
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="order" checked={orderMode==='manual'} onChange={()=>setOrderMode('manual')} /> Manual
              </label>
            </div>

            {orderMode === 'manual' && (
              <div className="space-y-2 max-w-md mx-auto text-left">
                {orderList.length === 0 ? (
                  <p className="text-gray-400 text-center">No teams yet.</p>
                ) : (
                  orderList.map((addr, i) => (
                    <div key={`${addr}-${i}`} className="flex items-center gap-3">
                      <span className="w-8 text-gray-400">{i + 1}.</span>
                      <div className="relative h-7 w-7 overflow-hidden rounded-full bg-gray-800 shrink-0">
                        {addr !== ZERO ? (
                          <Image src={avatarForAddress(addr) || '/placeholder.png'} alt="" fill sizes="28px" />
                        ) : <div className="h-7 w-7 rounded-full bg-gray-700" />}
                      </div>
                      <span className="flex-1 truncate" style={{ color: EGGSHELL }}>
                        {nameForAddress(addr, i)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button onClick={()=>moveTeam(i,-1)} className="px-2 py-1 rounded border border-gray-700 hover:border-white/60" aria-label="Move up">↑</button>
                        <button onClick={()=>moveTeam(i,+1)} className="px-2 py-1 rounded border border-gray-700 hover:border-white/60" aria-label="Move down">↓</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* toggles */}
          <div className="text-center">
            <label className="inline-flex items-center gap-2 text-lg font-bold" style={{ color: ZIMA }}>
              <input type="checkbox" checked={draftPickTradingEnabled} onChange={(e)=>setDraftPickTradingEnabled(e.target.checked)} />
              Allow draft pick trading
            </label>
            <p className="text-sm mt-1" style={{ color: EGGSHELL }}>When enabled, teams can trade future/active draft picks per your league rules.</p>
          </div>

          <div className="text-center">
            <label className="inline-flex items-center gap-2 text-lg font-bold" style={{ color: ZIMA }}>
              <input type="checkbox" checked={draftCompleted} onChange={(e)=>setDraftCompleted(e.target.checked)} />
              Draft completed
            </label>
            <p className="text-sm mt-1" style={{ color: EGGSHELL }}>When checked, Home shows “My Team” + “League” for this league.</p>
          </div>

          <div className="flex justify-center">
            <button
              onClick={handleSave}
              disabled={isPending || settingsLocked}
              className="rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 px-6 py-3 font-bold disabled:opacity-50"
            >
              {settingsLocked ? 'Locked' : (isPending ? 'Saving…' : 'Save Settings')}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
