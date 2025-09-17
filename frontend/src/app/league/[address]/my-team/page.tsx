// src/app/league/[address]/my-team/page.tsx
'use client';

import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';

export default function MyTeamRedirect() {
  const { address } = useParams<{ address: `0x${string}` }>();
  const { address: wallet } = useAccount();
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !address) return;
    done.current = true;

    if (wallet) {
      router.replace(`/league/${address}/team/${wallet}`);
    } else {
      // fallback so users aren't stranded here if not connected
      router.replace(`/league/${address}/players`);
    }
  }, [address, wallet, router]);

  return null;
}
