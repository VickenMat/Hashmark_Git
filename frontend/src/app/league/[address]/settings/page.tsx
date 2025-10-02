// src/app/league/[address]/settings/page.tsx
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAccount, useReadContracts } from 'wagmi';
import { useMemo } from 'react';

/* ------------ ABI (subset of your League.sol) ------------ */
const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'buyInAmount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'buyInToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'getTeams',
    stateMutability: 'view',
    inputs: [],
    outputs: [{
      type: 'tuple[]',
      components: [
        { name: 'owner', type: 'address' },
        { name: 'name', type: 'string' },
      ],
    }],
  },
  {
    type: 'function',
    name: 'getDraftSettings',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }, { type: 'uint64' }, { type: 'uint8' }, { type: 'bool' }, { type: 'address[]' }],
  },
  { type: 'function', name: 'teamCap', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'commissioner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'requiresPassword', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'escrowBalances', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
  { type: 'function', name: 'hasPaid', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'outstandingOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const DraftTypeLabel = ['Snake', 'Salary Cap', 'Autopick', 'Offline'] as const;
const OrderModeLabel = ['Random', 'Manual'] as const;
const ZERO = '0x0000000000000000000000000000000000000000';

/* ---------------- helpers ---------------- */
function formatAvax(wei?: bigint) {
  if (wei === undefined) return '—';
  if (wei === 0n) return 'Free';
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n) + 10n ** 18n;
  const fracStr = frac.toString().slice(1).slice(0, 4);
  return `${whole}.${fracStr} AVAX`;
}
function truncateMiddle(s?: string, left = 6, right = 4) {
  if (!s) return '—';
  if (s.length <= left + right + 3) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}
function num(x: unknown): number | undefined {
  if (x === null || x === undefined) return undefined;
  const n = Number(x as any);
  return Number.isFinite(n) ? n : undefined;
}

/* ---------------- page ---------------- */
export default function LeagueSettings() {
  const { address } = useParams<{ address: `0x${string}` }>();
  const { address: wallet } = useAccount();

  // Primary reads (same set you showed, safe to keep)
  const primary = useReadContracts({
    contracts: [
      { abi: LEAGUE_ABI, address, functionName: 'name' },
      { abi: LEAGUE_ABI, address, functionName: 'buyInAmount' },
      { abi: LEAGUE_ABI, address, functionName: 'buyInToken' },
      { abi: LEAGUE_ABI, address, functionName: 'getTeams' },
      { abi: LEAGUE_ABI, address, functionName: 'getDraftSettings' },
      { abi: LEAGUE_ABI, address, functionName: 'teamCap' },
      { abi: LEAGUE_ABI, address, functionName: 'commissioner' },
      { abi: LEAGUE_ABI, address, functionName: 'requiresPassword' },
      { abi: LEAGUE_ABI, address, functionName: 'escrowBalances' },
      ...(wallet ? [{ abi: LEAGUE_ABI, address, functionName: 'hasPaid' as const, args: [wallet] }] : []),
      ...(wallet ? [{ abi: LEAGUE_ABI, address, functionName: 'outstandingOf' as const, args: [wallet] }] : []),
    ],
  });

  const name        = primary.data?.[0]?.result as string | undefined;
  const buyIn       = primary.data?.[1]?.result as bigint | undefined;
  const buyInToken  = primary.data?.[2]?.result as `0x${string}` | undefined;
  const teams       = (primary.data?.[3]?.result as { owner: `0x${string}`; name: string }[] | undefined) ?? [];
  const draftTuple  =
    (primary.data?.[4]?.result as [number, bigint, number, boolean, `0x${string}`[]] | undefined) ??
    (undefined as unknown as [number, bigint, number, boolean, `0x${string}`[]]);
  const cap         = Number((primary.data?.[5]?.result as bigint | undefined) ?? 0n);
  const commish     = primary.data?.[6]?.result as `0x${string}` | undefined;
  const passwordReq = Boolean(primary.data?.[7]?.result as boolean | undefined);
  const escrow      = primary.data?.[8]?.result as readonly [bigint, bigint] | undefined;
  const youPaid     = wallet ? (primary.data?.[9]?.result as boolean | undefined) : undefined;
  const youOweWei   = wallet ? (primary.data?.[10]?.result as bigint | undefined) : undefined;

  const draftTypeIdx = draftTuple?.[0] ?? 0;
  const draftTs      = Number(draftTuple?.[1] ?? 0n);
  const orderModeIdx = draftTuple?.[2] ?? 0;
  const draftDone    = Boolean(draftTuple?.[3] ?? false);
  const manualOrder  = (draftTuple?.[4] ?? []) as `0x${string}`[];

  const filled  = teams.length; // getTeams() returns only filled teams
  const isFree  = (buyIn ?? 0n) === 0n;

  // Per-team hasPaid()
  const teamHasPaidReads = useMemo(
    () => teams.map(t => ({ abi: LEAGUE_ABI, address, functionName: 'hasPaid' as const, args: [t.owner] })),
    [address, teams]
  );
  const teamPaidRes = useReadContracts({
    contracts: teamHasPaidReads,
    query: { enabled: teamHasPaidReads.length > 0 },
  });
  const paidCount = useMemo(
    () => (teamPaidRes.data ? teamPaidRes.data.reduce((n, r) => n + ((r?.result as boolean) ? 1 : 0), 0) : 0),
    [teamPaidRes.data]
  );

  const draftStatus = draftDone ? 'Completed' : draftTs === 0 ? 'Not scheduled' : 'Scheduled';
  const paymentsPct = isFree ? 100 : (filled > 0 ? Math.round((paidCount / filled) * 100) : 0);
  const fullnessPct = cap > 0 ? Math.round((filled / cap) * 100) : 0;

  const copy = (txt: string) => navigator.clipboard.writeText(txt);

  // Commissioner check
  const isCommissioner = !!(wallet && commish && wallet.toLowerCase() === commish.toLowerCase());

  /* ---------------- Derived "LM" settings (read-only) ----------------
     If/when you add a real LM struct read, just assign it to `lm`.
     Keeping this optional avoids crashes and fixes ?? + || precedence. */
  const lm: Partial<{
    leagueName: string;
    numberOfTeams: number | bigint;
    waiverType: number | bigint;
    waiverBudget: number | bigint;
    waiverMinBid: number | bigint;
  }> | undefined = undefined; // <-- replace when you have a contract read

  const lmLeagueName: string = (lm?.leagueName ?? '') as string;

  // Prefer explicit value from lm.numberOfTeams; else fall back to teams.length; if final is falsy -> '—'
  const lmTeams: string | number = ((num(lm?.numberOfTeams) ?? teams.length) || '—');

  const waiverTypeIndex = (num(lm?.waiverType) ?? 0);
  const WAIVER_TYPE_LABELS: Record<number, string> = { 0: 'Rolling', 1: 'Reverse standings', 2: 'FAAB' };
  const lmWaiverType: string = WAIVER_TYPE_LABELS[waiverTypeIndex] ?? '—';

  const lmFaabBudget = Number(lm?.waiverBudget ?? 0);
  const lmMinBid = Number(lm?.waiverMinBid ?? 0);

  /* ---------------- render ---------------- */
  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0b0b14] to-black text-white px-6 py-10">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <h1 className="text-center text-4xl font-extrabold tracking-tight">{name || 'League Settings'}</h1>
        <div className="mt-1 flex items-center justify-center gap-2 text-xs sm:text-sm text-gray-300">
          <code className="font-mono break-all">{address}</code>
          <button
            onClick={() => copy(address)}
            className="rounded-md border border-white/10 bg-white/10 px-2 py-1 hover:bg-white/15"
          >
            Copy
          </button>
        </div>

        {/* Quick Stats */}
        <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SmallStat title="Buy-In" value={formatAvax(buyIn)} centered />
          <SmallStat title="Teams" value={`${filled}/${cap || '—'}`} centered />
          <SmallStat title="Draft Status" value={draftStatus} centered />
        </div>

        {/* Progress */}
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <ProgressCard
            title="Payments"
            rightLabel={isFree ? 'Free' : `${paidCount}/${filled} (${paymentsPct}%)`}
            pct={isFree ? 100 : paymentsPct}
            barClass={isFree ? 'bg-emerald-400' : 'bg-gradient-to-r from-emerald-400 to-emerald-500'}
          />
          {!draftDone && (
            <ProgressCard
              title="League Fullness"
              rightLabel={`${filled}/${cap} (${fullnessPct}%)`}
              pct={fullnessPct}
              barClass="bg-gradient-to-r from-sky-400 to-blue-500"
            />
          )}
        </div>

        {/* Draft settings (centered) */}
        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
          <h2 className="mb-3 text-lg font-bold">Draft Settings</h2>
          <div className="text-sm text-gray-300 space-y-1">
            <div><span className="text-gray-400">Type: </span>{DraftTypeLabel[draftTypeIdx] ?? '—'}</div>
            <div><span className="text-gray-400">Order: </span>{OrderModeLabel[orderModeIdx] ?? '—'}</div>
            <div>
              <span className="text-gray-400">Date &amp; Time: </span>
              {draftTs ? new Date(draftTs * 1000).toLocaleString() : '—'}
            </div>
            {orderModeIdx === 1 && manualOrder.length > 0 && (
              <div className="pt-2">
                <span className="text-gray-400">Manual Order:</span>
                <div className="mt-2 inline-block text-left">
                  <ol className="ml-6 list-decimal space-y-1">
                    {manualOrder.map((addr, i) => {
                      const t = teams.find(tt => tt.owner.toLowerCase() === addr.toLowerCase());
                      return <li key={`${addr}-${i}`}>{t?.name || addr}</li>;
                    })}
                  </ol>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* League info + Your status */}
        <section className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h3 className="mb-3 text-center font-bold">League Info</h3>
            <div className="space-y-2 text-sm text-gray-300">
              <Row label="Commissioner" labelClass="w-24">
                <span className="font-mono">{truncateMiddle(commish)}</span>
                {commish && (
                  <button
                    onClick={() => copy(commish)}
                    className="ml-2 rounded border border-white/10 bg-white/10 px-2 py-0.5 text-xs hover:bg-white/15"
                  >
                    Copy
                  </button>
                )}
              </Row>
              <Row label="Password" labelClass="w-24"><span>{passwordReq ? 'Required' : 'Not required'}</span></Row>
              <Row label="Buy-In token" labelClass="w-24"><span>{(buyInToken ?? ZERO) === ZERO ? 'AVAX' : buyInToken}</span></Row>
              <Row label="Escrow (native)" labelClass="w-24"><span>{formatAvax(escrow?.[0])}</span></Row>
              {(buyInToken ?? ZERO) !== ZERO && (
                <Row label="Escrow (token)" labelClass="w-24"><span>{`${escrow?.[1] ?? 0n} wei`}</span></Row>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h3 className="mb-3 text-center font-bold">Your Status</h3>
            {wallet ? (
              <div className="space-y-2 text-sm text-gray-300">
                <Row label="Wallet" labelClass="w-24">
                  <span className="font-mono">{truncateMiddle(wallet)}</span>
                  <button
                    onClick={() => copy(wallet)}
                    className="ml-2 rounded border border-white/10 bg-white/10 px-2 py-0.5 text-xs hover:bg-white/15"
                  >
                    Copy
                  </button>
                </Row>
                <Row label="Membership" labelClass="w-24">
                  <span>{teams.some(t => t.owner.toLowerCase() === wallet.toLowerCase()) ? 'Member' : '—'}</span>
                </Row>
                <Row label="Payment" labelClass="w-24">
                  <span>
                    {isFree ? 'Free' : youPaid ? 'Paid' : youOweWei && youOweWei > 0n ? `Owes ${formatAvax(youOweWei)}` : '—'}
                  </span>
                </Row>
              </div>
            ) : (
              <p className="text-center text-gray-400">Connect your wallet to see your status.</p>
            )}
          </div>
        </section>

        {/* Derived LM Settings block (read-only preview) */}
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h3 className="mb-3 text-center font-bold">League Manager Settings</h3>
          <div className="space-y-2 text-sm text-gray-300">
            <Row label="League Name" labelClass="w-36"><span>{lmLeagueName || '—'}</span></Row>
            <Row label="Number of Teams" labelClass="w-36"><span>{lmTeams}</span></Row>
            <Row label="Waiver Type" labelClass="w-36"><span>{lmWaiverType}</span></Row>
            <Row label="FAAB Budget" labelClass="w-36"><span>{lmFaabBudget ? `${lmFaabBudget}` : '—'}</span></Row>
            <Row label="Min Bid" labelClass="w-36"><span>{lmMinBid ? `${lmMinBid}` : '—'}</span></Row>
          </div>
        </section>

        {/* Actions */}
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href={`/league/${address}/my-team`}
            className="rounded-xl bg-purple-600 hover:bg-purple-700 px-4 py-2 font-semibold"
          >
            Go to My Team
          </Link>

          {isCommissioner ? (
            <Link
              href={`/league/${address}/draft-settings`}
              className="rounded-xl border border-purple-500/60 hover:border-purple-400 px-4 py-2 font-semibold text-purple-200"
            >
              Edit Draft Settings
            </Link>
          ) : (
            <Link
              href={`/league/${address}/members`}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 font-semibold hover:border-white/25"
            >
              League Members
            </Link>
          )}

          <a
            href={`https://testnet.snowtrace.io/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 font-semibold text-blue-300 hover:border-blue-400"
          >
            Snowtrace →
          </a>
        </div>
      </div>
    </main>
  );
}

/* ---------------- presentational helpers ---------------- */
function SmallStat({ title, value, centered = false }: { title: string; value: string; centered?: boolean }) {
  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 ${centered ? 'text-center' : ''}`}>
      <div className="text-xs text-gray-400">{title}</div>
      <div className="text-base font-bold">{value}</div>
    </div>
  );
}
function Row({
  label,
  children,
  labelClass = 'w-28',
}: {
  label: string;
  children: React.ReactNode;
  labelClass?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`${labelClass} shrink-0 text-gray-400`}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
function ProgressCard({
  title,
  rightLabel,
  pct,
  barClass,
}: {
  title: string;
  rightLabel: string;
  pct: number;
  barClass: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
        <span>{title}</span>
        <span>{rightLabel}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-white/10">
        <div className={`h-2 rounded-full ${barClass}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}
