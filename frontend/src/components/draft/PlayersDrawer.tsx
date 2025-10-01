// src/components/draft/PlayersDrawer.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { type RankedPlayerRow } from '@/lib/auto-pick';

const ZIMA = '#37c0f6';
const EGGSHELL = '#F0EAD6';

type Props = {
  open: boolean;
  onToggle: () => void;
  league: `0x${string}`;
  draftedNames?: Set<string>;
  onDraft: (p: RankedPlayerRow) => void;
  whoAmI?: `0x${string}`;
  canDraft: boolean; // NEW: enable/disable draft button by turn
};

type SortKey = 'adp' | 'name' | 'position' | 'team' | 'rank';
type FilterAvail = 'all' | 'available' | 'drafted';
type FilterPos = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST' | 'FLEX';

export default function PlayersDrawer({
  open, onToggle, league, draftedNames, onDraft, whoAmI, canDraft,
}: Props) {
  const drafted = draftedNames ?? new Set<string>();

  const [rows, setRows] = useState<RankedPlayerRow[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('adp');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');
  const [pos, setPos] = useState<FilterPos>('ALL');
  const [avail, setAvail] = useState<FilterAvail>('available');

  // Load CSV
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const resp = await fetch('/hashmark-top300.csv', { cache: 'no-store' });
        const text = await resp.text();
        const lines = text.trim().split(/\r?\n/);
        const cols = lines[0].toLowerCase().split(',');
        const idx = {
          rank: cols.findIndex(h => /^(rank|#)$/i.test(h.trim())),
          name: cols.findIndex(h => /^name$/i.test(h.trim())),
          position: cols.findIndex(h => /^(position|pos)$/i.test(h.trim())),
          team: cols.findIndex(h => /^team$/i.test(h.trim())),
          adp: cols.findIndex(h => /^adp$/i.test(h.trim())),
        };
        const list: RankedPlayerRow[] = lines.slice(1).map((ln) => {
          const t = ln.split(',').map(s => s.trim());
          const rank = safeNum(t[idx.rank], Number.MAX_SAFE_INTEGER);
          const adp = safeNum(t[idx.adp], rank);
          return { rank, adp, name: t[idx.name], position: t[idx.position], team: t[idx.team] };
        }).filter(x => !!x?.name);
        if (!live) return;
        setRows(list);
      } catch {
        if (!live) return;
        setRows([]);
      }
    })();
    return () => { live = false; };
  }, []);

  // Queue storage
  const qKey = whoAmI ? `queue:${whoAmI.toLowerCase()}` : undefined;
  const [queueNames, setQueueNames] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!qKey) return;
    try {
      const raw = localStorage.getItem(qKey);
      const arr: RankedPlayerRow[] = raw ? JSON.parse(raw) : [];
      setQueueNames(new Set(arr.map(x => x.name)));
    } catch {}
  }, [qKey]);

  const filtered = useMemo(() => rows.filter(r => {
    if (pos !== 'ALL' && r.position !== pos) return false;
    const isDrafted = drafted.has(r.name);
    if (avail === 'available' && isDrafted) return false;
    if (avail === 'drafted' && !isDrafted) return false;
    return true;
  }), [rows, pos, avail, drafted]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a,b) => {
      const av = val(a, sortKey); const bv = val(b, sortKey);
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const isQueued = (name: string) => queueNames.has(name);
  const toggleQueue = (p: RankedPlayerRow) => {
    if (!qKey) return;
    try {
      const raw = localStorage.getItem(qKey);
      const arr: RankedPlayerRow[] = raw ? JSON.parse(raw) : [];
      const exists = arr.find(x => x.name === p.name);
      let next: RankedPlayerRow[];
      if (exists) next = arr.filter(x => x.name !== p.name);
      else next = [...arr, p].sort((a,b)=> (num(a.adp,a.rank) - num(b.adp,b.rank)));
      localStorage.setItem(qKey, JSON.stringify(next));
      setQueueNames(new Set(next.map(x => x.name)));
    } catch {}
  };

  const handleResetFilters = () => {
    setSortKey('adp'); setSortDir('asc'); setPos('ALL'); setAvail('available');
  };

  const th = (k: SortKey, label: string) => (
    <th
      className="py-2 px-2 cursor-pointer select-none"
      onClick={() => {
        setSortKey(prev => (prev === k ? prev : k));
        setSortDir(prev => (sortKey === k ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
      }}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k && <span className="text-xs opacity-70">{sortDir==='asc'?'▲':'▼'}</span>}
      </span>
    </th>
  );

  return (
    <>
      {/* Handle */}
      <div className="fixed inset-x-0 bottom-0 z-[70] pointer-events-none">
        <div className="mx-auto max-w-6xl pointer-events-auto">
          <button
            onClick={onToggle}
            className="mx-auto block rounded-t-2xl border-x border-t border-white/15 bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
            title={open ? 'Hide players' : 'Show players'}
          >
            {open ? '▼ Hide Players' : '▲ Show Players'}
          </button>
        </div>
      </div>

      {/* Drawer */}
      <div
        className="fixed inset-x-0 bottom-0 z-[69] transition-transform duration-300"
        style={{
          transform: open ? 'translateY(0)' : 'translateY(calc(100% - 2.5rem))',
        }}
      >
        <div className="mx-auto max-w-6xl h-[55vh] overflow-y-auto rounded-t-2xl border-x border-t border-white/15 bg-black/80 backdrop-blur px-3 py-2">
          {/* Controls */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="text-xs opacity-80" style={{ color: EGGSHELL }}>Filters:</div>
            <select value={pos} onChange={e=>setPos(e.target.value as FilterPos)} className="rounded-xl bg-white/10 border border-white/15 px-2 py-1 text-sm">
              {['ALL','QB','RB','WR','TE','K','DST','FLEX'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={avail} onChange={e=>setAvail(e.target.value as FilterAvail)} className="rounded-xl bg-white/10 border border-white/15 px-2 py-1 text-sm">
              <option value="available">Available</option>
              <option value="drafted">Drafted</option>
              <option value="all">All</option>
            </select>
            <button onClick={handleResetFilters} className="ml-auto rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15">Reset</button>
          </div>

          {/* Table */}
          {sorted.length === 0 ? (
            <div className="text-center text-sm text-gray-300 py-6">
              No players to display. Ensure <span className="font-mono">/hashmark-top300.csv</span> exists.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-black/75">
                <tr className="text-left" style={{ color: ZIMA }}>
                  {th('adp', 'ADP')}
                  {th('name', 'Name')}
                  {th('position', 'Pos')}
                  {th('team', 'Team')}
                  {th('rank', 'Rank')}
                  <th className="py-2 px-2 w-32 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(p => {
                  const alreadyDrafted = drafted.has(p.name);
                  const disabled = alreadyDrafted || !canDraft;
                  return (
                    <tr key={`${p.rank}-${p.name}`} className="border-t border-white/10">
                      <td className="py-1.5 px-2 font-mono">{displayAdp(p)}</td>
                      <td className="py-1.5 px-2 font-medium" style={{ color: '#F0EAD6' }}>{p.name}</td>
                      <td className="py-1.5 px-2">{p.position}</td>
                      <td className="py-1.5 px-2">{p.team}</td>
                      <td className="py-1.5 px-2">{p.rank}</td>
                      <td className="py-1.5 px-2 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => toggleQueue(p)}
                            className={`rounded-full px-2 py-1 text-xs border ${
                              isQueued(p.name)
                                ? 'border-yellow-500/50 bg-yellow-500/10'
                                : 'border-white/15 bg-white/5 hover:bg-white/10'
                            }`}
                            title={isQueued(p.name) ? 'Remove from queue' : 'Add to queue'}
                          >
                            ⭐
                          </button>
                          <button
                            onClick={() => !disabled && onDraft(p)}
                            disabled={disabled}
                            className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                              disabled
                                ? 'bg-gray-700/40 border border-gray-700/60 opacity-60 cursor-not-allowed'
                                : 'bg-emerald-600 hover:bg-emerald-700 border border-emerald-700/50'
                            }`}
                            title={
                              alreadyDrafted ? 'Already drafted'
                              : !canDraft ? 'Not your turn'
                              : 'Draft player'
                            }
                          >
                            DRAFT
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function displayAdp(p: RankedPlayerRow) {
  const v = Number.isFinite(p.adp) ? p.adp! : p.rank;
  return Number.isFinite(v) ? v : '—';
}
function val(r: RankedPlayerRow, key: 'adp'|'name'|'position'|'team'|'rank') {
  if (key === 'name' || key === 'team' || key === 'position') return (r as any)[key] || '';
  if (key === 'adp') return Number.isFinite(r.adp) ? (r.adp as number) : r.rank;
  if (key === 'rank') return r.rank;
  return '';
}
function safeNum(s?: string, fallback = 999999) { const n = Number(s ?? ''); return Number.isFinite(n) ? n : fallback; }
function num(a?: number, fallback?: number) { if (Number.isFinite(a)) return a as number; if (Number.isFinite(fallback)) return fallback as number; return Number.MAX_SAFE_INTEGER; }
