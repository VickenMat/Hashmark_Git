// src/components/Navbar.tsx
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { useAccount, useReadContract, useChainId, useConfig } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';

function cx(...c: (string | boolean | undefined)[]) { return c.filter(Boolean).join(' '); }
function stripSlash(s: string) { return s.replace(/\/+$/, ''); }
function shortAddr(a?: string){ return a ? `${a.slice(0,6)}…${a.slice(-4)}` : ''; }

/* Icons */
const MenuIcon   = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);
const ChevronDown= (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6"/>
  </svg>
);
const ArrowLeft  = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
  </svg>
);

/* Theme */
type Theme = 'light' | 'dark';
function applyTheme(t: Theme) {
  const r = document.documentElement;
  t === 'dark' ? r.classList.add('dark') : r.classList.remove('dark');
  try { localStorage.setItem('theme', t); } catch {}
}
function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => {
    let next: Theme = 'dark';
    try {
      const s = localStorage.getItem('theme');
      if (s === 'light' || s === 'dark') next = s as Theme;
      else if (window.matchMedia?.('(prefers-color-scheme: light)').matches) next = 'light';
    } catch {}
    setTheme(next); applyTheme(next);
  }, []);
  return [theme, (t) => { setTheme(t); applyTheme(t); }];
}
function ThemeToggleSmall({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle theme"
      className={cx(
        'inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm transition',
        'border-black/10 bg-white text-gray-900 hover:bg-gray-50',
        'dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/15',
        className
      )}
    >
      {theme === 'dark'
        ? <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        : <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 1 0 9.79 9.79Z"/></svg>}
    </button>
  );
}

/* ===== TOP BAR connect: network (white), AVAX balance pill, account ===== */
function TopConnect() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        if (!mounted) return null;

        const netLabel =
          chain?.id === 43113 ? 'FUJI'
          : chain?.id === 43114 ? 'Avalanche'
          : (chain?.name ?? 'Select Network');

        if (!account) {
          return (
            <button
              onClick={openConnectModal}
              className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/15"
            >
              Connect
            </button>
          );
        }

        return (
          <div className="flex items-center gap-2">
            <button
              onClick={openChainModal}
              className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/15"
            >
              {netLabel}
            </button>

            {account.displayBalance && (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-sm text-white">
                <Image src="/avalanche-avax-logo.svg" alt="AVAX" width={14} height={14} />
                <span className="tabular-nums">{account.displayBalance}</span>
              </div>
            )}

            <button
              onClick={openAccountModal}
              className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-sm text-white/90 hover:text-white hover:bg-white/15"
            >
              {account.displayName}
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

/* ===== SIDE BAR connect: combined 'Network + Address' pill (styled) ===== */
function ConnectControls() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        if (!mounted) return null;

        const netLabel =
          chain?.id === 43113 ? 'FUJI'
          : chain?.id === 43114 ? 'Avalanche'
          : (chain?.name ?? 'Network');

        if (!account) {
          return (
            <button
              onClick={openConnectModal}
              className="w-full rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 px-3 py-2 font-semibold text-white shadow-[0_8px_24px_-10px_rgba(168,85,247,0.7)] hover:brightness-110"
            >
              Connect Wallet
            </button>
          );
        }

        // Styled split-control pill: left = Network chip, right = address; subtle divider + focus states
        return (
          <div
            className="group w-full rounded-xl border border-white/10 bg-white/5 px-2 py-1.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] flex items-center gap-2"
          >
            <button
              onClick={openChainModal}
              aria-label="Select network"
              className="shrink-0 inline-flex items-center rounded-md border border-white/10 bg-white/10 px-2 py-0.5 text-[11px] font-medium leading-5 tracking-wide uppercase text-white/90 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              {netLabel}
            </button>

            <span aria-hidden className="h-4 w-px bg-white/10" />

            <button
              onClick={openAccountModal}
              aria-label="Account"
              title={account?.address}
              className="ml-auto truncate text-sm opacity-95 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded"
            >
              {account.displayName}
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

/* On-chain reads */
const LEAGUE_ABI = [
  { type:'function', name:'name', stateMutability:'view', inputs:[], outputs:[{type:'string'}] },
  { type:'function', name:'commissioner', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
] as const;

function parseMatchupFromPath(p: string) {
  const m = p.match(/\/matchup\/([^/?#]+)/);
  if (!m) return null;
  try {
    const [w, a, h] = decodeURIComponent(m[1]).split(':');
    if (!w || !a || !h) return null;
    return { id: m[1], week: w, away: a.toLowerCase(), home: h.toLowerCase() };
  } catch { return null; }
}

/* Dimensions */
const SIDEBAR_W = 208;
const SKINNY_W  = 48;
const OUT_BTN_GAP = 8;

export default function Navbar() {
  const pathname = usePathname() || '/';
  const { address: wallet } = useAccount();

  const chainId = useChainId();
  const config  = useConfig();
  const chain   = React.useMemo(() => config?.chains?.find(c => c.id === chainId), [config, chainId]);

  const match = pathname.match(/^\/league\/(0x[0-9a-fA-F]{40})(?:\/|$)/);
  const leagueAddress = (match?.[1] as `0x${string}` | undefined);
  const base = leagueAddress ? `/league/${leagueAddress}` : undefined;

  const { data: leagueNameData } = useReadContract({ abi: LEAGUE_ABI, address: leagueAddress, functionName: 'name', query: { enabled: Boolean(leagueAddress) }});
  const { data: commissionerData } = useReadContract({ abi: LEAGUE_ABI, address: leagueAddress, functionName: 'commissioner', query: { enabled: Boolean(leagueAddress) }});

  const leagueName  = (leagueNameData as string | undefined)?.trim();
  const leagueShort = leagueAddress ? shortAddr(leagueAddress) : 'League';
  const isCommissioner = !!(wallet && commissionerData && wallet.toLowerCase() === String(commissionerData).toLowerCase());
  const myTeamHref = leagueAddress && wallet ? `${base}/team/${wallet}` : `${base}/my-team`;

  /* Hydration-safe UI state */
  const [hydrated, setHydrated] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [overlayMode, setOverlayMode] = useState(false);
  useEffect(() => {
    setHydrated(true);
    try { setCollapsed(localStorage.getItem('hm:navCollapsed') === '1'); } catch {}
    const onResize = () => setOverlayMode(window.innerWidth < 1024);
    onResize(); window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => { try { localStorage.setItem('hm:navCollapsed', collapsed ? '1' : '0'); } catch {} }, [collapsed]);

  /* Matchup cache */
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
    const saved = readCached();
    if (saved && saved !== matchupHref) setMatchupHref(saved);
  }, [pathname, leagueAddress, wallet, base, cacheKey, readCached, matchupHref]);

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
      { key: 'my-team',   label: 'My Team',    href: myTeamHref },
      { key: 'matchup',   label: 'Matchup',    href: matchupHref || `${base}/scoreboard` },
      { key: 'scoreboard',label: 'Scoreboard', href: `${base}/scoreboard` },
      { key: 'standings', label: 'Standings',  href: `${base}/standings` },
      { key: 'settings',  label: 'Settings',   href: `${base}/settings` },
    ];
    if (isCommissioner) tabs.push({ key: 'lm-tools', label: 'LM Tools', href: `${base}/lm-tools` });
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

  /* Home top bar (Hashmark bigger previously) */
  const onHome = !leagueAddress;
  if (onHome) {
    return (
      <header className="sticky top-0 z-40 w-full border-b border-transparent bg-transparent backdrop-blur">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 sm:px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/avalanche-avax-logo.svg" alt="Hashmark Logo" width={24} height={24} />
            <span className="text-2xl font-semibold">Hashmark</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggleSmall />
            <TopConnect />
          </div>
        </div>
      </header>
    );
  }

  /* Collapsed rail (TRANSPARENT) */
  if (hydrated && collapsed) {
    return (
      <>
        <aside
          className="fixed left-0 top-0 bottom-0 z-40 text-gray-900 dark:text-white bg-transparent border-none"
          style={{ width: SKINNY_W }}
          aria-label="Collapsed sidebar"
        >
          <div className="flex h-full flex-col items-center py-3 gap-3">
            <button
              className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white hover:text-gray-300 hover:bg-white/10"
              aria-label="Open sidebar"
              onClick={() => setCollapsed(false)}
            >
              <MenuIcon />
            </button>
            <Link href="/" title="Home">
              <Image src="/avalanche-avax-logo.svg" alt="Hashmark Logo" width={24} height={24} />
            </Link>
            <div className="mt-auto mb-2">
              <ThemeToggleSmall />
            </div>
          </div>
        </aside>
      </>
    );
  }

  /* Expanded sidebar (OPAQUE DARK GRAY) */
  const item    = 'block w-full px-3 py-1.5 text-[14px] rounded-md transition text-gray-200 hover:bg-white/6 hover:text-white';
  const itemActive = 'bg-white/10 text-white';

  return (
    <>
      <aside
        className="fixed left-0 top-0 bottom-0 z-50 text-white"
        style={{ width: SIDEBAR_W, backgroundColor: '#1c2128' }} // dark gray
        aria-label="Sidebar"
      >
        <div className="flex h-full flex-col px-4 pt-5 pb-3">
          {/* Brand (flush with tabs) */}
          <Link href="/" className="flex items-center gap-2 mb-3 pl-3">
            <Image src="/avalanche-avax-logo.svg" alt="Hashmark Logo" width={24} height={24} />
            <span className="text-2xl font-semibold leading-none">Hashmark</span>
          </Link>

          {/* Combined network + address pill (styled) */}
          <div className="mb-2"><ConnectControls /></div>

          {/* League title (pill, clickable) */}
          <div className="pb-1">
            <Link
              href={base!}
              className="block rounded-md px-3 py-1.5 text-[14px] font-extrabold tracking-tight text-white/90 hover:bg-white/10 hover:text-white"
            >
              {leagueName || leagueShort}
            </Link>
          </div>

          {/* League dropdown (closed by default) */}
          <button
            className="mb-1 inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] tracking-wide uppercase text-white/75 hover:text-white hover:bg-white/6"
            type="button"
            onClick={() => { const el = document.getElementById('league-subnav'); if (el) el.classList.toggle('hidden'); }}
          >
            <span>League</span><ChevronDown className="opacity-80" />
          </button>

          <nav id="league-subnav" className="space-y-1 hidden mb-2">
            {leagueMenu.map(m => (
              <Link key={m.href} href={m.href} className={item}>{m.label}</Link>
            ))}
          </nav>

          {/* Main tabs */}
          <nav className="space-y-1">
            {[
              { key:'my-team',   label:'My Team',    href: leagueAddress && wallet ? `${base}/team/${wallet}` : `${base}/my-team` },
              { key:'matchup',   label:'Matchup',    href: (matchupHref || `${base}/scoreboard`)! },
              { key:'scoreboard',label:'Scoreboard', href: `${base}/scoreboard` },
              { key:'standings', label:'Standings',  href: `${base}/standings` },
              { key:'settings',  label:'Settings',   href: `${base}/settings` },
              ...(isCommissioner ? [{ key:'lm-tools', label:'LM Tools', href:`${base}/lm-tools` }]:[])
            ].map(t => {
              const p = stripSlash(pathname);
              const active = t.key === 'my-team'
                ? (p === stripSlash(`${base}/my-team`) || p.startsWith(stripSlash(`${base}/team/`)))
                : p.startsWith(stripSlash(t.href));
              return (
                <Link key={t.key} href={t.href} className={cx(item, active && itemActive)}>
                  {t.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto flex justify-end pt-2"><ThemeToggleSmall /></div>
        </div>
      </aside>

      {/* Outside chevron — hover turns gray */}
      <button
        onClick={() => setCollapsed(true)}
        aria-label="Collapse sidebar"
        className="fixed top-4 z-50 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white hover:text-gray-300 hover:bg-white/10"
        style={{ left: SIDEBAR_W + OUT_BTN_GAP }}
      >
        <ArrowLeft />
      </button>

      {/* Tap-anywhere overlay on small screens */}
      {overlayMode && (
        <div
          className="fixed top-0 right-0 bottom-0 z-40 bg-black/40 lg:hidden"
          style={{ left: SIDEBAR_W }}
          onClick={() => setCollapsed(true)}
        />
      )}
    </>
  );
}
