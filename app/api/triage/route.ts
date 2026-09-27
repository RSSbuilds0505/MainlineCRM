import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { orgs, skus } from '@/lib/db/schema';
import { getViewer } from '@/lib/auth';
import { allow } from '@/lib/ratelimit';
import { aiTriage } from '@/lib/triage';
import { llmEnabled } from '@/lib/llm';

export async function POST(req: Request): Promise<NextResponse> {
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: 'Sign in again to use suggestions.' }, { status: 401 });
  if (!llmEnabled()) return NextResponse.json({ error: 'Suggestions are not turned on yet. Pick the service yourself.' }, { status: 503 });
  const db = getDb();
  const lim = await allow(db, `ai:${v.id}`, 30, 3600);
  if (!lim.ok) return NextResponse.json({ error: `You have used all suggestions for this hour. Try again in ${Math.ceil(lim.retryAfter / 60)} minutes.` }, { status: 429, headers: { 'retry-after': String(lim.retryAfter) } });
  const body = (await req.json().catch(() => ({}))) as { text?: string; orgId?: string | null };
  const text = String(body.text ?? '').slice(0, 5000);
  const orgId = v.role === 'client' ? v.orgId : body.orgId ?? null;
  if (!orgId) return NextResponse.json({ error: 'Pick the client first.' }, { status: 400 });
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  if (!org) return NextResponse.json({ error: 'Pick the client first.' }, { status: 400 });
  const ai = await aiTriage(db, org, text);
  if (!ai) return NextResponse.json({ error: 'No suggestion this time. Pick the service yourself.' }, { status: 502 });
  const [k] = ai.skuId ? await db.select().from(skus).where(eq(skus.id, ai.skuId)) : [];
  return NextResponse.json({ suggestion: { skuId: ai.skuId, skuName: k?.name ?? 'Custom scope', priority: ai.priority, summary: ai.summary, missing: ai.missing, confidence: ai.confidence } });
}
