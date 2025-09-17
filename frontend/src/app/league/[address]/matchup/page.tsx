// src/app/league/[address]/matchup/page.tsx
'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function MatchupIndex() {
  const { address } = useParams<{ address: `0x${string}` }>();
  const router = useRouter();

  useEffect(() => {
    try {
      // last viewed matchup per wallet (set by scoreboard tiles)
      const last = Object.keys(localStorage)
        .filter(k => k.startsWith(`hashmark:lastMatchup:${address}:`))
        .map(k => localStorage.getItem(k)!)
        .find(Boolean);
      router.replace(last || `/league/${address}/scoreboard`);
    } catch {
      router.replace(`/league/${address}/scoreboard`);
    }
  }, [address, router]);

  return null;
}
