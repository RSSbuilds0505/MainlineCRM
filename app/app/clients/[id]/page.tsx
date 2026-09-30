import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { getSettings, lookups, visibleRequests } from '@/lib/queries';
import { ACTIVE, isCsmRole, isLeadRole, isSupport } from '@/lib/core';
import { Head, fmtWhen, initials } from '@/components/ui';
import { StaffList } from '@/components/lists';

/** One client account: who they are, who serves them, and everything open or recently finished, with quick actions. */
export default async function ClientPage({ params }: { params: { id: string } }): Promise<ReactNode> {
  const v = await requireStaff();
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const db = getDb();
  const [L, s, rs] = await Promise.all([lookups(db), getSettings(db), visibleRequests(db, v)]);
  const org = L.orgs.get(params.id);
  if (!org || (!isLeadRole(v.role) && org.podId !== v.podId)) notFound();
  const mine = rs.filter((r) => r.orgId === org.id);
  const open = mine.filter((r) => ACTIVE.includes(r.status));
  const done = mine.filter((r) => !ACTIVE.includes(r.status)).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 10);
  const pod = org.podId ? L.pods.get(org.podId) : undefined;
  const csm = pod?.csmId ? L.people.get(pod.csmId) : undefined;
  const team = [...L.people.values()].filter((p) => p.active && p.role === 'implementer' && p.podId === org.podId);
  const contacts = [...L.people.values()].filter((p) => p.role === 'client' && p.orgId === org.id && p.active);
  const pct = org.monthlyCredits ? Math.max(0, Math.min(100, (org.credits / org.monthlyCredits) * 100)) : 0;
  const person = (id: string, name: string, sub: string, email?: string): ReactNode => (
    <div key={id} className="person">
      <span className="av">{initials(name)}</span>
      <div><Link href={`/app/board?who=${id}`}><strong>{name}</strong></Link><div className="small muted">{sub}{email ? <> · <a href={`mailto:${email}`}>{email}</a></> : null}</div></div>
    </div>
  );
  return (
    <>
      <Link className="back" href="/app/clients">All clients</Link>
      <Head title={org.name} sub={`${org.platform}, ${org.plan} plan${pod ? `, ${pod.name}` : ''}${org.active ? '' : ' (paused)'}`}>
        <div className="row">
          {isCsmRole(v.role) ? <Link className="btn ghost" href={`/app/support/new?org=${org.id}`}>Log support ticket</Link> : null}
          {isCsmRole(v.role) ? <Link className="btn sig" href={`/app/new?org=${org.id}`}>New request</Link> : null}
        </div>
      </Head>
      <div className="kpis" style={{ marginBottom: 14 }}>
        <Link className="kpi link" href={`/app/board?org=${org.id}`}><b>{open.length}</b><span>Open, view on board</span></Link>
        <Link className="kpi link" href={`/app/board?org=${org.id}&kind=support`}><b>{open.filter(isSupport).length}</b><span>Open support tickets</span></Link>
        <div className="kpi"><b>{org.credits}</b><span>of {org.monthlyCredits} credits left</span><div className={`meter ${pct < 20 ? 'hot' : pct < 40 ? 'warm' : ''}`} style={{ marginTop: 8 }}><i style={{ width: `${pct}%` }} /></div></div>
        <div className="kpi"><b>{mine.reduce((t, r) => t + r.revisions, 0)}</b><span>Revisions and reopens</span></div>
      </div>
      <div className="grid2">
        <section className="stack">
          <h2>Open</h2>
          <StaffList reqs={open} L={L} s={s} empty={`Nothing open for ${org.name}.`} />
          <h2>Recently finished</h2>
          {done.length ? (
            <div className="panel tw"><table><tbody>
              {done.map((r) => (
                <tr key={r.id} className="rowlink">
                  <td><Link href={`/app/requests/${r.id}`}>ML-{r.num} {r.title}</Link>{isSupport(r) ? <span className="tag sup">Support</span> : null}</td>
                  <td className="small muted">{r.status === 'cancelled' ? 'Cancelled' : 'Closed'} {fmtWhen(r.closedAt ?? r.cancelledAt ?? r.updatedAt)}</td>
                </tr>
              ))}
            </tbody></table></div>
          ) : <p className="muted small" style={{ margin: 0 }}>Nothing finished yet.</p>}
        </section>
        <aside className="stack">
          <div className="panel stack">
            <h3>Portal contacts</h3>
            <div className="team">
              {contacts.map((c) => (
                <div key={c.id} className="person"><span className="av">{initials(c.name)}</span><div><strong>{c.name}</strong><div className="small"><a href={`mailto:${c.email}`}>{c.email}</a></div></div></div>
              ))}
              {!contacts.length ? <p className="small muted" style={{ margin: 0 }}>No portal contacts yet.</p> : null}
            </div>
            {isLeadRole(v.role) ? <Link className="btn ghost sm" href="/app/setup?edit=contact:new#edit">Add a portal contact</Link> : null}
          </div>
          <div className="panel stack">
            <h3>Their team</h3>
            <div className="team">
              {csm ? person(csm.id, csm.name, 'Customer success manager', csm.email) : null}
              {team.map((p) => person(p.id, p.name, `${p.platforms.join(', ')} implementer`, p.email))}
              {!csm && !team.length ? <p className="small muted" style={{ margin: 0 }}>No pod assigned yet.</p> : null}
            </div>
          </div>
          {isLeadRole(v.role) ? <Link className="btn ghost" href={`/app/setup?edit=org:${org.id}#edit`}>Edit account settings</Link> : null}
        </aside>
      </div>
    </>
  );
}
