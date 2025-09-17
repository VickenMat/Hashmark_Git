'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAccount, useReadContract, useWriteContract } from 'wagmi';
import { toast } from 'react-hot-toast';

/* ──────────────────────  Contract ABI  ──────────────────────
   IMPORTANT: Make sure League.sol matches these two functions:

   function getDraftSettings() external view returns (
     uint8 draftType,
     uint64 draftTimestamp,
     uint8 orderMode,
     bool draftCompleted,
     address[] memory manualOrder,
     bool draftPickTradingEnabled
   );

   function setDraftSettings(
     uint8 _draftType,
     uint64 _draftTimestamp,
     uint8 _orderMode,
     address[] calldata _manualOrder,
     bool _draftCompleted,
     bool _draftPickTradingEnabled
   ) external;
*/
const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
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
          { name: 'name', type: 'string' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getDraftSettings',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { type: 'uint8' },     // draftType
      { type: 'uint64' },    // draftTimestamp
      { type: 'uint8' },     // orderMode
      { type: 'bool' },      // draftCompleted
      { type: 'address[]' }, // manualOrder
      { type: 'bool' },      // draftPickTradingEnabled
    ],
  },
  {
    type: 'function',
    name: 'setDraftSettings',
    stateMutability: 'nonpayable',
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
  snake: 'Each round reverses the draft order (1→N, then N→1). Fair and simple.',
  salary: 'Auction-style draft with budgets. Bid on any player until budgets run out.',
  autopick: 'Teams are auto-picked from rankings. Fastest way to start.',
  offline: 'Run the draft elsewhere and enter results manually later.',
};

const OrderModeMap = { random: 0, manual: 1 } as const;
type OrderModeKey = keyof typeof OrderModeMap;

/* ──────────────── helpers ──────────────── */
function shortAddr(a?: string) { if (!a) return '—'; return `${a.slice(0,6)}…${a.slice(-4)}`; }
function fifteenMinuteOptions() {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 15) out.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
  return out;
}
function fmtYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function useOnClickOutside(ref: React.RefObject<HTMLElement>, fn: () => void) {
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) fn();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ref, fn]);
}
function Calendar({ value, onChange }: { value?: string; onChange: (d: string) => void }) {
  const [view, setView] = useState(() => {
    const base = value ? new Date(value) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const days = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const startDay = first.getDay(); // 0 Sun - 6 Sat
    const grid: Date[] = [];
    for (let i = 0; i < startDay; i++) grid.push(new Date(view.getFullYear(), view.getMonth(), -startDay + i + 1));
    const lastDate = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= lastDate; d++) grid.push(new Date(view.getFullYear(), view.getMonth(), d));
    while (grid.length % 7 !== 0) {
      const last = grid[grid.length - 1];
      grid.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
    }
    return grid;
  }, [view]);

  const selected = value ? new Date(value) : undefined;
  const WEEKDAYS = ['S','M','T','W','T','F','S'];

  return (
    <div className="rounded-xl border border-gray-700 bg-[#0b0b12] p-3 w-72 text-sm shadow-xl">
      <div className="flex items-center justify-between mb-2">
        <button className="px-2 py-1 rounded border border-gray-700 hover:border-white/60"
                onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}>‹</button>
        <div className="font-semibold">
          {view.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
        </div>
        <button className="px-2 py-1 rounded border border-gray-700 hover:border-white/60"
                onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}>›</button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-gray-400 mb-1">
        {WEEKDAYS.map((d, i) => <div key={i}>{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === view.getMonth();
          const isSel = selected && fmtYMD(d) === fmtYMD(selected);
          return (
            <button
              key={`${fmtYMD(d)}-${i}`}
              onClick={() => onChange(fmtYMD(d))}
              className={[
                'py-1 rounded',
                inMonth ? 'text-white' : 'text-gray-500',
                isSel ? 'bg-fuchsia-600' : 'hover:bg-white/10 border border-transparent hover:border-white/10',
              ].join(' ')}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────  Page  ─────────────────────────── */
export default function DraftSettings() {
  const { address: league } = useParams<{ address: `0x${string}` }>();
  const router = useRouter();
  const { address: wallet } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();

  // Permissions
  const { data: commish } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'commissioner' });
  const isCommish = !!(wallet && commish && wallet.toLowerCase() === (commish as string).toLowerCase());
  useEffect(() => { if (commish && (!wallet || !isCommish)) router.replace(`/league/${league}`); },
    [commish, isCommish, wallet, router, league]);

  // Reads
  const { data: leagueName } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' });
  const { data: teamsData }  = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'getTeams' });
  const teams = ((teamsData as any[]) || []) as Team[];
  const filledTeams = teams.filter(t => t.owner !== ZERO);

  const { data: settings } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'getDraftSettings' });
  const [currentType, currentTs, currentOrderMode, currentCompleted, currentManualOrder, currentPickTrading] =
    (settings as [number, bigint, number, boolean, string[], boolean] | undefined) || [0, 0n, 0, false, [], false];

  /* ----- UI state (prefilled from chain) ----- */
  const [draftType, setDraftType] = useState<DraftTypeKey>('snake');
  const [date, setDate] = useState<string>('');      // yyyy-mm-dd
  const [time, setTime] = useState<string>('20:00'); // HH:MM
  const [orderMode, setOrderMode] = useState<OrderModeKey>('random');
  const [manualOrder, setManualOrder] = useState<Record<string, number>>({});
  const [draftCompleted, setDraftCompleted] = useState<boolean>(false);
  const [draftPickTradingEnabled, setDraftPickTradingEnabled] = useState<boolean>(false);

  useEffect(() => {
    setDraftType((['snake','salary','autopick','offline'] as DraftTypeKey[])[currentType] ?? 'snake');
    setOrderMode((['random','manual'] as OrderModeKey[])[currentOrderMode] ?? 'random');
    setDraftCompleted(Boolean(currentCompleted));
    setDraftPickTradingEnabled(Boolean(currentPickTrading));
    const ts = Number(currentTs);
    if (ts > 0) {
      const d = new Date(ts * 1000);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      const hh = String(d.getHours()).padStart(2,'0');
      const mi = String(d.getMinutes()).padStart(2,'0');
      setDate(`${yyyy}-${mm}-${dd}`);
      setTime(`${hh}:${mi}`);
    }
    if ((currentManualOrder || []).length) {
      const map: Record<string, number> = {};
      currentManualOrder.forEach((addr, idx) => { if (addr !== ZERO) map[addr] = idx + 1; });
      setManualOrder(map);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentType, currentTs, currentOrderMode, currentCompleted, currentPickTrading, JSON.stringify(currentManualOrder)]);

  const timeOptions = useMemo(() => fifteenMinuteOptions(), []);

  // Popover calendar handling
  const [calOpen, setCalOpen] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(calRef, () => setCalOpen(false));

  // Compute timestamp (local → seconds)
  const draftTimestamp = useMemo(() => {
    if (!date || !time) return 0;
    const [yyyy, mm, dd] = date.split('-').map(Number);
    const [hh, mi] = time.split(':').map(Number);
    const dt = new Date(yyyy, mm - 1, dd, hh, mi, 0, 0);
    return Math.floor(dt.getTime() / 1000);
  }, [date, time]);

  // Build on-chain order array: full teamCap length; joined teams get positions; empties are ZERO
  const manualOrderArray = useMemo(() => {
    const ordered = [...filledTeams]
      .map(t => ({ ...t, pos: manualOrder[t.owner] ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.pos - b.pos);
    const out = new Array<string>(teams.length).fill(ZERO);
    let idx = 0;
    for (const t of ordered) {
      if (t.pos !== Number.MAX_SAFE_INTEGER && idx < out.length) out[idx++] = t.owner;
    }
    return out as `0x${string}`[];
  }, [teams.length, filledTeams, manualOrder]);

  const validateManual = () => {
    const cap = teams.length;
    const positions = Object.values(manualOrder).filter((n) => Number.isFinite(n)) as number[];
    if (positions.some(p => p < 1 || p > cap)) { toast.error(`Positions must be between 1 and ${cap}.`); return false; }
    const set = new Set(positions);
    if (set.size !== positions.length) { toast.error('Duplicate positions are not allowed.'); return false; }
    return true;
  };

  const handleSave = async () => {
    try {
      if (orderMode === 'manual' && !validateManual()) return;
      const id = toast.loading('Saving draft settings…');
      await writeContractAsync({
        abi: LEAGUE_ABI,
        address: league,
        functionName: 'setDraftSettings',
        args: [
          DraftTypeMap[draftType],
          BigInt(draftTimestamp),
          OrderModeMap[orderMode],
          manualOrderArray,
          draftCompleted,
          draftPickTradingEnabled,
        ],
      });
      toast.success('Draft settings saved on-chain.', { id });
      router.push(`/league/${league}/settings`);
    } catch (e: any) {
      toast.error(e?.shortMessage || e?.message || 'Failed to save settings');
    }
  };

  // While permission is resolving, keep the page minimal to avoid flashing content
  if (!commish || !wallet) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-gray-400">Checking permissions…</p>
        </div>
      </main>
    );
  }
  if (!isCommish) return null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
      <div className="mx-auto max-w-2xl">
        {/* Header with centered title + My Team pill */}
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-extrabold">Draft Settings</h1>
            <Link
              href={`/league/${league}/team`}
              className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm hover:border-fuchsia-400/60"
              title="Go to My Team"
            >
              My Team — {shortAddr(wallet)}
            </Link>
          </div>
          <div className="mt-2 text-sm text-gray-400 font-mono">
            {league} · {(leagueName as string) || 'League'}
          </div>
        </header>

        <div className="space-y-8 rounded-2xl border border-gray-800 bg-black/30 p-6">
          {/* Draft Type */}
          <div className="text-center">
            <label className="block mb-3 text-lg font-bold text-fuchsia-400">Draft Type</label>
            <div className="flex flex-wrap justify-center gap-2">
              {(['snake','salary','autopick','offline'] as DraftTypeKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setDraftType(key)}
                  className={[
                    'rounded-xl px-4 py-2 font-semibold border transition',
                    draftType === key ? 'bg-fuchsia-600 border-fuchsia-600' : 'bg-gray-800 border-gray-700 hover:border-white'
                  ].join(' ')}
                  title={DraftTypeDesc[key]}
                >
                  {key === 'snake' ? 'Snake' : key === 'salary' ? 'Salary Cap' : key === 'autopick' ? 'Autopick' : 'Offline'}
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-gray-300">{DraftTypeDesc[draftType]}</p>
          </div>

          {/* Date + Time */}
          <div className="text-center">
            <label className="block mb-3 text-lg font-bold text-fuchsia-400">Draft Date & Time</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Calendar popover */}
              <div className="relative" ref={calRef}>
                <button
                  onClick={() => setCalOpen((s) => !s)}
                  className="w-full text-left bg-black/40 text-white p-3 rounded-xl border border-gray-700 focus:ring-2 focus:ring-fuchsia-600 outline-none"
                >
                  {date ? new Date(date).toLocaleDateString() : 'Pick a date'}
                </button>
                {calOpen && (
                  <div className="absolute z-10 mt-2">
                    <Calendar value={date} onChange={(d) => { setDate(d); setCalOpen(false); }} />
                  </div>
                )}
              </div>

              <select
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full bg-black/40 text-white p-3 rounded-xl border border-gray-700 focus:ring-2 focus:ring-fuchsia-600 outline-none"
              >
                {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Draft Order */}
          <div className="text-center">
            <label className="block mb-3 text-lg font-bold text-fuchsia-400">Draft Order</label>
            <div className="flex flex-wrap gap-6 justify-center mb-2">
              <label className="flex items-center gap-2">
                <input type="radio" name="order" checked={orderMode === 'random'} onChange={() => setOrderMode('random')} />
                Random
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="order" checked={orderMode === 'manual'} onChange={() => setOrderMode('manual')} />
                Manual
              </label>
            </div>

            {orderMode === 'manual' && (
              <>
                {filledTeams.length < teams.length && (
                  <p className="text-xs text-yellow-300 mb-2">
                    League has {filledTeams.length}/{teams.length} teams. You can set positions for joined teams;
                    empty slots will be placed at the end automatically.
                  </p>
                )}

                <div className="space-y-2 max-w-md mx-auto text-left">
                  {filledTeams.length === 0 ? (
                    <p className="text-gray-400 text-center">No teams yet.</p>
                  ) : (
                    filledTeams.map((t, i) => (
                      <div key={`${t.owner}-${i}`} className="flex items-center gap-3">
                        <span className="w-10 text-gray-400">{i + 1}.</span>
                        <span className="flex-1 truncate">{t.name || t.owner}</span>
                        <input
                          type="number" min={1} max={teams.length}
                          className="w-24 bg-black/40 text-white p-2 rounded-lg border border-gray-700"
                          value={manualOrder[t.owner] ?? ''}
                          onChange={(e) =>
                            setManualOrder((prev) => ({
                              ...prev,
                              [t.owner]: e.target.value ? Number(e.target.value) : (undefined as any)
                            }))
                          }
                          placeholder="#"
                        />
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Draft Pick Trading */}
          <div className="text-center">
            <label className="inline-flex items-center gap-2 text-lg font-bold text-fuchsia-400">
              <input
                type="checkbox"
                checked={draftPickTradingEnabled}
                onChange={(e) => setDraftPickTradingEnabled(e.target.checked)}
              />
              Allow draft pick trading
            </label>
            <p className="text-sm text-gray-400 mt-1">When enabled, teams can trade future/active draft picks per your league rules.</p>
          </div>

          {/* Draft Completed */}
          <div className="text-center">
            <label className="inline-flex items-center gap-2 text-lg font-bold text-fuchsia-400">
              <input type="checkbox" checked={draftCompleted} onChange={(e) => setDraftCompleted(e.target.checked)} />
              Draft completed
            </label>
            <p className="text-sm text-gray-400 mt-1">
              When checked, Home shows “My Team” + “League” for this league.
            </p>
          </div>

          <div className="flex justify-center">
            <button
              onClick={handleSave}
              disabled={isPending}
              className="rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 px-6 py-3 font-bold disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
