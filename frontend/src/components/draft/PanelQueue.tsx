'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { type RankedPlayerRow } from '@/lib/auto-pick';

const ZIMA = '#37c0f6';

export default function PanelQueue({
  whoAmI,
  draftedNames,
  onDraft,
  canDraft, // NEW
}: {
  whoAmI?: `0x${string}`;
  draftedNames: Set<string>;
  onDraft: (p: RankedPlayerRow) => void;
  canDraft: boolean;
}) {
  const qKey = whoAmI ? `queue:${whoAmI.toLowerCase()}` : undefined;
  const [queue, setQueue] = useState<RankedPlayerRow[]>([]);

  // load + live updates (cheap poll)
  useEffect(() => {
    if (!qKey) return;
    let t = setInterval(() => {
      try {
        const raw = localStorage.getItem(qKey);
        const arr: RankedPlayerRow[] = raw ? JSON.parse(raw) : [];
        setQueue(arr);
      } catch {}
    }, 700);
    return () => clearInterval(t);
  }, [qKey]);

  const available = useMemo(() => queue.filter(q => !draftedNames.has(q.name)), [queue, draftedNames]);

  const remove = (name: string) => {
    if (!qKey) return;
    try {
      const next = (queue || []).filter(x => x.name !== name);
      localStorage.setItem(qKey, JSON.stringify(next));
      setQueue(next);
    } catch {}
  };

  return (
    <div>
      {available.length === 0 ? (
        <p className="text-sm text-gray-300 text-center">Your queue is empty.</p>
      ) : (
        <ul className="mx-auto max-w-xl space-y-2">
          {available.map((p, i) => (
            <li key={`${p.name}-${i}`} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-white/10 px-2 py-[2px] font-mono text-xs">{Number.isFinite(p.adp) ? p.adp : p.rank}</span>
                <span className="font-semibold">{p.name}</span>
                <span className="text-sm opacity-80">{p.team} · {p.position}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => canDraft && onDraft(p)}
                  disabled={!canDraft}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                    !canDraft
                      ? 'bg-gray-700/40 border border-gray-700/60 opacity-60 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-700 border border-emerald-700/50'
                  }`}
                  title={canDraft ? 'Draft player' : 'Not your turn'}
                >
                  DRAFT
                </button>
                <button
                  onClick={() => remove(p.name)}
                  className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 text-center text-xs opacity-75" style={{ color: ZIMA }}>
        Players are automatically removed from your queue when drafted.
      </div>
    </div>
  );
}
