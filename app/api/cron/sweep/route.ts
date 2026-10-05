import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { sweep } from '@/lib/workflow';
import { deliver } from '@/lib/notify';

/** Called by Vercel Cron. Escalates SLA risk, auto-closes stale deliveries and resets monthly credits. */
export async function GET(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const res = await sweep(getDb(), { force: true });
  await deliver(res.out);
  return NextResponse.json(res.value);
}
