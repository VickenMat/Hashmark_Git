'use client';

import React from 'react';
import { useTeamProfile } from '@/lib/teamProfile';

const EGGSHELL = '#F0EAD6';

type Address = `0x${string}`;

export default function HeaderCell({
  league,
  owner,
  name,
}: {
  league: Address;
  owner: Address;
  name: string;
}) {
  const prof = useTeamProfile(league, owner || ('0x0000000000000000000000000000000000000000' as Address), { name });
  const label = prof?.name || name;

  return (
    <div className="flex items-center justify-center gap-2 truncate">
      {prof.logo && (
        <img
          src={prof.logo}
          alt={label || 'Team'}
          className="h-6 w-6 rounded-xl border border-white/20 object-cover shrink-0"
        />
      )}
      <div className="truncate text-center" style={{ color: EGGSHELL }}>{label}</div>
    </div>
  );
}
