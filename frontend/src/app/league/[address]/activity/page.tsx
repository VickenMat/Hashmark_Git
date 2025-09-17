'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  useAccount,
  useReadContract,
  usePublicClient,
  useWatchContractEvent,
} from 'wagmi';
import { useTeamProfile } from '@/lib/teamProfile';

/* ─────────────────────────────── ABI (views + events) ─────────────────────────────── */
const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getTeamByAddress', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'string' }] },

  // Waiver events
  {
    type: 'event', name: 'WaiverClaimed', inputs: [
      { indexed: true,  name: 'owner',    type: 'address' },
      { indexed: false, name: 'player',   type: 'string'  },
      { indexed: false, name: 'position', type: 'string'  },
      { indexed: false, name: 'team',     type: 'string'  },
      { indexed: false, name: 'faab',     type: 'uint256' },
    ],
  },
  {
    type: 'event', name: 'WaiverReleased', inputs: [
      { indexed: true,  name: 'owner',    type: 'address' },
      { indexed: false, name: 'player',   type: 'string'  },
      { indexed: false, name: 'position', type: 'string'  },
      { indexed: false, name: 'team',     type: 'string'  },
    ],
  },
  {
    type: 'event', name: 'PlayerCut', inputs: [
      { indexed: true,  name: 'owner',    type: 'address' },
      { indexed: false, name: 'player',   type: 'string'  },
      { indexed: false, name: 'position', type: 'string'  },
      { indexed: false, name: 'team',     type: 'string'  },
    ],
  },
  // Collapsed add/drop (1=add, 2=cut)
  {
    type: 'event', name: 'WaiverProcessed', inputs: [
      { indexed: true,  name: 'owner',    type: 'address' },
      { indexed: false, name: 'action',   type: 'uint8'   },
      { indexed: false, name: 'player',   type: 'string'  },
      { indexed: false, name: 'position', type: 'string'  },
      { indexed: false, name: 'team',     type: 'string'  },
      { indexed: false, name: 'faab',     type: 'uint256' },
    ],
  },

  // Trades
  {
    type: 'event', name: 'TradeAccepted', inputs: [
      { indexed: true,  name: 'proposer',     type: 'address' },
      { indexed: true,  name: 'counterparty', type: 'address' },
      { indexed: false, name: 'tradeId',      type: 'uint64'  },
    ],
  },
  {
    type: 'event', name: 'TradeExecuted', inputs: [
      { indexed: true,  name: 'teamA',         type: 'address' },
      { indexed: true,  name: 'teamB',         type: 'address' },
      { indexed: false, name: 'teamAReceived', type: 'string[]' },
      { indexed: false, name: 'teamBReceived', type: 'string[]' },
    ],
  },
] as const;

/* ─────────────────────────────── Helpers ─────────────────────────────── */
const ZERO = '0x0000000000000000000000000000000000000000';
function initials(n?: string) {
  const s = (n || '').trim(); if (!s) return 'TM';
  const p = s.split(/\s+/); return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || 'TM';
}
function compactPlayer(full?: string) {
  const s = (full || '').trim(); if (!s) return '—';
  const parts = s.split(/\s+/); if (parts.length === 1) return parts[0];
  const first = (parts[0] || '')[0] ? `${parts[0][0].toUpperCase()}.` : '';
  const last = parts.slice(-1)[0] || ''; return `${first} ${last}`;
}
function abbrTeam(team?: string) { return (team || '').trim().slice(0, 3).toUpperCase(); }
function fmtFaab(v?: bigint | number) { if (v == null) return '—'; const n = typeof v === 'bigint' ? Number(v) : v; return `$${n}`; }
function fmtDate(ts?: number) { if (!ts) return '—'; return new Date(ts * 1000).toLocaleString(); }
function shortAddr(a?: `0x${string}`) { return a ? `${a.slice(0,6)}…${a.slice(-4)}` : ''; }

/* ─────────────────────────────── Tiny components ─────────────────────────────── */
function TeamName({ league, owner }: { league: `0x${string}`; owner: `0x${string}` }) {
  const { data: fallback } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'getTeamByAddress', args: [owner] });
  const prof = useTeamProfile(league, owner, { name: fallback as string });
  const display = (prof.name || (fallback as string) || '').trim() || shortAddr(owner);
  return <span className="font-semibold">{display}</span>;
}

function ProfilePill({
  league, wallet, name, logo,
}: { league: `0x${string}`; wallet?: `0x${string}`; name?: string; logo?: string }) {
  const content = (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 shadow-sm hover:bg-white/[0.06]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? <img src={logo} alt={name || 'Team'} className="h-10 w-10 rounded-2xl object-cover ring-1 ring-white/15" />
            : <div className="h-10 w-10 rounded-2xl bg-white/10 grid place-items-center font-semibold">{initials(name)}</div>}
      <div className="leading-tight">
        <div className="font-semibold">{name || 'Your Team'}</div>
        {wallet && <div className="text-[11px] text-gray-400 font-mono">{shortAddr(wallet)}</div>}
      </div>
    </div>
  );
  if (!wallet) return <div className="opacity-70">{content}</div>;
  return <Link href={`/league/${league}/team/${wallet}`}>{content}</Link>;
}

function HeaderBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 items-center">
      <div /> {/* left empty (no hamburger) */}
      <h1 className="justify-self-center text-3xl font-extrabold">{title}</h1>
      <div className="justify-self-end">{right}</div>
    </div>
  );
}

/* ─────────────────────────────── Types ─────────────────────────────── */
type ActivityKind = 'WAIVER_ADD' | 'WAIVER_DROP' | 'TRADE_ACCEPTED' | 'TRADE_EXECUTED';
type BaseItem = { id: string; ts?: number; blockNumber?: bigint; txHash?: `0x${string}` };
type WaiverItem = BaseItem & { kind: 'WAIVER_ADD' | 'WAIVER_DROP'; owner: `0x${string}`; player: string; position: string; team: string; faab?: bigint; };
type TradeAcceptedItem = BaseItem & { kind: 'TRADE_ACCEPTED'; a: `0x${string}`; b: `0x${string}`; tradeId?: bigint; };
type TradeExecutedItem = BaseItem & { kind: 'TRADE_EXECUTED'; a: `0x${string}`; b: `0x${string}`; aReceived: string[]; bReceived: string[]; };
type ActivityItem = WaiverItem | TradeAcceptedItem | TradeExecutedItem;

/* ─────────────────────────────── Rows ─────────────────────────────── */
function WaiverRow({ item, league }: { item: WaiverItem; league: `0x${string}` }) {
  const sign = item.kind === 'WAIVER_ADD' ? '+' : '–';
  const pillClass = item.kind === 'WAIVER_ADD'
    ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-200'
    : 'bg-rose-500/20 border-rose-400/30 text-rose-200';
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className={`grid h-6 w-6 place-items-center rounded-full border text-sm font-bold ${pillClass}`}>{sign}</span>
        <div className="text-gray-300">
          <TeamName league={league} owner={item.owner} /> {item.kind === 'WAIVER_ADD' ? 'added' : 'dropped'}{' '}
          <span className="font-semibold">{compactPlayer(item.player)}</span>{' '}
          <span className="text-gray-400">({item.position} – {abbrTeam(item.team)})</span>
          {item.kind === 'WAIVER_ADD' && <span className="ml-2 text-emerald-300 font-semibold">for {fmtFaab(item.faab)} FAAB</span>}
        </div>
      </div>
      <span className="text-gray-500 text-sm">{fmtDate(item.ts)}</span>
    </div>
  );
}
function TradeAcceptedRow({ item, league }: { item: TradeAcceptedItem; league: `0x${string}` }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3 flex items-center justify-between">
      <div className="text-gray-300">
        Trade accepted between <TeamName league={league} owner={item.a} /> and <TeamName league={league} owner={item.b} />
        {typeof item.tradeId !== 'undefined' && <span className="text-gray-400"> (ID {String(item.tradeId)})</span>}.
      </div>
      <span className="text-gray-500 text-sm">{fmtDate(item.ts)}</span>
    </div>
  );
}
function ReceivedList({ items }: { items: string[] }) {
  if (!items?.length) return <span className="italic text-gray-400">—</span>;
  const norm = items.map((raw0) => {
    const raw = String(raw0 || ''); let name = raw, pos = '', tm = '';
    if (raw.includes('|')) { const [n,p,t] = raw.split('|'); name = n||''; pos=(p||'').toUpperCase(); tm=abbrTeam(t); }
    else { const m = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/); if (m){ name=m[1].trim(); const p2=m[2].split('-'); pos=(p2[0]||'').toUpperCase(); tm=abbrTeam(p2[1]||''); } }
    const label = [compactPlayer(name), pos && `(${pos}${tm?`-${tm}`:''})`].filter(Boolean).join(' ');
    return label || raw;
  });
  return <span>{norm.join(', ')}</span>;
}
function TradeExecutedRow({ item, league }: { item: TradeExecutedItem; league: `0x${string}` }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3">
      <div className="flex items-start justify-between">
        <div className="text-gray-300">
          Trade completed: <TeamName league={league} owner={item.a} /> received{' '}
          <span className="font-semibold"><ReceivedList items={item.aReceived} /></span>{' '}
          • <TeamName league={league} owner={item.b} /> received{' '}
          <span className="font-semibold"><ReceivedList items={item.bReceived} /></span>.
        </div>
        <span className="text-gray-500 text-sm">{fmtDate(item.ts)}</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Page ─────────────────────────────── */
export default function ActivityPage() {
  const { address: league } = useParams<{ address: `0x${string}` }>();
  const { address: wallet } = useAccount();
  const publicClient = usePublicClient();

  const { data: myOnChainName } = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getTeamByAddress', args: [wallet ?? ZERO], query: { enabled: !!wallet },
  });
  const profile = useTeamProfile(league, wallet, { name: myOnChainName as string });
  const displayName = (profile.name || (myOnChainName as string) || '').trim() || undefined;

  const [items, setItems] = useState<ActivityItem[]>([]);
  function upsert(next: ActivityItem[]) {
    setItems((prev) => {
      const map = new Map<string, ActivityItem>();
      for (const it of [...prev, ...next]) map.set(it.id, it);
      const arr = [...map.values()];
      arr.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0) || Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n)));
      return arr;
    });
  }

  // Initial backfill
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!publicClient || !league) return;
      try {
        const latest = await publicClient.getBlockNumber();
        const lookback = BigInt(Number(process.env.NEXT_PUBLIC_ACTIVITY_BLOCK_LOOKBACK ?? 120_000));
        const fromBlock = latest > lookback ? latest - lookback : 0n;

        async function grab(eventName: string) {
          return publicClient.getLogs({
            address: league,
            event: (LEAGUE_ABI as any).find((e: any) => e.type === 'event' && e.name === eventName),
            fromBlock, toBlock: latest,
          });
        }
        const [logsAdd, logsRel, logsCut, logsProc, logsAcc, logsExec] = await Promise.all([
          grab('WaiverClaimed'), grab('WaiverReleased'), grab('PlayerCut'), grab('WaiverProcessed'), grab('TradeAccepted'), grab('TradeExecuted'),
        ]);

        const blockHashes = Array.from(new Set(
          [...logsAdd, ...logsRel, ...logsCut, ...logsProc, ...logsAcc, ...logsExec].map((l) => l.blockHash as `0x${string}`).filter(Boolean)
        ));
        const blockTime = new Map<string, number>();
        for (const h of blockHashes) { const b = await publicClient.getBlock({ blockHash: h }); blockTime.set(h, Number(b.timestamp)); }

        const norm: ActivityItem[] = [];
        for (const l of logsAdd) {
          const { args } = l as any;
          norm.push({ id: `${l.transactionHash}-${l.logIndex}`, kind: 'WAIVER_ADD', owner: args.owner, player: args.player, position: args.position, team: args.team, faab: args.faab, ts: blockTime.get(l.blockHash as string), txHash: l.transactionHash, blockNumber: l.blockNumber });
        }
        for (const l of [...logsRel, ...logsCut]) {
          const { args } = l as any;
          norm.push({ id: `${l.transactionHash}-${l.logIndex}`, kind: 'WAIVER_DROP', owner: args.owner, player: args.player, position: args.position, team: args.team, ts: blockTime.get(l.blockHash as string), txHash: l.transactionHash, blockNumber: l.blockNumber });
        }
        for (const l of logsProc) {
          const { args } = l as any; const kind: ActivityKind = Number(args.action) === 1 ? 'WAIVER_ADD' : 'WAIVER_DROP';
          norm.push({ id: `${l.transactionHash}-${l.logIndex}`, kind, owner: args.owner, player: args.player, position: args.position, team: args.team, faab: args.faab, ts: blockTime.get(l.blockHash as string), txHash: l.transactionHash, blockNumber: l.blockNumber } as WaiverItem);
        }
        for (const l of logsAcc) {
          const { args } = l as any;
          norm.push({ id: `${l.transactionHash}-${l.logIndex}`, kind: 'TRADE_ACCEPTED', a: args.proposer, b: args.counterparty, tradeId: args.tradeId, ts: blockTime.get(l.blockHash as string), txHash: l.transactionHash, blockNumber: l.blockNumber });
        }
        for (const l of logsExec) {
          const { args } = l as any;
          norm.push({ id: `${l.transactionHash}-${l.logIndex}`, kind: 'TRADE_EXECUTED', a: args.teamA, b: args.teamB, aReceived: Array.isArray(args.teamAReceived) ? args.teamAReceived : [], bReceived: Array.isArray(args.teamBReceived) ? args.teamBReceived : [], ts: blockTime.get(l.blockHash as string), txHash: l.transactionHash, blockNumber: l.blockNumber });
        }
        if (alive && norm.length) upsert(norm);
      } catch (e) {
        console.warn('activity backfill skipped:', e);
      }
    })();
    return () => { alive = false; };
  }, [publicClient, league]);

  // Live watchers
  useWatchContractEvent({
    address: league, abi: LEAGUE_ABI, eventName: 'WaiverClaimed', enabled: !!league,
    onLogs: async (logs) => {
      if (!publicClient) return;
      const ts = await publicClient.getBlock({ blockHash: logs[0]!.blockHash as `0x${string}` }).then(b => Number(b.timestamp)).catch(() => undefined);
      upsert(logs.map((l: any) => ({ id: `${l.transactionHash}-${l.logIndex}`, kind: 'WAIVER_ADD', owner: l.args.owner, player: l.args.player, position: l.args.position, team: l.args.team, faab: l.args.faab, ts, txHash: l.transactionHash, blockNumber: l.blockNumber })));
    },
  });
  useWatchContractEvent({
    address: league, abi: LEAGUE_ABI, eventName: 'WaiverReleased', enabled: !!league,
    onLogs: async (logs) => {
      if (!publicClient) return;
      const ts = await publicClient.getBlock({ blockHash: logs[0]!.blockHash as `0x${string}` }).then(b => Number(b.timestamp)).catch(() => undefined);
      upsert(logs.map((l: any) => ({ id: `${l.transactionHash}-${l.logIndex}`, kind: 'WAIVER_DROP', owner: l.args.owner, player: l.args.player, position: l.args.position, team: l.args.team, ts, txHash: l.transactionHash, blockNumber: l.blockNumber })));
    },
  });
  useWatchContractEvent({
    address: league, abi: LEAGUE_ABI, eventName: 'PlayerCut', enabled: !!league,
    onLogs: async (logs) => {
      if (!publicClient) return;
      const ts = await publicClient.getBlock({ blockHash: logs[0]!.blockHash as `0x${string}` }).then(b => Number(b.timestamp)).catch(() => undefined);
      upsert(logs.map((l: any) => ({ id: `${l.transactionHash}-${l.logIndex}`, kind: 'WAIVER_DROP', owner: l.args.owner, player: l.args.player, position: l.args.position, team: l.args.team, ts, txHash: l.transactionHash, blockNumber: l.blockNumber })));
    },
  });
  useWatchContractEvent({
    address: league, abi: LEAGUE_ABI, eventName: 'WaiverProcessed', enabled: !!league,
    onLogs: async (logs) => {
      if (!publicClient) return;
      const ts = await publicClient.getBlock({ blockHash: logs[0]!.blockHash as `0x${string}` }).then(b => Number(b.timestamp)).catch(() => undefined);
      upsert(logs.map((l: any) => ({ id: `${l.transactionHash}-${l.logIndex}`, kind: Number(l.args.action) === 1 ? 'WAIVER_ADD' : 'WAIVER_DROP', owner: l.args.owner, player: l.args.player, position: l.args.position, team: l.args.team, faab: l.args.faab, ts, txHash: l.transactionHash, blockNumber: l.blockNumber })));
    },
  });
  useWatchContractEvent({
    address: league, abi: LEAGUE_ABI, eventName: 'TradeAccepted', enabled: !!league,
    onLogs: async (logs) => {
      if (!publicClient) return;
      const ts = await publicClient.getBlock({ blockHash: logs[0]!.blockHash as `0x${string}` }).then(b => Number(b.timestamp)).catch(() => undefined);
      upsert(logs.map((l: any) => ({ id: `${l.transactionHash}-${l.logIndex}`, kind: 'TRADE_ACCEPTED', a: l.args.proposer, b: l.args.counterparty, tradeId: l.args.tradeId, ts, txHash: l.transactionHash, blockNumber: l.blockNumber })));
    },
  });
  useWatchContractEvent({
    address: league, abi: LEAGUE_ABI, eventName: 'TradeExecuted', enabled: !!league,
    onLogs: async (logs) => {
      if (!publicClient) return;
      const ts = await publicClient.getBlock({ blockHash: logs[0]!.blockHash as `0x${string}` }).then(b => Number(b.timestamp)).catch(() => undefined);
      upsert(logs.map((l: any) => ({ id: `${l.transactionHash}-${l.logIndex}`, kind: 'TRADE_EXECUTED', a: l.args.teamA, b: l.args.teamB, aReceived: Array.isArray(l.args.teamAReceived) ? l.args.teamAReceived : [], bReceived: Array.isArray(l.args.teamBReceived) ? l.args.teamBReceived : [], ts, txHash: l.transactionHash, blockNumber: l.blockNumber })));
    },
  });

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <HeaderBar
          title="Recent Activity"
          right={<ProfilePill league={league} wallet={wallet} name={displayName} logo={profile.logo} />}
        />

        {/* Stream */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold mb-4">Live Feed</h2>
          {items.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3 text-gray-400">
              No activity yet. Waiver moves and trades will show up here as they happen.
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              {items.map((it) => {
                switch (it.kind) {
                  case 'WAIVER_ADD':
                  case 'WAIVER_DROP':
                    return <WaiverRow key={it.id} item={it as WaiverItem} league={league} />;
                  case 'TRADE_ACCEPTED':
                    return <TradeAcceptedRow key={it.id} item={it as TradeAcceptedItem} league={league} />;
                  case 'TRADE_EXECUTED':
                    return <TradeExecutedRow key={it.id} item={it as TradeExecutedItem} league={league} />;
                }
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
