import type { ReactNode } from 'react';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { lookups, visibleRequests } from '@/lib/queries';
import { ACTIVE, isLeadRole } from '@/lib/core';
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
      <Head title="Clients" sub={`${orgs.length} accounts${isLeadRole(v.role) ? '' : ' in your pod'}`} />
      <div className="panel tw"><table>
        <thead><tr><th>Client</th><th>Platform</th><th>Pod</th><th>Portal contacts</th><th className="num">Credits left</th><th className="num">Open</th><th className="num">Revisions</th></tr></thead>
        <tbody>
          {orgs.map((o) => {
            const mine = rs.filter((r) => r.orgId === o.id);
            return (
              <tr key={o.id}>
                <td><strong>{o.name}</strong>{mine.some((r) => r.unhappy && r.status !== 'closed') ? <> <span className="chip lvl3">Concern</span></> : null}</td>
                <td>{o.platform}</td><td>{L.pods.get(o.podId ?? '')?.name ?? 'None'}</td>
                <td className="small">{contacts.filter((c) => c.orgId === o.id).map((c) => c.name).join(', ') || 'None yet'}</td>
                <td className="num">{o.credits} / {o.monthlyCredits}</td>
                <td className="num">{mine.filter((r) => ACTIVE.includes(r.status)).length}</td>
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
