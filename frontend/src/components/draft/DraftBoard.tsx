'use client';

import React from 'react';

const ZIMA = '#37c0f6';
const EGGSHELL = '#F0EAD6';
const ORANGE = '#f59e0b';
const RED = '#ef4444';

type Address = `0x${string}`;

export default function DraftBoard({
  header,
  rounds,
  isSnakeLike,
  reverseRound,
  currentCol,
  cellIsCurrent,
  arrowDirection,
  timePerPickSeconds,
  draftType,
  ended,
  remaining,
  isTrueReversalCell,
  pickLabelFor,
  picksMap, // map key `${round}.${slot}` => { name, team, pos }
}: {
  header: { owner: Address; name: string }[];
  rounds: number;
  isSnakeLike: boolean;
  reverseRound: (r: number) => boolean;
  currentCol: number;
  cellIsCurrent: (round: number, col: number) => boolean;
  arrowDirection: () => 'left' | 'right' | 'down' | null;
  timePerPickSeconds: number;
  draftType: number;
  ended: boolean;
  remaining: number;
  isTrueReversalCell: (round: number, col: number, n: number) => boolean;
  pickLabelFor: (round: number, col: number, n: number) => string;
  picksMap: Record<string, { name: string; team?: string; pos?: string } | undefined>;
}) {
  return (
    <div className="mt-3 space-y-3 min-w-max">
      {Array.from({ length: rounds }, (_, r) => r + 1).map((round) => (
        <div
          key={`round-${round}`}
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${header.length}, minmax(160px,1fr))` }}
        >
          {header.map((_, col) => {
            const isCur = cellIsCurrent(round, col);
            const showTimer = isCur && timePerPickSeconds > 0 && (draftType === 0 || draftType === 2) && !ended;
            const n = header.length;
            const trueReversal = isTrueReversalCell(round, col, n);
            const borderColor = isCur ? ZIMA : (trueReversal ? ORANGE : 'rgba(255,255,255,.10)');
            const background = isCur ? 'rgba(55,192,246,0.10)' : 'rgba(0,0,0,.40)';
            const dir = isCur ? arrowDirection() : null;

            const slot = reverseRound(round) ? (n - col) : (col + 1);
            const taken = picksMap[`${round}.${slot}`];

            return (
              <div
                key={`cell-${round}-${col}`}
                className="relative h-16 rounded-2xl border grid place-items-center text-sm"
                style={{ borderColor, background }}
              >
                {taken ? (
                  <div className="px-2 text-center">
                    <div className="font-semibold" style={{ color: EGGSHELL }}>{taken.name}</div>
                    <div className="text-xs opacity-80">{taken.team} · {taken.pos}</div>
                  </div>
                ) : showTimer ? (
                  <span className="inline-flex items-center gap-1">
                    {dir === 'left' && <span className="text-xs font-semibold" style={{ color: ZIMA }}>←</span>}
                    <span
                      className="rounded px-2 py-[3px] text-[13px] font-mono"
                      style={{
                        color: (remaining <= 60 ? RED : EGGSHELL),
                        background: 'rgba(255,255,255,.08)'
                      }}
                    >
                      {fmtClock(remaining)}
                    </span>
                    {dir === 'right' && <span className="text-xs font-semibold" style={{ color: ZIMA }}>→</span>}
                  </span>
                ) : (
                  <span className="text-gray-300">
                    {pickLabelFor(round, col, header.length)}
                  </span>
                )}

                {isCur && dir === 'down' && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs font-semibold" style={{ color: ZIMA }}>↓</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function fmtClock(s: number) {
  const sec = Math.max(0, Math.ceil(s));
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
