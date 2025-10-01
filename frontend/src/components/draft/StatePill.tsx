'use client';

import React from 'react';

const MAP: Record<string, string> = {
  SOON: 'bg-yellow-500/20 text-yellow-300 border-yellow-700/40',
  GRACE: 'bg-orange-500/20 text-orange-300 border-orange-700/40',
  LIVE:  'bg-emerald-500/20 text-emerald-300 border-emerald-700/40',
  PAUSED:'bg-red-500/20 text-red-300 border-red-700/40',
  DONE:  'bg-zinc-500/20 text-zinc-200 border-zinc-700/40',
};

export default function StatePill({
  children,
  color,
  className = '',
}: {
  children: React.ReactNode;
  color: 'SOON'|'GRACE'|'LIVE'|'PAUSED'|'DONE';
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-9 items-center rounded-2xl border px-3 text-sm ${MAP[color]} ${className}`}
    >
      {children}
    </span>
  );
}
