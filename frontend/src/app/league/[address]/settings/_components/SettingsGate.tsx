'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';

const LEAGUE_ABI = [
  { type:'function', name:'commissioner', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
] as const;

export default function SettingsGate({ children }:{ children: React.ReactNode }) {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const router = useRouter();
  const { address: wallet, isConnecting } = useAccount();
  const { data: commish, isLoading } = useReadContract({
    abi: LEAGUE_ABI,
    address: league,
    functionName: 'commissioner',
  });

  const isCommish =
    wallet && commish &&
    wallet.toLowerCase() === (commish as string).toLowerCase();

  useEffect(() => {
    if (!isConnecting && !isLoading) {
      if (!wallet) router.replace(`/league/${league}`);
      else if (!isCommish) router.replace(`/league/${league}`);
    }
  }, [wallet, isCommish, isConnecting, isLoading, router, league]);

  if (isConnecting || isLoading) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-sm text-gray-400">
        Checking permissions…
      </div>
    );
  }
  if (!isCommish) return null; // brief flash handled by redirect above
  return <>{children}</>;
}
