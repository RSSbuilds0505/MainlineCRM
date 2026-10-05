import type { ReactNode } from 'react';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { getSettings, lookups, visibleRequests } from '@/lib/queries';
import { ACTIVE, ROLE_LBL, isCsmRole, isLeadRole, isSupport, sla } from '@/lib/core';
import type { Request } from '@/lib/db/schema';
import { Flash, Head } from '@/components/ui';
import { StaffList } from '@/components/lists';

export default async function Queue({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireStaff();
  const db = getDb();
  const [rs, L, s] = await Promise.all([visibleRequests(db, v), lookups(db), getSettings(db)]);
  const lead = isLeadRole(v.role), csm = isCsmRole(v.role);
  const sec = (title: string, items: Request[], empty: string, more?: string): ReactNode => (
    <section key={title}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2>{title} <span className="muted" style={{ fontSize: 16 }}>{items.length}</span></h2>
        {more && items.length ? <Link className="small" href={more}>View on the board</Link> : null}
      </div>
      <StaffList reqs={items} L={L} s={s} empty={empty} />
    </section>
  );
  const open = rs.filter((r) => ACTIVE.includes(r.status));
  const out: ReactNode[] = [];
  if (v.role === 'owner') {
    out.push(sec('Needs you', open.filter((r) => sla(r, s)?.level === 3), 'Nothing needs you. The line is running.', '/app/board?risk=3'));
    out.push(sec('Breached SLA', open.filter((r) => sla(r, s)?.level === 2), 'No breaches.', '/app/board?risk=2'));
    out.push(sec('Open support tickets', open.filter(isSupport), 'No open support tickets.', '/app/board?kind=support'));
    out.push(sec('New from clients', open.filter((r) => r.status === 'submitted'), 'No untriaged requests.', '/app/board?src=portal'));
    out.push(sec('Waiting for assignment', open.filter((r) => r.status === 'scoped'), 'Routing is covering everything.'));
  } else {
    if (csm) out.push(sec('Support tickets', open.filter((r) => isSupport(r) && r.assigneeId !== v.id), 'No open support tickets.', '/app/board?kind=support'));
    if (csm) out.push(sec('Triage', open.filter((r) => r.status === 'submitted'), 'No new requests to triage.'));
    if (csm) out.push(sec('Ready to scope', open.filter((r) => r.status === 'triaged'), 'Nothing waiting on scope.'));
    if (csm) out.push(sec('Needs assignment', open.filter((r) => r.status === 'scoped'), 'Routing is covering everything.'));
    out.push(sec('Your support tickets', open.filter((r) => isSupport(r) && r.assigneeId === v.id && ['assigned', 'in_progress', 'waiting'].includes(r.status)), 'No support tickets assigned to you.'));
    out.push(sec('Your work', open.filter((r) => !isSupport(r) && r.assigneeId === v.id && ['assigned', 'in_progress', 'waiting'].includes(r.status)), 'Nothing assigned to you.'));
    out.push(sec('Your QA reviews', open.filter((r) => r.qaId === v.id && r.status === 'qa'), 'No QA reviews waiting.'));
    if (csm) out.push(sec('Waiting on a client answer', open.filter((r) => r.status === 'waiting'), 'No open client questions.'));
    if (csm) out.push(sec('Waiting on client sign-off', open.filter((r) => r.status === 'delivered'), 'Nothing waiting on a client.'));
    if (lead) out.push(sec('Escalations', open.filter((r) => (sla(r, s)?.level ?? 0) >= 2), 'No escalations.', '/app/board?risk=2'));
  }
  return (
    <>
      <Flash sp={searchParams} />
      <Head title={v.role === 'owner' ? 'Needs attention' : 'My queue'} sub={`${v.name}, ${ROLE_LBL[v.role]}. Sorted by SLA risk.`} />
      <div className="stack">{out}</div>
    </>
  );
}
