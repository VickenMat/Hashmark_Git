// src/app/league/[address]/claims/add/page.tsx
'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function AddClaimRedirect() {
  const { address } = useParams<{ address: `0x${string}` }>();
  const router = useRouter();

  useEffect(() => {
    if (!address) return;
    router.replace(`/league/${address}/players`);
  }, [address, router]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="animate-pulse h-6 w-40 rounded bg-white/10" />
          <div className="mt-4 animate-pulse h-24 rounded bg-white/5" />
        </div>
      </div>
    </main>
  );
}
