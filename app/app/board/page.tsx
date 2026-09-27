import type { ReactNode } from 'react';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { getSettings, lookups, visibleRequests } from '@/lib/queries';
import { ACTIVE, LBL, isLeadRole, riskScore } from '@/lib/core';
import type { Status } from '@/lib/db/schema';
import { Head, SlaChip, initials } from '@/components/ui';

export default async function Board({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireStaff();
  const db = getDb();
  const [all, L, s] = await Promise.all([visibleRequests(db, v), lookups(db), getSettings(db)]);
  const pod = searchParams.pod ?? 'all';
  let rs = all.filter((r) => ACTIVE.includes(r.status));
  if (isLeadRole(v.role) && pod !== 'all') rs = rs.filter((r) => L.orgs.get(r.orgId)?.podId === pod);
  const cols: Status[] = ['submitted', 'triaged', 'scoped', 'assigned', 'in_progress', 'waiting', 'qa', 'delivered'];
  return (
    <>
      <Head title="Board" sub={`${rs.length} open requests`}>
        {isLeadRole(v.role) ? (
          <form method="get" className="row">
            <label className="f" style={{ minWidth: 180 }}>Pod
              <select name="pod" defaultValue={pod}>
                <option value="all">All pods</option>
                {[...L.pods.values()].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <button className="btn ghost sm" type="submit" style={{ alignSelf: 'end' }}>Filter</button>
          </form>
        ) : null}
      </Head>
      <div className="board">
        {cols.map((c) => {
          const items = rs.filter((r) => r.status === c).sort((a, b) => riskScore(b, s) - riskScore(a, s));
          return (
            <div className="col" key={c}>
              <h3><span>{LBL[c]}</span><span className="muted">{items.length}</span></h3>
              {items.map((r) => (
                <Link key={r.id} className="card" href={`/app/requests/${r.id}`}>
                  <span className="small muted">ML-{r.num}, {L.orgs.get(r.orgId)?.name}</span>
                  <span className="title">{r.title}</span>
                  <span className="row" style={{ justifyContent: 'space-between' }}>
                    <SlaChip r={r} s={s} />
                    {r.assigneeId ? <span className="av sm" title={L.people.get(r.assigneeId)?.name}>{initials(L.people.get(r.assigneeId)?.name ?? '?')}</span> : null}
                  </span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
