'use client';

import React from 'react';
import { useTeamProfile } from '@/lib/teamProfile';

type Address = `0x${string}`;

export default function TeamInline({
  league,
  owner,
  labelOverride,
}: {
  league: Address;
  owner: Address;
  labelOverride?: string;
}) {
  const p = useTeamProfile(league, owner || ('0x0000000000000000000000000000000000000000' as Address), {
    name: labelOverride,
  });
  return (
    <span className="inline-flex items-center gap-2">
      {p.logo && (
        <img
          src={p.logo}
          className="h-4 w-4 rounded-xl border border-white/20 object-cover"
          alt={p.name || 'Team'}
        />
      )}
      <span>{labelOverride || p.name}</span>
    </span>
  );
}
