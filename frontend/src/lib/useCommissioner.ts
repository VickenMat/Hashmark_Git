'use client';

import { useMemo } from 'react';
import { useAccount, useReadContract } from 'wagmi';

const READS = [
  { type: 'function', name: 'commissioner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

export function useCommissioner(league?: `0x${string}`) {
  const { address: wallet } = useAccount();
  const { data: commish } = useReadContract({
    abi: READS, address: league, functionName: 'commissioner', query: { enabled: !!league }
  });

  const isCommish = useMemo(() => {
    if (!wallet || !commish) return false;
    return wallet.toLowerCase() === String(commish).toLowerCase();
  }, [wallet, commish]);

  return { wallet, commissioner: commish as `0x${string}` | undefined, isCommish };
}
