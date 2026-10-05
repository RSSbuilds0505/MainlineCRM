import type { ReactNode } from 'react';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { orgs } from '@/lib/db/schema';
import { requireClient } from '@/lib/auth';
import { lookups } from '@/lib/queries';
import { isCatalogSku } from '@/lib/core';
import { llmEnabled } from '@/lib/llm';
import { Flash, Head } from '@/components/ui';
import { ClientRequestForm } from '@/components/request-form';

export default async function PortalNewRequest({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireClient();
  const db = getDb();
  const [[org], L] = await Promise.all([db.select().from(orgs).where(eq(orgs.id, v.orgId!)), lookups(db)]);
  const skus = [...L.skus.values()].filter((k) => k.active && isCatalogSku(k) && (k.platform === 'Any' || k.platform === org.platform));
  return (
    <>
      <Link className="back" href="/portal/new">New</Link>
      <Flash sp={searchParams} />
      <Head title="Something built or changed" sub={org.billingModel === 'project' ? 'Work is tracked against your total project hours. Monthly credits do not apply.' : `${org.credits} credits available. Credits are only used once your team confirms the scope, and you can cancel before work starts.`} />
      <ClientRequestForm project={org.billingModel === 'project'} skus={skus} aiOn={llmEnabled()} preselect={searchParams.sku} />
    </>
  );
}
