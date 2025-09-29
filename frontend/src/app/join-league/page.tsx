// src/app/join-league/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
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

/* ------------------- Theme ------------------- */
const ZIMA = '#37c0f6';
const EGGSHELL = '#F0EAD6';

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

/* ------------------- Team name generator ------------------- */
function randomTeamName(seed?: number) {
  const adj = [
    'Electric','Savage','Icy','Crimson','Silent','Prime','Solar','Noisy',
    'Lucky','Golden','Quantum','Turbo','Wired','Swift','Blitz','Stealthy'
  ];
  const beasts = [
    'Dragons','Wolves','Titans','Raptors','Cyclones','Stallions',
    'Cobras','Falcons','Badgers','Rhinos','Hawks','Sharks','Phoenix'
  ];
  const n = (seed ?? Math.floor(Math.random() * 1e9));
  const a = adj[n % adj.length];
  const b = beasts[(n >> 4) % beasts.length];
  const num = (n % 999) + 1;
  return `${a}${b}${num}`;
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
        const code = await publicClient.getBytecode({ address: debouncedAddr as `0x${string}` });
        if (!code) throw new Error('No contract code at this address.');

        try {
          const res = (await publicClient.readContract({
            abi: LEAGUE_ABI,
            address: debouncedAddr as `0x${string}`,
            functionName: 'getSummary',
          })) as SummaryTuple;
          if (!cancelled) setSummary(res);
        } catch {
          const res = await fallbackReads(debouncedAddr as `0x${string}`);
          if (!cancelled) setSummary(res);
        }
      } catch {
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

  useEffect(() => {
    if (tx.isSuccess) {
      router.push('/');
    }
  }, [tx.isSuccess, router]);

  const canSubmit =
    addrOk && teamName.trim().length > 0 &&
    (!needsPassword || password.length > 0) &&
    !tx.isLoading;

  function parsePasswordRevert(err: any): string | null {
    const msg = String(err?.shortMessage || err?.message || '').toLowerCase();
    if (msg.includes('bad password')) return 'Wrong password for this league.';
    if (msg.includes('execution reverted') || msg.includes('revert')) {
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
    setPasswordError(null);

    try {
      await publicClient!.simulateContract({
        abi: LEAGUE_ABI,
        address: addr as `0x${string}`,
        functionName: method,
        args: [teamName.trim(), pwArg as any],
        value,
        account: wallet,
        chain: undefined,
      });
    } catch (err: any) {
      const pretty = parsePasswordRevert(err);
      if (pretty) {
        setPasswordError(pretty);
        toast.error(pretty);
        shakeNow();
        return;
      }
      toast.error(err?.shortMessage || err?.message || 'Simulation failed');
      return;
    }

    try {
      const hash = await writeContractAsync({
        abi: LEAGUE_ABI,
        address: addr as `0x${string}`,
        functionName: method,
        args: [teamName.trim(), pwArg as any],
        value,
      });
      setTxHash(hash);
    } catch (err: any) {
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

  const buyNowOrJoinFree = async () => {
    if (!canSubmit || !wallet) return;
    await simulateThenSend('joinLeague', isFree ? 0n : isNative ? buyInAmount : 0n);
  };

  const joinPayLater = async () => {
    if (!canSubmit || !wallet) return;
    await simulateThenSend('createTeam', 0n);
  };

  const showLeagueInfo = addrOk;
  const copy = (text: string) => navigator.clipboard.writeText(text);

  const leagueHeader = useMemo(() => {
    if (!showLeagueInfo || loading || readError || !summary) return null;
    return (
      <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center">
        {/* Removed the small "LEAGUE" label per request; show name in Zima */}
        <div className="text-xl font-extrabold" style={{ color: ZIMA }}>
          {leagueName || '—'}
        </div>
        {commissioner && (
          <div className="mt-1 text-xs font-mono opacity-80" style={{ color: EGGSHELL }}>
            Commissioner: {commissioner}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <div className="text-xs opacity-80" style={{ color: EGGSHELL }}>Buy-In</div>
            <div className="mt-1 font-semibold" style={{ color: EGGSHELL }}>
              {isNative ? formatAvax(buyInAmount) : buyInAmount === 0n ? 'Free' : 'ERC-20'}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <div className="text-xs opacity-80" style={{ color: EGGSHELL }}>Teams</div>
            <div className="mt-1 font-semibold" style={{ color: EGGSHELL }}>
              {typeof teamCap === 'number' && !Number.isNaN(teamCap) ? teamCap : '—'}
            </div>
          </div>

          <div className="col-span-2 rounded-lg border border-white/10 bg-black/30 p-3 sm:col-span-1">
            <div className="text-xs opacity-80" style={{ color: EGGSHELL }}>Requires Password</div>
            <div className="mt-1 font-semibold" style={{ color: EGGSHELL }}>{summary?.[5] ? 'Yes' : 'No'}</div>
          </div>
        </div>
      </div>
    );
  }, [showLeagueInfo, loading, readError, summary, leagueName, commissioner, isNative, buyInAmount, teamCap]);

  return (
    <div
      className="relative mx-auto max-w-3xl px-4 sm:px-6 py-10"
      style={{ color: EGGSHELL }}
    >
      {/* Back button pinned top-left of the page */}
      <Link
        href="/"
        className="absolute left-4 top-4 text-sm hover:underline"
        style={{ color: EGGSHELL }}
      >
        ← Back
      </Link>

      {/* Page title (no subtitle) */}
      <h1 className="mb-6 text-center text-4xl font-extrabold tracking-tight" style={{ color: ZIMA }}>
        Join League
      </h1>

      {/* How to join (kept) */}
      <div className="mx-auto mb-6 max-w-2xl rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm">
        <div className="text-center">
          <div className="mb-1 text-[11px] uppercase tracking-[0.2em]" style={{ color: ZIMA }}>How to join</div>
          <ol className="mx-auto list-decimal pl-5 text-left sm:inline-block sm:text-left">
            <li>Paste the League address provided by your commissioner.</li>
            <li>Pick a team name (unique within the league) or roll the dice.</li>
            <li>If the league is password-protected, enter the password.</li>
            <li>Click <span className="font-semibold">Join League</span>. If there’s a native buy-in, it’s sent with the transaction.</li>
          </ol>
        </div>
      </div>

      <div className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-black/30 p-6 shadow-2xl shadow-black/30">
        {/* League Address */}
        <label className="mb-4 block">
          <span className="block text-center text-sm opacity-80">League Contract Address</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value)}
              placeholder="0x..."
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono outline-none focus:ring-2"
              style={{ color: EGGSHELL }}
            />
            {addrOk && (
              <button
                type="button"
                onClick={() => copy(addr)}
                className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                style={{ color: EGGSHELL }}
                title="Copy address"
              >
                Copy
              </button>
            )}
          </div>
        </label>

        {/* Team Name + Dice */}
        <label className="mb-6 block">
          <span className="block text-center text-sm opacity-80">Team Name</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. team_name_123"
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 outline-none focus:ring-2"
              style={{ color: EGGSHELL }}
            />
            <button
              type="button"
              onClick={() => setTeamName(randomTeamName())}
              className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
              style={{ color: EGGSHELL }}
              title="Roll a random team name"
            >
              🎲
            </button>
          </div>
        </label>

        {/* League summary card */}
        {showLeagueInfo && (
          <>
            {loading && (
              <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center text-sm opacity-80">
                Fetching league…
              </div>
            )}
            {!loading && readError && (
              <div className="mb-6 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm" style={{ color: EGGSHELL }}>
                {readError}
              </div>
            )}
            {!loading && !readError && leagueHeader}
          </>
        )}

        {/* Password ONLY if required; centered label; no "(required)" */}
        {showLeagueInfo && summary?.[5] && (
          <div className="mb-6">
            <label className="block">
              <span className="block text-center text-sm opacity-80">Password</span>
              <div className={`mt-1 flex items-center gap-2 ${shake ? 'animate-[shake_0.45s_ease-in-out_1]' : ''}`}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordError(null); }}
                  placeholder="Enter league password"
                  className={`w-full rounded-lg border px-3 py-2 outline-none focus:ring-2
                    ${passwordError ? 'border-red-500/60 bg-red-500/5' : 'border-white/15 bg-white/5'}
                  `}
                  style={{ color: EGGSHELL }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                  style={{ color: EGGSHELL }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {passwordError && (
                <div className="mt-1 text-center text-xs" style={{ color: '#ffb4b4' }}>{passwordError}</div>
              )}
            </label>
          </div>
        )}

        {/* Actions */}
        <div className="text-center">
          {isFree || !showLeagueInfo ? (
            <button
              disabled={!showLeagueInfo || !canSubmit}
              onClick={buyNowOrJoinFree}
              className="w-full rounded-xl px-5 py-3 font-semibold shadow disabled:opacity-40"
              style={{ backgroundColor: ZIMA, color: '#0b0b14' }}
            >
              Join League
            </button>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                disabled={!canSubmit || !isNative}
                onClick={buyNowOrJoinFree}
                className="rounded-xl px-5 py-3 font-semibold shadow disabled:opacity-40"
                style={{ backgroundColor: ZIMA, color: '#0b0b14' }}
                title={isNative ? undefined : 'Use the ERC-20 flow in the League page'}
              >
                Join League ({isNative ? formatAvax(buyInAmount) : 'ERC-20'})
              </button>
              <button
                disabled={!canSubmit}
                onClick={joinPayLater}
                className="rounded-xl px-5 py-3 font-semibold"
                style={{ border: `1px solid ${ZIMA}`, color: EGGSHELL, background: 'transparent' }}
              >
                Join &amp; Pay Later
              </button>
            </div>
          )}

          {/* Tx status */}
          {txHash && (
            <div className="mt-3 text-sm">
              {tx.isLoading ? 'Confirming transaction…'
                : tx.isSuccess ? 'Joined!'
                : tx.isError ? 'Transaction failed'
                : 'Sent…'}{' '}
              <a
                className="hover:underline"
                href={`https://testnet.snowtrace.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: EGGSHELL }}
              >
                View on Snowtrace →
              </a>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs opacity-80">
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
