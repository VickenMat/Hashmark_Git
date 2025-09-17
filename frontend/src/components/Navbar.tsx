// src/components/Navbar.tsx
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccount, useReadContract, useChainId, useConfig } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';

function cx(...c: (string | boolean | undefined)[]) { return c.filter(Boolean).join(' '); }
function stripSlash(s: string) { return s.replace(/\/+$/, ''); }
function shortAddr(a?: string){ return a ? `${a.slice(0,6)}…${a.slice(-4)}` : ''; }

const MenuIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);

const ChevronDown = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
  </svg>
);

const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'commissioner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

/* ---------- Wallet controls (stacked pills) ---------- */
function ConnectControls() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        mounted,
        openAccountModal,
        openChainModal,
        openConnectModal,
      }) => {
        const ready = mounted;
        if (!ready) return null;

        if (!account) {
          return (
            <button
              onClick={openConnectModal}
              className="w-full rounded-2xl bg-gradient-to-r from-fuchsia-600 to-purple-600 px-4 py-2 font-semibold shadow-[0_8px_24px_-10px_rgba(168,85,247,0.7)] hover:brightness-110"
            >
              Connect Wallet
            </button>
          );
        }

        return (
          <div className="flex flex-col gap-2">
            <button
              onClick={openChainModal}
              className="w-full inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 hover:bg-white/[0.12] transition"
              aria-label="Select network"
            >
              {chain?.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={chain.iconUrl} alt={chain?.name ?? 'Chain'} className="h-5 w-5 rounded-full" />
              ) : (
                <span className="inline-block h-5 w-5 rounded-full bg-white/40" />
              )}
              <span className="truncate text-sm font-medium">{chain?.name ?? 'Select Network'}</span>
              <span className="ml-auto opacity-80">
                <ChevronDown />
              </span>
            </button>

            <button
              onClick={openAccountModal}
              className="w-full inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 hover:bg-white/[0.12] transition"
              aria-label="Account"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium leading-5">
                  {account?.displayName}
                </div>
              </div>
              {account?.displayBalance ? (
                <span className="ml-2 shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-xs opacity-90">
                  {account.displayBalance}
                </span>
              ) : null}
              <span className="ml-2 shrink-0 opacity-80">
                <ChevronDown />
              </span>
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

/* Parse /league/<addr>/matchup/<id> into lowercased team addrs if present */
function parseMatchupFromPath(path: string) {
  const m = path.match(/\/matchup\/([^/?#]+)/);
  if (!m) return null;
  try {
    const decoded = decodeURIComponent(m[1]);
    const [week, away, home] = decoded.split(':');
    if (!week || !away || !home) return null;
    return { id: m[1], week, away: away.toLowerCase(), home: home.toLowerCase() };
  } catch { return null; }
}

export default function Navbar() {
  const pathname = usePathname() || '/';
  const { address: wallet } = useAccount();

  const chainId = useChainId();
  const config  = useConfig();
  const chain   = React.useMemo(() => config?.chains?.find(c => c.id === chainId), [config, chainId]);

  const match = pathname.match(/^\/league\/(0x[0-9a-fA-F]{40})(?:\/|$)/);
  const leagueAddress = (match?.[1] as `0x${string}` | undefined);
  const base = leagueAddress ? `/league/${leagueAddress}` : undefined;

  // Read league name + commissioner (for tab visibility)
  const { data: leagueNameData } = useReadContract({
    abi: LEAGUE_ABI, address: leagueAddress, functionName: 'name',
    query: { enabled: Boolean(leagueAddress) },
  });
  const { data: commissionerData } = useReadContract({
    abi: LEAGUE_ABI, address: leagueAddress, functionName: 'commissioner',
    query: { enabled: Boolean(leagueAddress) },
  });

  const leagueName  = (leagueNameData as string | undefined)?.trim();
  const leagueShort = leagueAddress ? shortAddr(leagueAddress) : 'League';
  const isCommissioner = !!(wallet && commissionerData && wallet.toLowerCase() === String(commissionerData).toLowerCase());

  const myTeamHref = leagueAddress && wallet ? `${base}/team/${wallet}` : `${base}/my-team`;

  /* --------- Matchup link: only cache if matchup includes my wallet --------- */
  const [matchupHref, setMatchupHref] = useState<string | null>(null);
  const cacheKey = React.useMemo(
    () => (leagueAddress && wallet) ? `hashmark:lastMatchup:${leagueAddress}:${wallet.toLowerCase()}` : null,
    [leagueAddress, wallet]
  );

  const readCached = React.useCallback(() => {
    if (!cacheKey) return null;
    try { return localStorage.getItem(cacheKey); } catch { return null; }
  }, [cacheKey]);

  useEffect(() => {
    if (!base) { setMatchupHref(null); return; }
    setMatchupHref(readCached() || `${base}/scoreboard`);
  }, [base, readCached]);

  // Re-sync when the route changes.
  useEffect(() => {
    if (!leagueAddress || !wallet || !base) return;

    const parsed = parseMatchupFromPath(pathname);
    if (parsed) {
      const me = wallet.toLowerCase();
      if (parsed.away === me || parsed.home === me) {
        const href = `${base}/matchup/${parsed.id}`;
        setMatchupHref(href);
        try { cacheKey && localStorage.setItem(cacheKey, href); } catch {}
        return;
      }
    }
    // Otherwise, refresh from cache (updated by Scoreboard/Matchup)
    const saved = readCached();
    if (saved && saved !== matchupHref) setMatchupHref(saved);
  }, [pathname, leagueAddress, wallet, base, cacheKey, readCached, matchupHref]);

  // Listen for same-tab updates
  useEffect(() => {
    if (!cacheKey) return;
    const onUpdated = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (!wallet || !leagueAddress) return;
      if (String(d.league).toLowerCase() !== String(leagueAddress).toLowerCase()) return;
      if (String(d.owner).toLowerCase() !== wallet.toLowerCase()) return;
      if (typeof d.href === 'string') setMatchupHref(d.href);
    };
    // @ts-ignore
    window.addEventListener('hashmark:lastMatchupUpdated', onUpdated as EventListener);
    return () => {
      // @ts-ignore
      window.removeEventListener('hashmark:lastMatchupUpdated', onUpdated as EventListener);
    };
  }, [cacheKey, leagueAddress, wallet]);

  /* -------- Orders you requested -------- */
  const leagueMenu = useMemo(() => !leagueAddress || !base ? [] : [
    { label: 'Members',         href: `${base}/members` },
    { label: 'Rosters',         href: `${base}/rosters` },
    { label: 'Schedule',        href: `${base}/schedule` },
    { label: 'Recent Activity', href: `${base}/activity` },
    { label: 'Players',         href: `${base}/players` },
    { label: 'History',         href: `${base}/history` },
  ], [leagueAddress, base]);

  const mainTabs = useMemo(() => {
    if (!leagueAddress || !base) return [];
    const tabs = [
      { key: 'my-team',   label: 'My Team',   href: myTeamHref },
      { key: 'matchup',   label: 'Matchup',   href: matchupHref || `${base}/scoreboard` },
      { key: 'scoreboard',label: 'Scoreboard',href: `${base}/scoreboard` },
      { key: 'standings', label: 'Standings', href: `${base}/standings` },
      { key: 'settings',  label: 'Settings',  href: `${base}/settings` },
    ];
    if (isCommissioner) {
      tabs.push({ key: 'lm-tools', label: 'LM Tools', href: `${base}/lm-tools` });
    }
    return tabs;
  }, [leagueAddress, base, myTeamHref, matchupHref, isCommissioner]);

  const activeKey = useMemo(() => {
    if (!leagueAddress || !base) return undefined;
    const p = stripSlash(pathname);
    if (p === stripSlash(base)) return 'league';
    if (p === stripSlash(`${base}/my-team`) || p.startsWith(stripSlash(`${base}/team/`))) return 'my-team';
    if (p.startsWith(stripSlash(`${base}/matchup/`)))  return 'matchup';
    if (p.startsWith(stripSlash(`${base}/scoreboard`))) return 'scoreboard';
    if (p.startsWith(stripSlash(`${base}/standings`)))  return 'standings';
    if (p.startsWith(stripSlash(`${base}/settings`)))   return 'settings';
    if (p.startsWith(stripSlash(`${base}/lm-tools`)))   return 'lm-tools';
    return undefined;
  }, [pathname, leagueAddress, base]);

  const [open, setOpen] = useState(false);
  const [leagueOpen, setLeagueOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = () => setOpen(false);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const cls = 'has-vertical-sidebar';
    if (leagueAddress) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [leagueAddress]);

  const item    = 'block w-full px-5 py-2 text-[15px] font-medium text-gray-100 hover:text-white hover:bg-white/5 rounded-md';
  const divider = 'my-3 mx-4 border-t border-white/10';

  return (
    <>
      {leagueAddress && (
        <button
          className="lg:hidden fixed left-3 top-3 z-[200] rounded-xl bg-black/40 backdrop-blur border border-white/10 p-2 text-white hover:bg-black/60"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <MenuIcon />
        </button>
      )}

      {mounted && leagueAddress && open && createPortal(
        <>
          <div className="fixed inset-0 z-[2147483645] bg-black/60" onClick={() => setOpen(false)} />
          <aside
            className="fixed left-0 top-0 bottom-0 z-[2147483646] w-56 bg-[#0d1117] text-white border-r border-white/5 shadow-xl overflow-y-auto"
            role="dialog"
            aria-modal="true"
          >
            <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-3 px-5 pt-5">
              <Image src="/avalanche-avax-logo.svg" alt="Hashmark Logo" width={28} height={28} />
              <span className="text-2xl font-semibold leading-none">Hashmark</span>
            </Link>

            <div className="px-5 pt-4"><ConnectControls /></div>

            <div className="px-5 pt-3 pb-4">
              <Link href={`${base}`} onClick={() => setOpen(false)} className="text-lg font-extrabold tracking-tight hover:text-white/90">
                {leagueName || leagueShort}
              </Link>
            </div>

            <button
              onClick={() => setLeagueOpen(o => o ^ true)}
              className="w-full px-4 py-3 text-xs tracking-widest text-gray-400 hover:bg-white/5 text-left relative"
            >
              <span className={cx('absolute right-4 top-1/2 -translate-y-1/2 transition-transform', leagueOpen ? 'rotate-180' : '')}>▾</span>
              LEAGUE
            </button>
            {leagueOpen && (
              <div className="px-2">
                {leagueMenu.map((m) => (
                  <Link key={m.href} href={m.href} onClick={() => setOpen(false)} className={item}>
                    {m.label}
                  </Link>
                ))}
              </div>
            )}

            <div className={divider} />

            <nav className="px-2 pb-6">
              {mainTabs.map((t) => {
                const active = (activeKey === t.key) || (!activeKey && stripSlash(pathname) === stripSlash(t.href));
                return (
                  <Link
                    key={t.key}
                    href={t.key === 'my-team' && wallet ? `${base}/team/${wallet}` : t.href}
                    onClick={() => setOpen(false)}
                    className={cx(item, active && 'bg-white/8')}
                  >
                    {t.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
        </>,
        document.body
      )}

      {leagueAddress && (
        <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-56 bg-[#0d1117] text-white border-r border-white/5">
          <div className="flex flex-col w-full">
            <Link href="/" className="flex items-center gap-3 px-5 pt-5 pb-4">
              <Image src="/avalanche-avax-logo.svg" alt="Hashmark Logo" width={28} height={28} />
              <span className="text-2xl font-semibold leading-none">Hashmark</span>
            </Link>

            <div className="px-5"><ConnectControls /></div>

            <div className="px-5 pt-3 pb-4">
              <Link href={`${base}`} className="text-lg font-extrabold tracking-tight hover:text-white/90">
                {leagueName || leagueShort}
              </Link>
            </div>

            <details className="px-3">
              <summary className="list-none px-2 py-2 text-xs tracking-widest text-gray-400 flex items-center justify-between cursor-pointer">
                <span>LEAGUE</span><span>▾</span>
              </summary>
              <nav className="space-y-1">
                {leagueMenu.map((m) => (
                  <Link key={m.href} href={m.href} className="block rounded-md px-4 py-2 text-[15px] text-gray-200 hover:bg白/5 hover:text-white">
                    {m.label}
                  </Link>
                ))}
              </nav>
            </details>

            <div className="my-3 mx-4 border-t border-white/5" />

            <nav className="px-3 space-y-1">
              {mainTabs.map((t) => {
                const active = (activeKey === t.key) || (!activeKey && stripSlash(pathname) === stripSlash(t.href));
                return (
                  <Link
                    key={t.key}
                    href={t.key === 'my-team' && wallet ? `${base}/team/${wallet}` : t.href}
                    className={cx('block rounded-md px-4 py-2 text-[15px]', active ? 'bg-white/8 text-white' : 'text-gray-200 hover:bg-white/5 hover:text-white')}
                  >
                    {t.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>
      )}
    </>
  );
}
