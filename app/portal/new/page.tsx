import type { ReactNode } from 'react';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { orgs } from '@/lib/db/schema';
import { requireClient } from '@/lib/auth';
import Link from 'next/link';
import { lookups } from '@/lib/queries';
import { isCatalogSku } from '@/lib/core';
import { llmEnabled } from '@/lib/llm';
import { Flash, Head } from '@/components/ui';
import { ClientRequestForm } from '@/components/request-form';

export default async function PortalNew({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireClient();
  const db = getDb();
  const [[org], L] = await Promise.all([db.select().from(orgs).where(eq(orgs.id, v.orgId!)), lookups(db)]);
  const skus = [...L.skus.values()].filter((k) => k.active && isCatalogSku(k) && (k.platform === 'Any' || k.platform === org.platform));
  return (
    <>
      <Flash sp={searchParams} />
      <Head title="New request" sub={`${org.credits} credits available. Credits are only used once your team confirms the scope, and you can cancel before work starts.`} />
      <div className="callout"><span>Something broken, or have a question? Open a support ticket instead. Support never uses credits.</span><Link className="btn ghost sm" href="/portal/support/new">Get support</Link></div>
      <ClientRequestForm skus={skus} aiOn={llmEnabled()} preselect={searchParams.sku} />
    </>
  );
}
