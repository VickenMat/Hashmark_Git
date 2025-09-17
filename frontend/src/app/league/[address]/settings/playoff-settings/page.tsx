'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import CommissionerGuard from '@/components/CommissionerGuard';
import { SaveButton, useOnchainWrite } from '@/components/OnchainForm';

const ABI = [
  // Read packed playoff settings
  { type:'function', name:'getPlayoffSettings', stateMutability:'view', inputs:[], outputs:[{ type:'tuple', components:[
    { name:'teams', type:'uint8' },      // 2..10
    { name:'startWeek', type:'uint8' },  // 0=disabled, 11..17
    { name:'weeksMode', type:'uint8' },  // 0 one/round, 1 two-week final, 2 two/round
    { name:'seeding', type:'uint8' },    // 0 default, 1 reseed
  ]}]},
  // Write playoff settings
  { type:'function', name:'setPlayoffSettings', stateMutability:'nonpayable', inputs:[{ name:'s', type:'tuple', components:[
    { name:'teams', type:'uint8' },
    { name:'startWeek', type:'uint8' },
    { name:'weeksMode', type:'uint8' },
    { name:'seeding', type:'uint8' },
  ]}], outputs:[] },
] as const;

const TEAM_CHOICES = [2,3,4,5,6,7,8,9,10] as const;
const START_WEEK_CHOICES = [0,11,12,13,14,15,16,17] as const; // 0 = disable playoffs
const WEEKS_MODE = ['one','two-final','two'] as const; // display mapped below
const SEEDING = ['default','reseed'] as const;

function shortAddr(a?: string){ if(!a) return '—'; return `${a.slice(0,6)}…${a.slice(-4)}`; }

export default function PlayoffSettingsPage() {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const { address: wallet } = useAccount();

  const { data: raw } = useReadContract({ abi: ABI, address: league, functionName: 'getPlayoffSettings' });

  const defaults = useMemo(() => {
    const t = raw as any;
    return {
      teams: Number(t?.teams ?? 6),
      startWeek: Number(t?.startWeek ?? 14) as (typeof START_WEEK_CHOICES)[number],
      weeksMode: Number(t?.weeksMode ?? 0) as 0|1|2,
      seeding: Number(t?.seeding ?? 0) as 0|1,
    };
  }, [raw]);

  const [form, setForm] = useState(defaults);
  useEffect(()=>setForm(defaults), [defaults]);

  const write = useOnchainWrite();

  const save = async () => {
    const arg = {
      teams: BigInt(form.teams),
      startWeek: BigInt(form.startWeek),
      weeksMode: BigInt(form.weeksMode),
      seeding: BigInt(form.seeding),
    };
    await write(
      { abi: ABI, address: league, functionName: 'setPlayoffSettings', args: [arg] },
      'Playoff settings saved.'
    );
  };

  const Field = ({ label, children }:{label:string; children:React.ReactNode}) => (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
      <div className="text-xs text-gray-400 mb-2">{label}</div>
      {children}
    </div>
  );

  const Chip = ({ label, active, onClick }:{label:string|number; active:boolean; onClick:()=>void}) => (
    <button
      onClick={onClick}
      className={[
        'rounded-xl px-4 py-2 text-sm font-semibold border transition',
        active ? 'bg-fuchsia-600 border-fuchsia-600 text-white' : 'bg-black/30 border-white/10 hover:border-white/40'
      ].join(' ')}
    >
      {label}
    </button>
  );

  return (
    <CommissionerGuard>
      <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
        <div className="mx-auto max-w-3xl space-y-6">
          <header className="flex items-start justify-between">
            <div className="flex-1" />
            <h1 className="text-3xl font-extrabold text-center flex-1">Playoff Settings</h1>
            <div className="flex-1 flex justify-end">
              <Link
                href={`/league/${league}/team`}
                className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm hover:border-fuchsia-400/60"
              >
                My Team — {shortAddr(wallet)}
              </Link>
            </div>
          </header>

          {/* Teams */}
          <Field label="Playoff teams">
            <div className="flex flex-wrap justify-center gap-2">
              {TEAM_CHOICES.map(n =>
                <Chip key={n} label={n} active={form.teams===n} onClick={()=>setForm({...form, teams:n})}/>
              )}
            </div>
          </Field>

          {/* Start week */}
          <Field label="Playoffs start week">
            <div className="flex flex-wrap justify-center gap-2">
              {START_WEEK_CHOICES.map(w =>
                <Chip
                  key={w}
                  label={w === 0 ? 'Disable playoffs' : `Week ${w}`}
                  active={form.startWeek===w}
                  onClick={()=>setForm({...form, startWeek:w})}
                />
              )}
            </div>
          </Field>

          {/* Weeks per round */}
          <Field label="Playoff weeks per round">
            <div className="grid gap-2">
              <label className="flex items-center justify-center gap-2">
                <input type="radio" checked={form.weeksMode===0} onChange={()=>setForm({...form, weeksMode:0})}/>
                <span>One week per round</span>
              </label>
              <label className="flex items-center justify-center gap-2">
                <input type="radio" checked={form.weeksMode===1} onChange={()=>setForm({...form, weeksMode:1})}/>
                <span>Two week championship round</span>
              </label>
              <label className="flex items-center justify-center gap-2">
                <input type="radio" checked={form.weeksMode===2} onChange={()=>setForm({...form, weeksMode:2})}/>
                <span>Two weeks per round</span>
              </label>
            </div>
          </Field>

          {/* Seeding rules */}
          <Field label="Playoff seeding rules">
            <div className="grid gap-2">
              <label className="flex items-center justify-center gap-2">
                <input type="radio" checked={form.seeding===0} onChange={()=>setForm({...form, seeding:0})}/>
                <span>Default bracket</span>
              </label>
              <label className="flex items-center justify-center gap-2">
                <input type="radio" checked={form.seeding===1} onChange={()=>setForm({...form, seeding:1})}/>
                <span>Re-seed each round</span>
              </label>
            </div>
          </Field>

          <div className="pt-2 text-center">
            <SaveButton onClick={save}/>
          </div>
        </div>
      </main>
    </CommissionerGuard>
  );
}
