import type { ReactNode } from 'react';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { getSettings, lookups, visibleRequests } from '@/lib/queries';
import { ACTIVE, LBL, SUPPORT_LBL, TZ, isCsmRole, isLeadRole, isSupport, riskScore, sla, supportCategoryLabel } from '@/lib/core';
import type { Request } from '@/lib/db/schema';
import { Flash, Head, ReqRow, SlaChip } from '@/components/ui';
import { Overview } from '@/components/overview';

type Todo = { r: Request; tag: string; tone: 'hot' | 'warm' | 'plain' };

function greeting(name: string): string {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));
  return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${name.split(' ')[0]}`;
}

/**
 * Home: one list of the things this person should do next, most urgent first, each tagged with why it is here.
 * The owner and leads also get the overview of how the whole line is running underneath.
 */
export default async function Home({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireStaff();
  const db = getDb();
  const [rs, L, s] = await Promise.all([visibleRequests(db, v), lookups(db), getSettings(db)]);
  const lead = isLeadRole(v.role), csm = isCsmRole(v.role);
  const open = rs.filter((r) => ACTIVE.includes(r.status));

  // First matching reason wins, so each request shows once with its most important tag.
  const todo = new Map<string, Todo>();
  const add = (r: Request, tag: string, tone: Todo['tone']): void => { if (!todo.has(r.id)) todo.set(r.id, { r, tag, tone }); };
  for (const r of open) {
    const lvl = sla(r, s)?.level ?? 0;
    const sup = isSupport(r);
    if (v.role === 'owner' && lvl === 3) add(r, r.unhappy ? 'Client concern' : 'Needs you', 'hot');
    if (lead && r.unhappy) add(r, 'Client concern', 'hot');
    if (lead && lvl === 2) add(r, 'Overdue', 'hot');
    if (r.qaId === v.id && r.status === 'qa') add(r, 'QA review', 'warm');
    if (r.assigneeId === v.id && r.status === 'assigned') add(r, sup ? 'Start this ticket' : 'Start', lvl ? 'warm' : 'plain');
    if (r.assigneeId === v.id && r.status === 'in_progress') add(r, sup ? 'Resolve' : r.qaFails ? 'Fix QA notes' : 'Finish and submit for QA', lvl ? 'warm' : 'plain');
    if (csm && (r.status === 'submitted' || r.status === 'triaged')) add(r, 'Confirm and schedule', 'warm');
    if (csm && r.status === 'scoped') add(r, 'Needs an owner', 'warm');
  }
  const items = [...todo.values()].sort((a, b) => riskScore(b.r, s) - riskScore(a.r, s));
  const waiting = open.filter((r) => (r.status === 'waiting' || r.status === 'delivered') && (csm || r.assigneeId === v.id) && !todo.has(r.id));

  const meta = (r: Request): string => `${isSupport(r) ? supportCategoryLabel(r.category) : L.skus.get(r.skuId)?.name ?? 'Service'} for ${L.orgs.get(r.orgId)?.name ?? ''}${r.assigneeId && r.assigneeId !== v.id ? `, ${L.people.get(r.assigneeId)?.name ?? ''}` : ''}`;
  return (
    <>
      <Flash sp={searchParams} />
      <Head title={greeting(v.name)} sub={items.length ? `${items.length} ${items.length === 1 ? 'thing' : 'things'} for you, most urgent first.` : 'Nothing needs you right now.'} />
      {items.length ? (
        <div className="reqs todo">
          {items.map(({ r, tag, tone }) => (
            <ReqRow key={r.id} r={r} href={`/app/requests/${r.id}`} meta={meta(r)}
              right={<><span className={`chip todo-tag ${tone}`}>{tag}</span><SlaChip r={r} s={s} /></>} />
          ))}
        </div>
      ) : (
        <div className="empty caught-up"><strong>You&apos;re all caught up.</strong><br /><span className="small">New work shows up here as soon as it needs you. <Link href="/app/board">See everything on the board</Link></span></div>
      )}
      {waiting.length ? (
        <details className="panel waiting" style={{ marginTop: 14 }}>
          <summary><strong>Waiting on clients</strong> <span className="muted">{waiting.length}</span> <span className="small muted">Nothing to do until they reply or sign off.</span></summary>
          <div className="reqs" style={{ marginTop: 12 }}>
            {waiting.map((r) => (
              <ReqRow key={r.id} r={r} href={`/app/requests/${r.id}`} meta={meta(r)}
                right={<span className="small muted">{(isSupport(r) && SUPPORT_LBL[r.status]) || LBL[r.status]}</span>} />
            ))}
          </div>
        </details>
      ) : null}
      {lead ? <Overview v={v} month={searchParams.m} /> : null}
    </>
  );
}
