'use client';

import React, { useState } from 'react';

const ZIMA = '#37c0f6';
const EGGSHELL = '#F0EAD6';

type Address = `0x${string}`;

type Info = {
  draftTypeText: string;       // 'Snake' | 'Linear' | 'Auction'
  trr?: boolean;               // third-round reversal
  startLocalText: string;      // 'MM/DD/YYYY - H:MM AM/PM'
  playerPoolText?: string;     // 'All Players', etc.
  timePerPickText: string;     // '60s / pick' or 'No limit'
  salaryBudget?: number;       // shown only for Auction if provided
};

export default function SettingsModal({
  open,
  onClose,
  isCommish,
  onReset,
  info,
  round1Order, // optional list of { owner, name } to preview Round 1 order
}: {
  open: boolean;
  onClose: () => void;
  isCommish: boolean;
  onReset: () => void;
  info: Info;
  round1Order?: { owner: Address; name: string }[];
}) {
  const [showOrder, setShowOrder] = useState(true);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Centered modal */}
      <div className="absolute left-1/2 top-1/2 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/12 bg-[#0b0b12] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="text-lg font-semibold" style={{ color: EGGSHELL }}>Draft Settings</div>
          <button
            onClick={onClose}
            className="rounded-md border border-white/15 bg-white/10 px-2 py-1 text-sm hover:bg-white/15"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          {/* Summary — centered single column */}
          <div className="mx-auto max-w-xl text-center space-y-2">
            <div className="text-sm">
              <span className="opacity-80">Draft Type:</span>{' '}
              <span className="font-semibold" style={{ color: EGGSHELL }}>{info.draftTypeText}</span>
            </div>
            <div className="text-sm">
              <span className="opacity-80">Third-Round Reversal:</span>{' '}
              <span className="font-semibold" style={{ color: EGGSHELL }}>{info.trr ? 'Enabled' : 'Disabled'}</span>
            </div>
            <div className="text-sm">
              <span className="opacity-80">Date &amp; Time:</span>{' '}
              <span className="font-semibold" style={{ color: EGGSHELL }}>{info.startLocalText}</span>
            </div>
            {info.playerPoolText && (
              <div className="text-sm">
                <span className="opacity-80">Player Pool:</span>{' '}
                <span className="font-semibold" style={{ color: EGGSHELL }}>{info.playerPoolText}</span>
              </div>
            )}
            {Number.isFinite(info.salaryBudget) && (
              <div className="text-sm">
                <span className="opacity-80">Salary Budget:</span>{' '}
                <span className="font-semibold" style={{ color: EGGSHELL }}>{info.salaryBudget}</span>
              </div>
            )}
            <div className="text-sm">
              <span className="opacity-80">Time per Pick:</span>{' '}
              <span className="font-semibold" style={{ color: EGGSHELL }}>{info.timePerPickText}</span>
            </div>
          </div>

          {/* Draft Order (optional) */}
          {round1Order && round1Order.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold" style={{ color: EGGSHELL }}>Draft Order (Round 1)</div>
                <button
                  onClick={() => setShowOrder(v => !v)}
                  className="rounded-md border border-white/15 bg-white/10 px-2 py-1 text-xs hover:bg-white/15"
                >
                  {showOrder ? 'Hide' : 'Show'}
                </button>
              </div>
              {showOrder && (
                <ol className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {round1Order.map((t, i) => (
                    <li key={`${t.owner}-${i}`} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <span className="rounded bg-white/10 px-2 py-[2px] font-mono text-xs">{i + 1}</span>
                        <span className="font-medium" style={{ color: EGGSHELL }}>{t.name}</span>
                      </span>
                      <span className="text-xs opacity-60">{short(t.owner)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* Danger zone — only commissioner */}
          {isCommish && (
            <div className="mt-8 rounded-xl border border-red-700/40 bg-red-900/20 p-4 text-center">
              <div className="mb-2 text-sm font-semibold text-red-200">Danger Zone</div>
              <button
                onClick={() => {
                  const ok = confirm(
                    '⚠️ This will wipe all local draft progress for this league and return to the grace/starting state.\nProceed?'
                  );
                  if (!ok) return;
                  onReset();
                }}
                className="w-full sm:w-auto rounded-xl bg-red-600 hover:bg-red-700 px-4 py-2 font-semibold"
              >
                Reset Draft (local broadcast)
              </button>
              <p className="mt-2 text-xs text-red-200/80">
                Resets picks and pointer back to Pick 1. Broadcasts to other tabs for this league.
              </p>
            </div>
          )}
        </div>

        {/* Footer — centered Close */}
        <div className="px-6 pb-6 flex justify-center">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function short(a?: string) {
  if (!a) return '';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
