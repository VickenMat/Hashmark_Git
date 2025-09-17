// src/components/League/CommissionerGuard.tsx
'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';

const ABI = [
  { type:'function', name:'commissioner', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
] as const;

export default function CommissionerGuard({ children }:{ children: React.ReactNode }) {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const router = useRouter();
  const { address: wallet } = useAccount();
  const { data: commish } = useReadContract({ abi: ABI, address: league, functionName: 'commissioner' });
  const allowed = wallet && commish && wallet.toLowerCase() === (commish as string).toLowerCase();

  useEffect(() => {
    if (commish && !allowed) router.replace(`/league/${league}`);
  }, [commish, allowed, router, league]);

  if (!commish || !wallet) return <div className="p-6 text-sm text-gray-400">Checking permissions…</div>;
  if (!allowed) return null;
  return <>{children}</>;
}
