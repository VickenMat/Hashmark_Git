// src/app/league/[address]/layout.tsx
import { ReactNode } from "react";
import LeagueScope from "@/components/LeagueScope";

// Server component (no "use client")
export default async function LeagueSegmentLayout({
  children,
  params,
}: {
  children: ReactNode;
  // In Next 15, params is a Promise in server components:
  params: Promise<{ address: `0x${string}` }>;
}) {
  const { address } = await params;
  if (!address) return <>{children}</>;

  // Normalize to lowercase so API, localStorage, and UI are consistent
  const leagueLc = (address as string).toLowerCase() as `0x${string}`;

  // LeagueScope can be a client component; server layouts can render client components.
  return <LeagueScope league={leagueLc}>{children}</LeagueScope>;
}
