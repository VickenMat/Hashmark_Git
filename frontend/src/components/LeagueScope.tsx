// src/components/LeagueScope.tsx
'use client';

import { useEffect } from 'react';
import { useChainId, usePublicClient } from 'wagmi';
import type { Abi } from 'viem';
import { LEAGUE_ABI } from '@/lib/LeagueContracts';
import { useLeagueInvalidators } from '@/lib/leagueData';

export default function LeagueScope({
  league,
  children,
}: {
  league: `0x${string}`;
  children: React.ReactNode;
}) {
  const chainId = useChainId();
  const pc = usePublicClient({ chainId });
  const inv = useLeagueInvalidators(league);

  useEffect(() => {
    if (!pc || !league) return;

    // subscribe to a small set of events that affect UI data
    const unsubs: (() => void)[] = [];

    const sub = pc.watchContractEvent({
      abi: LEAGUE_ABI as Abi,
      address: league,
      eventName: 'TeamRenamed',
      onLogs() {
        inv.teams();
        inv.all(); // also touches teamBy queries
      },
    });
    unsubs.push(sub);

    const sub2 = pc.watchContractEvent({
      abi: LEAGUE_ABI as Abi,
      address: league,
      eventName: 'TeamCreated',
      onLogs() {
        inv.teams();
        inv.summary();
      },
    });
    unsubs.push(sub2);

    const sub3 = pc.watchContractEvent({
      abi: LEAGUE_ABI as Abi,
      address: league,
      eventName: 'DraftSettingsUpdated',
      onLogs() {
        inv.draft();
      },
    });
    unsubs.push(sub3);

    // OPTIONAL: if you add on-chain logo CID
    // const sub4 = pc.watchContractEvent({
    //   abi: LEAGUE_ABI as Abi,
    //   address: league,
    //   eventName: 'TeamLogoUpdated',
    //   onLogs() { /* invalidate a logo query if you add one */ },
    // });
    // unsubs.push(sub4);

    return () => { unsubs.forEach((u) => u?.()); };
  }, [pc, league, inv]);

  return <>{children}</>;
}
