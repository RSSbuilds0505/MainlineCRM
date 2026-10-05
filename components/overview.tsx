import type { ReactNode } from 'react';
import Link from 'next/link';
import { gte, lt, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { timelogs } from '@/lib/db/schema';
import type { Profile } from '@/lib/db/schema';
import { finance, getSettings, hoursByRequest, lookups, visibleRequests } from '@/lib/queries';
import { ACTIVE, TZ, isSupport, sla } from '@/lib/core';
import { openHoursByStaff } from '@/lib/workflow';
import { hrs, money } from '@/components/ui';
import { projectSummary } from '@/lib/projects';
import { ProjectBudget } from '@/components/project-budget';
import { StaffList } from '@/components/lists';

function monthBounds(back: number): [string, string, string] {
  const now = new Date(new Date().toLocaleDateString('en-CA', { timeZone: TZ }) + 'T00:00:00Z');
  const a = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  const b = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 1));
  return [a.toISOString().slice(0, 10), b.toISOString().slice(0, 10), a.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })];
}

/** The owner's and leads' overview: team health, load, escalations, budgets and (owner only) margin. Shown on Home. */
export async function Overview({ v, month }: { v: Profile; month?: string }): Promise<JSX.Element> {
  const db = getDb();
  const back = month === '1' ? 1 : 0;
  const [from, to, label] = monthBounds(back);
  const [all, L, s, fin, openRec, hoursMap, logs] = await Promise.all([
    visibleRequests(db, v), lookups(db), getSettings(db), finance(db, v), openHoursByStaff(db), hoursByRequest(db),
    db.select().from(timelogs).where(and(gte(timelogs.workDate, from), lt(timelogs.workDate, to))),
  ]);
  const projectAccounts = [...L.orgs.values()].filter((o) => o.active && o.billingModel === 'project');
  const budgets = await Promise.all(projectAccounts.map((o) => projectSummary(db, v, o.id)));
  const open = all.filter((r) => ACTIVE.includes(r.status));
  const finished = all.filter((r) => r.deliveredAt && r.scopedAt && (r.status === 'delivered' || r.status === 'closed'));
  const hit = finished.filter((r) => sla(r, s)?.text === 'Met SLA').length;
  const fp = finished.filter((r) => !r.qaFails).length;
  const lv = (l: number): number => open.filter((r) => sla(r, s)?.level === l).length;
  const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)}%` : 'No data');
  const monthStart = new Date(`${monthBounds(0)[0]}T00:00:00Z`).getTime();
  const used = all.filter((r) => r.scopedAt && new Date(r.scopedAt).getTime() >= monthStart).reduce((t, r) => t + r.credits, 0);
  const team = [...L.people.values()].filter((p) => p.active && (p.role === 'implementer' || p.role === 'lead'));
  const portalShare = pct(all.filter((r) => r.source === 'Client portal').length, all.length);

  // Margin (owner only)
  let margin: ReactNode = null;
  if (fin) {
    const rate = (id: string): number => Number(fin.rates.get(id) ?? 0);
    const missing = [...new Set(logs.filter((t) => !rate(t.staffId)).map((t) => t.staffId))];
    const rows = [...L.orgs.values()].filter((o) => o.active && o.billingModel !== 'project').map((o) => {
      const ls = logs.filter((t) => t.orgId === o.id);
      const h = ls.reduce((x, t) => x + Number(t.hours), 0);
      const cost = ls.reduce((x, t) => x + Number(t.hours) * rate(t.staffId), 0);
      const price = Number(fin.prices.get(o.id) ?? 0);
      return { o, h, cost, price, gm: price ? (price - cost) / price : null };
    });
    const T = rows.reduce((a, x) => ({ h: a.h + x.h, cost: a.cost + x.cost, price: a.price + x.price }), { h: 0, cost: 0, price: 0 });
    const done = all.filter((r) => r.status === 'delivered' || r.status === 'closed');
    const bySku = new Map<string, { n: number; est: number; act: number; cr: number }>();
    done.forEach((r) => {
      const x = bySku.get(r.skuId) ?? { n: 0, est: 0, act: 0, cr: 0 };
      x.n++; x.est += Number(r.estHours ?? 0); x.act += hoursMap.get(r.id) ?? 0; x.cr += r.credits;
      bySku.set(r.skuId, x);
    });
    const gmCls = (g: number | null): string => (g == null ? '' : g >= 0.45 ? 'gm-good' : g < 0.3 ? 'gm-bad' : '');
    margin = (
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Margin, {label}</h2>
          <div className="row"><Link className="btn ghost sm" href="/app#overview" aria-pressed={!back}>This month</Link><Link className="btn ghost sm" href="/app?m=1#overview" aria-pressed={!!back}>Last month</Link></div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Only you can see prices, pay rates and margin. Labor cost is each person&apos;s pay rate times the hours they logged.</p>
        {missing.length ? <div className="banner" style={{ margin: 0 }}>Pay rate missing for {missing.map((id) => L.people.get(id)?.name).join(', ')}. Their hours count as $0 until you add a rate in Setup.</div> : null}
        <div className="kpis">
          <div className="kpi"><b>{money(T.price)}</b><span>Subscription revenue</span></div>
          <div className="kpi"><b>{money(T.cost)}</b><span>Labor cost</span></div>
          <div className="kpi"><b>{T.price ? `${Math.round(((T.price - T.cost) / T.price) * 100)}%` : 'None'}</b><span>Gross margin</span></div>
          <div className="kpi"><b>{T.h ? money(T.price / T.h) : 'None'}</b><span>Revenue per hour worked</span></div>
        </div>
        <div className="tw"><table>
          <thead><tr><th>Client</th><th className="num">Price</th><th className="num">Hours</th><th className="num">Labor</th><th className="num">Margin</th></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.o.id}><td><Link href={`/app/clients/${x.o.id}`}>{x.o.name}</Link></td><td className="num">{x.price ? money(x.price) : 'Not set'}</td><td className="num">{hrs(x.h)}</td><td className="num">{money(x.cost)}</td><td className={`num ${gmCls(x.gm)}`}>{x.gm == null ? '' : `${Math.round(x.gm * 100)}%`}</td></tr>)}</tbody>
        </table></div>
        <h3>Service estimates vs actual</h3>
        <div className="tw"><table>
          <thead><tr><th>Service</th><th className="num">Delivered</th><th className="num">Est. hours avg</th><th className="num">Actual avg</th><th className="num">Hours per credit</th></tr></thead>
          <tbody>
            {[...bySku.entries()].map(([id, x]) => <tr key={id}><td>{L.skus.get(id)?.name}</td><td className="num">{x.n}</td><td className="num">{hrs(x.est / x.n)}</td><td className="num">{hrs(x.act / x.n)}</td><td className="num">{x.cr ? hrs(x.act / x.cr) : ''}</td></tr>)}
            {!bySku.size ? <tr><td colSpan={5} className="muted">Appears once requests are delivered with time logged.</td></tr> : null}
          </tbody>
        </table></div>
      </section>
    );
  }

  return (
    <>
      <h2 id="overview" style={{ marginTop: 28 }}>How the line is running</h2>
      <div className="stack">
        <div className="kpis">
          <Link className="kpi link" href="/app/board"><b>{open.length}</b><span>Open requests</span></Link>
          <div className="kpi"><b>{pct(hit, finished.length)}</b><span>SLA hit rate</span></div>
          <Link className="kpi link" href="/app/board?risk=1"><b>{lv(1)}</b><span>At risk</span></Link>
          <Link className="kpi link" href="/app/board?risk=2"><b>{lv(2)}</b><span>Breached</span></Link>
          <Link className="kpi link" href="/app/board?risk=3"><b style={{ color: lv(3) ? 'var(--stop)' : 'inherit' }}>{lv(3)}</b><span>Need the owner</span></Link>
          <div className="kpi"><b>{pct(fp, finished.length)}</b><span>First-pass QA</span></div>
          <Link className="kpi link" href="/app/clients"><b>{used}</b><span>Credits used this month</span></Link>
          <Link className="kpi link" href="/app/board?src=portal"><b>{portalShare}</b><span>Submitted by clients</span></Link>
          <Link className="kpi link" href="/app/board?kind=support"><b>{open.filter(isSupport).length}</b><span>Open support tickets</span></Link>
        </div>
        <div className="grid2 even">
          <section className="panel"><h2>Team load</h2><div className="stack">
            {team.map((p) => {
              const u = (openRec[p.id] ?? 0) / (p.capacity || 30);
              return (
                <div key={p.id}>
                  <div className="row" style={{ justifyContent: 'space-between' }}><Link href={`/app/board?who=${p.id}`}><strong>{p.name}</strong></Link><span className="small muted">{Math.round(openRec[p.id] ?? 0)}h open of {p.capacity}h</span></div>
                  <div className={`meter ${u > 0.9 ? 'hot' : u > 0.7 ? 'warm' : ''}`}><i style={{ width: `${Math.min(100, u * 100)}%` }} /></div>
                </div>
              );
            })}
            {!team.length ? <p className="muted">Add implementers in Setup.</p> : null}
          </div></section>
          <section className="panel"><h2>Escalations</h2><StaffList reqs={open.filter((r) => (sla(r, s)?.level ?? 0) >= 2)} L={L} s={s} empty="No escalations right now." /></section>
        </div>
        {projectAccounts.length ? <section className="stack"><h2>Project budgets</h2>{v.role === 'owner' ? <Link className="btn ghost sm" href="/api/project-export">Download project budgets CSV</Link> : null}{projectAccounts.map((o, i) => <div key={o.id}><h3><Link href={`/app/clients/${o.id}`}>{o.name}</Link></h3><ProjectBudget summary={budgets[i]}/></div>)}</section> : null}
      {margin}
      </div>
    </>
  );
}
