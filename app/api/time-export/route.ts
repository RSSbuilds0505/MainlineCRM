import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getViewer } from '@/lib/auth';
import { isLeadRole } from '@/lib/core';
import { csvField } from '@/lib/csv';
import { lookups, timeRows } from '@/lib/queries';

export async function GET(req: Request): Promise<Response> {
  const v = await getViewer();
  if (!v || !isLeadRole(v.role)) return NextResponse.json({ error: 'Only leads can export time.' }, { status: 403 });
  const u = new URL(req.url);
  const from = u.searchParams.get('from') ?? '', to = u.searchParams.get('to') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return NextResponse.json({ error: 'Bad date range.' }, { status: 400 });
  const db = getDb();
  const [rows, L] = await Promise.all([timeRows(db, v, from, to, u.searchParams.get('who') || null), lookups(db)]);
  const q = csvField;
  const csv = ['Date,Person,Client,Service,Request ID,Hours,Note',
    ...rows.map((t) => [t.workDate, L.people.get(t.staffId)?.name, L.orgs.get(t.orgId)?.name, L.skus.get(t.skuId)?.name, t.requestId, t.hours, t.note].map(q).join(','))].join('\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="mainline-time-${from}-to-${to}.csv"` } });
}
