'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import { useTeamProfile } from '@/lib/teamProfile';
import { loadUISettings } from '@/lib/draft-helpers';
import { loadDraftState, saveDraftState } from '@/lib/draft-storage';

type Address = `0x${string}`;
const ZERO: Address = '0x0000000000000000000000000000000000000000';

const ZIMA = '#37c0f6';
const EGGSHELL = '#F0EAD6';

const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getTeams', stateMutability: 'view', inputs: [], outputs: [{ type: 'tuple[]', components: [{ name: 'owner', type: 'address' }, { name: 'name', type: 'string' }]}] },
  // draftType(uint8), draftTimestamp(uint64), orderMode(uint8), completed(bool), manual(address[]), picksTrading(bool)
  { type: 'function', name: 'getDraftSettings', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }, { type: 'uint64' }, { type: 'uint8' }, { type: 'bool' }, { type: 'address[]' }, { type: 'bool' }] },
  { type: 'function', name: 'commissioner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

type Team = { owner: Address; name: string };

const short = (a?: string) => (a ? `${a.slice(0,6)}…${a.slice(-4)}` : '');

const fmtClock = (s: number) => {
  const sec = Math.max(0, Math.floor(s));
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};
const timeLabel = (label?: string, secs?: number) => {
  if (label && label.trim()) return `${label.trim()} per Pick`;
  if (secs === undefined) return '— per Pick';
  if (secs <= 0) return 'No Limit per Pick';
  if (secs < 60) return `${secs}S per Pick`;
  if (secs < 3600) return `${Math.round(secs/60)}M per Pick`;
  return `${Math.round(secs/3600)}H per Pick`;
};

/* ---------------- Draft Room ---------------- */
export default function DraftRoom() {
  const { address: league } = useParams<{ address: Address }>();
  const { address: wallet } = useAccount();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /* reads */
  const nameRes = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' });
  const teamsRes = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getTeams',
    query: { refetchInterval: 5000, staleTime: 0 }
  });
  const settingsRes = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getDraftSettings',
    query: { refetchInterval: 5000, staleTime: 0 }
  });
  const commishRes = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'commissioner' });

  const leagueName = (nameRes.data as string) || 'League';
  const teams = (Array.isArray(teamsRes.data) ? (teamsRes.data as Team[]) : []) as Team[];
  const isCommish = !!(wallet && commishRes.data && wallet.toLowerCase() === (commishRes.data as string).toLowerCase());

  // [type, ts, orderMode, completed, manual, picksTrading]
  const [draftType, draftTs, , draftCompleted, manualOrder] =
    ((settingsRes.data as any) || [0, 0n, 0, false, [], false]) as [number, bigint, number, boolean, Address[], boolean];

  /* UI settings (local) */
  const [ui, setUi] = useState(() => loadUISettings(league));
  useEffect(() => {
    const on = () => setUi(loadUISettings(league));
    window.addEventListener('storage', on);
    const iv = setInterval(on, 2000);
    return () => { window.removeEventListener('storage', on); clearInterval(iv); };
  }, [league]);

  const rounds = ui.rounds ?? 15;
  const timePerPickSeconds = ui.timePerPickSeconds ?? 60;
  const timePerPickText = timeLabel(ui.timePerPickLabel, timePerPickSeconds);
  const leagueFormat = ui.leagueFormat || 'Redraft';
  const thirdRoundReversal = !!ui.thirdRoundReversal;
  const salaryBudget = ui.salaryBudget ?? ui.budget ?? 400;

  const draftTypeLabel = ['Snake', 'Salary Cap', 'Autopick', 'Offline'][draftType] || 'Snake';

  /* order (live) */
  const teamOrderR1 = useMemo<Address[]>(() => {
    const joined = teams.map(t => t.owner);
    const base = (manualOrder?.length ? manualOrder : joined).filter(Boolean) as Address[];
    const cap = Math.max(base.length, teams.length);
    while (base.length < cap) base.push(ZERO);
    return base;
  }, [manualOrder, teams]);

  // header entries with names (teams fixed left→right; order logic is per-round)
  const header = useMemo(() => teamOrderR1.map((owner, i) => {
    const t = teams.find(tt => tt.owner?.toLowerCase() === owner?.toLowerCase());
    return { owner, name: t?.name || (owner === ZERO ? `Team ${i+1}` : `${owner.slice(0,6)}…${owner.slice(-4)}`) };
  }), [teamOrderR1, teams]);

  /* live clock & state sync (BroadcastChannel) */
  const startAt = Number(draftTs) || 0;
  const [now, setNow] = useState(() => Math.floor(Date.now()/1000));
  useEffect(() => { const id = setInterval(() => setNow(Math.floor(Date.now()/1000)), 1000); return () => clearInterval(id); }, []);
  const isLive = startAt > 0 && now >= startAt && !draftCompleted;

  const boot = () => loadDraftState(league) || {};
  const [paused, setPaused] = useState<boolean>(() => !!boot().paused);
  const [curRound, setCurRound] = useState<number>(() => boot().currentRound || 1);
  const [curIndex, setCurIndex] = useState<number>(() => boot().currentPickIndex || 0); // 0..(teams-1) in FORWARD orientation
  const [pickStartedAt, setPickStartedAt] = useState<number>(() => boot().pickStartedAt || 0);
  const [remaining, setRemaining] = useState<number>(() => boot().remaining ?? timePerPickSeconds);

  const chanRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    try { chanRef.current = new BroadcastChannel(`draft:${league}`); }
    catch { chanRef.current = null; }
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== `draft:${league}` || !ev.newValue) return;
      try {
        const s = JSON.parse(ev.newValue);
        setPaused(!!s.paused);
        if (typeof s.currentRound === 'number') setCurRound(s.currentRound);
        if (typeof s.currentPickIndex === 'number') setCurIndex(s.currentPickIndex);
        if (typeof s.pickStartedAt === 'number') setPickStartedAt(s.pickStartedAt);
        if (typeof s.remaining === 'number') setRemaining(s.remaining);
      } catch {}
    };
    window.addEventListener('storage', onStorage);
    const ch = chanRef.current;
    if (ch) ch.onmessage = (e) => onStorage({ key: `draft:${league}`, newValue: JSON.stringify(e.data) } as any);
    return () => { window.removeEventListener('storage', onStorage); if (ch) ch.close(); };
  }, [league]);

  const broadcast = (patch: any) => {
    const prev = loadDraftState(league) || {};
    const next = { ...prev, ...patch };
    saveDraftState(league, next);
    try { localStorage.setItem(`draft:${league}`, JSON.stringify(next)); } catch {}
    const ch = chanRef.current; if (ch) ch.postMessage(next);
  };

  // Tick the tile/large clocks
  useEffect(() => {
    if (!isLive || paused || timePerPickSeconds <= 0) return;
    const id = setInterval(() => {
      if (pickStartedAt <= 0) return;
      const left = timePerPickSeconds - (Math.floor(Date.now()/1000) - pickStartedAt);
      setRemaining(Math.max(0, left));
    }, 250);
    return () => clearInterval(id);
  }, [isLive, paused, timePerPickSeconds, pickStartedAt]);

  // When timer hits zero → advance (autopick stub later)
  useEffect(() => {
    if (!isLive || paused || timePerPickSeconds <= 0) return;
    if (remaining > 0) return;
    // advance to next index / round
    const nTeams = header.length || 1;
    const nextIndex = (curIndex + 1) % nTeams;
    const wrap = nextIndex === 0;
    const nextRound = wrap ? curRound + 1 : curRound;
    setCurIndex(nextIndex);
    setCurRound(nextRound);
    // reset clocks
    const start = Math.floor(Date.now()/1000);
    setPickStartedAt(start);
    setRemaining(timePerPickSeconds);
    broadcast({ currentPickIndex: nextIndex, currentRound: nextRound, pickStartedAt: start, remaining: timePerPickSeconds });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, isLive, paused]);

  // Pause/Resume
  const togglePause = () => {
    if (!isCommish || !isLive) return;
    if (paused) {
      const start = Math.floor(Date.now()/1000) - (timePerPickSeconds - remaining);
      setPickStartedAt(start);
      setPaused(false);
      broadcast({ paused: false, pickStartedAt: start });
    } else {
      setPaused(true);
      broadcast({ paused: true, remaining });
    }
  };

  /* snake + R3 reversal */
  const isSnakeLike = draftType === 0 || draftType === 2; // Snake & Autopick use snake board
  // No TRR: even rounds reversed. TRR: r<3 ? even reversed : odd reversed.
  const reverseRound = (r: number) => {
    if (!isSnakeLike) return false;
    return thirdRoundReversal ? (r < 3 ? (r % 2 === 0) : (r % 2 === 1)) : (r % 2 === 0);
  };

  // Which visible column is "on the clock" this round?
  const currentCol = useMemo(() => {
    if (!isSnakeLike) return curIndex; // salary cap uses forward index visually
    return reverseRound(curRound) ? (header.length - 1) - curIndex : curIndex;
  }, [curIndex, curRound, header.length, isSnakeLike]);

  // Pick label shown in *non-current* tiles
  const pickLabelFor = (round: number, col: number, n: number) =>
    `${round}.${reverseRound(round) ? (n - col) : (col + 1)}`;

  // Next pick owner (for box on right)
  const nextPick = (() => {
    const n = header.length || 1;
    const nextI = (curIndex + 1) % n;
    const r = (nextI === 0) ? curRound + 1 : curRound;
    const col = isSnakeLike
      ? (reverseRound(r) ? (n - 1) - nextI : nextI)
      : nextI;
    const h = header[col];
    return { round: r, owner: h?.owner, name: h?.name || '—' };
  })();

  // My team pill
  const me = teams.find(t => wallet && t.owner.toLowerCase() === wallet.toLowerCase());
  const myProf = useTeamProfile(league, (wallet as Address) || undefined, { name: me?.name || 'My Team' });

  /* tabs */
  type Tab = 'draft' | 'queue' | 'history' | 'team' | 'all';
  const [tab, setTab] = useState<Tab>('draft');

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 to-black text-white px-4 sm:px-6 py-4">
      {/* Title + Team pill (top-right) */}
      <div className="relative mb-3">
        <h1 className="text-center text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight" style={{ color: ZIMA }}>
          <span className="block">{leagueName}</span>
          <span className="block sm:inline uppercase">DRAFT ROOM</span>
        </h1>
        <div className="absolute right-0 top-0">
          <Link
            href={`/league/${league}/my-team`}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm hover:border-white/30"
            title="My Team"
          >
            {myProf.logo && <img src={myProf.logo} alt={myProf.name || 'My Team'} className="h-6 w-6 rounded-xl border border-white/20 object-cover" />}
            <div className="leading-tight text-left">
              <div className="font-medium">{myProf.name || 'My Team'}</div>
              {wallet && <div className="text-[11px] font-mono opacity-70">{short(wallet)}</div>}
            </div>
          </Link>
        </div>
      </div>

      {/* Chips (uniform rounded-squares). Render after mount to avoid hydration drift. */}
      {mounted && (
        <div className="mx-auto mb-2 flex max-w-6xl flex-wrap items-center justify-center gap-2">
          <Pill>{timePerPickText}</Pill>
          <Pill>{leagueFormat}</Pill>
          <Pill>
            {draftTypeLabel}
            {draftType === 1 && <span className="ml-2 rounded-md border border-white/15 bg-white/10 px-2 py-[2px] text-xs">Budget: {salaryBudget}</span>}
            {thirdRoundReversal && (draftType === 0 || draftType === 2) && (
              <span className="ml-2 rounded-md border border-white/15 bg-white/10 px-2 py-[2px] text-xs">R3 Reversal</span>
            )}
          </Pill>
          <Pill>
            Draft Start: {startAt ? new Date(startAt * 1000).toLocaleString() : '—'} · {isLive ? (paused ? <span className="text-amber-300">Paused</span> : <span className="text-emerald-400">Live</span>) : 'Scheduled'}
          </Pill>
        </div>
      )}

      {/* Row: Big timer (left) • Recent pick (centered in card) • Next pick (right) */}
      <div className="mx-auto mb-2 grid max-w-6xl grid-cols-1 gap-2 md:grid-cols-3">
        <div className="rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-gray-300">On the Clock</div>
          <div className="text-4xl font-black tabular-nums" style={{ color: EGGSHELL }}>
            {(isLive && (draftType === 0 || draftType === 2) && timePerPickSeconds > 0)
              ? (paused ? fmtClock(remaining) : fmtClock(remaining))
              : '—'}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div className="text-center">
            <div className="mb-1 font-semibold" style={{ color: ZIMA }}>Most Recent Pick</div>
            {(() => {
              const s = loadDraftState(league);
              const rp = s?.recentPick as any;
              if (!rp) return <div className="opacity-70">No picks yet.</div>;
              return (
                <div className="inline-flex flex-wrap items-center justify-center gap-2">
                  <span className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 font-mono">#{rp.overall} ({rp.round}.{rp.pickInRound})</span>
                  <span className="font-semibold">{rp.playerName}</span>
                  <span className="opacity-80">{rp.playerTeam} · {rp.position}</span>
                  <span className="opacity-80">by</span>
                  <TeamInline league={league} owner={rp.owner} />
                </div>
              );
            })()}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div className="text-center">
            <div className="mb-1 font-semibold" style={{ color: ZIMA }}>Next Pick</div>
            <div className="inline-flex items-center gap-2">
              <span className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 font-mono" style={{ color: ZIMA }}>
                Round {nextPick.round}
              </span>
              <TeamInline league={league} owner={nextPick.owner || ZERO} labelOverride={nextPick.name} />
            </div>
          </div>
        </div>
      </div>

      {/* Single-line bar */}
      <div className="mx-auto mb-3 flex max-w-6xl flex-wrap items-center justify-center gap-2">
        <div className="inline-flex rounded-2xl border border-white/12 bg-white/5 p-1 shadow-sm">
          {(['draft','queue','history','team','all'] as const).map(k => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-2xl px-3 py-1.5 text-sm transition ${tab === k ? 'bg-white/10' : 'hover:bg-white/5'}`}
              style={{ color: EGGSHELL }}
            >
              {k === 'draft' ? 'Draft' : k === 'queue' ? 'Queue' : k === 'history' ? 'History' : k === 'team' ? 'Team' : 'All Teams'}
            </button>
          ))}
        </div>
        <Link
          href={`/league/${league}/settings/draft-settings`}
          className="rounded-2xl border border-white/15 bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
          title="Draft Settings"
          style={{ color: EGGSHELL }}
        >
          Settings
        </Link>
        {isCommish && isLive && (
          <button
            onClick={togglePause}
            className={`rounded-2xl px-3 py-1.5 text-sm font-semibold ${paused ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}
          >
            {paused ? 'Resume Draft' : 'Pause Draft'}
          </button>
        )}
      </div>

      {/* Panels */}
      {tab === 'draft' && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="overflow-x-auto">
            {/* header row */}
            <div className="grid gap-3 min-w-max" style={{ gridTemplateColumns: `repeat(${header.length}, minmax(160px,1fr))` }}>
              {header.map((h, i) => <HeaderCell key={`${h.owner}-${i}`} league={league} owner={h.owner} name={h.name} />)}
            </div>

            {/* board */}
            <div className="mt-3 space-y-3 min-w-max">
              {Array.from({ length: rounds }, (_, r) => r + 1).map((round) => (
                <div
                  key={`round-${round}`}
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(${header.length}, minmax(160px,1fr))` }}
                >
                  {header.map((_, col) => {
                    const isCur = isLive && round === curRound && col === currentCol;
                    const showTimer = isCur && timePerPickSeconds > 0 && (draftType === 0 || draftType === 2);
                    return (
                      <div
                        key={`cell-${round}-${col}`}
                        className="h-16 rounded-2xl border grid place-items-center text-sm"
                        style={{ borderColor: isCur ? ZIMA : 'rgba(255,255,255,.10)', background: 'rgba(0,0,0,.40)' }}
                      >
                        {showTimer ? (
                          <span
                            className="rounded px-2 py-[3px] text-[13px] font-mono"
                            style={{ color: paused ? '#ff4d4f' : EGGSHELL, background: 'rgba(255,255,255,.08)' }}
                          >
                            {paused ? 'PAUSED' : fmtClock(remaining)}
                          </span>
                        ) : (
                          <span className="text-gray-300">{pickLabelFor(round, col, header.length)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === 'queue' && (
        <Section title="Queue">
          <p className="text-sm text-gray-300">Your queued players will appear here.</p>
        </Section>
      )}

      {tab === 'history' && (
        <Section title="History">
          <p className="text-sm text-gray-300">No picks have been made yet.</p>
        </Section>
      )}

      {tab === 'team' && (
        <Section title="My Team">
          <p className="text-sm text-gray-300">Your drafted players will appear here.</p>
        </Section>
      )}

      {tab === 'all' && (
        <Section title="All Teams">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {header.map((h, i) => <TeamCard key={`${h.owner}-card-${i}`} league={league} owner={h.owner} name={h.name} />)}
          </div>
        </Section>
      )}
    </main>
  );
}

/* ---------- UI bits ---------- */
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex h-9 items-center rounded-2xl border px-3 text-sm"
      style={{ borderColor: 'rgba(255,255,255,.16)', background: 'rgba(255,255,255,.06)', color: EGGSHELL }}
    >
      {children}
    </span>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 text-sm uppercase tracking-[0.15em]" style={{ color: ZIMA }}>{title}</div>
      {children}
    </section>
  );
}
function HeaderCell({ league, owner, name }: { league: Address; owner: Address; name: string }) {
  const p = owner === ZERO ? { name, logo: undefined } : useTeamProfile(league, owner, { name });
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-3">
      <div className="flex items-center justify-center gap-2 truncate">
        {p.logo && <img src={p.logo} alt={p.name || 'Team'} className="h-6 w-6 rounded-xl border border-white/20 object-cover shrink-0" />}
        <div className="truncate text-center">{p.name || name}</div>
      </div>
    </div>
  );
}
function TeamInline({ league, owner, labelOverride }: { league: Address; owner: Address; labelOverride?: string }) {
  const p = owner ? useTeamProfile(league, owner, { name: labelOverride || `${owner.slice(0,6)}…${owner.slice(-4)}` }) : { name: labelOverride, logo: undefined };
  return (
    <span className="inline-flex items-center gap-2">
      {p.logo && <img src={p.logo} className="h-4 w-4 rounded-xl border border-white/20 object-cover" alt={p.name || 'Team'} />}
      <span>{labelOverride || p.name}</span>
    </span>
  );
}
function TeamCard({ league, owner, name }: { league: Address; owner: Address; name: string }) {
  const p = owner === ZERO ? { name, logo: undefined } : useTeamProfile(league, owner, { name });
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        {p.logo && <img src={p.logo} alt={p.name || 'Team'} className="h-6 w-6 rounded-xl border border-white/20 object-cover" />}
        <div className="font-semibold">{p.name || name}</div>
      </div>
      <p className="text-xs text-gray-400">Drafted players will list here.</p>
    </div>
  );
}
