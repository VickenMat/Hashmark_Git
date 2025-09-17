// Use this template for each page below.
// Example: src/app/league/[address]/settings/member-settings/page.tsx
'use client';
import CommissionerGuard from '@/components/CommissionerGuard';

export default function Page() {
  return (
    <CommissionerGuard>
      <main className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white px-6 py-10">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-extrabold mb-2">[PAGE TITLE]</h1>
          <p className="text-gray-400">Coming soon — this page will save settings on-chain.</p>
        </div>
      </main>
    </CommissionerGuard>
  );
}
