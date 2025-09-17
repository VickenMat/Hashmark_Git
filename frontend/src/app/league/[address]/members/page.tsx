// src/app/league/[address]/members/page.tsx
'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import { useTeamProfile, generatedLogoFor } from '@/lib/teamProfile';

const ZERO = '0x0000000000000000000000000000000000000000';

const LEAGUE_ABI = [
  { type: 'function', name: 'name',               stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'commissioner',       stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'buyInToken',         stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'buyInAmount',        stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'teamCap',            stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'getTeams',
    stateMutability: 'view',
    inputs: [],
    outputs: [{
      type: 'tuple[]',
      components: [
        { name: 'owner', type: 'address' },
        { name: 'name',  type: 'string'  }, // on-chain fallback
      ],
    }],
  },
  { type: 'function', name: 'getTeamByAddress',   stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'string' }] },
] as const;

type Team = { owner: `0x${string}`; name: string };

// --- helpers ---------------------------------------------------------------

/** Convert ipfs:// or bare CID into an HTTP URL using your public gateway. */
function toHttp(uri?: string) {
  if (!uri) return '';
  if (uri.startsWith('data:')) return uri; // already usable
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;

  const gateway = (process.env.NEXT_PUBLIC_IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/').replace(/\/+$/, '');
  if (uri.startsWith('ipfs://')) {
    const path = uri.slice('ipfs://'.length);
    return `${gateway}/${path}`;
  }
  // bare CID (optionally with a path)
  if (/^[a-z0-9]{46,}(?:\/.*)?$/i.test(uri)) {
    return `${gateway}/${uri}`;
  }
  return uri;
}

function initials(n?: string){ const s=(n||'').trim(); if(!s) return 'TM'; const p=s.split(/\s+/); return ((p[0]?.[0]??'')+(p[1]?.[0]??'')).toUpperCase() || 'TM'; }

function Avatar({ name, url }:{ name?:string; url?:string }) {
  const safe = name?.trim() || '—';
  const src = toHttp(url);
  return src
    ? /* eslint-disable-next-line @next/next/no-img-element */
      <img src={src} alt={safe} className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/15"/>
    : <div className="h-10 w-10 rounded-xl bg-white/10 grid place-items-center font-semibold">{initials(safe)}</div>;
}

function TeamBadge({ name, logo, wallet }:{ name?:string; logo?:string; wallet?:`0x${string}`|undefined }) {
  const safe = name?.trim() || '—';
  return (
    <div className="flex items-center gap-3">
      <Avatar name={safe} url={logo}/>
      <div className="leading-tight">
        <div className="text-xs text-gray-400">Your Team</div>
        <div className="font-semibold truncate max-w-[220px]" title={safe}>{safe}</div>
        {wallet && <div className="text-[10px] text-gray-500 font-mono truncate max-w-[220px]">{wallet}</div>}
      </div>
    </div>
  );
}

function shortAddr(a?: string) { if (!a) return '0x'; return `${a.slice(0,6)}…${a.slice(-4)}`; }
function formatAvax(wei?: bigint) {
  if (wei === undefined) return '—';
  if (wei === 0n) return 'Free';
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n) + 10n ** 18n;
  const fracStr = frac.toString().slice(1).slice(0, 4);
  return `${whole}.${fracStr} AVAX`;
}

function CopyBtn({ value }: { value: string }) {
  return (
    <button
      onClick={() => navigator.clipboard.writeText(value)}
      className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-gray-200 hover:border-fuchsia-400/60 transition"
      title="Copy to clipboard"
    >
      Copy
    </button>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
      <div className="text-[11px] tracking-[0.2em] text-gray-400">{label}</div>
      <div className="mt-2 text-xl font-extrabold">{value}</div>
    </div>
  );
}

/** Child so hook order is stable */
function MemberRow({
  league,
  owner,
  fallbackName,
  isCommish,
  isYou,
}: {
  league: `0x${string}`;
  owner: `0x${string}`;
  fallbackName: string;
  isCommish: boolean;
  isYou: boolean;
}) {
  // Read from GLOBAL profile; fallback = on-chain team name
  const prof = useTeamProfile(league, owner, { name: fallbackName });
  const displayName = (prof.name || fallbackName || '').trim() || 'Unnamed Team';

  // Normalize the logo:
  // 1) prefer on-chain logoURI (converted from ipfs:// or CID to HTTP),
  // 2) otherwise use deterministic SVG
  const logoUrl = useMemo(() => {
    const uri = prof.logo; // may be ipfs://..., CID, http(s), or data:
    return uri ? toHttp(uri) : generatedLogoFor(owner);
  }, [prof.logo, owner]);

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar name={displayName} url={logoUrl}/>
        <div className="min-w-0">
          <div className="font-semibold leading-tight truncate">{displayName}</div>
          <div className="text-xs text-gray-400 font-mono truncate flex items-center gap-2">
            <span>{owner}</span>
            <CopyBtn value={owner}/>
          </div>
        </div>
      </div>

      <div className="ml-3 flex items-center gap-2 shrink-0">
        {isCommish && (
          <span className="text-[11px] px-2 py-0.5 rounded bg-purple-600/20 border border-purple-500/30 text-purple-200">
            Commissioner
          </span>
        )}
        {isYou && (
          <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-200">
            You
          </span>
        )}
      </div>
    </div>
  );
}

export default function MembersPage() {
  const { address: league } = useParams<{ address: `0x${string}` }>();
  const { address: wallet } = useAccount();

  // Header reads
  const { data: leagueName }   = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'name' });
  const { data: commissioner } = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'commissioner' });
  const { data: buyInToken }   = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'buyInToken' });
  const { data: buyInAmount }  = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'buyInAmount' });
  const { data: capData }      = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'teamCap' });

  // Teams (getTeams returns only filled teams)
  const teamsRes = useReadContract({ abi: LEAGUE_ABI, address: league, functionName: 'getTeams' });
  const allTeams = (teamsRes.data as unknown as Team[] | undefined) ?? [];
  const members = useMemo(() => {
    const filtered = allTeams.filter(t => t.owner && t.owner !== ZERO);
    const comm = (commissioner as string | undefined)?.toLowerCase();
    filtered.sort((a,b) => {
      const aIs = comm && a.owner.toLowerCase() === comm ? -1 : 0;
      const bIs = comm && b.owner.toLowerCase() === comm ? -1 : 0;
      if (aIs !== bIs) return aIs - bIs;
      return (a.name || '').toLowerCase() < (b.name || '').toLowerCase() ? -1 : 1;
    });
    return filtered;
  }, [allTeams, commissioner]);

  const teamsJoined = members.length;
  const totalSlots  = (() => {
    const n = capData as unknown as bigint | undefined;
    if (n === undefined) return undefined;
    try { return Number(n); } catch { return undefined; }
  })();

  // Your team tile (top-right) — read GLOBAL
  const { data: myOnChainName } = useReadContract({
    abi: LEAGUE_ABI, address: league, functionName: 'getTeamByAddress',
    args: [wallet ?? ZERO], query: { enabled: !!wallet }
  });
  const myProf = useTeamProfile(league, wallet as `0x${string}` | undefined, { name: (myOnChainName as string) || '' });
  const myDisplayName = (myProf.name || (myOnChainName as string) || '').trim() || undefined;
  const myLogo = useMemo(() => {
    if (!wallet) return undefined;
    return toHttp(myProf.logo) || generatedLogoFor(wallet);
  }, [wallet, myProf.logo]);

  const isNative = (buyInToken as string | undefined)?.toLowerCase() === ZERO.toLowerCase();
  const buyInLabel =
    (buyInAmount as bigint | undefined) && (buyInAmount as bigint) > 0n
      ? (isNative ? formatAvax(buyInAmount as bigint) : `${String(buyInAmount)} (ERC-20)`)
      : 'Free';

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Title bar — centered "Members" + clickable team pill */}
        <div className="grid grid-cols-3 items-start">
          <div />
          <div className="text-center">
            <h1 className="text-3xl font-extrabold">Members</h1>
          </div>

          <div className="justify-self-end">
            {wallet && (
              <a
                href={`/league/${league}/team/${wallet}`}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 hover:bg-white/10 transition"
              >
                <Avatar
                  name={myDisplayName || 'Team'}
                  url={myLogo || generatedLogoFor(wallet)}
                />
                <div className="leading-tight">
                  <div className="text-base font-semibold truncate max-w-[180px]">
                    {(myDisplayName || 'Team').trim()}
                  </div>
                  <div className="text-[11px] text-gray-400 font-mono">
                    {shortAddr(wallet)}
                  </div>
                </div>
              </a>
            )}
          </div>
        </div>

        {/* Summary panel */}
        <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 sm:p-7 shadow-2xl">
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <span className="text-[11px] tracking-[0.2em] text-gray-400">LEAGUE ADDRESS</span>
            <span className="font-mono text-sm text-gray-300">{league}</span>
            <CopyBtn value={league}/>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="COMMISSIONER" value={commissioner ? shortAddr(commissioner as string) : '—'} />
            <StatCard label="BUY-IN"       value={buyInLabel} />
            <StatCard label="TEAMS JOINED" value={teamsJoined} />
            <StatCard label="TOTAL SLOTS"  value={totalSlots ?? '—'} />
          </div>

          <p className="mt-5 text-xs text-gray-400">
            To invite someone, share this league address; they can open <span className="font-semibold text-gray-300">Join League</span> in the app and paste it to join.
          </p>
        </section>

        {/* Members list */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="mb-4 text-lg font-semibold text-center">
            Teams <span className="text-gray-400">({teamsJoined})</span>
          </h2>

          {teamsRes.isLoading ? (
            <p className="text-gray-400 text-sm text-center">Loading members…</p>
          ) : teamsJoined === 0 ? (
            <p className="text-gray-400 text-sm text-center">No teams yet — invite members or create teams.</p>
          ) : (
            <div className="space-y-3">
              {members.map((m) => (
                <MemberRow
                  key={m.owner}
                  league={league}
                  owner={m.owner}
                  fallbackName={m.name}
                  isCommish={!!commissioner && (commissioner as string).toLowerCase() === m.owner.toLowerCase()}
                  isYou={!!wallet && wallet.toLowerCase() === m.owner.toLowerCase()}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
