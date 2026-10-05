import type { ReactNode } from 'react';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { getSettings, lookups, visibleRequests } from '@/lib/queries';
import { ACTIVE, LBL, SUPPORT_LBL, isLeadRole, isSupport, riskScore, sla } from '@/lib/core';
import type { Request, Status } from '@/lib/db/schema';
import { Head, SlaChip, initials } from '@/components/ui';

type SP = Record<string, string | undefined>;
const KEYS = ['pod', 'org', 'who', 'kind', 'risk', 'src'] as const;
type Change = Partial<Record<(typeof KEYS)[number], string | undefined>>;

/** Builds a board link that keeps the current filters and changes some. Passing undefined clears one. */
function href(sp: SP, change: Change): string {
  const q = new URLSearchParams();
  for (const k of KEYS) {
    const val = k in change ? change[k] : sp[k];
    if (val && val !== 'all') q.set(k, val);
  }
  const s = q.toString();
  return s ? `/app/board?${s}` : '/app/board';
}

const RISK: Record<string, string> = { '1': 'At risk or worse', '2': 'Breached', '3': 'Needs the owner' };

export default async function Board({ searchParams: sp }: { searchParams: SP }): Promise<ReactNode> {
  const v = await requireStaff();
  const db = getDb();
  const [all, L, s] = await Promise.all([visibleRequests(db, v), lookups(db), getSettings(db)]);
  const lead = isLeadRole(v.role);
  let rs: Request[] = all.filter((r) => ACTIVE.includes(r.status));
  if (lead && sp.pod && sp.pod !== 'all') rs = rs.filter((r) => L.orgs.get(r.orgId)?.podId === sp.pod);
  if (sp.org) rs = rs.filter((r) => r.orgId === sp.org);
  if (sp.who) rs = rs.filter((r) => r.assigneeId === sp.who || r.qaId === sp.who);
  if (sp.kind === 'support') rs = rs.filter(isSupport);
  if (sp.kind === 'service') rs = rs.filter((r) => !isSupport(r));
  if (sp.risk) rs = rs.filter((r) => (sla(r, s)?.level ?? 0) >= Number(sp.risk));
  if (sp.src === 'portal') rs = rs.filter((r) => r.source === 'Client portal');
  const cols: Status[] = ['submitted', 'triaged', 'scoped', 'assigned', 'in_progress', 'waiting', 'qa', 'delivered'];

  const quick: [string, Change, boolean][] = [
    ['Everything', { kind: undefined, risk: undefined, src: undefined }, !sp.kind && !sp.risk && !sp.src],
    ['Support tickets', { kind: sp.kind === 'support' ? undefined : 'support' }, sp.kind === 'support'],
    ['Service requests', { kind: sp.kind === 'service' ? undefined : 'service' }, sp.kind === 'service'],
    ['At risk', { risk: sp.risk === '1' ? undefined : '1' }, sp.risk === '1'],
    ['Breached', { risk: sp.risk === '2' ? undefined : '2' }, sp.risk === '2'],
    ['Needs the owner', { risk: sp.risk === '3' ? undefined : '3' }, sp.risk === '3'],
    ['From the portal', { src: sp.src === 'portal' ? undefined : 'portal' }, sp.src === 'portal'],
    ['Mine', { who: sp.who === v.id ? undefined : v.id }, sp.who === v.id],
  ];
  const active: [string, Change][] = [];
  if (sp.org) active.push([`Client: ${L.orgs.get(sp.org)?.name ?? 'Unknown'}`, { org: undefined }]);
  if (sp.who && sp.who !== v.id) active.push([`Person: ${L.people.get(sp.who)?.name ?? 'Unknown'}`, { who: undefined }]);
  if (lead && sp.pod && sp.pod !== 'all') active.push([`Pod: ${L.pods.get(sp.pod)?.name ?? 'Unknown'}`, { pod: undefined }]);

  return (
    <>
      <Head title="Board" sub={`${rs.length} open ${rs.length === 1 ? 'item' : 'items'}${active.length || sp.kind || sp.risk || sp.src ? ' matching your filters' : ''}${sp.risk ? ` (${RISK[sp.risk] ?? ''})` : ''}. Click any card to open it.`}>
        {lead ? (
          <form method="get" className="row">
            {KEYS.filter((k) => k !== 'pod').map((k) => (sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null))}
            <label className="f" style={{ minWidth: 180 }}>Pod
              <select name="pod" defaultValue={sp.pod ?? 'all'}>
                <option value="all">All pods</option>
                {[...L.pods.values()].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <button className="btn ghost sm" type="submit" style={{ alignSelf: 'end' }}>Filter</button>
          </form>
        ) : null}
      </Head>
      <nav className="filters" aria-label="Quick filters">
        {quick.map(([label, change, on]) => <Link key={label} className="fchip" href={href(sp, change)} aria-pressed={on}>{label}</Link>)}
      </nav>
      {active.length ? (
        <div className="filters">
          {active.map(([label, change]) => <Link key={label} className="fchip on" href={href(sp, change)} title="Remove this filter">{label} <span aria-hidden="true">×</span></Link>)}
          <Link className="small" href="/app/board">Clear all filters</Link>
        </div>
      ) : null}
      <div className="board">
        {cols.map((c) => {
          const items = rs.filter((r) => r.status === c).sort((a, b) => riskScore(b, s) - riskScore(a, s));
          if (sp.kind === 'support' && !items.length && ['submitted', 'triaged', 'qa'].includes(c)) return null;
          return (
            <div className="col" key={c}>
              <h3><span>{sp.kind === 'support' ? SUPPORT_LBL[c] ?? LBL[c] : LBL[c]}</span><span className="muted">{items.length}</span></h3>
              {items.map((r) => {
                const who = r.assigneeId ? L.people.get(r.assigneeId)?.name : undefined;
                return (
                  <Link key={r.id} className="card" href={`/app/requests/${r.id}`}>
                    <span className="small muted">ML-{r.num}{isSupport(r) ? <span className="tag sup">Support</span> : null}<br />{L.orgs.get(r.orgId)?.name}</span>
                    <span className="title">{r.title}</span>
                    <span className="row" style={{ justifyContent: 'space-between' }}>
                      <SlaChip r={r} s={s} />
                      {who ? <span className="av sm" title={who}>{initials(who)}</span> : null}
                    </span>
                  </Link>
                );
              })}
              {!items.length ? <p className="small muted" style={{ margin: '4px 2px' }}>Nothing here.</p> : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
