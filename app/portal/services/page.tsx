import type { ReactNode } from 'react';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { orgs } from '@/lib/db/schema';
import { requireClient } from '@/lib/auth';
import { lookups } from '@/lib/queries';
import { isCatalogSku } from '@/lib/core';
import { Head } from '@/components/ui';

export default async function Services(): Promise<ReactNode> {
  const v = await requireClient();
  const db = getDb();
  const [[org], L] = await Promise.all([db.select().from(orgs).where(eq(orgs.id, v.orgId!)), lookups(db)]);
  const skus = [...L.skus.values()].filter((k) => k.active && isCatalogSku(k) && (k.platform === 'Any' || k.platform === org.platform));
  return (
    <>
      <Head title="Services" sub={`Everything your plan covers on ${org.platform}. Anything not listed can be requested as custom work.`} />
      <div className="skus">
        {skus.map((k) => (
          <div key={k.id} className="sku">
            <span className="nm">{k.name}</span><span className="d">{k.description}</span>
            <span className="k"><span>{k.credits ? `${k.credits} credits` : 'Quoted after scoping'}</span><span>{k.category}</span></span>
          </div>
        ))}
      </div>
    </>
  );
}
