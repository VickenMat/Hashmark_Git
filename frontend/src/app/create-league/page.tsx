// src/app/create-league/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
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
  LEAGUE_FACTORY_ADDRESS,
  LEAGUE_ABI,
} from '@/lib/LeagueContracts';

const ZIMA = '#37c0f6';
const EGGSHELL = '#F0EAD6';
const MIN_BUYIN_AVAX = '0.001'; // validation only (no visible hint)

const SETPW_BYTES32_ABI = [
  { type: 'function', name: 'setJoinPassword', stateMutability: 'nonpayable', inputs: [{ name: 'passwordHash', type: 'bytes32' }], outputs: [] },
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
  const [showPwHelp, setShowPwHelp] = useState(false);

  const teamOptions = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];

  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    (async function loop() {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=avalanche-2&vs_currencies=usd');
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
      if (!Number.isFinite(f)) { toast.error('Enter a valid buy-in'); return; }
      if (f < parseFloat(MIN_BUYIN_AVAX)) { toast.error('You must enter at least 0.001 AVAX.'); return; } // <- exact copy
      try { buyInAmount = parseEther(buyIn); } catch { toast.error('Invalid buy-in amount'); return; }
    }

    if (wantsPassword && password.trim().length === 0) {
      toast.error('Enter a password or turn off "Require Password".');
      return;
    }

    const toastId = toast.loading('Creating league…');

    try {
      const txHash = await writeContractAsync({
        address: LEAGUE_FACTORY_ADDRESS as `0x${string}`,
        abi: LEAGUE_FACTORY_ABI,
        functionName: 'createLeague',
        args: [name, buyInAmount, BigInt(teamCount)],
        account: address,
      });

      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash as Hex });

      let newLeague: `0x${string}` | undefined;
      try {
        const parsed = parseEventLogs({
          abi: LEAGUE_FACTORY_ABI as any,
          logs: receipt.logs,
          eventName: 'LeagueCreated',
          strict: false,
        });
        if (parsed.length) newLeague = (parsed[0].args as any).leagueAddress as `0x${string}`;
      } catch {}

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

      try {
        await navigator.clipboard.writeText(newLeague);
        toast.success('✅ League created! Address copied to clipboard.', { id: toastId });
      } catch {
        toast.success('✅ League created!', { id: toastId });
      }

      toast(() => (
        <span>
          New League: <code style={{ fontFamily: 'mono' }}>{newLeague}</code>{' '}
          <a href={`https://testnet.snowtrace.io/address/${newLeague}`} target="_blank" rel="noreferrer" style={{ color: ZIMA, marginLeft: 8 }}>
            View on Snowtrace →
          </a>
        </span>
      ), { duration: 6000 });

      window.location.href = '/';
    } catch (err: any) {
      console.error(err);
      const msg = err?.shortMessage || err?.cause?.reason || err?.details || err?.message || 'Transaction failed';
      toast.error(msg, { id: toastId });
    }
  };

  return (
    <div className="min-h-screen px-4 sm:px-6 py-10" style={{ backgroundImage: 'linear-gradient(to bottom right, #0b0b14, #000000)', color: EGGSHELL }}>
      <h1 className="mb-3 text-center text-4xl font-extrabold tracking-tight" style={{ color: ZIMA }}>
        Create League
      </h1>

      {avaxPrice && (
        <div className="mb-6 text-center">
          <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs" style={{ borderColor: 'rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)' }}>
            AVAX price • <span className="ml-1 font-semibold" style={{ color: ZIMA }}>${avaxPrice.toFixed(2)}</span>
          </span>
        </div>
      )}

      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-black/30 p-5 shadow-2xl shadow-black/30">
        {/* League Name — label with spacing; counter on the right */}
        <div className="mb-5 text-center">
          <label className="mb-2 block text-sm" style={{ color: EGGSHELL }}>League Name</label>
          <div className="mx-auto flex w-full max-w-md items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder="e.g. Sunday Legends"
              className="block w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 outline-none focus:ring-2"
              style={{ color: EGGSHELL }}
            />
            <span className="text-[11px] opacity-60">{name.length}/32</span>
          </div>
        </div>

        {/* Buy-In — title above toggle; extra padding when FREE is selected */}
        <div className={`text-center ${isFree ? 'mb-6' : 'mb-2'}`}>
          <div className="mb-2 text-sm" style={{ color: EGGSHELL }}>Buy-In</div>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => { setIsFree(true); setBuyIn(''); }}
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

        {/* Buy-In amount (only when Buy-In selected) */}
        {!isFree && (
          <div className="mb-5 text-center">
            <div className="mx-auto w-full max-w-md">
              <label className="mb-2 block text-sm" style={{ color: EGGSHELL }}>Amount (AVAX)</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="< 0.001 AVAX"   // <- requested placeholder
                value={buyIn}
                onChange={(e) => handleBuyInChange(e.target.value)}
                className="block w-full rounded-xl border px-3 py-2 outline-none focus:ring-2"
                style={{ color: EGGSHELL, borderColor: ZIMA, background: 'rgba(255,255,255,.04)' }}
              />
            </div>
          </div>
        )}

        {/* Number of Teams — one-line pills with more top spacing from the Free state */}
        <div className="mb-5 text-center">
          <div className="mb-2 text-sm" style={{ color: EGGSHELL }}>Number of Teams</div>
          <div className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-2 overflow-x-auto whitespace-nowrap">
            {teamOptions.map((n) => (
              <button
                key={n}
                onClick={() => setTeamCount(n)}
                className="rounded-xl border px-3 py-1.5 text-sm font-medium"
                style={{
                  borderColor: teamCount === n ? ZIMA : 'rgba(255,255,255,.15)',
                  background: teamCount === n ? 'rgba(55,192,246,.15)' : 'rgba(255,255,255,.04)',
                  color: EGGSHELL,
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Password section */}
        <div className="mb-5 text-center">
          <div className="mb-2 text-sm" style={{ color: EGGSHELL }}>Password</div>

          <div className="mb-2 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setWantsPassword((v) => !v)}
              className="rounded-xl px-4 py-2 font-semibold"
              style={{
                background: wantsPassword ? ZIMA : 'transparent',
                color: wantsPassword ? '#0b0b14' : EGGSHELL,
                border: `1px solid ${wantsPassword ? ZIMA : 'rgba(255,255,255,.15)'}`,
              }}
            >
              {wantsPassword ? 'Require Password ✓' : 'Require Password'}
            </button>
            <button
              type="button"
              onClick={() => setShowPwHelp(v => !v)}
              title="What does this do?"
              className="grid h-8 w-8 place-items-center rounded-full border text-xs"
              style={{ borderColor: 'rgba(255,255,255,.2)', background: 'rgba(255,255,255,.06)', color: EGGSHELL }}
            >
              ?
            </button>
          </div>

          {showPwHelp && (
            <div className="mx-auto mb-2 max-w-md rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs">
              If enabled, players must enter a password to join. The contract validates the password hash on-chain.
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
                style={{ color: EGGSHELL, borderColor: ZIMA, background: 'rgba(255,255,255,.04)' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                className="rounded-lg border px-3 py-2 text-sm hover:opacity-90"
                style={{ borderColor: 'rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)', color: EGGSHELL }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          )}
        </div>

        {/* Submit — narrower */}
        <div className="flex justify-center">
          <button
            onClick={handleSubmit}
            disabled={isPending}
  className="mt-1 w-full max-w-sm rounded-xl px-6 py-3 font-bold transition disabled:opacity-50"
            style={{ backgroundColor: ZIMA, color: '#0b0b14' }}
          >
            {isPending ? 'Creating…' : 'Create League'}
          </button>

        </div>
      </div>
    </div>
  );
}
