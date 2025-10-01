'use client';

import React from 'react';
import StatePill from './StatePill';

const EGGSHELL = '#F0EAD6';
const ZIMA = '#37c0f6';

type TabKey = 'draft' | 'queue' | 'history' | 'team' | 'all';

export default function ControlsRow({
  tab,
  setTab,
  showSettings,
  onShowSettings,
  isCommish,
  paused,
  inGrace,
  beforeRealStart,
  ended,
  onTogglePause,
}: {
  tab: TabKey;
  setTab: (k: TabKey) => void;
  showSettings?: boolean;
  onShowSettings?: () => void;
  isCommish?: boolean;
  paused?: boolean;
  inGrace?: boolean;
  beforeRealStart?: boolean;
  ended?: boolean;
  onTogglePause?: () => void;
}) {
  const phasePill = (() => {
    if (ended) return <StatePill color="DONE">Completed</StatePill>;
    if (paused) return <StatePill color="PAUSED">Paused</StatePill>;
    if (beforeRealStart) return <StatePill color={inGrace ? 'GRACE' : 'SOON'}>{inGrace ? 'Grace' : 'Starting Soon'}</StatePill>;
    return <StatePill color="LIVE">Live</StatePill>;
  })();

  return (
    <div className="mx-auto mb-3 flex max-w-6xl flex-wrap items-center gap-2">
      {(['draft','queue','history','team','all'] as const).map(k => (
        <button
          key={k}
          onClick={() => setTab(k)}
          className={`rounded-2xl px-3 py-1.5 text-sm transition border ${tab === k ? 'bg-white/10' : 'hover:bg-white/5'}`}
          style={{ color: EGGSHELL, borderColor: k === 'draft' ? ZIMA : 'rgba(255,255,255,.16)' }}
        >
          {k === 'draft' ? 'Draft' : k === 'queue' ? 'Queue' : k === 'history' ? 'History' : k === 'team' ? 'My Team' : 'All Teams'}
        </button>
      ))}

      {/* Right side actions */}
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onShowSettings}
          className="rounded-lg border px-3 py-1.5 text-sm no-underline hover:bg-white/10"
          title="Draft Settings"
        >
          Settings
        </button>

        {/* Pills now live here (moved below tabs by being inside this component) */}
        {phasePill}

        {/* Hide Pause during grace */}
        {isCommish && !inGrace && (
          <button
            onClick={onTogglePause}
            className={`rounded-lg border px-3 py-1.5 text-sm no-underline ${
              paused ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-700/50' :
                       'bg-amber-600 hover:bg-amber-700 border-amber-700/50'
            }`}
            title={paused ? 'Resume Draft' : 'Pause Draft'}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
        )}
      </div>
    </div>
  );
}
