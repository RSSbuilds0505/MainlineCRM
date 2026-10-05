import type { ReactNode } from 'react';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { orgs } from '@/lib/db/schema';
import { requireClient } from '@/lib/auth';
import { lookups } from '@/lib/queries';
import { isCatalogSku } from '@/lib/core';
import Link from 'next/link';
import { Head } from '@/components/ui';

export default async function Services(): Promise<ReactNode> {
  const v = await requireClient();
  const db = getDb();
  const [[org], L] = await Promise.all([db.select().from(orgs).where(eq(orgs.id, v.orgId!)), lookups(db)]);
  const skus = [...L.skus.values()].filter((k) => k.active && isCatalogSku(k) && (k.platform === 'Any' || k.platform === org.platform));
  return (
    <>
      <Head title="Services" sub={`Everything your plan covers on ${org.platform}. Click a service to request it. Anything not listed can be requested as custom work.`}><Link className="btn ghost" href="/portal/new/support">Need help instead?</Link></Head>
      <div className="skus">
        {skus.map((k) => (
          <Link key={k.id} className="sku" href={`/portal/new/request?sku=${k.id}#nr`}>
            <span className="nm">{k.name}</span><span className="d">{k.description}</span>
            <span className="k"><span>{org.billingModel === 'project' ? `${k.estHours} estimated hours` : k.credits ? `${k.credits} credits` : 'Quoted after scoping'}</span><span className="go">Request this</span></span>
          </Link>
        ))}
      </div>
    </>
  );
}
