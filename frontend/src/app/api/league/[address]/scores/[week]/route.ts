export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getStore } from '@/lib/leagueStore';

export async function GET(_: Request, { params }: { params: { address: string; week: string } }) {
  const league = (params.address || '').toLowerCase();
  const week = Number(params.week);
  try {
    const store = await getStore();
    const data = await store.getScores(league, week);
    console.log('[scores.GET]', { league, week, ok: !!data });
    return NextResponse.json(data ?? {}, { headers: { 'x-runtime': 'nodejs' } });
  } catch (e) {
    console.error('[scores.GET][error]', { league, week, e });
    return NextResponse.json({ error: 'scores_get_failed' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { address: string; week: string } }) {
  const league = (params.address || '').toLowerCase();
  const week = Number(params.week);
  try {
    const body = await req.json();
    const store = await getStore();
    await store.setScores(league, week, body || {});
    console.log('[scores.POST]', { league, week, keys: Object.keys(body ?? {}).length });
    return NextResponse.json({ ok: true }, { headers: { 'x-runtime': 'nodejs' } });
  } catch (e) {
    console.error('[scores.POST][error]', { league, week, e });
    return NextResponse.json({ error: 'scores_post_failed' }, { status: 500 });
  }
}
