export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getStore } from '@/lib/leagueStore';

export async function GET(_: Request, { params }: { params: { address: string } }) {
  const league = (params.address || '').toLowerCase();
  try {
    const store = await getStore();
    const data = await store.getSchedule(league);
    console.log('[schedule.GET]', { league, ok: !!data });
    return NextResponse.json(data ?? { pairings: {}, status: {} }, { headers: { 'x-runtime': 'nodejs' } });
  } catch (e) {
    console.error('[schedule.GET][error]', { league, e });
    return NextResponse.json({ error: 'schedule_get_failed' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { address: string } }) {
  const league = (params.address || '').toLowerCase();
  try {
    const body = await req.json();
    const store = await getStore();
    await store.setSchedule(league, { pairings: body?.pairings ?? {}, status: body?.status ?? {} });
    console.log('[schedule.POST]', { league, pairings: Object.keys(body?.pairings ?? {}).length, status: Object.keys(body?.status ?? {}).length });
    return NextResponse.json({ ok: true }, { headers: { 'x-runtime': 'nodejs' } });
  } catch (e) {
    console.error('[schedule.POST][error]', { league, e });
    return NextResponse.json({ error: 'schedule_post_failed' }, { status: 500 });
  }
}
