// src/app/league/[address]/settings/roster-settings/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  useAccount,
  useReadContract,
  usePublicClient,
  useBlockNumber,
  useWriteContract,
  useChainId,
} from 'wagmi';
import { useTeamProfile } from '@/lib/teamProfile';

const ZERO = '0x0000000000000000000000000000000000000000' as const;

const ABI = [
  { type:'function', name:'commissioner', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
  { type:'function', name:'getTeamByAddress', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'string'}] },
  {
    type:'function',
    name:'getRosterSettings',
    stateMutability:'view',
    inputs:[],
    outputs:[{ type:'tuple', components:[
      { name:'qb',            type:'uint8' },
      { name:'rb',            type:'uint8' },
      { name:'wr',            type:'uint8' },
      { name:'te',            type:'uint8' },
      { name:'flexWRT',       type:'uint8' },
      { name:'flexWR',        type:'uint8' },
      { name:'flexWT',        type:'uint8' },
      { name:'superFlexQWRT', type:'uint8' },
      { name:'idpFlex',       type:'uint8' },
      { name:'k',             type:'uint8' },
      { name:'dst',           type:'uint8' },
      { name:'dl',            type:'uint8' },
      { name:'lb',            type:'uint8' },
      { name:'db',            type:'uint8' },
      { name:'bench',         type:'uint8' },
      { name:'ir',            type:'uint8' },
    ]}]
  },
  {
    type:'function',
    name:'setRosterSettings',
    stateMutability:'nonpayable',
    inputs:[{ name:'s', type:'tuple', components:[
      { name:'qb',            type:'uint8' },
      { name:'rb',            type:'uint8' },
      { name:'wr',            type:'uint8' },
      { name:'te',            type:'uint8' },
      { name:'flexWRT',       type:'uint8' },
      { name:'flexWR',        type:'uint8' },
      { name:'flexWT',        type:'uint8' },
      { name:'superFlexQWRT', type:'uint8' },
      { name:'idpFlex',       type:'uint8' },
      { name:'k',             type:'uint8' },
      { name:'dst',           type:'uint8' },
      { name:'dl',            type:'uint8' },
      { name:'lb',            type:'uint8' },
      { name:'db',            type:'uint8' },
      { name:'bench',         type:'uint8' },
      { name:'ir',            type:'uint8' },
    ]}],
    outputs:[]
  },
] as const;

/* Colors */
const DOT = {
  qb:   'bg-rose-500',
  rb:   'bg-emerald-500',
  wr:   'bg-sky-500',
  te:   'bg-amber-500',
  flexWRT: 'bg-white ring-1 ring-black/30',
  flexWR:  'bg-white ring-1 ring-black/30',
  flexWT:  'bg-white ring-1 ring-black/30',
  superFlexQWRT: 'bg-white ring-1 ring-black/30',
  idpFlex: 'bg-white ring-1 ring-black/30',
  k:    'bg-yellow-400',
  dst:  'bg-violet-500',
  dl:   'bg-rose-800',
  lb:   'bg-rose-800',
  db:   'bg-rose-800',
  bench:'bg-gray-400',
  ir:   'bg-red-400',
} as const;

type Keys =
  | 'qb'|'rb'|'wr'|'te'
  | 'flexWRT'|'flexWR'|'flexWT'|'superFlexQWRT'|'idpFlex'
  | 'k'|'dst'
  | 'dl'|'lb'|'db'
  | 'bench'|'ir';

type RosterForm = Record<Keys, number>;

const LABELS: Record<Keys, { title: string }> = {
  qb:   { title: 'QUARTERBACK (QB)' },
  rb:   { title: 'RUNNING BACK (RB)' },
  wr:   { title: 'WIDE RECEIVER (WR)' },
  te:   { title: 'TIGHT END (TE)' },
  flexWRT:      { title: 'FLEX (WR/RB/TE)' },
  flexWR:       { title: 'FLEX (WR/RB)' },
  flexWT:       { title: 'FLEX (WR/TE)' },
  superFlexQWRT:{ title: 'FLEX (QB/WR/RB/TE)' },
  idpFlex:      { title: 'FLEX (IDP)' },
  k:    { title: 'KICKER (K)' },
  dst:  { title: 'D/ST' },
  dl:   { title: '(DL)' },
  lb:   { title: '(LB)' },
  db:   { title: '(DB)' },
  bench:{ title: '(BN)' },
  ir:   { title: '(IR)' },
};

function initials(n?: string){
  const s=(n||'').trim(); if(!s) return 'TM';
  const p=s.split(/\s+/); return ((p[0]?.[0]??'')+(p[1]?.[0]??'')).toUpperCase() || 'TM';
}
function shortAddr(a?: string){ if(!a) return '—'; return `${a.slice(0,6)}…${a.slice(-4)}`; }

function MyTeamPill({ href, name, logo, wallet }:{
  href:string; name?:string; logo?:string; wallet?:`0x${string}`|undefined
}) {
  const display = name?.trim() || 'My Team';
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] px-3 py-2 ring-1 ring-black/20 hover:border-fuchsia-400/60 transition"
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

export default function RosterSettingsPage() {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const { address: wallet } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // Re-read on each block so we see changes as soon as they land
  const { data: blockNumber } = useBlockNumber({ watch: true });

  /* commissioner & team pill */
  const { data: commissioner } = useReadContract({
    abi: ABI, address: league, functionName: 'commissioner',
    query: { enabled: !!league }
  });
  const isCommish = !!wallet && !!commissioner && wallet.toLowerCase() === String(commissioner).toLowerCase();

  const { data: onChainTeamName } = useReadContract({
    abi: ABI, address: league, functionName: 'getTeamByAddress',
    args: [wallet ?? ZERO], query: { enabled: !!wallet }
  });

  const prof = useTeamProfile(league, wallet, { name: onChainTeamName as string });
  const teamName = (prof.name || (onChainTeamName as string) || '').trim() || undefined;

  /* read roster settings (force-fresh) */
  const { data: raw, refetch } = useReadContract({
    abi: ABI, address: league, functionName: 'getRosterSettings',
    query: {
      enabled: !!league,
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  useEffect(() => { if (league) refetch(); /* eslint-disable-next-line */ }, [blockNumber, league]);

  const defaults: RosterForm = useMemo(() => {
    const t = raw as any;
    return {
      qb:   Number(t?.qb   ?? 1),
      rb:   Number(t?.rb   ?? 2),
      wr:   Number(t?.wr   ?? 2),
      te:   Number(t?.te   ?? 1),
      flexWRT:       Number(t?.flexWRT       ?? 1),
      flexWR:        Number(t?.flexWR        ?? 0),
      flexWT:        Number(t?.flexWT        ?? 0),
      superFlexQWRT: Number(t?.superFlexQWRT ?? 0),
      idpFlex:       Number(t?.idpFlex       ?? 0),
      k:    Number(t?.k    ?? 1),
      dst:  Number(t?.dst  ?? 1),
      dl:   Number(t?.dl   ?? 0),
      lb:   Number(t?.lb   ?? 0),
      db:   Number(t?.db   ?? 0),
      bench:Number(t?.bench?? 5),
      ir:   Number(t?.ir   ?? 1),
    };
  }, [raw]);

  const [form, setForm] = useState<RosterForm>(defaults);
  useEffect(() => { setForm(defaults); }, [defaults]);

  const mutate = (key: Keys, delta: number) => {
    setForm(prev => {
      const next = Math.max(0, Math.min(10, (prev[key] ?? 0) + delta));
      return { ...prev, [key]: next };
    });
  };

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(defaults), [form, defaults]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<`0x${string}` | null>(null);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      if (!publicClient) throw new Error('No public client');
      if (!league) throw new Error('No league address');

      if (!isCommish) {
        throw new Error('Only the commissioner can change roster settings');
      }

      // Pass a strict object matching the tuple fields, with uints as BigInt
      const s = {
        qb:            BigInt(form.qb),
        rb:            BigInt(form.rb),
        wr:            BigInt(form.wr),
        te:            BigInt(form.te),
        flexWRT:       BigInt(form.flexWRT),
        flexWR:        BigInt(form.flexWR),
        flexWT:        BigInt(form.flexWT),
        superFlexQWRT: BigInt(form.superFlexQWRT),
        idpFlex:       BigInt(form.idpFlex),
        k:             BigInt(form.k),
        dst:           BigInt(form.dst),
        dl:            BigInt(form.dl),
        lb:            BigInt(form.lb),
        db:            BigInt(form.db),
        bench:         BigInt(form.bench),
        ir:            BigInt(form.ir),
      } as const;

      const hash = await writeContractAsync({
        abi: ABI,
        address: league,
        functionName: 'setRosterSettings',
        args: [s],
        chainId,
      });
      setLastTx(hash);

      // wait for mining
      await publicClient.waitForTransactionReceipt({ hash });

      // re-read from chain and sync UI
      const after = await refetch();
      const t = after.data as any;
      const applied = JSON.stringify({
        qb: Number(t?.qb), rb: Number(t?.rb), wr: Number(t?.wr), te: Number(t?.te),
        flexWRT: Number(t?.flexWRT), flexWR: Number(t?.flexWR), flexWT: Number(t?.flexWT),
        superFlexQWRT: Number(t?.superFlexQWRT), idpFlex: Number(t?.idpFlex),
        k: Number(t?.k), dst: Number(t?.dst), dl: Number(t?.dl), lb: Number(t?.lb), db: Number(t?.db),
        bench: Number(t?.bench), ir: Number(t?.ir),
      });

      const wanted = JSON.stringify({
        qb: form.qb, rb: form.rb, wr: form.wr, te: form.te,
        flexWRT: form.flexWRT, flexWR: form.flexWR, flexWT: form.flexWT,
        superFlexQWRT: form.superFlexQWRT, idpFlex: form.idpFlex,
        k: form.k, dst: form.dst, dl: form.dl, lb: form.lb, db: form.db,
        bench: form.bench, ir: form.ir,
      });

      if (applied !== wanted) {
        throw new Error('Transaction mined, but settings on-chain do not match what was submitted');
      }
    } catch (e:any) {
      setError(e?.shortMessage || e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function Row({ k }: { k: Keys }) {
    const label = LABELS[k];
    const val = form[k] ?? 0;
    return (
      <div className="flex items-center justify-center gap-4 py-2 text-center">
        <div className="flex items-center gap-2 rounded-full bg-white/5 px-2 py-1">
          <button
            onClick={()=>mutate(k, -1)}
            className="grid h-8 w-8 place-items-center rounded-full bg-black/50 border border-white/10 hover:border-white/40"
            aria-label={`decrease ${label.title}`}
          >
            <span className="text-lg leading-none">–</span>
          </button>
          <div className="grid h-8 min-w-10 place-items-center rounded-full bg-black/30 border border-white/10 px-3 font-semibold">
            {val}
          </div>
          <button
            onClick={()=>mutate(k, +1)}
            className="grid h-8 w-8 place-items-center rounded-full bg-black/50 border border-white/10 hover:border-white/40"
            aria-label={`increase ${label.title}`}
          >
            <span className="text-lg leading-none">+</span>
          </button>
        </div>
        <div className={`h-4 w-4 rounded-full ${DOT[k]} shadow`} />
        <div className="min-w-[220px] font-semibold tracking-wide">{label.title}</div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header */}
        <header className="flex items-start justify-between">
          <div className="flex-1" />
          <h1 className="text-3xl font-extrabold text-center flex-1">Roster Settings</h1>
          <div className="flex-1 flex justify-end">
            <MyTeamPill href={`/league/${league}/team`} name={teamName} logo={prof.logo} wallet={wallet} />
          </div>
        </header>

        {!isCommish && (
          <div className="rounded-xl border border-yellow-400/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
            View only — only the commissioner can save roster settings
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
            {lastTx && (
              <div className="mt-1 text-[11px] text-rose-300 font-mono break-all">
                Tx: {lastTx}
              </div>
            )}
          </div>
        )}

        <p className="text-center text-sm text-gray-400">
          Set roster positions for this league. Saving applies league-wide and updates My Team, Rosters, and Matchup
        </p>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="space-y-3 max-w-xl mx-auto">
            <Row k="qb" />
            <Row k="rb" />
            <Row k="wr" />
            <Row k="te" />
            <Row k="flexWRT" />
            <Row k="flexWR" />
            <Row k="flexWT" />
            <Row k="superFlexQWRT" />
            <Row k="idpFlex" />
            <Row k="k" />
            <Row k="dst" />
            <Row k="dl" />
            <Row k="lb" />
            <Row k="db" />
            <Row k="bench" />
            <Row k="ir" />
          </div>

          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              onClick={()=>setForm({
                qb:1, rb:2, wr:2, te:1,
                flexWRT:1, flexWR:0, flexWT:0, superFlexQWRT:0, idpFlex:0,
                k:1, dst:1, dl:0, lb:0, db:0, bench:5, ir:1
              })}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm hover:border-fuchsia-400/60"
            >
              Reset to default
            </button>

            <button
              onClick={save}
              disabled={!isCommish || !isDirty || saving}
              className="rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 font-semibold disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>

            {!isDirty && <div className="text-[11px] text-gray-400">No changes</div>}
          </div>
        </section>

        <div className="text-center text-[11px] text-gray-500">
          Net: chain {chainId} • League {shortAddr(league)} • Block {String(blockNumber ?? '—')}
        </div>
      </div>
    </main>
  );
}
