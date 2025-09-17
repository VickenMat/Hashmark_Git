// src/app/league/[address]/settings/league-settings/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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
const TRADE_DEADLINE_WEEKS = [0,11,12,13,14,15,16,17] as const; // 0 = None
const ZERO = '0x0000000000000000000000000000000000000000' as const;

/* ---------------- helpers ---------------- */
function shortAddr(a?: string){ if(!a) return '—'; return `${a.slice(0,6)}…${a.slice(-4)}`; }
function initials(n?: string){ const s=(n||'').trim(); if(!s) return 'TM'; const p=s.split(/\s+/); return ((p[0]?.[0]??'')+(p[1]?.[0]??'')).toUpperCase() || 'TM'; }

/** Prefer UI defaults if chain returns 0/None */
const pref = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : d;
};

/* small presentational bits */
const Title = ({children}:{children:React.ReactNode}) =>
  <h2 className="text-lg font-extrabold text-white text-center">{children}</h2>;

function Chip({ n, active, onClick }:{ n:number; active:boolean; onClick:()=>void }) {
  return (
    <button
      onClick={onClick}
      className={[
        // thinner tabs
        'rounded-xl px-3 py-1.5 text-sm font-semibold border transition',
        active ? 'bg-fuchsia-600 border-fuchsia-600 text-white' : 'bg-black/30 border-white/10 hover:border-white/40'
      ].join(' ')}
    >
      {n}
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

  // My Team pill
  const { data: onChainTeamName } = useReadContract({
    abi: TEAM_ABI, address: league, functionName: 'getTeamByAddress',
    args: [wallet ?? ZERO], query: { enabled: !!wallet }
  });
  const prof = useTeamProfile(league, wallet, { name: onChainTeamName as string });
  const teamName = (prof.name || (onChainTeamName as string) || '').trim() || undefined;

  // Settings read
  const { data: s } = useReadContract({ abi: SETTINGS_ABI, address: league, functionName: 'getLeagueSettings' });

  const defaults: LeagueSettingsForm = useMemo(() => {
    const t = s as any;
    return {
      leagueName: (t?.leagueName ?? '') as string,
      leagueLogo: (t?.leagueLogo ?? '') as string,
      numberOfTeams: pref(t?.numberOfTeams, 12),

      waiverType: MAP.waiverType[pref(t?.waiverType, 0) as 0|1|2],
      waiverBudget: Number(t?.waiverBudget ?? 0),
      waiverMinBid: Number(t?.waiverMinBid ?? 0),

      // requested UI defaults (prefer these if chain has 0/None)
      waiversAfterDropDays: pref(t?.waiversAfterDropDays, 1) as 0|1|2|3,
      tradeReviewDays:      pref(t?.tradeReviewDays, 1)      as 0|1|2|3,
      tradeDeadline:        pref(t?.tradeDeadlineWeek, 12)   as (typeof TRADE_DEADLINE_WEEKS)[number],

      leagueType: MAP.leagueType[pref(t?.leagueType, 0) as 0|1|2],

      // switches
      extraGameVsMedian: Boolean(t?.extraGameVsMedian ?? false),
      preventDropAfterKickoff: Boolean(t?.preventDropAfterKickoff ?? false),
      lockAllMoves: Boolean(t?.lockAllMoves ?? false),
    };
  }, [s]);

  const [form, setForm] = useState<LeagueSettingsForm>(defaults);
  const [nameLocked, setNameLocked] = useState(true);
  const [logoPreview, setLogoPreview] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm(defaults);
    setNameLocked(true);
    setLogoPreview(undefined);
  }, [defaults]);

  const write = useOnchainWrite();

  const save = async () => {
    const argTuple = {
      leagueName: form.leagueName,
      leagueLogo: form.leagueLogo,
      numberOfTeams: BigInt(form.numberOfTeams),
      waiverType: BigInt(MAP.waiverType.indexOf(form.waiverType)),
      waiverBudget: BigInt(form.waiverBudget || 0),
      waiverMinBid: BigInt(form.waiverMinBid || 0),
      waiverClearance: BigInt(0), // not surfaced here
      waiversAfterDropDays: BigInt(form.waiversAfterDropDays || 0),
      tradeReviewDays: BigInt(form.tradeReviewDays || 0),
      tradeDeadlineWeek: BigInt(form.tradeDeadline || 0),
      leagueType: BigInt(MAP.leagueType.indexOf(form.leagueType)),
      extraGameVsMedian: !!form.extraGameVsMedian,
      preventDropAfterKickoff: !!form.preventDropAfterKickoff,
      lockAllMoves: !!form.lockAllMoves,
    };
    await write(
      { abi: SETTINGS_ABI, address: league, functionName: 'setLeagueSettings', args: [argTuple] },
      'Settings saved.'
    );
  };

  /* crude uploader: POST /api/upload-image -> { url } */
  async function uploadImageToServer(file: File): Promise<string | undefined> {
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch('/api/upload-image', { method: 'POST', body });
      if (!res.ok) throw new Error('upload failed');
      const json = await res.json();
      return typeof json?.url === 'string' ? json.url : undefined;
    } catch {
      return undefined;
    }
  }

  /* logo upload */
  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(String(reader.result));
    reader.readAsDataURL(f);

    setUploading(true);
    const url = await uploadImageToServer(f);
    setUploading(false);
    if (url) setForm(prev => ({ ...prev, leagueLogo: url }));
    else alert('Upload failed — make /api/upload-image return { url }');
    e.target.value = '';
  }

  return (
    <CommissionerGuard>
      <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Header row */}
          <header className="flex items-start justify-between">
            <div className="flex-1" />
            <h1 className="text-3xl font-extrabold text-center flex-1 whitespace-nowrap">League Settings</h1>
            <div className="flex-1 flex justify-end">
              <MyTeamPill href={`/league/${league}/team`} name={teamName} logo={prof.logo} wallet={wallet} />
            </div>
          </header>

          {/* Big container with TWO inner blocks */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            {/* ── Block A: name + logo + teams + league type ── */}
            <div className="rounded-xl border border-white/10 bg-black/20 p-5">
              {/* Name & Logo in SAME ROW; titles inline with controls */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Name inline */}
                <div className="flex flex-col items-center">
                  <div className="flex items-center justify-center gap-3 w-full">
                    <Title>League name</Title>
                    <input
                      value={form.leagueName}
                      disabled={nameLocked}
                      onChange={(e)=>setForm({...form, leagueName:e.target.value})}
                      className={[
                        'w-full max-w-xs rounded-lg bg-black/40 border p-2 text-center',
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

                {/* Logo inline */}
                <div className="flex flex-col items-center">
                  <div className="flex items-center justify-center gap-3 w-full">
                    <Title>League logo</Title>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {(logoPreview || form.leagueLogo) ? (
                      <img src={logoPreview || form.leagueLogo} alt="League logo" className="h-10 w-10 rounded-lg object-cover ring-1 ring-white/15" />
                    ) : (
                      <div className="h-10 w-10 rounded-lg bg-white/10 grid place-items-center text-[10px]">No logo</div>
                    )}
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:border-fuchsia-400/60 disabled:opacity-50"
                      disabled={uploading}
                    >
                      {uploading ? 'Uploading…' : 'Upload'}
                    </button>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickLogo}/>
                  </div>
                </div>
              </div>

              {/* Teams */}
              <div className="mt-8 text-center">
                <Title>Number of teams</Title>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {TEAM_OPTIONS.map((n) => (
                    <Chip key={n} n={n} active={form.numberOfTeams === n} onClick={() => setForm({ ...form, numberOfTeams: n })}/>
                  ))}
                </div>
              </div>

              {/* League type — thinner cards */}
              <div className="mt-8 text-center">
                <Title>League type</Title>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {(['redraft','keeper','dynasty'] as const).map((lt) => (
                    <label key={lt} className={[
                      'rounded-xl border p-3 text-center cursor-pointer transition', // thinner
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
                      <div className="mt-1 text-xs text-gray-400">
                        {lt === 'redraft' && 'Fresh rosters each season'}
                        {lt === 'keeper'  && 'Keep a limited number of players year to year'}
                        {lt === 'dynasty' && 'Long-term rosters with rookie drafts'}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Block B: waivers + timers + deadline + switches ── */}
            <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-5">
              <div className="grid gap-8">
                {/* Waiver type */}
                <div className="text-center">
                  <Title>Waiver type</Title>
                  <select
                    value={form.waiverType}
                    onChange={e=>setForm({...form, waiverType:e.target.value as any})}
                    className="mt-3 w-full max-w-sm mx-auto rounded-lg bg-black/40 border border-white/10 p-2 text-center"
                  >
                    <option className="text-center" value="rolling">Rolling waiver</option>
                    <option className="text-center" value="reverse">Reverse standings</option>
                    <option className="text-center" value="faab">FAAB bidding</option>
                  </select>

                  {form.waiverType === 'faab' && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 place-items-center">
                      <div className="w-full max-w-xs">
                        <div className="text-xs text-gray-400 mb-1 text-center">Waiver budget (wei)</div>
                        <input
                          type="number" min={0}
                          value={form.waiverBudget ?? 0}
                          onChange={e=>setForm({...form, waiverBudget:Number(e.target.value)})}
                          className="w-full rounded-lg bg-black/40 border border-white/10 p-2 text-center"
                        />
                      </div>
                      <div className="w-full max-w-xs">
                        <div className="text-xs text-gray-400 mb-1 text-center">Minimum bid (wei)</div>
                        <input
                          type="number" min={0}
                          value={form.waiverMinBid ?? 0}
                          onChange={e=>setForm({...form, waiverMinBid:Number(e.target.value)})}
                          className="w-full rounded-lg bg-black/40 border border-white/10 p-2 text-center"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Timers row */}
                <div className="grid gap-6 md:grid-cols-3">
                  <div className="text-center">
                    <Title>Waivers after drop</Title>
                    <select
                      value={form.waiversAfterDropDays}
                      onChange={e=>setForm({...form, waiversAfterDropDays:Number(e.target.value) as 0|1|2|3})}
                      className="mt-3 w-full max-w-sm mx-auto rounded-lg bg-black/40 border border-white/10 p-2 text-center"
                    >
                      <option className="text-center" value={0}>None</option>
                      <option className="text-center" value={1}>1 day</option>
                      <option className="text-center" value={2}>2 days</option>
                      <option className="text-center" value={3}>3 days</option>
                    </select>
                  </div>

                  <div className="text-center">
                    <Title>Trade review time</Title>
                    <select
                      value={form.tradeReviewDays}
                      onChange={e=>setForm({...form, tradeReviewDays:Number(e.target.value) as 0|1|2|3})}
                      className="mt-3 w-full max-w-sm mx-auto rounded-lg bg-black/40 border border-white/10 p-2 text-center"
                    >
                      <option className="text-center" value={0}>None</option>
                      <option className="text-center" value={1}>1 day</option>
                      <option className="text-center" value={2}>2 days</option>
                      <option className="text-center" value={3}>3 days</option>
                    </select>
                  </div>

                  <div className="text-center">
                    <Title>Trade deadline</Title>
                    <select
                      value={form.tradeDeadline}
                      onChange={e=>setForm({...form, tradeDeadline:Number(e.target.value) as (typeof TRADE_DEADLINE_WEEKS)[number]})}
                      className="mt-3 w-full max-w-sm mx-auto rounded-lg bg-black/40 border border-white/10 p-2 text-center"
                    >
                      {TRADE_DEADLINE_WEEKS.map((w) =>
                        w === 0 ? <option className="text-center" key="none" value={0}>None</option> :
                        <option className="text-center" key={w} value={w}>Week {w}</option>
                      )}
                    </select>
                  </div>
                </div>

                {/* Switches */}
                <div className="grid gap-4 md:grid-cols-3">
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
              </div>
            </div>
          </section>

          <div className="pt-2 text-center">
            <SaveButton onClick={save} /> {/* label is "Save" */}
          </div>
        </div>
      </main>
    </CommissionerGuard>
  );
}
