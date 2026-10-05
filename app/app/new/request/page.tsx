import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { lookups } from '@/lib/queries';
import { isCatalogSku, isCsmRole } from '@/lib/core';
import { llmEnabled } from '@/lib/llm';
import { Empty, Flash, Head } from '@/components/ui';
import { StaffRequestForm } from '@/components/request-form';

export default async function NewRequest({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireStaff();
  if (!isCsmRole(v.role)) redirect('/app');
  const L = await lookups(getDb());
  const orgs = [...L.orgs.values()].filter((o) => o.active);
  if (!orgs.length) return <Empty>Add a client in Setup before logging requests.</Empty>;
  const org = orgs.find((o) => o.id === searchParams.org) ?? orgs[0];
  const skus = [...L.skus.values()].filter((k) => k.active && isCatalogSku(k) && (k.platform === 'Any' || k.platform === org.platform));
  return (
    <>
      <Link className="back" href="/app/new">New</Link>
      <Flash sp={searchParams} />
      <Head title="Something to build or change" sub="Log work a client asked for. Clients can also submit directly from their portal." />
      <StaffRequestForm orgs={orgs} org={org} skus={skus} aiOn={llmEnabled()} canTriage={isCsmRole(v.role)} />
    </>
  );
}
