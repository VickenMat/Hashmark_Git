'use client';

import React from 'react';

const EGGSHELL = '#F0EAD6';
const ZIMA = '#37c0f6';

export default function DraftInfoRow({
  timePerPickSec,
  draftType,          // 0 snake, 1 auction, 2 linear (example mapping)
  startTimestamp,     // seconds since epoch
  tzLabel,            // e.g., 'ET' / 'PT'
}: {
  timePerPickSec?: number | null;
  draftType?: number | null;
  startTimestamp?: number | null;
  tzLabel?: string;
}) {
  const tpp = (timePerPickSec ?? 0) > 0 ? `${Math.floor((timePerPickSec ?? 0) / 60)}m ${Math.floor((timePerPickSec ?? 0) % 60)}s` : '—';
  const typeName = draftType === 1 ? 'Auction' : draftType === 2 ? 'Linear' : 'Snake';

  const startText = startTimestamp
    ? fmtLocal(new Date((startTimestamp as number) * 1000)) + (tzLabel ? ` ${tzLabel}` : '')
    : 'Not scheduled';

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="rounded-2xl border px-3 py-1.5 text-sm" style={{ color: EGGSHELL, borderColor: 'rgba(255,255,255,0.18)' }}>
        <span className="opacity-70 mr-1">Time/ Pick:</span> <span style={{ color: ZIMA }}>{tpp}</span>
      </span>
      <span className="rounded-2xl border px-3 py-1.5 text-sm" style={{ color: EGGSHELL, borderColor: 'rgba(255,255,255,0.18)' }}>
        <span className="opacity-70 mr-1">Type:</span> <span style={{ color: ZIMA }}>{typeName}</span>
      </span>
      <span className="rounded-2xl border px-3 py-1.5 text-sm" style={{ color: EGGSHELL, borderColor: 'rgba(255,255,255,0.18)' }}>
        <span className="opacity-70 mr-1">Start:</span> <span style={{ color: ZIMA }}>{startText}</span>
      </span>
    </div>
  );
}

function fmtLocal(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${mm}/${dd}/${yyyy} - ${h}:${m} ${ampm}`;
}
