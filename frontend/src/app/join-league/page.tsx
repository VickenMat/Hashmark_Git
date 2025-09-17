// src/app/join-league/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { keccak256, stringToBytes } from 'viem';
import { toast } from 'react-hot-toast';
import { LEAGUE_ABI } from '@/lib/LeagueContracts';

function formatAvax(wei?: bigint) {
  if (wei === undefined) return '—';
  if (wei === 0n) return 'Free';
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n) + 10n ** 18n;
  const fracStr = frac.toString().slice(1).slice(0, 4);
  return `${whole}.${fracStr} AVAX`;
}

type SummaryTuple =
  | [
      string,          // name
      `0x${string}`,   // buyInToken
      bigint,          // buyInAmount
      bigint,          // teamCap
      bigint,          // teamsFilled
      boolean,         // requiresPassword
      `0x${string}`    // commissioner
    ]
  | null;

/** Inspect ABI to know if password param is bytes32 (hash) or string */
function passwordIsBytes32(methodName: 'joinLeague' | 'createTeam') {
  const item = (LEAGUE_ABI as any[]).find(
    (e) => e?.type === 'function' && e?.name === methodName
  );
  const last = item?.inputs?.[item.inputs.length - 1];
  return String(last?.type || '').toLowerCase() === 'bytes32';
}
function passwordArgFor(methodName: 'joinLeague' | 'createTeam', pw: string) {
  return passwordIsBytes32(methodName)
    ? (keccak256(stringToBytes(pw)) as `0x${string}`)
    : pw;
}

export default function JoinLeaguePage() {
  const router = useRouter();
  const { address: wallet } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });

  const [contractAddress, setContractAddress] = useState('');
  const [teamName, setTeamName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  const addr = contractAddress.trim();
  const addrOk = /^0x[a-fA-F0-9]{40}$/.test(addr);

  const [summary, setSummary] = useState<SummaryTuple>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  // debounce the address
  const [debouncedAddr, setDebouncedAddr] = useState(addr);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedAddr(addr), 250);
    return () => clearTimeout(id);
  }, [addr]);

  // Read getSummary() with robust fallback
  useEffect(() => {
    let cancelled = false;

    async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
      try { return await p; } catch { return fallback; }
    }

    async function fallbackReads(address: `0x${string}`): Promise<SummaryTuple> {
      const name         = await safe(publicClient!.readContract({ abi: LEAGUE_ABI, address, functionName: 'name' }) as Promise<string>, '');
      const buyInToken   = await safe(publicClient!.readContract({ abi: LEAGUE_ABI, address, functionName: 'buyInToken' }) as Promise<`0x${string}`>, '0x0000000000000000000000000000000000000000');
      const buyInAmount  = await safe(publicClient!.readContract({ abi: LEAGUE_ABI, address, functionName: 'buyInAmount' }) as Promise<bigint>, 0n);
      const commissioner = await safe(publicClient!.readContract({ abi: LEAGUE_ABI, address, functionName: 'commissioner' }) as Promise<`0x${string}`>, '0x0000000000000000000000000000000000000000');
      const capBn        = await safe(publicClient!.readContract({ abi: LEAGUE_ABI, address, functionName: 'teamCap' }) as Promise<bigint>, 0n);
      const teams        = await safe(publicClient!.readContract({ abi: LEAGUE_ABI, address, functionName: 'getTeams' }) as Promise<{ owner: `0x${string}`; name: string }[]>, []);
      const requiresPw   = await safe(publicClient!.readContract({ abi: LEAGUE_ABI, address, functionName: 'requiresPassword' }) as Promise<boolean>, false);

      const cap    = capBn;
      const filled = BigInt(teams.filter(t => t.owner && t.owner !== '0x0000000000000000000000000000000000000000').length);
      return [name, buyInToken, buyInAmount, cap, filled, requiresPw, commissioner];
    }

    async function run() {
      if (!addrOk || !publicClient) {
        setSummary(null);
        setReadError(null);
        return;
      }
      setLoading(true);
      setReadError(null);
      try {
        // 0) ensure it’s a contract on this chain
        const code = await publicClient.getBytecode({ address: debouncedAddr as `0x${string}` });
        if (!code) throw new Error('No contract code at this address.');

        // 1) try getSummary()
        try {
          const res = (await publicClient.readContract({
            abi: LEAGUE_ABI,
            address: debouncedAddr as `0x${string}`,
            functionName: 'getSummary',
          })) as SummaryTuple;
          if (!cancelled) setSummary(res);
        } catch {
          // 2) on ANY error, fall back to discrete reads (stronger & more accurate)
          const res = await fallbackReads(debouncedAddr as `0x${string}`);
          if (!cancelled) setSummary(res);
        }
      } catch (e) {
        if (!cancelled) {
          setSummary(null);
          setReadError("Couldn't read league at this address. Make sure the address is a League contract on the current network.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => { cancelled = true; };
  }, [publicClient, debouncedAddr, addrOk, chainId]);

  const leagueName     = summary?.[0] ?? '';
  const buyInToken     = summary?.[1];
  const buyInAmount    = summary?.[2] ?? 0n;
  const teamCap        = summary ? Number(summary[3]) : undefined;
  const needsPassword  = !!summary?.[5];
  const commissioner   = summary?.[6];

  const isFree = buyInAmount === 0n;
  const isNative =
    (buyInToken ?? '0x0000000000000000000000000000000000000000') ===
    '0x0000000000000000000000000000000000000000';

  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const tx = useWaitForTransactionReceipt({ hash: txHash });

  // Redirect to home after success
  useEffect(() => {
    if (tx.isSuccess) {
      router.push('/'); // homescreen
    }
  }, [tx.isSuccess, router]);

  const canSubmit =
    addrOk && teamName.trim().length > 0 &&
    (!needsPassword || password.length > 0) &&
    !tx.isLoading;

  // prettier error messages for password-related failures
  function parsePasswordRevert(err: any): string | null {
    const msg = String(err?.shortMessage || err?.message || '').toLowerCase();
    if (msg.includes('bad password')) return 'Wrong password for this league.';
    // Common revert surfaces (wagon/viem can give generic "execution reverted")
    if (msg.includes('execution reverted') || msg.includes('revert')) {
      // If league requires a password and we had one, assume it’s wrong
      return needsPassword ? 'Wrong password for this league.' : 'Transaction reverted.';
    }
    return null;
  }

  function shakeNow() {
    setShake(true);
    setTimeout(() => setShake(false), 450);
  }

  async function simulateThenSend(
    method: 'joinLeague' | 'createTeam',
    value: bigint
  ) {
    const pwArg = passwordArgFor(method, password);

    // Clear previous inline error
    setPasswordError(null);

    try {
      // 🧪 Preflight simulation (no gas, catches wrong password early)
      await publicClient!.simulateContract({
        abi: LEAGUE_ABI,
        address: addr as `0x${string}`,
        functionName: method,
        args: [teamName.trim(), pwArg as any],
        value,
        account: wallet,
        chain: undefined, // use connected chain
      });
    } catch (err: any) {
      const pretty = parsePasswordRevert(err);
      if (pretty) {
        setPasswordError(pretty);
        toast.error(pretty);
        shakeNow();
        return;
      }
      // Unknown simulation failure
      toast.error(err?.shortMessage || err?.message || 'Simulation failed');
      return;
    }

    try {
      // If simulation passed, send the real tx
      const hash = await writeContractAsync({
        abi: LEAGUE_ABI,
        address: addr as `0x${string}`,
        functionName: method,
        args: [teamName.trim(), pwArg as any],
        value,
      });
      setTxHash(hash);
    } catch (err: any) {
      // Fallback: if user changes password between simulate & send, still parse nicely
      const pretty = parsePasswordRevert(err);
      if (pretty) {
        setPasswordError(pretty);
        toast.error(pretty);
        shakeNow();
        return;
      }
      toast.error(err?.shortMessage || err?.message || 'Transaction failed');
    }
  }

  async function buyNowOrJoinFree() {
    if (!canSubmit || !wallet) return;
    await simulateThenSend('joinLeague', isFree ? 0n : isNative ? buyInAmount : 0n);
  }

  async function joinPayLater() {
    if (!canSubmit || !wallet) return;
    await simulateThenSend('createTeam', 0n);
  }

  const showLeagueInfo = addrOk;

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10 text-white">
      <div className="mb-6">
        <Link href="/" className="text-blue-400 hover:underline">← Back</Link>
      </div>

      <h1 className="mb-8 text-center text-4xl font-extrabold tracking-tight">Join League</h1>

      <div className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-black/40 p-6 shadow-2xl shadow-black/30">
        <label className="mb-4 block">
          <span className="text-sm text-gray-400">League Contract Address</span>
          <input
            value={contractAddress}
            onChange={(e) => setContractAddress(e.target.value)}
            placeholder="0x..."
            className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono outline-none focus:ring-2 focus:ring-fuchsia-400/60"
          />
        </label>

        <label className="mb-6 block">
          <span className="text-sm text-gray-400">Team Name</span>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="e.g. vicken_team1"
            className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 outline-none focus:ring-2 focus:ring-fuchsia-400/60"
          />
        </label>

        {showLeagueInfo && (
          <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center">
            {loading && <div className="py-4 text-sm text-gray-300">Fetching league…</div>}

            {!loading && readError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                {readError}
              </div>
            )}

            {!loading && !readError && summary && (
              <>
                <div className="text-sm uppercase tracking-[0.2em] text-purple-200/80 mb-1">League</div>
                <div className="text-xl font-bold">{leagueName || '—'}</div>
                {commissioner && (
                  <div className="mt-1 text-xs text-gray-400 font-mono">
                    Commissioner: {commissioner}
                  </div>
                )}

                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="text-xs text-gray-400">Buy-In</div>
                    <div className="mt-1 font-semibold">
                      {isNative ? formatAvax(buyInAmount) : buyInAmount === 0n ? 'Free' : 'ERC-20'}
                    </div>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="text-xs text-gray-400">Teams</div>
                    <div className="mt-1 font-semibold">
                      {typeof teamCap === 'number' && !Number.isNaN(teamCap) ? teamCap : '—'}
                    </div>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-black/30 p-3 col-span-2 sm:col-span-1">
                    <div className="text-xs text-gray-400">Requires Password</div>
                    <div className="mt-1 font-semibold">{needsPassword ? 'Yes' : 'No'}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {showLeagueInfo && (
          <div className="mb-6">
            <label className="block">
              <span className="text-sm text-gray-400">
                {needsPassword ? 'Password (required)' : 'Password'}
              </span>
              <div className={`mt-1 flex items-center gap-2 ${shake ? 'animate-[shake_0.45s_ease-in-out_1]' : ''}`}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordError(null); }}
                  placeholder={needsPassword ? 'Enter league password' : 'Enter password (if needed)'}
                  className={`w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-fuchsia-400/60
                    ${passwordError ? 'border-red-500/60 bg-red-500/5' : 'border-white/15 bg-white/5'}
                  `}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:border-fuchsia-400/60"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {passwordError && (
                <div className="mt-1 text-xs text-red-300">{passwordError}</div>
              )}
            </label>
          </div>
        )}

        <div className="text-center">
          {isFree || !showLeagueInfo ? (
            <button
              disabled={!showLeagueInfo || !canSubmit}
              onClick={buyNowOrJoinFree}
              className="w-full rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 px-5 py-3 font-semibold shadow-lg shadow-fuchsia-500/25 disabled:opacity-40"
            >
              Join
            </button>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                disabled={!canSubmit || !isNative}
                onClick={buyNowOrJoinFree}
                className="rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 px-5 py-3 font-semibold shadow-lg shadow-fuchsia-500/25 disabled:opacity-40"
              >
                Buy in now ({isNative ? formatAvax(buyInAmount) : 'ERC-20'})
              </button>
              <button
                disabled={!canSubmit}
                onClick={joinPayLater}
                className="rounded-xl border border-white/15 bg-white/5 px-5 py-3 font-semibold hover:border-fuchsia-400/60 disabled:opacity-40"
              >
                Join &amp; pay later
              </button>
            </div>
          )}

          {txHash && (
            <div className="mt-3 text-sm text-gray-300">
              {tx.isLoading ? 'Confirming transaction…'
                : tx.isSuccess ? 'Joined!'
                : tx.isError ? 'Transaction failed'
                : 'Sent…'}{' '}
              <a
                className="text-blue-400 hover:underline"
                href={`https://testnet.snowtrace.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View on Snowtrace →
              </a>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Tip: Native AVAX buy-ins send AVAX with the join transaction. ERC-20 buy-ins require token approval first.
        </p>
      </div>

      {/* tiny keyframes for password shake */}
      <style jsx>{`
        @keyframes shake {
          10%, 90% { transform: translateX(-1px); }
          20%, 80% { transform: translateX(2px); }
          30%, 50%, 70% { transform: translateX(-4px); }
          40%, 60% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
