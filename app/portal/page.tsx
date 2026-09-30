import type { ReactNode } from 'react';
import Link from 'next/link';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { orgs, pods, profiles } from '@/lib/db/schema';
import { requireClient } from '@/lib/auth';
import { lookups, visibleRequests } from '@/lib/queries';
import { ACTIVE } from '@/lib/core';
import { Flash, Head, initials } from '@/components/ui';
import { ClientList } from '@/components/lists';

export default async function PortalHome({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireClient();
  const db = getDb();
  const [[org], rs, L] = await Promise.all([db.select().from(orgs).where(eq(orgs.id, v.orgId!)), visibleRequests(db, v), lookups(db)]);
  const [pod] = org.podId ? await db.select().from(pods).where(eq(pods.id, org.podId)) : [];
  const team = org.podId ? await db.select().from(profiles).where(and(eq(profiles.podId, org.podId), eq(profiles.active, true), inArray(profiles.role, ['csm', 'implementer']))) : [];
  const csm = pod?.csmId ? L.people.get(pod.csmId) : undefined;
  const open = rs.filter((r) => ACTIVE.includes(r.status));
  const needsYou = open.filter((r) => r.status === 'waiting' || r.status === 'delivered');
  const done = rs.filter((r) => !ACTIVE.includes(r.status));
  const pct = org.monthlyCredits ? Math.max(0, Math.min(100, (org.credits / org.monthlyCredits) * 100)) : 0;
  const showClosed = searchParams.closed === '1';
  return (
    <>
      <Flash sp={searchParams} />
      <Head title={org.name} sub={`${org.platform}, ${org.plan} plan`}><div className="row"><Link className="btn ghost" href="/portal/support/new">Get support</Link><Link className="btn sig" href="/portal/new">New request</Link></div></Head>
      <div className="grid2">
        <section className="stack">
          {needsYou.length ? <><h2>Needs your attention</h2><ClientList reqs={needsYou} L={L} empty="" /></> : null}
          <h2>Open requests</h2>
          <ClientList reqs={open.filter((r) => !needsYou.includes(r))} L={L} empty="Nothing else open. Start a new request when you need something built or changed, or open a support ticket if something is not working." />
          {done.length ? (
            <div className="stack">
              <div><Link className="btn ghost sm" href={showClosed ? '/portal' : '/portal?closed=1'}>{showClosed ? 'Hide' : 'Show'} completed requests ({done.length})</Link></div>
              {showClosed ? <ClientList reqs={done} L={L} empty="" /> : null}
            </div>
          ) : null}
        </section>
        <aside className="stack">
          <div className="panel"><h3>Credits</h3>
            <p style={{ margin: '8px 0 6px' }}><strong style={{ fontSize: 20 }}>{org.credits}</strong> <span className="muted">of {org.monthlyCredits} left this month</span></p>
            <div className={`meter ${pct < 20 ? 'hot' : pct < 40 ? 'warm' : ''}`}><i style={{ width: `${pct}%` }} /></div>
            <p className="small muted" style={{ margin: '8px 0 0' }}>Credits are used when your team confirms a request&apos;s scope, and refill on the 1st.</p>
          </div>
          <div className="panel"><h3>Need help?</h3>
            <p className="small" style={{ margin: '8px 0 10px' }}>Something broken, data looking wrong, or a quick question? Open a support ticket. It goes straight to your implementer and never uses credits.</p>
            <Link className="btn ghost sm" href="/portal/support/new">Open a support ticket</Link>
          </div>
          <div className="panel"><h3>Your team</h3>
            <div className="team" style={{ marginTop: 10 }}>
              {csm ? <div className="person"><span className="av">{initials(csm.name)}</span><div><strong>{csm.name}</strong><div className="small muted">Customer success manager</div></div></div> : null}
              {team.filter((p) => p.role === 'implementer').map((p) => <div key={p.id} className="person"><span className="av">{initials(p.name)}</span><div><strong>{p.name}</strong><div className="small muted">{p.platforms.join(', ')} specialist</div></div></div>)}
              {!csm && !team.length ? <p className="muted small">Your team is being assigned.</p> : null}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
