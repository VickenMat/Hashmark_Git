// src/app/settings/team-profile/page.tsx
'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { saveTeamProfileGlobal, useTeamProfile } from '@/lib/teamProfile';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(fr.error);
    fr.onload = () => res(String(fr.result));
    fr.readAsDataURL(file);
  });
}

export default function TeamProfileSettings() {
  const { address } = useAccount();
  const prof = useTeamProfile(undefined, address, {});
  const [name, setName] = useState(prof.name ?? '');
  const [preview, setPreview] = useState<string | undefined>(prof.logo);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    setPreview(dataUrl);
  }

  function onSave() {
    if (!address) return alert('Connect a wallet first.');
    saveTeamProfileGlobal(address, { name: name.trim() || undefined, logo: preview });
    alert('Saved!');
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-[#0b0b14] to-black text-white px-6 py-10">
      <div className="mx-auto max-w-lg space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-extrabold">Team Profile</h1>
          <Link href="/team" className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm hover:border-fuchsia-400/60">
            My Team
          </Link>
        </header>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
          <label className="block text-sm text-gray-300">
            Team Name
            <input
              value={name}
              onChange={(e)=>setName(e.target.value)}
              className="mt-1 w-full rounded-md bg-black/40 border border-white/10 px-3 py-2"
              placeholder="Your team name"
            />
          </label>

          <div className="space-y-2">
            <div className="text-sm text-gray-300">Team Photo</div>
            <div className="flex items-center gap-3">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="preview" className="h-16 w-16 rounded-xl object-cover ring-1 ring-white/15"/>
              ) : (
                <div className="h-16 w-16 rounded-xl bg-white/10 grid place-items-center text-xs">No photo</div>
              )}
              <button
                onClick={()=>fileRef.current?.click()}
                className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm hover:border-fuchsia-400/60"
              >Choose File</button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickLogo}/>
              {preview && (
                <button
                  onClick={()=>setPreview(undefined)}
                  className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm hover:border-pink-400/60"
                >Remove</button>
              )}
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={onSave}
              className="rounded-lg bg-fuchsia-600/80 hover:bg-fuchsia-600 px-4 py-2 font-semibold"
            >Save</button>
          </div>
        </div>
      </div>
    </main>
  );
}
