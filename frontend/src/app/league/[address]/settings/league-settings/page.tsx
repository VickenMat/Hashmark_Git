// src/app/league/[address]/settings/league-settings/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import CommissionerGuard from '@/components/CommissionerGuard';
import { SaveButton, useOnchainWrite } from '@/components/OnchainForm';
import { useTeamProfile } from '@/lib/teamProfile';
import type { LeagueSettingsForm } from '@/lib/leagueSettingsSchema';

/* ---------------- ABI ---------------- */
const SETTINGS_ABI = [
  { type:'function', name:'getLeagueSettings', stateMutability:'view', inputs:[], outputs:[{ type:'tuple', components:[
    { name:'leagueName', type:'string' },
    { name:'leagueLogo', type:'string' },
    { name:'numberOfTeams', type:'uint8' },
    { name:'waiverType', type:'uint8' },
    { name:'waiverBudget', type:'uint64' },
    { name:'waiverMinBid', type:'uint64' },
    { name:'waiverClearance', type:'uint8' },
    { name:'waiversAfterDropDays', type:'uint8' },
    { name:'tradeReviewDays', type:'uint8' },
    { name:'tradeDeadlineWeek', type:'uint8' },
    { name:'leagueType', type:'uint8' },
    { name:'extraGameVsMedian', type:'bool' },
    { name:'preventDropAfterKickoff', type:'bool' },
    { name:'lockAllMoves', type:'bool' },
  ]}]},
  { type:'function', name:'setLeagueSettings', stateMutability:'nonpayable', inputs:[{ name:'s', type:'tuple', components:[
    { name:'leagueName', type:'string' },
    { name:'leagueLogo', type:'string' },
    { name:'numberOfTeams', type:'uint8' },
    { name:'waiverType', type:'uint8' },
    { name:'waiverBudget', type:'uint64' },
    { name:'waiverMinBid', type:'uint64' },
    { name:'waiverClearance', type:'uint8' },
    { name:'waiversAfterDropDays', type:'uint8' },
    { name:'tradeReviewDays', type:'uint8' },
    { name:'tradeDeadlineWeek', type:'uint8' },
    { name:'leagueType', type:'uint8' },
    { name:'extraGameVsMedian', type:'bool' },
    { name:'preventDropAfterKickoff', type:'bool' },
    { name:'lockAllMoves', type:'bool' },
  ]}], outputs:[] },
] as const;

const TEAM_ABI = [
  { type:'function', name:'getTeamByAddress', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'string'}] },
] as const;

/* ---------------- Maps / constants ---------------- */
const MAP = {
  waiverType: ['rolling','reverse','faab'] as const,
  leagueType: ['redraft','keeper','dynasty'] as const,
};
const TEAM_OPTIONS = [2,4,6,8,10,12,14,16,18,20] as const;
const TRADE_DEADLINE_WEEKS = [0,11,12,13,14,15,16,17] as const; // 0=None
const ZERO = '0x0000000000000000000000000000000000000000' as const;

/* ---------------- helpers ---------------- */
function shortAddr(a?: string){ if(!a) return '—'; return `${a.slice(0,6)}…${a.slice(-4)}`; }
function initials(n?: string){ const s=(n||'').trim(); if(!s) return 'TM'; const p=s.split(/\s+/); return ((p[0]?.[0]??'')+(p[1]?.[0]??'')).toUpperCase() || 'TM'; }
const num = (v: unknown): number | undefined => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };

const Title = ({children}:{children:React.ReactNode}) =>
  <h2 className="text-lg font-extrabold text-white text-center">{children}</h2>;

function Chip({ n, active, onClick }:{ n:number; active:boolean; onClick:()=>void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'rounded-xl px-3 py-1.5 text-sm font-semibold border transition',
        active ? 'bg-fuchsia-600 border-fuchsia-600 text-white' : 'bg-black/30 border-white/10 hover:border-white/40'
      ].join(' ')}
    >
      {n}
    </button>
  );
}
function Pill({ label, active, onClick }:{ label:string; active:boolean; onClick:()=>void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'rounded-xl px-3 py-1.5 text-sm font-semibold border transition',
        active ? 'bg-fuchsia-600 border-fuchsia-600 text-white' : 'bg-black/30 border-white/10 hover:border-white/40'
      ].join(' ')}
    >
      {label}
    </button>
  );
}
function Toggle({checked, onChange}:{checked:boolean; onChange:(v:boolean)=>void}) {
  return (
    <button
      onClick={()=>onChange(!checked)}
      className={[
        'relative inline-flex h-6 w-12 items-center rounded-full transition',
        checked ? 'bg-fuchsia-600' : 'bg-gray-600'
      ].join(' ')}
      aria-pressed={checked}
    >
      <span
        className={[
          'inline-block h-5 w-5 transform rounded-full bg-white transition',
          checked ? 'translate-x-6' : 'translate-x-1'
        ].join(' ')}
      />
    </button>
  );
}
function MyTeamPill({ href, name, logo, wallet }:{
  href:string; name?:string; logo?:string; wallet?:`0x${string}`|undefined;
}) {
  const display = name?.trim() || 'My Team';
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] px-3 py-2 ring-1 ring-black/20 hover:border-fuchsia-400/60 transition"
      title="Go to My Team"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? (
        <img src={logo} alt={display} className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/15"/>
      ) : (
        <div className="h-9 w-9 rounded-xl bg-white/10 grid place-items-center text-xs font-bold">{initials(display)}</div>
      )}
      <div className="leading-tight text-left">
        <div className="font-semibold text-white">{display}</div>
        <div className="text-[11px] font-mono text-gray-300">{shortAddr(wallet)}</div>
      </div>
    </Link>
  );
}

/* ---------------- Page ---------------- */
export default function Page() {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const { address: wallet } = useAccount();
  const router = useRouter();

  // My Team pill
  const { data: onChainTeamName } = useReadContract({
    abi: TEAM_ABI, address: league, functionName: 'getTeamByAddress',
    args: [wallet ?? ZERO], query: { enabled: !!wallet }
  });
  const prof = useTeamProfile(league, wallet, { name: onChainTeamName as string });
  const teamName = (prof.name || (onChainTeamName as string) || '').trim() || undefined;

  // Settings read (+ refetch handle so UI updates post-save)
  const { data: s, refetch: refetchSettings } = useReadContract({
    abi: SETTINGS_ABI, address: league, functionName: 'getLeagueSettings'
  });
  const chainSettings = s as any;

  const defaults: LeagueSettingsForm = useMemo(() => {
    const t = chainSettings;
    const wtIndex = (num(t?.waiverType) ?? 0) as 0|1|2;
    const uiWaiverType = MAP.waiverType[wtIndex];

    // Default FAAB budget to $100 if on-chain is 0 AND waiver type is FAAB
    const rawBudget = Number(t?.waiverBudget ?? 0);
    const defaultedBudget = (uiWaiverType === 'faab' && rawBudget === 0) ? 100 : rawBudget;

    return {
      leagueName: (t?.leagueName ?? '') as string,
      leagueLogo: (t?.leagueLogo ?? '') as string, // preserved silently
      numberOfTeams: num(t?.numberOfTeams) ?? 12,
      waiverType: uiWaiverType,
      waiverBudget: defaultedBudget,
      waiverMinBid: Number(t?.waiverMinBid ?? 0),

      waiversAfterDropDays: (num(t?.waiversAfterDropDays) ?? 1) as 0|1|2|3,
      tradeReviewDays:      (num(t?.tradeReviewDays)      ?? 1) as 0|1|2|3,
      tradeDeadline:        (num(t?.tradeDeadlineWeek)    ?? 12) as (typeof TRADE_DEADLINE_WEEKS)[number],

      leagueType: MAP.leagueType[(num(t?.leagueType) ?? 0) as 0|1|2],

      // default toggles per request (off / on / off)
      extraGameVsMedian: Boolean(t?.extraGameVsMedian ?? false),
      preventDropAfterKickoff: Boolean(
        typeof t?.preventDropAfterKickoff === 'boolean' ? t?.preventDropAfterKickoff : true
      ),
      lockAllMoves: Boolean(t?.lockAllMoves ?? false),
    };
  }, [chainSettings]);

  const [form, setForm] = useState<LeagueSettingsForm>(defaults);
  const [nameLocked, setNameLocked] = useState(true);

  // Default FAAB to 100 if switching to FAAB with 0 budget
  useEffect(() => {
    if (form.waiverType === 'faab' && (form.waiverBudget ?? 0) === 0) {
      setForm(f => ({ ...f, waiverBudget: 100 }));
    }
  }, [form.waiverType]);

  useEffect(() => {
    setForm(defaults);
    setNameLocked(true);
  }, [defaults]);

  const write = useOnchainWrite();

  const save = async () => {
    const preservedLogo = String(chainSettings?.leagueLogo ?? '');
    const preservedClearance = BigInt(num(chainSettings?.waiverClearance) ?? 0);

    // positional tuple in exact ABI order
    const tupleArgs = [
      form.leagueName,
      preservedLogo,
      BigInt(form.numberOfTeams),
      BigInt(MAP.waiverType.indexOf(form.waiverType)),
      BigInt(form.waiverBudget ?? 0),
      BigInt(form.waiverMinBid ?? 0),
      preservedClearance,
      BigInt(form.waiversAfterDropDays ?? 0),
      BigInt(form.tradeReviewDays ?? 0),
      BigInt(form.tradeDeadline ?? 0),
      BigInt(MAP.leagueType.indexOf(form.leagueType)),
      !!form.extraGameVsMedian,
      !!form.preventDropAfterKickoff,
      !!form.lockAllMoves,
    ] as const;

    await write(
      { abi: SETTINGS_ABI, address: league, functionName: 'setLeagueSettings', args: [tupleArgs] },
      'Settings saved.'
    );

    await refetchSettings();
    router.refresh(); // refresh page after confirmed tx
  };

  // Reset to UI defaults (click Save to persist)
  const resetToDefaults = () => {
    setForm(prev => ({
      ...prev,
      numberOfTeams: 12,
      waiverType: 'rolling',
      waiverBudget: 100,
      waiverMinBid: 0,
      waiversAfterDropDays: 1,
      tradeReviewDays: 1,
      tradeDeadline: 12,
      leagueType: 'redraft',
      extraGameVsMedian: false,
      preventDropAfterKickoff: true,
      lockAllMoves: false,
    }));
  };

  const waiverDesc: Record<typeof MAP.waiverType[number], string> = {
    rolling: 'Managers move to the back of the order after a successful claim.',
    reverse: 'Lowest-ranked teams get priority; order re-computed from standings.',
    faab:    'Bid with your budget; highest bid wins and is deducted from FAAB.',
  };

  const isFAAB = form.waiverType === 'faab';

  return (
    <CommissionerGuard>
      <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Header (no league name at top) */}
          <header className="flex items-start justify-between">
            <div className="flex-1" />
            <h1 className="text-3xl font-extrabold text-center flex-1 whitespace-nowrap">League Settings</h1>
            <div className="flex-1 flex justify-end">
              <MyTeamPill href={`/league/${league}/team`} name={teamName} logo={prof.logo} wallet={wallet} />
            </div>
          </header>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-6">
            {/* Row A: League name (full row) */}
            <div className="grid">
              <div className="rounded-xl border border-white/10 bg-black/20 p-5 lg:col-span-3">
                <Title>League name</Title>
                <div className="mt-2 flex items-center justify-center gap-3">
                  <input
                    value={form.leagueName}
                    disabled={nameLocked}
                    onChange={(e)=>setForm({...form, leagueName:e.target.value})}
                    className={[
                      'w-full max-w-md rounded-lg bg-black/40 border p-2 text-center h-10',
                      nameLocked ? 'border-white/10 text-gray-400 cursor-not-allowed' : 'border-fuchsia-400/60'
                    ].join(' ')}
                  />
                  <button
                    type="button"
                    onClick={()=>setNameLocked(v=>!v)}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:border-fuchsia-400/60"
                  >
                    {nameLocked ? 'Unlock' : 'Lock'}
                  </button>
                </div>
              </div>
            </div>

            {/* Row B: Number of Teams + League type side-by-side */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Number of Teams */}
              <div className="rounded-xl border border-white/10 bg-black/20 p-5 text-center">
                <Title>Number of <span className="capitalize">Teams</span></Title>

                {/* Halfscreen: one horizontal row (unchanged) */}
                <div className="mt-3 lg:hidden overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none]">
                  <div className="flex gap-2 whitespace-nowrap justify-center">
                    {TEAM_OPTIONS.map((n) => (
                      <div key={`sm-${n}`} className="shrink-0">
                        <Chip n={n} active={form.numberOfTeams === n} onClick={() => setForm({ ...form, numberOfTeams: n })}/>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Fullscreen: two centered rows (2–10, 12–20), tighter gaps */}
                <div className="mt-3 hidden lg:block">
                  <div className="grid grid-cols-5 gap-1.5 justify-items-center">
                    {TEAM_OPTIONS.slice(0,5).map((n) => (
                      <Chip key={`lg-top-${n}`} n={n} active={form.numberOfTeams === n} onClick={() => setForm({ ...form, numberOfTeams: n })}/>
                    ))}
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 justify-items-center mt-2">
                    {TEAM_OPTIONS.slice(5).map((n) => (
                      <Chip key={`lg-bot-${n}`} n={n} active={form.numberOfTeams === n} onClick={() => setForm({ ...form, numberOfTeams: n })}/>
                    ))}
                  </div>
                </div>
              </div>

              {/* League Type */}
              <div className="rounded-xl border border-white/10 bg-black/20 p-5 text-center">
                <Title>League type</Title>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {(['redraft','keeper','dynasty'] as const).map((lt) => (
                    <label key={lt} className={[
                      'rounded-lg border p-2 cursor-pointer transition',
                      form.leagueType === lt ? 'border-fuchsia-500 bg-fuchsia-500/10' : 'border-white/10 bg-black/30 hover:border-white/40'
                    ].join(' ')}>
                      <input
                        type="radio"
                        name="leagueType"
                        className="sr-only"
                        checked={form.leagueType === lt}
                        onChange={()=>setForm({...form, leagueType: lt})}
                      />
                      <div className="font-semibold capitalize">{lt}</div>
                      <div className="mt-1 text-[11px] text-gray-400">
                        {lt === 'redraft' && 'Fresh rosters each season'}
                        {lt === 'keeper'  && 'Keep a limited number of players'}
                        {lt === 'dynasty' && 'Long-term rosters; rookie drafts'}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Waivers Block */}
            <div className="rounded-xl border border-white/10 bg-black/20 p-5">
              <Title>Waivers</Title>

              {isFAAB ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="text-center">
                    <div className="text-sm text-gray-300 mb-1">Type</div>
                    <select
                      value={form.waiverType}
                      onChange={e=>setForm({...form, waiverType:e.target.value as any})}
                      className="w-full rounded-lg bg-black/40 border border-white/10 p-2 text-center h-10"
                    >
                      <option value="rolling">Rolling Waivers</option>
                      <option value="reverse">Reverse Standings</option>
                      <option value="faab">FAAB Bidding</option>
                    </select>
                  </div>

                  <div className="text-center">
                    <div className="text-sm text-gray-300 mb-1">Total Budget</div>
                    <input
                      type="number" min={0}
                      value={form.waiverBudget ?? 0}
                      onChange={e=>setForm({...form, waiverBudget:Number(e.target.value)})}
                      className="w-full rounded-lg bg-black/40 border border-white/10 p-2 text-center h-10"
                    />
                  </div>

                  <div className="text-center">
                    <div className="text-sm text-gray-300 mb-1">Minimum Bid</div>
                    <input
                      type="number" min={0}
                      value={form.waiverMinBid ?? 0}
                      onChange={e=>setForm({...form, waiverMinBid:Number(e.target.value)})}
                      className="w-full rounded-lg bg-black/40 border border-white/10 p-2 text-center h-10"
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <select
                    value={form.waiverType}
                    onChange={e=>setForm({...form, waiverType:e.target.value as any})}
                    className="mx-auto block max-w-sm rounded-lg bg-black/40 border border-white/10 p-2 text-center h-10"
                  >
                    <option value="rolling">Rolling Waivers</option>
                    <option value="reverse">Reverse Standings</option>
                    <option value="faab">FAAB Bidding</option>
                  </select>
                </div>
              )}

              <div className="mt-2 text-center text-[12px] text-gray-400 min-h-[1.5rem]">
                {waiverDesc[form.waiverType]}
              </div>
            </div>

            {/* Timers Block */}
            <div className="rounded-xl border border-white/10 bg-black/20 p-5">
              {/* Base/halfscreen layout unchanged; lg shows all three columns */}
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <div className="text-center">
                  <div className="text-sm text-gray-300 mb-2">Waiver Period After Cut (Days)</div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Pill label="None" active={form.waiversAfterDropDays===0} onClick={()=>setForm({...form, waiversAfterDropDays:0})}/>
                    <Pill label="1"    active={form.waiversAfterDropDays===1} onClick={()=>setForm({...form, waiversAfterDropDays:1})}/>
                    <Pill label="2"    active={form.waiversAfterDropDays===2} onClick={()=>setForm({...form, waiversAfterDropDays:2})}/>
                    <Pill label="3"    active={form.waiversAfterDropDays===3} onClick={()=>setForm({...form, waiversAfterDropDays:3})}/>
                  </div>
                </div>

                <div className="text-center">
                  <div className="text-sm text-gray-300 mb-2">Trade Review (Days)</div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Pill label="None" active={form.tradeReviewDays===0} onClick={()=>setForm({...form, tradeReviewDays:0})}/>
                    <Pill label="1"    active={form.tradeReviewDays===1} onClick={()=>setForm({...form, tradeReviewDays:1})}/>
                    <Pill label="2"    active={form.tradeReviewDays===2} onClick={()=>setForm({...form, tradeReviewDays:2})}/>
                    <Pill label="3"    active={form.tradeReviewDays===3} onClick={()=>setForm({...form, tradeReviewDays:3})}/>
                  </div>
                </div>

                <div className="text-center sm:col-span-2 lg:col-span-1">
                  <div className="text-sm text-gray-300 mb-2">Trade Deadline (Week)</div>

                  {/* Halfscreen: keep as-is (single row, wrapping). */}
                  <div className="flex flex-wrap justify-center gap-2 lg:hidden">
                    {TRADE_DEADLINE_WEEKS.map((w) => (
                      <Pill
                        key={`td-sm-${w}`}
                        label={w === 0 ? 'None' : String(w)}
                        active={form.tradeDeadline === w}
                        onClick={()=>setForm({...form, tradeDeadline: w as (typeof TRADE_DEADLINE_WEEKS)[number]})}
                      />
                    ))}
                  </div>

                  {/* Fullscreen: two rows — None/11/12/13 and 14/15/16/17 */}
                  <div className="hidden lg:block mx-auto w-full max-w-xs">
                    <div className="grid grid-cols-4 gap-1.5 justify-items-center">
                      {[0,11,12,13].map((w) => (
                        <Pill
                          key={`td-top-${w}`}
                          label={w === 0 ? 'None' : String(w)}
                          active={form.tradeDeadline === w}
                          onClick={()=>setForm({...form, tradeDeadline: w as (typeof TRADE_DEADLINE_WEEKS)[number]})}
                        />
                      ))}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 justify-items-center mt-2">
                      {[14,15,16,17].map((w) => (
                        <Pill
                          key={`td-bot-${w}`}
                          label={String(w)}
                          active={form.tradeDeadline === w}
                          onClick={()=>setForm({...form, tradeDeadline: w as (typeof TRADE_DEADLINE_WEEKS)[number]})}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Switches */}
            <div className="grid gap-6 md:grid-cols-3">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
                <span className="text-sm text-center w-full">Extra game each week vs. median</span>
                <Toggle checked={!!form.extraGameVsMedian} onChange={(v)=>setForm({...form, extraGameVsMedian:v})}/>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
                <span className="text-sm text-center w-full">Prevent drops after kickoff</span>
                <Toggle checked={!!form.preventDropAfterKickoff} onChange={(v)=>setForm({...form, preventDropAfterKickoff:v})}/>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
                <span className="text-sm text-center w-full">Lock all free agent & waiver moves</span>
                <Toggle checked={!!form.lockAllMoves} onChange={(v)=>setForm({...form, lockAllMoves:v})}/>
              </div>
            </div>
          </section>

          <div className="pt-2 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={resetToDefaults}
              className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm hover:border-fuchsia-400/60"
            >
              Reset to Defaults
            </button>
            <SaveButton onClick={save} />
          </div>
        </div>
      </main>
    </CommissionerGuard>
  );
}
