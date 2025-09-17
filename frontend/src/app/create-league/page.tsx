// src/app/create-league/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import {
  parseEther,
  keccak256,
  toBytes,
  type Hex,
  parseEventLogs,   // 👈 add this
} from 'viem';
import { toast } from 'react-hot-toast';
import {
  LEAGUE_FACTORY_ABI,
  LEAGUE_FACTORY_ADDRESS,
  LEAGUE_ABI,
} from '@/lib/LeagueContracts';

/** Minimal, correct ABI for the deployed function */
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
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();

  const [name, setName] = useState('');
  const [isFree, setIsFree] = useState(true);
  const [buyIn, setBuyIn] = useState('');
  const [teamCount, setTeamCount] = useState<number | null>(null);
  const [avaxPrice, setAvaxPrice] = useState<number | null>(null);

  const [wantsPassword, setWantsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const teamOptions = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];

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
    const normalized = parts.length <= 2 ? cleaned : `${parts[0]}.${parts.slice(1).join('')}`;
    setBuyIn(normalized);
  };

  const handleSubmit = async () => {
    if (!address) { toast.error('Connect your wallet first'); return; }
    if (!name || name.length > 32) { toast.error('League name is required (max 32 chars)'); return; }
    if (!teamCount) { toast.error('Select number of teams'); return; }

    let buyInAmount = 0n;
    if (!isFree) {
      const f = parseFloat(buyIn || '0');
      if (!Number.isFinite(f) || f <= 0) { toast.error('Enter a valid buy-in > 0'); return; }
      if (f > 10) { toast.error('Buy-In must be ≤ 10 AVAX'); return; }
      try { buyInAmount = parseEther(buyIn); } catch { toast.error('Invalid buy-in amount'); return; }
    }

    if (wantsPassword && password.trim().length === 0) {
      toast.error('Enter a password or turn off "Require Password".');
      return;
    }

    const toastId = toast.loading('Creating league…');

    try {
      // 1) Create league
      const txHash = await writeContractAsync({
        address: LEAGUE_FACTORY_ADDRESS as `0x${string}`,
        abi: LEAGUE_FACTORY_ABI,
        functionName: 'createLeague',
        args: [name, buyInAmount, BigInt(teamCount)],
        account: address,
      });

      // 2) Wait for receipt
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash as Hex });

      // 2a) Robustly parse the LeagueCreated event
      let newLeague: `0x${string}` | undefined;
      try {
        const parsed = parseEventLogs({
          abi: LEAGUE_FACTORY_ABI as any,
          logs: receipt.logs,
          eventName: 'LeagueCreated',
          strict: false, // tolerate unknown logs in the receipt
        });
        if (parsed.length) {
          // event LeagueCreated(address indexed leagueAddress, address indexed creator)
          newLeague = (parsed[0].args as any).leagueAddress as `0x${string}`;
        }
      } catch {
        // ignore and fall back
      }

      // 2b) Fallback: read the latest league created by this wallet
      if (!newLeague) {
        const list = (await publicClient!.readContract({
          address: LEAGUE_FACTORY_ADDRESS as `0x${string}`,
          abi: LEAGUE_FACTORY_ABI,
          functionName: 'getLeaguesByCreator',
          args: [address],
        })) as `0x${string}`[];
        newLeague = list?.[list.length - 1];
      }
      if (!newLeague) throw new Error('LeagueCreated log not found');

      // 2.5) Verify commissioner = this wallet (avoids onlyCommissioner revert)
      const commissioner = (await publicClient!.readContract({
        abi: LEAGUE_ABI,
        address: newLeague,
        functionName: 'commissioner',
      })) as `0x${string}`;
      if (commissioner.toLowerCase() !== address.toLowerCase()) {
        toast.error('This wallet is not the league commissioner; cannot set the password.', { id: toastId });
        window.location.href = '/';
        return;
      }

      // 3) Optionally set join password
      if (wantsPassword) {
        const pwdHash = keccak256(toBytes(password)) as Hex;

        const sim = await publicClient!.simulateContract({
          address: newLeague,
          abi: SETPW_BYTES32_ABI,
          functionName: 'setJoinPassword',
          args: [pwdHash],
          account: address,
        });

        const pwdTx = await writeContractAsync(sim.request);
        await publicClient!.waitForTransactionReceipt({ hash: pwdTx as Hex });
      }

      toast.success('✅ League created!', { id: toastId });
      window.location.href = '/';
    } catch (err: any) {
      console.error(err);
      const msg =
        err?.shortMessage ||
        err?.cause?.reason ||
        err?.details ||
        err?.message ||
        'Transaction failed';
      toast.error(msg, { id: toastId });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-black p-6">
      <div className="bg-gray-950/70 border border-gray-800 rounded-2xl shadow-2xl p-8 w-full max-w-2xl text-white">
        <h1 className="text-4xl font-bold mb-2 text-center">Create League</h1>

        {avaxPrice && (
          <div className="mb-8 text-center text-sm text-gray-300">
            <span className="font-semibold text-purple-400">AVAX Price:</span>{' '}
            ${avaxPrice.toFixed(2)} USD
          </div>
        )}

        {/* League Name */}
        <div className="mb-6 text-center">
          <label className="block mb-3 text-lg font-bold text-purple-400 uppercase tracking-wide">
            League Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            className="mx-auto block w-full max-w-xl bg-black/40 text-white p-3 rounded-xl border border-gray-700 focus:ring-2 focus:ring-purple-600 outline-none"
          />
        </div>

        {/* Free / Buy-In Toggle */}
        <div className="flex gap-4 mb-6 justify-center">
          <button
            type="button"
            className={`px-5 py-2.5 rounded-xl font-semibold transition ${
              isFree ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
            onClick={() => { setIsFree(true); setBuyIn(''); }}
          >
            Free
          </button>
          <button
            type="button"
            className={`px-5 py-2.5 rounded-xl font-semibold transition ${
              !isFree ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
            onClick={() => setIsFree(false)}
          >
            Buy-In
          </button>
        </div>

        {/* Buy-In Amount */}
        {!isFree && (
          <div className="mb-8 text-center">
            <label className="block mb-3 text-lg font-bold text-purple-400 uppercase tracking-wide">
              Buy-In Amount (in AVAX)
            </label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 1.5"
              value={buyIn}
              onChange={(e) => handleBuyInChange(e.target.value)}
              className="mx-auto block w-full max-w-xl bg-black/40 text-white p-3 rounded-xl border border-purple-600 focus:ring-2 focus:ring-purple-600 outline-none"
            />
          </div>
        )}

        {/* Number of Teams */}
        <div className="mb-8 text-center">
          <label className="block mb-3 text-lg font-bold text-purple-400 uppercase tracking-wide">
            Number of Teams
          </label>
          <div className="mx-auto grid grid-cols-5 gap-3 max-w-xl">
            {teamOptions.map((n) => (
              <button
                key={n}
                onClick={() => setTeamCount(n)}
                className={`py-2 rounded-xl border font-medium transition ${
                  teamCount === n
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-white'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Password toggle + input */}
        <div className="mb-2 text-center">
          <button
            type="button"
            onClick={() => setWantsPassword((v) => !v)}
            className={`mx-auto mb-3 block px-5 py-2.5 rounded-xl font-semibold transition ${
              wantsPassword ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {wantsPassword ? 'Require Password ✓' : 'Require Password'}
          </button>

          {wantsPassword && (
            <>
              <div className="mx-auto flex w-full max-w-xl items-center gap-2">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter league password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex-1 bg-black/40 text-white p-3 rounded-xl border border-purple-600 focus:ring-2 focus:ring-purple-600 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:border-purple-400/60"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Your password is stored as <code>keccak256(bytes(password))</code> on-chain.
              </p>
            </>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="mt-6 w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white py-3 rounded-xl font-bold transition disabled:opacity-50"
        >
          {isPending ? 'Creating League…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
