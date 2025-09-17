// src/app/league/[address]/settings/team-settings/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAccount, useReadContract } from 'wagmi';
import CommissionerGuard from '@/components/CommissionerGuard';
import { SaveButton, useOnchainWrite } from '@/components/OnchainForm';

const ZERO = '0x0000000000000000000000000000000000000000';

const ABI = [
  { type:'function', name:'getTeamByAddress', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'string'}] },
  { type:'function', name:'setTeamProfile',   stateMutability:'nonpayable', inputs:[{type:'string'},{type:'string'}], outputs:[] },
] as const;

/* ───────────────── helpers ───────────────── */
function shortAddr(a?: string){ if(!a) return '—'; return `${a.slice(0,6)}…${a.slice(-4)}`; }
function initials(n?: string){ const s=(n||'').trim(); if(!s) return 'TM'; const p=s.split(/\s+/); return ((p[0]?.[0]??'')+(p[1]?.[0]??'')).toUpperCase() || 'TM'; }
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(fr.error);
    fr.onload = () => res(String(fr.result));
    fr.readAsDataURL(file);
  });
}
/** Optional: if you wire an API route that returns { url } */
async function uploadImageToServer(file: File): Promise<string | undefined> {
  try {
    const body = new FormData();
    body.append('file', file);
    const resp = await fetch('/api/upload-image', { method: 'POST', body });
    if (!resp.ok) return undefined;
    const json = await resp.json();
    return typeof json?.url === 'string' ? json.url : undefined;
  } catch { return undefined; }
}

/* ───────────────── pill ───────────────── */
function MyTeamPill({ href, name, logo, wallet }:{
  href: string; name?: string; logo?: string; wallet?: `0x${string}` | undefined;
}) {
  const display = (name || '').trim() || 'My Team';
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] px-3 py-2 ring-1 ring-black/20 hover:border-fuchsia-400/60 transition"
      title="Go to My Team"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? (
        <img src={logo} alt={display} className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/15"/>
      ) : (
        <div className="h-9 w-9 rounded-xl bg-white/10 grid place-items-center text-xs font-bold">
          {initials(display)}
        </div>
      )}
      <div className="leading-tight text-left">
        <div className="font-semibold text-white">{display}</div>
        <div className="text-[11px] font-mono text-gray-300">{shortAddr(wallet)}</div>
      </div>
    </Link>
  );
}

/* ───────────────── page ───────────────── */
export default function Page() {
  const { address: league } = useParams<{ address:`0x${string}` }>();
  const { address: wallet } = useAccount();

  const { data: onChainName } = useReadContract({
    abi: ABI, address: league, functionName: 'getTeamByAddress',
    args: [wallet ?? ZERO], query: { enabled: !!wallet }
  });

  // reactive name when the read resolves
  const [name, setName] = useState<string>('');
  useEffect(() => { setName(((onChainName as string) ?? '') as string); }, [onChainName]);

  const [locked, setLocked] = useState(true);

  // logo: keep a preview (dataURL) and a persisted url to save on-chain
  const [logoPreview, setLogoPreview] = useState<string | undefined>(undefined);
  const [logoUrl, setLogoUrl] = useState<string>(''); // value we pass to setTeamProfile
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const write = useOnchainWrite();

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    // show preview immediately
    const dataUrl = await fileToDataUrl(f);
    setLogoPreview(dataUrl);

    // try to upload to your backend (optional)
    setUploading(true);
    const url = await uploadImageToServer(f);
    setUploading(false);

    setLogoUrl(url || dataUrl); // fall back to dataURL if no backend
    e.target.value = '';
  }

  const save = async () => {
    await write(
      { abi: ABI, address: league, functionName: 'setTeamProfile', args: [name, logoUrl || ''] },
      'Team updated.'
    );
    setLocked(true);
  };

  return (
    <CommissionerGuard>
      <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Header (centered title + My Team pill on right) */}
          <header className="flex items-start justify-between">
            <div className="flex-1" />
            <h1 className="text-3xl font-extrabold text-center flex-1">Team Settings</h1>
            <div className="flex-1 flex justify-end">
              <MyTeamPill
                href={`/league/${league}/team`}
                name={name || (onChainName as string)}
                logo={logoPreview || logoUrl}
                wallet={wallet}
              />
            </div>
          </header>

          {/* Single centered card */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="max-w-xl mx-auto space-y-8">
              {/* Team name (Lock/Unlock) */}
              <div className="text-center">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <div className="text-lg font-extrabold">Team name</div>
                  <button
                    onClick={() => setLocked(v => !v)}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:border-fuchsia-400/60"
                  >
                    {locked ? 'Unlock' : 'Lock'}
                  </button>
                </div>
                <input
                  value={name}
                  disabled={locked}
                  onChange={(e)=>setName(e.target.value)}
                  className={[
                    'w-full rounded-lg bg-black/40 border p-2 text-center',
                    locked ? 'border-white/10 text-gray-400 cursor-not-allowed' : 'border-fuchsia-400/60'
                  ].join(' ')}
                  placeholder="Your team name"
                />
              </div>

              {/* Team logo (Upload) */}
              <div className="text-center">
                <div className="text-lg font-extrabold mb-2">Team logo</div>
                <div className="flex items-center justify-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {logoPreview ? (
                    <img src={logoPreview} alt="preview" className="h-16 w-16 rounded-xl object-cover ring-1 ring-white/15"/>
                  ) : (
                    <div className="h-16 w-16 rounded-xl bg-white/10 grid place-items-center text-xs">No logo</div>
                  )}
                  <button
                    onClick={()=>fileRef.current?.click()}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm hover:border-fuchsia-400/60 disabled:opacity-50"
                    disabled={uploading}
                  >
                    {uploading ? 'Uploading…' : 'Upload'}
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickLogo}/>
                  {logoPreview && (
                    <button
                      onClick={()=>{ setLogoPreview(undefined); setLogoUrl(''); }}
                      className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm hover:border-pink-400/60"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div className="pt-2 text-center">
                <SaveButton onClick={save} />
              </div>
            </div>
          </section>
        </div>
      </main>
    </CommissionerGuard>
  );
}
