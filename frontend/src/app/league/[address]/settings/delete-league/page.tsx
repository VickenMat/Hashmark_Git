// src/app/league/[address]/settings/delete-league/page.tsx
'use client';

import { useParams } from 'next/navigation';
import CommissionerGuard from '@/components/CommissionerGuard';
import { useOnchainWrite } from '@/components/OnchainForm';

const ABI = [
  { type:'function', name:'resetLeague',  stateMutability:'nonpayable', inputs:[], outputs:[] },
  { type:'function', name:'deleteLeague', stateMutability:'nonpayable', inputs:[], outputs:[] },
] as const;

export default function Page() {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const write = useOnchainWrite();

  const call = async (fn:'resetLeague'|'deleteLeague') => {
    await write({ abi: ABI, address: league, functionName: fn, args: [] },
      fn === 'resetLeague' ? 'League reset.' : 'League deleted.');
  };

  return (
    <CommissionerGuard>
      <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
        <div className="mx-auto max-w-2xl space-y-5">
          <h1 className="text-3xl font-extrabold">Delete / Reset League</h1>
          <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-yellow-100">
            ⚠️ These actions are destructive and permanent. Make sure you know what you’re doing.
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <h2 className="font-semibold">Reset League</h2>
            <p className="text-sm text-gray-300">Removes all players from rosters but keeps settings intact.</p>
            <button
              onClick={()=>call('resetLeague')}
              className="rounded-xl bg-amber-600 hover:bg-amber-700 px-6 py-3 font-bold"
            >
              Reset League
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <h2 className="font-semibold">Delete League</h2>
            <p className="text-sm text-gray-300">Completely removes league from existence.</p>
            <button
              onClick={()=>{ if (confirm('Type OK to delete')) call('deleteLeague'); }}
              className="rounded-xl bg-rose-600 hover:bg-rose-700 px-6 py-3 font-bold"
            >
              Delete League
            </button>
          </div>
        </div>
      </main>
    </CommissionerGuard>
  );
}
