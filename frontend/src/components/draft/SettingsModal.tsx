'use client';

import React from 'react';

type Address = `0x${string}`;

export default function SettingsModal({
  open,
  onClose,
  isCommish,
  onReset,                // parent does the actual reset logic (broadcast included)
  info,                   // current settings to display
  round1Order,            // [{owner,name}]
}: {
  open: boolean;
  onClose: () => void;
  isCommish: boolean;
  onReset: () => void;
  info: {
    timePerPickText: string;
    draftTypeText: string;
    startLocalText: string;
    salaryBudget?: number | null;
  };
  round1Order: { owner: Address; name: string }[];
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/12 bg-[#0b0b12] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-semibold text-white">Draft Settings</div>
          <button onClick={onClose} className="rounded-md border border-white/15 bg-white/10 px-2 py-1 text-sm hover:bg-white/15">✕</button>
        </div>

        {/* Settings summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/12 bg-white/5 p-3">
            <div className="text-sm font-semibold mb-2">Settings</div>
            <ul className="text-sm space-y-1">
              <li><span className="opacity-70">Time per Pick:</span> <span className="ml-1">{info.timePerPickText}</span></li>
              <li><span className="opacity-70">Type:</span> <span className="ml-1">{info.draftTypeText}</span></li>
              <li><span className="opacity-70">Start:</span> <span className="ml-1">{info.startLocalText}</span></li>
              {info.dsalaryBudget && <li><span className="opacity-70">Budget:</span> <span className="ml-1">{info.salaryBudget}</span></li>}
            </ul>
          </div>

          <div className="rounded-xl border border-white/12 bg-white/5 p-3">
            <div className="text-sm font-semibold mb-2">Round 1 Order</div>
            {round1Order.length === 0 ? (
              <div className="text-sm opacity-70">No teams.</div>
            ) : (
              <ol className="text-sm space-y-1">
                {round1Order.map((t, i) => (
                  <li key={`${t.owner}-${i}`} className="flex items-center gap-2">
                    <span className="font-mono text-xs rounded bg-white/10 px-2 py-[2px]">{i + 1}</span>
                    <span>{t.name}</span>
                    <span className="opacity-60 text-xs">{t.owner.slice(0,6)}…{t.owner.slice(-4)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {/* Danger zone (commish only) */}
        {isCommish && (
          <div className="mt-4 rounded-xl border border-red-700/40 bg-red-900/20 p-3">
            <div className="text-sm text-red-200 font-semibold mb-2">Danger Zone</div>
            <button
              onClick={() => {
                if (!confirm('⚠️ Reset the draft for all members? This clears all picks and returns to grace.')) return;
                onReset();
                onClose();
              }}
              className="w-full rounded-xl bg-red-600 hover:bg-red-700 px-4 py-2 font-semibold"
            >
              Reset Draft (broadcast)
            </button>
            <p className="text-xs text-red-200/80 mt-2">
              Wipes picks, pointer and timers, then re-enters the grace period for every user.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
