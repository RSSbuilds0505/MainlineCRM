import type { ReactNode } from 'react';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { lookups, timeRows } from '@/lib/queries';
import { TZ, isLeadRole } from '@/lib/core';
import { deleteTimeAction } from '@/app/actions';
import { Head, fmtDay, hrs } from '@/components/ui';
import { Submit } from '@/components/client';

const iso = (d: Date): string => d.toISOString().slice(0, 10);
function range(key: string): [string, string, string] {
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: TZ }) + 'T00:00:00Z');
  const mon = new Date(today); mon.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const addD = (d: Date, n: number): Date => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
  const m0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const m1 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const mp = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const name = (d: Date): string => d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  if (key === 'lastweek') return [iso(addD(mon, -7)), iso(mon), 'Last week'];
  if (key === 'month') return [iso(m0), iso(m1), name(m0)];
  if (key === 'lastmonth') return [iso(mp), iso(m0), name(mp)];
  return [iso(mon), iso(addD(mon, 7)), 'This week'];
}

export default async function Time({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireStaff();
  const db = getDb();
  const key = searchParams.range ?? 'week', who = searchParams.who ?? '';
  const [from, to, label] = range(key);
  const lead = isLeadRole(v.role);
  const [rows, L] = await Promise.all([timeRows(db, v, from, to, lead && who ? who : null), lookups(db)]);
  const total = rows.reduce((t, r) => t + Number(r.hours), 0);
  const sum = (k: (r: (typeof rows)[number]) => string): [string, number][] => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(k(r), (m.get(k(r)) ?? 0) + Number(r.hours)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const seg: [string, string][] = [['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month']];
  const q = (k: string): string => `/app/time?range=${k}${who ? `&who=${who}` : ''}`;
  return (
    <>
      <Head title={lead ? 'Time' : 'My time'} sub={`${label}: ${hrs(total)} hours logged`}>
        <div className="row">
          <div className="seg" role="group" aria-label="Date range">{seg.map(([k, l]) => <Link key={k} href={q(k)} aria-pressed={key === k} style={{ padding: '7px 12px', fontWeight: 600, textDecoration: 'none', background: key === k ? 'var(--ink)' : 'var(--panel)', color: key === k ? 'var(--panel)' : 'var(--muted)' }}>{l}</Link>)}</div>
          {lead ? (
            <form method="get" className="row">
              <input type="hidden" name="range" value={key} />
              <select name="who" defaultValue={who} aria-label="Person" style={{ width: 'auto' }}><option value="">Everyone</option>{[...L.people.values()].filter((p) => p.role !== 'client').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <button className="btn ghost sm" type="submit">Filter</button>
              <a className="btn ghost sm" href={`/api/time-export?from=${from}&to=${to}${who ? `&who=${who}` : ''}`}>Download CSV</a>
            </form>
          ) : null}
        </div>
      </Head>
      <div className="stack">
        {lead ? (
          <div className="grid2 even">
            <section className="panel"><h2>By person</h2><div className="tw"><table><tbody>{sum((r) => r.staffId).map(([id, h]) => <tr key={id}><td><Link href={`/app/board?who=${id}`}>{L.people.get(id)?.name}</Link></td><td className="num">{hrs(h)}h</td></tr>)}</tbody></table></div></section>
            <section className="panel"><h2>By client</h2><div className="tw"><table><tbody>{sum((r) => r.orgId).map(([id, h]) => <tr key={id}><td><Link href={`/app/clients/${id}`}>{L.orgs.get(id)?.name}</Link></td><td className="num">{hrs(h)}h</td></tr>)}</tbody></table></div></section>
          </div>
        ) : null}
        <section className="panel">
          <h2>Entries</h2>
          <div className="tw"><table>
            <thead><tr><th>Date</th>{lead ? <th>Person</th> : null}<th>Client</th><th>Request</th><th className="num">Hours</th><th>Note</th><th /></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDay(t.workDate)}</td>{lead ? <td><Link href={`/app/board?who=${t.staffId}`}>{L.people.get(t.staffId)?.name}</Link></td> : null}<td><Link href={`/app/clients/${t.orgId}`}>{L.orgs.get(t.orgId)?.name}</Link></td>
                  <td><Link href={`/app/requests/${t.requestId}`}>{L.skus.get(t.skuId)?.name ?? 'Request'}</Link></td>
                  <td className="num">{hrs(Number(t.hours))}</td><td className="small">{t.note}</td>
                  <td>{t.staffId === v.id || lead ? <form action={deleteTimeAction}><input type="hidden" name="timelogId" value={t.id} /><input type="hidden" name="back" value="/app/time" /><Submit className="btn ghost sm" confirmText="Delete this time entry?">Delete</Submit></form> : null}</td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={7} className="muted">No time logged for {label.toLowerCase()}. Log time from any request you work on.</td></tr> : null}
            </tbody>
            <tfoot><tr><td colSpan={lead ? 4 : 3}>Total</td><td className="num">{hrs(total)}</td><td colSpan={2} /></tr></tfoot>
          </table></div>
        </section>
      </div>
    </>
  );
}
