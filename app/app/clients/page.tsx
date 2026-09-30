import type { ReactNode } from 'react';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { lookups, visibleRequests } from '@/lib/queries';
import { ACTIVE, isLeadRole } from '@/lib/core';
import Link from 'next/link';
import { Head } from '@/components/ui';

export default async function Clients(): Promise<ReactNode> {
  const v = await requireStaff();
  const db = getDb();
  const [L, rs] = await Promise.all([lookups(db), visibleRequests(db, v)]);
  let orgs = [...L.orgs.values()].filter((o) => o.active);
  if (!isLeadRole(v.role)) orgs = orgs.filter((o) => o.podId === v.podId);
  const contacts = [...L.people.values()].filter((p) => p.role === 'client' && p.active);
  return (
    <>
      <Head title="Clients" sub={`${orgs.length} accounts${isLeadRole(v.role) ? '' : ' in your pod'}. Click a client to see everything about their account.`}>{isLeadRole(v.role) ? <Link className="btn ghost" href="/app/setup?edit=org:new#edit">Add a client</Link> : null}</Head>
      <div className="panel tw"><table>
        <thead><tr><th>Client</th><th>Platform</th><th>Pod</th><th>Portal contacts</th><th className="num">Credits left</th><th className="num">Open</th><th className="num">Revisions</th></tr></thead>
        <tbody>
          {orgs.map((o) => {
            const mine = rs.filter((r) => r.orgId === o.id);
            return (
              <tr key={o.id} className="rowlink">
                <td><Link className="stretch" href={`/app/clients/${o.id}`}><strong>{o.name}</strong></Link>{mine.some((r) => r.unhappy && r.status !== 'closed') ? <> <span className="chip lvl3">Concern</span></> : null}</td>
                <td>{o.platform}</td><td>{L.pods.get(o.podId ?? '')?.name ?? 'None'}</td>
                <td className="small">{contacts.filter((c) => c.orgId === o.id).map((c, i) => <span key={c.id}>{i ? ', ' : ''}<a className="lift" href={`mailto:${c.email}`}>{c.name}</a></span>)}{contacts.some((c) => c.orgId === o.id) ? null : 'None yet'}</td>
                <td className="num">{o.credits} / {o.monthlyCredits}</td>
                <td className="num"><Link className="lift" href={`/app/board?org=${o.id}`}>{mine.filter((r) => ACTIVE.includes(r.status)).length}</Link></td>
                <td className="num">{mine.reduce((t, r) => t + r.revisions, 0)}</td>
              </tr>
            );
          })}
          {!orgs.length ? <tr><td colSpan={7} className="muted">No clients yet.</td></tr> : null}
        </tbody>
      </table></div>
    </>
  );
}
