// src/components/League/OnchainForm.tsx
'use client';
import { useState } from 'react';
import { useWriteContract } from 'wagmi';
import { toast } from 'react-hot-toast';

export function SaveButton({ onClick, disabled, label='Save Settings' }:{
  onClick: () => Promise<void>;
  disabled?: boolean;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => { try { setBusy(true); await onClick(); } finally { setBusy(false); } }}
      disabled={busy || disabled}
      className="rounded-xl bg-purple-600 hover:bg-purple-700 px-6 py-3 font-bold disabled:opacity-50"
    >
      {busy ? 'Saving…' : label}
    </button>
  );
}

export function useOnchainWrite() {
  const { writeContractAsync } = useWriteContract();
  return async (args: Parameters<typeof writeContractAsync>[0], success='Saved on-chain.') => {
    const id = toast.loading('Submitting transaction…');
    try {
      await writeContractAsync(args);
      toast.success(success, { id });
    } catch (e:any) {
      toast.error(e?.shortMessage || e?.message || 'Transaction failed', { id });
      throw e;
    }
  };
}
