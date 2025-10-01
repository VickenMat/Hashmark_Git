'use client';

import React from 'react';

const ZIMA = '#37c0f6';
const EGGSHELL = '#F0EAD6';

type Tab = 'draft' | 'queue' | 'history' | 'team' | 'all';

export default function ControlsRow({
  tab,
  onTab,
  league,             // not used, kept for parity
  isCommish,
  phasePill,
  canShowPause,
  paused,
  onTogglePause,
  onOpenSettings,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  league: `0x${string}`;
  isCommish: boolean;
  phasePill: React.ReactNode;
  canShowPause: boolean;
  paused: boolean;
  onTogglePause: () => void;
  onOpenSettings: () => void;
}) {
  const tabs: Tab[] = ['draft', 'queue', 'history', 'team', 'all'];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tabs.map((k) => {
        const label =
          k === 'all' ? 'All Teams' :
          k === 'team' ? 'My Team' :
          k[0].toUpperCase() + k.slice(1);
        const active = tab === k;
        return (
          <button
            key={k}
            onClick={() => onTab(k)}
            className={`rounded-2xl px-3 py-1.5 text-sm border transition-all no-underline
              ${active ? 'ring-1' : 'opacity-80 hover:opacity-100'}`}
            style={{
              color: EGGSHELL,
              borderColor: active ? ZIMA : 'rgba(255,255,255,0.18)',
              background: active ? 'rgba(55,192,246,0.08)' : 'transparent',
            }}
          >
            {label}
          </button>
        );
      })}

      <button
        onClick={onOpenSettings}
        className="rounded-2xl px-3 py-1.5 text-sm border transition-all no-underline"
        style={{ color: EGGSHELL, borderColor: 'rgba(255,255,255,0.18)' }}
      >
        Settings
      </button>

      <div className="ml-auto flex items-center gap-2">
        {phasePill}
        {isCommish && canShowPause && (
          <button
            onClick={onTogglePause}
            className={`rounded-2xl px-3 py-1.5 text-sm border transition-all no-underline font-semibold`}
            style={{
              color: paused ? '#0b3b16' : '#3b2a07',
              borderColor: paused ? 'rgba(16,185,129,0.6)' : 'rgba(245,158,11,0.6)',
              background: paused ? 'rgba(16,185,129,0.85)' : 'rgba(245,158,11,0.85)',
            }}
            aria-label={paused ? 'Resume draft' : 'Pause draft'}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
        )}
      </div>
    </div>
  );
}
