// src/lib/teamProfile.ts
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useReadContract, useWatchContractEvent, useWriteContract } from 'wagmi';

export type TeamProfile = { name?: string; logo?: string; updatedAt?: number };

/* ── Deterministic geometric fallback (by owner address) ── */
export function generatedLogoFor(seed?: string | null): string {
  // Guard against undefined/empty inputs to avoid `seed.length` crash
  const s = typeof seed === 'string' && seed.length ? seed : 'anon';

  let h1 = 0x811c9dc5, h2 = 0x1b873593;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 0x85ebca6b);
    h2 ^= s.charCodeAt(i); h2 = Math.imul(h2, 0xc2b2ae35);
  }
  const rand = (n: number) => {
    h1 = Math.imul(h1 ^ (h1 >>> 15), 0x2c1b3c6d) ^ Math.imul(h2 ^ (h2 >>> 13), 0x297a2d39);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 0x1b873593);
    return Math.abs(h1 ^ h2) % n;
  };
  const hue = rand(360), sat = 55 + rand(20), lit = 45 + rand(10);
  const bg = `hsl(${(hue + 180) % 360} 25% 10%)`, fg = `hsl(${hue} ${sat}% ${lit}%)`;
  const size = 120, cells = 5, cell = size / cells; const rects: string[] = [];
  for (let y = 0; y < cells; y++) for (let x = 0; x < Math.ceil(cells / 2); x++) {
    if (rand(2) !== 1) continue; const px = x * cell, py = y * cell, mx = (cells - 1 - x) * cell;
    rects.push(`<rect x="${px}" y="${py}" width="${cell}" height="${cell}" rx="${cell/6}" />`);
    if (mx !== px) rects.push(`<rect x="${mx}" y="${py}" width="${cell}" height="${cell}" rx="${cell/6}" />`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs><clipPath id="r"><rect x="0" y="0" width="${size}" height="${size}" rx="${size/5}"/></clipPath></defs>
    <g clip-path="url(#r)"><rect width="100%" height="100%" fill="${bg}"/><g fill="${fg}">${rects.join('')}</g></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/* ── Contract interface ── */
export const PROFILE_ABI = [
  { type:'function', name:'getTeamProfile', stateMutability:'view',
    inputs:[{type:'address'}], outputs:[{type:'string'},{type:'string'},{type:'uint64'}] },
  { type:'function', name:'setTeamProfile', stateMutability:'nonpayable',
    inputs:[{type:'string'},{type:'string'}], outputs:[] },
  { type:'event', name:'TeamProfileUpdated', inputs:[
    { indexed:true,  name:'owner',    type:'address' },
    { indexed:false, name:'name',     type:'string'  },
    { indexed:false, name:'logoURI',  type:'string'  },
    { indexed:false, name:'updatedAt',type:'uint64'  },
  ]},
] as const;

/* ── URL helpers (tolerant to any IPFS shape) ── */
const GW_DEFAULT = 'https://gateway.pinata.cloud/ipfs';
const CID_RE = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[0-9a-z]{20,})$/i;

function gw() { return (process.env.NEXT_PUBLIC_IPFS_GATEWAY || GW_DEFAULT).replace(/\/+$/,''); }

/** → HTTPS you can <img src=.../> */
function toHttpFromAny(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();

  // data: already usable
  if (/^data:image\//i.test(s)) return s;

  // https: (normalize subdomain gateways to our path gateway)
  if (/^https:\/\//i.test(s)) {
    const sub = s.match(/^https:\/\/([a-z0-9]+)\.ipfs\.[^/]+(\/[^?#]*)?/i);
    if (sub) return `${gw()}/${sub[1]}${sub[2] ?? ''}`;
    return s;
  }

  // ipfs://CID[/path] or ipfs://ipfs/CID[/path]
  if (s.startsWith('ipfs://')) {
    let p = s.slice(7);
    if (p.startsWith('ipfs/')) p = p.slice(5);
    return `${gw()}/${p}`;
  }

  // /ipfs/CID[/path] or ipfs/CID[/path]
  if (s.startsWith('/ipfs/')) return `${gw()}${s}`;
  if (s.startsWith('ipfs/'))  return `${gw()}/${s.slice(5)}`;

  // Bare CID
  if (CID_RE.test(s)) return `${gw()}/${s}`;

  return undefined;
}

/** Ensure on-chain write is a clean ipfs://CID */
function toIpfsUri(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();

  if (s.startsWith('ipfs://')) {
    const p = s.slice(7).replace(/^ipfs\//, '');
    const cid = p.split(/[/?#]/)[0];
    return `ipfs://${cid}`;
  }
  const mPath = s.match(/\/ipfs\/([A-Za-z0-9]+)(?:[/?#]|$)/);
  if (mPath) return `ipfs://${mPath[1]}`;

  const mSub = s.match(/^https?:\/\/([A-Za-z0-9]+)\.ipfs\.[^/]+/);
  if (mSub) return `ipfs://${mSub[1]}`;

  if (CID_RE.test(s)) return `ipfs://${s}`;

  return undefined;
}

/* ── Hook ── */
export function useTeamProfile(
  league?: `0x${string}`,
  owner?: `0x${string}`,
  fallback: Partial<TeamProfile> = {},
): TeamProfile {
  // gate RPC until client is mounted to avoid SSR/CSR fetch noise
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const enabled = !!league && !!owner && mounted;

  const { data, refetch } = useReadContract({
    abi: PROFILE_ABI,
    address: league,
    functionName: 'getTeamProfile',
    args: owner ? [owner] : undefined, // avoid zero-address reads
    query: {
      enabled,
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  });

  useWatchContractEvent({
    address: league,
    abi: PROFILE_ABI,
    eventName: 'TeamProfileUpdated',
    enabled,
    onLogs(logs) {
      if (!owner) return;
      if (logs.some((l: any) => l.args?.owner?.toLowerCase() === owner.toLowerCase())) {
        refetch?.();
      }
    },
  });

  const name = (data?.[0] as string | undefined)?.trim() || fallback.name || '';
  const rawLogo = (data?.[1] as string | undefined) || '';
  const updatedAt = Number(data?.[2] ?? 0n);

  const logo = useMemo(() => {
    const http = toHttpFromAny(rawLogo);
    if (!http) return owner ? generatedLogoFor(owner) : undefined;
    const sep = http.includes('?') ? '&' : '?';
    return `${http}${sep}ut=${updatedAt || 0}`; // cache-bust when updated
  }, [rawLogo, updatedAt, owner]);

  return { name, logo, updatedAt };
}

/* ── Saver ── */
export function useSaveTeamProfile(league?: `0x${string}`) {
  const { writeContractAsync } = useWriteContract();

  return async function save(
    _owner: `0x${string}`,
    patch: { name?: string; logoDataUrl?: string; logoURI?: string },
  ) {
    if (!league) throw new Error('No league');

    // Prefer explicit logoURI (user pasted URL/CID), else upload dataUrl
    let logoURI = toIpfsUri(patch.logoURI);

    if (!logoURI && patch.logoDataUrl) {
      try {
        const r = await fetch('/api/uploadLogo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dataUrl: patch.logoDataUrl }),
        });
        if (r.ok) {
          const j = (await r.json()) as { cid?: string; uri?: string };
          logoURI = toIpfsUri(j.uri || j.cid || '');
        } else {
          // fallback: persist data URL if upload service fails
          logoURI = patch.logoDataUrl;
        }
      } catch {
        logoURI = patch.logoDataUrl;
      }
    }

    await writeContractAsync({
      abi: PROFILE_ABI,
      address: league,
      functionName: 'setTeamProfile',
      args: [patch.name ?? '', logoURI ?? ''],
    });
  };
}
