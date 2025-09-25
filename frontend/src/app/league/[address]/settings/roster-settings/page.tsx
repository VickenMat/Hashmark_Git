// src/app/league/[address]/settings/roster-settings/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  useAccount,
  useReadContract,
  usePublicClient,
  useBlockNumber,
  useWriteContract,
  useChainId,
} from 'wagmi';
import { useTeamProfile } from '@/lib/teamProfile';
import { decodeErrorResult, encodeFunctionData, isHex } from 'viem';

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

  // If your Solidity defines custom errors, add them here so the UI
  // can decode them (examples):
  // { type:'error', name:'MoreThanOneQbRequiresSuperFlex', inputs:[{name:'qb',type:'uint8'},{name:'superFlex',type:'uint8'}] },
  // { type:'error', name:'DefenseModeConflict', inputs:[] },
] as const;

/* colors */
const DOT = {
  qb: 'bg-rose-500', rb: 'bg-emerald-500', wr: 'bg-sky-500', te: 'bg-amber-500',
  flexWRT:'bg-white ring-1 ring-black/30', flexWR:'bg-white ring-1 ring-black/30',
  flexWT:'bg-white ring-1 ring-black/30', superFlexQWRT:'bg-white ring-1 ring-black/30',
  idpFlex:'bg-white ring-1 ring-black/30', k:'bg-yellow-400', dst:'bg-violet-500',
  dl:'bg-rose-800', lb:'bg-rose-800', db:'bg-rose-800', bench:'bg-gray-400', ir:'bg-red-400',
} as const;

type Keys =
  | 'qb'|'rb'|'wr'|'te'
  | 'flexWRT'|'flexWR'|'flexWT'|'superFlexQWRT'|'idpFlex'
  | 'k'|'dst'|'dl'|'lb'|'db'|'bench'|'ir';

type RosterForm = Record<Keys, number>;

const LABELS: Record<Keys, { title: string }> = {
  qb:{title:'QUARTERBACK (QB)'}, rb:{title:'RUNNING BACK (RB)'}, wr:{title:'WIDE RECEIVER (WR)'},
  te:{title:'TIGHT END (TE)'},
  flexWRT:{title:'FLEX (WR/RB/TE)'}, flexWR:{title:'FLEX (WR/RB)'}, flexWT:{title:'FLEX (WR/TE)'},
  superFlexQWRT:{title:'FLEX (QB/WR/RB/TE)'}, idpFlex:{title:'FLEX (IDP)'},
  k:{title:'KICKER (K)'}, dst:{title:'D/ST'},
  dl:{title:'(DL)'}, lb:{title:'(LB)'}, db:{title:'(DB)'},
  bench:{title:'(BN)'}, ir:{title:'(IR)'},
};

function initials(n?: string){
  const s=(n||'').trim(); if(!s) return 'TM';
  const p=s.split(/\s+/); return ((p[0]?.[0]??'')+(p[1]?.[0]??'')).toUpperCase() || 'TM';
}
function shortAddr(a?: string){ if(!a) return '—'; return `${a.slice(0,6)}…${a.slice(-4)}`; }
function clamp(n: number, lo=0, hi=50){ return Math.max(lo, Math.min(hi, n)); }
const eq = (a: RosterForm, b: RosterForm) => JSON.stringify(a) === JSON.stringify(b);

/* ————— Pill ————— */
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
      {logo ? <img src={logo} alt={display} className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/15"/> :
        <div className="h-9 w-9 rounded-xl bg-white/10 grid place-items-center text-xs font-bold">{initials(display)}</div>}
      <div className="leading-tight text-left">
        <div className="font-semibold text-white">{display}</div>
        <div className="text-[11px] font-mono text-gray-300">{shortAddr(wallet)}</div>
      </div>
    </Link>
  );
}

/* ————— Page ————— */
export default function RosterSettingsPage() {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const { address: wallet } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const router = useRouter();

  // live re-reads
  const { data: blockNumber } = useBlockNumber({ watch: true });

  // commissioner + team pill
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

  // read roster settings
  const { data: raw, refetch } = useReadContract({
    abi: ABI, address: league, functionName: 'getRosterSettings',
    query: { enabled: !!league, staleTime: 0, gcTime: 0, refetchOnWindowFocus: true, refetchOnReconnect: true },
  });
  useEffect(() => { if (league) refetch(); /* eslint-disable-next-line */ }, [blockNumber, league]);

  const defaults: RosterForm = useMemo(() => {
    const t = raw as any;
    return {
      qb: +(t?.qb ?? 1), rb: +(t?.rb ?? 2), wr: +(t?.wr ?? 2), te: +(t?.te ?? 1),
      flexWRT: +(t?.flexWRT ?? 1), flexWR: +(t?.flexWR ?? 0), flexWT: +(t?.flexWT ?? 0),
      superFlexQWRT: +(t?.superFlexQWRT ?? 0), idpFlex: +(t?.idpFlex ?? 0),
      k: +(t?.k ?? 1), dst: +(t?.dst ?? 1),
      dl: +(t?.dl ?? 0), lb: +(t?.lb ?? 0), db: +(t?.db ?? 0),
      bench: +(t?.bench ?? 5), ir: +(t?.ir ?? 1),
    };
  }, [raw]);

  const [form, setForm] = useState<RosterForm>(defaults);
  useEffect(() => { setForm(defaults); }, [defaults]);

  const mutate = (key: Keys, d: number) => setForm(p => ({ ...p, [key]: clamp((p[key] ?? 0) + d) }));
  const isDirty = useMemo(() => !eq(form, defaults), [form, defaults]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warnSim, setWarnSim] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<`0x${string}` | null>(null);

  /* ——— revert decoding helpers ——— */
  function parseRevert(e: any): string {
    const layers = [
      e?.data, e?.details, e?.message, e?.cause,
      e?.data?.data, e?.data?.originalError?.data,
      e?.details?.data, e?.details?.originalError?.data,
      e?.cause?.data, e?.cause?.cause?.data,
    ].filter(Boolean);

    for (const maybe of layers) {
      const hex = typeof maybe === 'string' ? (maybe.startsWith('0x') ? maybe : null)
               : typeof maybe?.data === 'string' ? (maybe.data.startsWith('0x') ? maybe.data : null)
               : null;
      if (!hex) continue;

      // Custom errors (if added to ABI)
      try {
        const d = decodeErrorResult({ abi: ABI as any, data: hex });
        if (d?.errorName) {
          const args = (d.args || []).map(String).join(', ');
          return `Reverted: ${d.errorName}${args ? `(${args})` : ''}`;
        }
      } catch {}

      // Error(string)
      if (hex.slice(0,10) === '0x08c379a0') {
        try {
          // selector(8) + offset(64) + length(64) + data…
          const lenHex = '0x' + hex.slice(10 + 64, 10 + 64 + 64);
          const len = Number(BigInt(lenHex));
          const start = 10 + 64 + 64;
          const strHex = '0x' + hex.slice(start, start + len * 2);
          // viem will throw if not utf8; fall back to hex
          return `Reverted: ${Buffer.from(strHex.slice(2), 'hex').toString('utf8') || strHex}`;
        } catch {}
        return 'Reverted (Error(string))';
      }
      // Panic(uint256)
      if (hex.slice(0,10) === '0x4e487b71') return 'Panic(uint256)';
    }

    return e?.shortMessage || e?.details || e?.message || 'Execution reverted';
  }

  async function diagnoseRevertAtBlock(
    args: readonly any[],
    blockNumber?: bigint,
  ): Promise<string | null> {
    if (!publicClient || !blockNumber) return null;
    try {
      const data = encodeFunctionData({ abi: ABI, functionName: 'setRosterSettings', args: args as any });
      // This will throw if it would revert at that block
      await publicClient.call({ to: league, data, blockNumber });
      return null;
    } catch (e:any) {
      return parseRevert(e);
    }
  }

  async function preflightWarn(args: readonly any[]) {
    setWarnSim(null);
    if (!publicClient || !league) return;
    try {
      await publicClient.simulateContract({
        abi: ABI, address: league, functionName: 'setRosterSettings', args,
        account: wallet as `0x${string}` | undefined, chainId,
      });
    } catch (e:any) {
      setWarnSim(`Dry-run failed: ${parseRevert(e)}. Sending anyway…`);
    }
  }

  async function save() {
    setError(null); setSuccess(null); setWarnSim(null); setSaving(true);
    try {
      if (!publicClient) throw new Error('No public client');
      if (!league) throw new Error('No league address');
      if (!isCommish) throw new Error('Only the commissioner can change roster settings');

      // build args (object + tuple)
      const obj = {
        qb:BigInt(form.qb), rb:BigInt(form.rb), wr:BigInt(form.wr), te:BigInt(form.te),
        flexWRT:BigInt(form.flexWRT), flexWR:BigInt(form.flexWR), flexWT:BigInt(form.flexWT),
        superFlexQWRT:BigInt(form.superFlexQWRT), idpFlex:BigInt(form.idpFlex),
        k:BigInt(form.k), dst:BigInt(form.dst), dl:BigInt(form.dl), lb:BigInt(form.lb), db:BigInt(form.db),
        bench:BigInt(form.bench), ir:BigInt(form.ir),
      } as const;
      const tuple = [
        obj.qb,obj.rb,obj.wr,obj.te,
        obj.flexWRT,obj.flexWR,obj.flexWT,obj.superFlexQWRT,
        obj.idpFlex,obj.k,obj.dst,obj.dl,obj.lb,obj.db,obj.bench,obj.ir
      ] as const;

      await preflightWarn([obj]);

      // Try object first
      let hash: `0x${string}`; let receipt;
      try {
        hash = await writeContractAsync({
          abi: ABI, address: league, functionName: 'setRosterSettings', args: [obj], chainId,
        });
        setLastTx(hash);
        receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
          const why = await diagnoseRevertAtBlock([obj], receipt.blockNumber);
          throw new Error(why || 'Execution reverted');
        }
      } catch (e1:any) {
        // Retry tuple shape
        await preflightWarn([tuple]);
        hash = await writeContractAsync({
          abi: ABI, address: league, functionName: 'setRosterSettings', args: [tuple] as any, chainId,
        });
        setLastTx(hash);
        receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
          const why = await diagnoseRevertAtBlock([tuple], receipt.blockNumber);
          throw new Error(why || 'Execution reverted');
        }
      }

      // Verify + refresh
      const after = await refetch();
      const applied = {
        qb:+(after.data as any)?.qb, rb:+(after.data as any)?.rb, wr:+(after.data as any)?.wr, te:+(after.data as any)?.te,
        flexWRT:+(after.data as any)?.flexWRT, flexWR:+(after.data as any)?.flexWR, flexWT:+(after.data as any)?.flexWT,
        superFlexQWRT:+(after.data as any)?.superFlexQWRT, idpFlex:+(after.data as any)?.idpFlex,
        k:+(after.data as any)?.k, dst:+(after.data as any)?.dst, dl:+(after.data as any)?.dl, lb:+(after.data as any)?.lb, db:+(after.data as any)?.db,
        bench:+(after.data as any)?.bench, ir:+(after.data as any)?.ir,
      } as RosterForm;

      if (!eq(applied, form)) {
        setSuccess('Saved (contract normalized some values).');
        setForm(applied);
      } else {
        setSuccess('Roster settings saved.');
      }

      // let other pages refresh
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('roster-settings-updated', { detail: { league } }));
      }
      router.refresh();
    } catch (e:any) {
      setError(parseRevert(e));
    } finally {
      setSaving(false);
    }
  }

  // Friendly hints (non-blocking)
  const hints: string[] = useMemo(() => {
    const out: string[] = [];
    if (form.qb > 1 && form.superFlexQWRT === 0) out.push('Some leagues only allow >1 QB if SuperFlex > 0.');
    const anyIDP = form.dl + form.lb + form.db + form.idpFlex > 0;
    if (anyIDP && form.dst > 0) out.push('Many leagues disable D/ST when any IDP position is used.');
    return out;
  }, [form]);

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

        {warnSim && !error && (
          <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {warnSim}
          </div>
        )}

        {hints.length > 0 && (
          <div className="rounded-xl border border-blue-400/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
            <div className="font-semibold mb-1">Heads-up (not blocking):</div>
            <ul className="list-disc pl-5 space-y-1">
              {hints.map((h,i)=><li key={i}>{h}</li>)}
            </ul>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
            {lastTx && <div className="mt-1 text-[11px] text-rose-300 font-mono break-all">Tx: {lastTx}</div>}
          </div>
        )}

        {success && (
          <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {success}
            {lastTx && <div className="mt-1 text-[11px] text-emerald-300 font-mono break-all">Tx: {lastTx}</div>}
          </div>
        )}

        <p className="text-center text-sm text-gray-400">
          Set roster positions for this league. Saving applies league-wide and updates My Team, Rosters, and Matchup
        </p>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="space-y-3 max-w-xl mx-auto">
            <Row k="qb" /><Row k="rb" /><Row k="wr" /><Row k="te" />
            <Row k="flexWRT" /><Row k="flexWR" /><Row k="flexWT" />
            <Row k="superFlexQWRT" /><Row k="idpFlex" />
            <Row k="k" /><Row k="dst" />
            <Row k="dl" /><Row k="lb" /><Row k="db" />
            <Row k="bench" /><Row k="ir" />
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
