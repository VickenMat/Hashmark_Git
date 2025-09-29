// src/app/create-league/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
} from 'wagmi';
import {
  parseEther,
  keccak256,
  toBytes,
  type Hex,
  parseEventLogs,
} from 'viem';
import { toast } from 'react-hot-toast';
import {
  LEAGUE_FACTORY_ABI,
  LEAGUE_FACTORY_ADDRESS,        // legacy fallback
  LEAGUE_ABI,
  factoryAddressForChain,       // pick factory per network
} from '@/lib/LeagueContracts';

const ZIMA = '#37c0f6';
const EGGSHELL = '#F0EAD6';
const MIN_BUYIN_AVAX = '0.001'; // validation only (no visible hint)

const SETPW_BYTES32_ABI = [
  {
    type: 'function',
    name: 'setJoinPassword',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'passwordHash', type: 'bytes32' }],
    outputs: [],
  },
] as const;

export default function CreateLeaguePage() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [name, setName] = useState('');
  const [isFree, setIsFree] = useState(true);
  const [buyIn, setBuyIn] = useState('');
  const [teamCount, setTeamCount] = useState<number | null>(null);
  const [avaxPrice, setAvaxPrice] = useState<number | null>(null);

  const [wantsPassword, setWantsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPwHelp, setShowPwHelp] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const teamOptions = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];

  // Select correct factory by network; fallback to legacy address if present
  const factory = useMemo<`0x${string}` | undefined>(() => {
    const selected =
      (factoryAddressForChain?.(chainId) as `0x${string}` | undefined) ??
      (LEAGUE_FACTORY_ADDRESS as `0x${string}` | undefined);
    return selected;
  }, [chainId]);

  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    (async function loop() {
      try {
        const res = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=avalanche-2&vs_currencies=usd'
        );
        const data = await res.json();
        setAvaxPrice(data['avalanche-2']?.usd ?? null);
      } catch {}
      id = setTimeout(loop, 30_000);
    })();
    return () => id && clearTimeout(id);
  }, []);

  const handleBuyInChange = (v: string) => {
    const cleaned = v.replace(/[^\d.]/g, '');
    const parts = cleaned.split('.');
    const normalized =
      parts.length <= 2 ? cleaned : `${parts[0]}.${parts.slice(1).join('')}`;
    setBuyIn(normalized);
  };

  /** Resolve new league address robustly: receipt logs → recent factory logs → getLeagues() */
  async function resolveNewLeagueAddress(
    receipt: any,
    creator: `0x${string}`
  ): Promise<`0x${string}` | undefined> {
    if (!publicClient || !factory) return;

    // 1) parse from receipt logs
    if (receipt?.logs?.length) {
      try {
        const parsed = parseEventLogs({
          abi: LEAGUE_FACTORY_ABI as any,
          logs: receipt.logs,
          eventName: 'LeagueCreated',
          strict: false,
        });
        if (parsed.length) {
          const args = parsed[0].args as any;
          const candidate = (args.leagueAddress ||
            args.league ||
            args.leagueAddr) as `0x${string}`;
          if (candidate) return candidate;
        }
      } catch {}
    }

    // 2) scan recent logs on the factory and validate by reading commissioner
    try {
      const latest = await publicClient.getBlockNumber();
      const fromBlock = latest > 1200n ? latest - 1200n : 0n;
      const rawLogs = await publicClient.getLogs({
        address: factory,
        fromBlock,
        toBlock: latest,
      });

      const decoded = parseEventLogs({
        abi: LEAGUE_FACTORY_ABI as any,
        logs: rawLogs,
        eventName: 'LeagueCreated',
        strict: false,
      });

      for (let i = decoded.length - 1; i >= 0; i--) {
        const args = decoded[i].args as any;
        const candidate = (args.leagueAddress ||
          args.league ||
          args.leagueAddr) as `0x${string}` | undefined;
        if (!candidate) continue;
        try {
          const comm = (await publicClient.readContract({
            abi: LEAGUE_ABI,
            address: candidate,
            functionName: 'commissioner',
          })) as `0x${string}`;
          if (comm.toLowerCase() === creator.toLowerCase()) return candidate;
        } catch {}
      }
    } catch {}

    // 3) last resort: take last from getLeagues()
    try {
      const list = (await publicClient.readContract({
        address: factory,
        abi: LEAGUE_FACTORY_ABI,
        functionName: 'getLeagues',
      })) as `0x${string}`[];
      return list?.[list.length - 1];
    } catch {}

    return;
  }

  const handleSubmit = async () => {
    if (submitting) return;
    if (!address) {
      toast.error('Connect your wallet first');
      return;
    }
    if (!factory) {
      toast.error('No LeagueFactory configured for this network.');
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 32) {
      toast.error('League name is required (max 32 chars)');
      return;
    }
    if (!teamCount) {
      toast.error('Select number of teams');
      return;
    }

    let buyInAmount = 0n;
    if (!isFree) {
      const f = Number(buyIn);
      if (!Number.isFinite(f)) {
        toast.error('Enter a valid buy-in');
        return;
      }
      if (f < parseFloat(MIN_BUYIN_AVAX)) {
        toast.error('You must enter at least 0.001 AVAX.');
        return;
      }
      const decimals = (buyIn.split('.')[1]?.length ?? 0);
      if (decimals > 18) {
        toast.error('Max 18 decimal places for AVAX amount.');
        return;
      }
      try {
        buyInAmount = parseEther(buyIn);
      } catch {
        toast.error('Invalid buy-in amount');
        return;
      }
    }

    const pw = password.trim();
    if (wantsPassword && pw.length === 0) {
      toast.error('Enter a password or turn off "Require Password".');
      return;
    }

    const toastId = toast.loading('Creating league…');
    setSubmitting(true);

    try {
      // 1) send tx
      let txHash = await writeContractAsync({
        address: factory,
        abi: LEAGUE_FACTORY_ABI,
        functionName: 'createLeague',
        args: [trimmedName, buyInAmount, BigInt(teamCount)],
        account: address,
      });

      // 2) wait for receipt robustly (handles speed-ups, timeouts)
      let receipt: any | undefined;
      try {
        receipt = await publicClient!.waitForTransactionReceipt({
          hash: txHash as Hex,
          timeout: 180_000,        // 3 minutes
          pollingInterval: 1500,
          includeReplaced: 'confirmed',
          onReplaced: (r) => {
            txHash = r.transaction.hash as Hex;
          },
        });
      } catch (e: any) {
        // If it’s a timeout, we’ll try to recover by scanning logs below
        if (e?.name !== 'WaitForTransactionReceiptTimeoutError') throw e;
      }

      // 3) resolve new league address (receipt → logs → getLeagues)
      const newLeague = await resolveNewLeagueAddress(
        receipt,
        address as `0x${string}`
      );
      if (!newLeague) {
        const base =
          chainId === 43114
            ? 'https://snowtrace.io/tx/'
            : 'https://testnet.snowtrace.io/tx/';
        throw new Error(
          `Could not determine new league address yet. Tx: ${base}${txHash}`
        );
      }

      // 4) sanity: ensure commissioner is the creator
      const commissioner = (await publicClient!.readContract({
        abi: LEAGUE_ABI,
        address: newLeague,
        functionName: 'commissioner',
      })) as `0x${string}`;
      if (commissioner.toLowerCase() !== address.toLowerCase()) {
        toast.error(
          'This wallet is not the league commissioner; cannot set the password.',
          { id: toastId }
        );
        window.location.href = '/';
        return;
      }

      // 5) optional: set join password
      if (wantsPassword) {
        const pwdHash = keccak256(toBytes(pw)) as Hex;
        const sim = await publicClient!.simulateContract({
          address: newLeague,
          abi: SETPW_BYTES32_ABI,
          functionName: 'setJoinPassword',
          args: [pwdHash],
          account: address,
        });
        const pwdTx = await writeContractAsync(sim.request);
        await publicClient!.waitForTransactionReceipt({
          hash: pwdTx as Hex,
          timeout: 90_000,
          pollingInterval: 1500,
        });
      }

      // 6) success UX
      try {
        await navigator.clipboard.writeText(newLeague);
      } catch {}
      toast.success('✅ League created!', { id: toastId });
      toast(
        () => (
          <span>
            New League:{' '}
            <code style={{ fontFamily: 'mono' }}>{newLeague}</code>{' '}
            <a
              href={`${
                chainId === 43114
                  ? 'https://snowtrace.io/address/'
                  : 'https://testnet.snowtrace.io/address/'
              }${newLeague}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: ZIMA, marginLeft: 8 }}
            >
              View on Snowtrace →
            </a>
          </span>
        ),
        { duration: 6000 }
      );

      window.location.href = '/';
    } catch (err: any) {
      console.error(err);
      const msg =
        err?.shortMessage ||
        err?.cause?.reason ||
        err?.details ||
        err?.message ||
        'Transaction failed';
      const hint = msg.includes('Could not determine new league address')
        ? ' (RPC may be slow; it will show up shortly)'
        : '';
      toast.error(msg + hint);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen px-4 sm:px-6 py-10"
      style={{
        backgroundImage: 'linear-gradient(to bottom right, #0b0b14, #000000)',
        color: EGGSHELL,
      }}
    >
      <h1
        className="mb-3 text-center text-4xl font-extrabold tracking-tight"
        style={{ color: ZIMA }}
      >
        Create League
      </h1>

      {avaxPrice && (
        <div className="mb-6 text-center">
          <span
            className="inline-flex items-center rounded-full border px-3 py-1 text-xs"
            style={{
              borderColor: 'rgba(255,255,255,.15)',
              background: 'rgba(255,255,255,.05)',
            }}
          >
            AVAX price •{' '}
            <span className="ml-1 font-semibold" style={{ color: ZIMA }}>
              ${avaxPrice.toFixed(2)}
            </span>
          </span>
        </div>
      )}

      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-black/30 p-5 shadow-2xl shadow-black/30">
        {/* League Name */}
        <div className="mb-5 text-center">
          <label className="mb-2 block text-sm" style={{ color: EGGSHELL }}>
            League Name
          </label>
          <div className="mx-auto flex w-full max-w-md items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) =>
                setName(e.target.value.slice(0, 32)) // enforce 32 chars
              }
              maxLength={32}
              placeholder="e.g. Sunday Legends"
              className="block w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 outline-none focus:ring-2"
              style={{ color: EGGSHELL }}
            />
            <span className="text-[11px] opacity-60">
              {name.length}/32
            </span>
          </div>
        </div>

        {/* Buy-In toggle */}
        <div className={`text-center ${isFree ? 'mb-6' : 'mb-2'}`}>
          <div className="mb-2 text-sm" style={{ color: EGGSHELL }}>
            Buy-In
          </div>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsFree(true);
                setBuyIn('');
              }}
              className="rounded-xl px-4 py-2 font-semibold"
              style={{
                background: isFree ? ZIMA : 'transparent',
                color: isFree ? '#0b0b14' : EGGSHELL,
                border: `1px solid ${isFree ? ZIMA : 'rgba(255,255,255,.15)'}`,
              }}
            >
              Free
            </button>
            <button
              type="button"
              onClick={() => setIsFree(false)}
              className="rounded-xl px-4 py-2 font-semibold"
              style={{
                background: !isFree ? ZIMA : 'transparent',
                color: !isFree ? '#0b0b14' : EGGSHELL,
                border: `1px solid ${!isFree ? ZIMA : 'rgba(255,255,255,.15)'}`,
              }}
            >
              Buy-In
            </button>
          </div>
        </div>

        {/* Buy-In amount */}
        {!isFree && (
          <div className="mb-5 text-center">
            <div className="mx-auto w-full max-w-md">
              <label className="mb-2 block text-sm" style={{ color: EGGSHELL }}>
                Amount (AVAX)
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="< 0.001 AVAX"
                value={buyIn}
                onChange={(e) => handleBuyInChange(e.target.value)}
                className="block w-full rounded-xl border px-3 py-2 outline-none focus:ring-2"
                style={{
                  color: EGGSHELL,
                  borderColor: ZIMA,
                  background: 'rgba(255,255,255,.04)',
                }}
              />
            </div>
          </div>
        )}

        {/* Team count */}
        <div className="mb-5 text-center">
          <div className="mb-2 text-sm" style={{ color: EGGSHELL }}>
            Number of Teams
          </div>
          <div className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-2 overflow-x-auto whitespace-nowrap">
            {teamOptions.map((n) => (
              <button
                key={n}
                onClick={() => setTeamCount(n)}
                className="rounded-xl border px-3 py-1.5 text-sm font-medium"
                style={{
                  borderColor:
                    teamCount === n ? ZIMA : 'rgba(255,255,255,.15)',
                  background:
                    teamCount === n
                      ? 'rgba(55,192,246,.15)'
                      : 'rgba(255,255,255,.04)',
                  color: EGGSHELL,
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Password */}
        <div className="mb-5 text-center">
          <div className="mb-2 text-sm" style={{ color: EGGSHELL }}>
            Password
          </div>

          <div className="mb-2 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setWantsPassword((v) => !v)}
              className="rounded-xl px-4 py-2 font-semibold"
              style={{
                background: wantsPassword ? ZIMA : 'transparent',
                color: wantsPassword ? '#0b0b14' : EGGSHELL,
                border: `1px solid ${
                  wantsPassword ? ZIMA : 'rgba(255,255,255,.15)'
                }`,
              }}
            >
              {wantsPassword ? 'Require Password ✓' : 'Require Password'}
            </button>
            <button
              type="button"
              onClick={() => setShowPwHelp((v) => !v)}
              title="What does this do?"
              className="grid h-8 w-8 place-items-center rounded-full border text-xs"
              style={{
                borderColor: 'rgba(255,255,255,.2)',
                background: 'rgba(255,255,255,.06)',
                color: EGGSHELL,
              }}
            >
              ?
            </button>
          </div>

          {showPwHelp && (
            <div className="mx-auto mb-2 max-w-md rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs">
              If enabled, players must enter a password to join. The contract
              validates the password hash on-chain.
            </div>
          )}

          {wantsPassword && (
            <div className="mx-auto flex w-full max-w-md items-center gap-2">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter league password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="flex-1 rounded-xl border px-3 py-2 outline-none focus:ring-2"
                style={{
                  color: EGGSHELL,
                  borderColor: ZIMA,
                  background: 'rgba(255,255,255,.04)',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="rounded-lg border px-3 py-2 text-sm hover:opacity-90"
                style={{
                  borderColor: 'rgba(255,255,255,.15)',
                  background: 'rgba(255,255,255,.05)',
                  color: EGGSHELL,
                }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex justify-center">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-1 w-full max-w-sm rounded-xl px-6 py-3 font-bold transition disabled:opacity-50"
            style={{ backgroundColor: ZIMA, color: '#0b0b14' }}
          >
            {submitting ? 'Creating…' : 'Create League'}
          </button>
        </div>
      </div>
    </div>
  );
}
