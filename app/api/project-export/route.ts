import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getViewer } from '@/lib/auth';
import { orgs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { projectSummary } from '@/lib/projects';
import { csvField } from '@/lib/csv';
export async function GET(): Promise<Response> {
  const viewer = await getViewer();
  if (!viewer?.active || viewer.role !== 'owner') return NextResponse.json({ error: 'Only the owner can export project financial data.' }, { status: 403 });
  const db = getDb();
  const accounts = await db.select().from(orgs).where(eq(orgs.billingModel, 'project'));
  const lines = ['Client,Contracted hours,Logged hours,Remaining hours,Hourly rate,Project value,Logged value,Budget warning'];
  for (const account of accounts) {
    const summary = await projectSummary(db, viewer, account.id);
    if (summary) lines.push([account.name, summary.contracted, summary.logged, summary.remaining, summary.financial?.rate, summary.financial?.value, summary.financial?.loggedValue, summary.warning].map(csvField).join(','));
  }
  return new Response(lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="mainline-project-budgets.csv"', 'cache-control': 'no-store' } });
}
