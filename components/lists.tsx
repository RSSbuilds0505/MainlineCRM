import type { ReactNode } from 'react';
import type { Request, Settings } from '@/lib/db/schema';
import type { Lookup } from '@/lib/queries';
import { LBL, SUPPORT_LBL, clientStatus, isSupport, riskScore, supportCategoryLabel } from '@/lib/core';
import { Empty, ReqRow, SlaChip } from './ui';

export function StaffList({ reqs, L, s, empty }: { reqs: Request[]; L: Lookup; s: Settings; empty: string }): ReactNode {
  if (!reqs.length) return <Empty>{empty}</Empty>;
  const sorted = [...reqs].sort((a, b) => riskScore(b, s) - riskScore(a, s));
  return (
    <div className="reqs">
      {sorted.map((r) => (
        <ReqRow key={r.id} r={r} href={`/app/requests/${r.id}`}
          meta={`${isSupport(r) ? supportCategoryLabel(r.category) : L.skus.get(r.skuId)?.name ?? 'Service'} for ${L.orgs.get(r.orgId)?.name ?? ''}${r.assigneeId ? `, ${L.people.get(r.assigneeId)?.name ?? ''}` : isSupport(r) && r.status === 'scoped' ? ', needs an owner' : ''}`}
          right={<><SlaChip r={r} s={s} /><span className="small muted">{(isSupport(r) && SUPPORT_LBL[r.status]) || LBL[r.status]}</span></>} />
      ))}
    </div>
  );
}

export function ClientList({ reqs, L, empty }: { reqs: Request[]; L: Lookup; empty: string }): ReactNode {
  if (!reqs.length) return <Empty>{empty}</Empty>;
  return (
    <div className="reqs">
      {reqs.map((r) => (
        <ReqRow key={r.id} r={r} href={`/portal/requests/${r.id}`} client
          meta={`${isSupport(r) ? supportCategoryLabel(r.category) : L.skus.get(r.skuId)?.name ?? 'Service'}, submitted by ${r.submittedByName || 'your team'}`}
          right={<span className={`chip ${r.status === 'waiting' || r.status === 'delivered' ? 'risk' : 'plain'}`}>{clientStatus(r)}</span>} />
      ))}
    </div>
  );
}
