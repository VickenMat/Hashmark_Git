// src/lib/leagueData.ts
'use client';

import { useMemo } from 'react';
import { useChainId, usePublicClient } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Abi } from 'viem';
import { LEAGUE_ABI } from '@/lib/LeagueContracts';

const ZERO = '0x0000000000000000000000000000000000000000' as const;

export const qk = {
  summary: (league?: `0x${string}`, chainId?: number) => ['league', chainId, league, 'summary'] as const,
  teams:   (league?: `0x${string}`, chainId?: number) => ['league', chainId, league, 'teams'] as const,
  teamBy:  (league?: `0x${string}`, owner?: `0x${string}`, chainId?: number) => ['league', chainId, league, 'teamBy', owner?.toLowerCase()] as const,
  draft:   (league?: `0x${string}`, chainId?: number) => ['league', chainId, league, 'draft'] as const,
};

export function useLeagueSummary(league?: `0x${string}`) {
  const chainId = useChainId();
  const pc = usePublicClient({ chainId });
  return useQuery({
    queryKey: qk.summary(league, chainId),
    enabled: !!pc && !!league,
    queryFn: async () => {
      // Try getSummary(); fallback to legacy pieces if needed
      async function safe<T>(p: Promise<T>, d: T) { try { return await p; } catch { return d; } }
      const address = league!;
      try {
        return await pc!.readContract({
          abi: LEAGUE_ABI as Abi,
          address,
          functionName: 'getSummary',
        }) as [
          string,          // name
          `0x${string}`,   // buyInToken
          bigint,          // buyInAmount
          bigint,          // teamCap
          bigint,          // teamsFilled
          boolean,         // requiresPassword
          `0x${string}`    // commissioner
        ];
      } catch {
        const name         = await safe(pc!.readContract({ abi: LEAGUE_ABI as Abi, address, functionName: 'name' }) as Promise<string>, '');
        const buyInToken   = await safe(pc!.readContract({ abi: LEAGUE_ABI as Abi, address, functionName: 'buyInToken' }) as Promise<`0x${string}`>, ZERO);
        const buyInAmount  = await safe(pc!.readContract({ abi: LEAGUE_ABI as Abi, address, functionName: 'buyInAmount' }) as Promise<bigint>, 0n);
        const commissioner = await safe(pc!.readContract({ abi: LEAGUE_ABI as Abi, address, functionName: 'commissioner' }) as Promise<`0x${string}`>, ZERO);
        const teams        = await safe(pc!.readContract({ abi: LEAGUE_ABI as Abi, address, functionName: 'getTeams' }) as Promise<{ owner: `0x${string}`; name: string }[]>, []);
        const requiresPw   = await safe(pc!.readContract({ abi: LEAGUE_ABI as Abi, address, functionName: 'requiresPassword' }) as Promise<boolean>, false);
        const cap    = BigInt(teams.length);
        const filled = BigInt(teams.filter(t => t.owner && t.owner !== ZERO).length);
        return [name, buyInToken, buyInAmount, cap, filled, requiresPw, commissioner] as const;
      }
    }
  });
}

export function useLeagueTeams(league?: `0x${string}`) {
  const chainId = useChainId();
  const pc = usePublicClient({ chainId });
  return useQuery({
    queryKey: qk.teams(league, chainId),
    enabled: !!pc && !!league,
    queryFn: async () => {
      const res = await pc!.readContract({
        abi: LEAGUE_ABI as Abi,
        address: league!,
        functionName: 'getTeams',
      }) as { owner: `0x${string}`; name: string }[];
      return res;
    }
  });
}

export function useTeamName(league?: `0x${string}`, owner?: `0x${string}`) {
  const chainId = useChainId();
  const pc = usePublicClient({ chainId });
  return useQuery({
    queryKey: qk.teamBy(league, owner, chainId),
    enabled: !!pc && !!league && !!owner,
    queryFn: async () => {
      const name = await pc!.readContract({
        abi: LEAGUE_ABI as Abi,
        address: league!,
        functionName: 'getTeamByAddress',
        args: [owner!],
      }) as string;
      return name;
    }
  });
}

export function useDraftSettings(league?: `0x${string}`) {
  const chainId = useChainId();
  const pc = usePublicClient({ chainId });
  return useQuery({
    queryKey: qk.draft(league, chainId),
    enabled: !!pc && !!league,
    queryFn: async () => {
      return await pc!.readContract({
        abi: LEAGUE_ABI as Abi,
        address: league!,
        functionName: 'getDraftSettings',
      }) as [number, bigint, number, boolean, `0x${string}`[]];
    }
  });
}

// handy helper for manual invalidations in rare cases
export function useLeagueInvalidators(league?: `0x${string}`) {
  const chainId = useChainId();
  const qc = useQueryClient();
  return useMemo(() => ({
    all: () => qc.invalidateQueries({ queryKey: ['league', chainId, league] }),
    summary: () => qc.invalidateQueries({ queryKey: qk.summary(league, chainId) }),
    teams: () => qc.invalidateQueries({ queryKey: qk.teams(league, chainId) }),
    draft: () => qc.invalidateQueries({ queryKey: qk.draft(league, chainId) }),
    teamBy: (owner?: `0x${string}`) => qc.invalidateQueries({ queryKey: qk.teamBy(league, owner, chainId) }),
  }), [qc, chainId, league]);
}
