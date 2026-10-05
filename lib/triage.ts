import { and, eq, inArray, ne } from 'drizzle-orm';
import type { DB } from './db';
import { skus, type AiTriage, type Org } from './db/schema';
import { SUPPORT_SKU } from './core';
import { complete } from './llm';
import { TRIAGE_V1 } from './llm/prompts';

/** AI suggestion for service, priority and clarifying questions. Returns null when AI is off or fails. */
export async function aiTriage(db: DB, org: Pick<Org, 'platform'>, text: string): Promise<AiTriage | null> {
  const list = await db.select().from(skus).where(and(eq(skus.active, true), ne(skus.id, SUPPORT_SKU), inArray(skus.platform, ['Any', org.platform])));
  const catalog = list.map((k) => ({ code: k.id, name: k.name, category: k.category, description: k.description }));
  const res = await complete({ purpose: TRIAGE_V1.version, system: TRIAGE_V1.system, prompt: TRIAGE_V1.build(org.platform, catalog, text), maxTokens: 500, timeoutMs: 20_000 });
  if (!res) return null;
  const m = res.text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const out = JSON.parse(m[0]) as { sku_code?: string; confidence?: number; priority?: string; priority_reason?: string; missing_info?: unknown; scope_summary?: string };
    const custom = list.find((k) => /custom/i.test(k.name));
    let skuId = list.some((k) => k.id === out.sku_code) ? (out.sku_code as string) : custom?.id ?? null;
    const confidence = Number(out.confidence) || 0;
    if (confidence < 0.7 && custom) skuId = custom.id;
    const pri = ['urgent', 'high', 'normal', 'low'].includes(String(out.priority)) ? (out.priority as AiTriage['priority']) : 'normal';
    return {
      skuId, confidence, priority: pri, priorityReason: String(out.priority_reason ?? ''),
      missing: (Array.isArray(out.missing_info) ? out.missing_info : []).slice(0, 3).map(String),
      summary: String(out.scope_summary ?? ''), at: Date.now(),
    };
  } catch {
    return null;
  }
}
