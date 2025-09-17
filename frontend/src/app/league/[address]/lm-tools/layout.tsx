// src/app/league/[address]/lm-tools/layout.tsx
'use client';

import CommissionerGuard from '@/components/CommissionerGuard';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <CommissionerGuard>{children}</CommissionerGuard>;
}
