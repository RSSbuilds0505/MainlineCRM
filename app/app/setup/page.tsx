import type { ReactNode } from 'react';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import { requireLead } from '@/lib/auth';
import { finance, getSettings, lookups } from '@/lib/queries';
import { PLATFORMS, ROLE_LBL } from '@/lib/core';
import { emailEnabled } from '@/lib/email';
import type { Lookup } from '@/lib/queries';
import type { Profile } from '@/lib/db/schema';
import * as A from '@/app/actions';
import { Flash, Head, money } from '@/components/ui';
import { Submit } from '@/components/client';

const BACK = '/app/setup';
const hb = <input type="hidden" name="back" value={BACK} />;

function PersonForm({ p, kind, L, rate, owner, viewer }: { p: Profile | null; kind: 'staff' | 'client'; L: Lookup; rate: number | undefined; owner: boolean; viewer: Profile }): ReactNode {
  const isNew = !p;
  const roles = kind === 'client' ? (['client'] as const) : (['implementer', 'csm', 'lead', ...(owner ? (['owner'] as const) : [])] as const);
  return (
    <form action={A.savePersonAction} className="form panel" id="edit" style={{ borderColor: 'var(--ink)' }}>
      {hb}
      {p ? <input type="hidden" name="personId" value={p.id} /> : null}
      <h3>{isNew ? (kind === 'client' ? 'Add a client portal user' : 'Add a team member') : `Edit ${p.name}`}</h3>
      <div className="three">
        <label className="f">Name<input type="text" name="name" required defaultValue={p?.name ?? ''} /></label>
        <label className="f">Email (they sign in with this)<input type="email" name="email" required defaultValue={p?.email ?? ''} readOnly={!isNew} /></label>
        {kind === 'client' ? (
          <label className="f">Client account<select name="orgId" required defaultValue={p?.orgId ?? ''}><option value="" disabled>Pick a client</option>{[...L.orgs.values()].map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        ) : (
          p?.role === 'owner' ? <label className="f">Role<input type="hidden" name="role" value="owner" /><input type="text" value="Owner" readOnly /></label> : <label className="f">Role<select name="role" defaultValue={p?.role ?? 'implementer'}>{roles.map((r) => <option key={r} value={r}>{ROLE_LBL[r]}</option>)}</select></label>
        )}
      </div>
      {kind === 'client' ? <input type="hidden" name="role" value="client" /> : (
        <>
          <div className="three">
            <label className="f">Pod<select name="podId" defaultValue={p?.podId ?? ''}><option value="">All pods</option>{[...L.pods.values()].map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="f">Weekly capacity (hours)<input type="number" name="capacity" min={1} defaultValue={p?.capacity ?? 30} /></label>
            {owner ? <label className="f">Pay rate, $ per hour (only you see this)<input type="number" name="rate" min={0} step={0.5} defaultValue={rate ?? ''} /></label> : <div />}
          </div>
          <div className="plat" role="group" aria-label="Platforms">{PLATFORMS.map((x) => <label key={x}><input type="checkbox" name={`p_${x}`} defaultChecked={p ? p.platforms.includes(x) : x === 'HubSpot'} /> {x}</label>)}</div>
        </>
      )}
      {p && p.id !== viewer.id ? <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="active" defaultChecked={p.active} /> Active (unchecked people cannot sign in)</label> : p ? <input type="hidden" name="active" value="on" /> : null}
      {isNew ? <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="sendInvite" defaultChecked /> {emailEnabled() ? 'Email them a sign-in link now' : 'Create a sign-in link for me to send them'}</label> : null}
      <div className="row"><Submit>Save</Submit><Link className="btn ghost" href={BACK}>Cancel</Link></div>
    </form>
  );
}

export default async function Setup({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireLead();
  const db = getDb();
  const [L, s, fin] = await Promise.all([lookups(db), getSettings(db), finance(db, v)]);
  const owner = v.role === 'owner';
  const [et, eid] = (searchParams.edit ?? '').split(':');
  const people = [...L.people.values()];
  const staff = people.filter((p) => p.role !== 'client').sort((a, b) => Number(!a.active) - Number(!b.active) || a.name.localeCompare(b.name));
  const contacts = people.filter((p) => p.role === 'client');
  const orgList = [...L.orgs.values()];
  const eb = (t: string, id: string, label = 'Edit'): ReactNode => <Link className="btn ghost sm" href={`${BACK}?edit=${t}:${id}#edit`}>{label}</Link>;
  const linkBtn = (p: Profile): ReactNode => (
    <form action={A.sendLinkAction} className="inline"><input type="hidden" name="email" value={p.email} />{hb}<Submit className="btn ghost sm">{emailEnabled() ? 'Email sign-in link' : 'Get sign-in link'}</Submit></form>
  );
  const org = et === 'org' ? (eid === 'new' ? null : L.orgs.get(eid) ?? null) : null;
  const pod = et === 'pod' ? (eid === 'new' ? null : L.pods.get(eid) ?? null) : null;
  const sku = et === 'sku' ? (eid === 'new' ? null : L.skus.get(eid) ?? null) : null;
  return (
    <>
      <Flash sp={searchParams} />
      <Head title="Setup" sub="Team, client accounts, portal users, pods, the service catalog and workspace settings." />
      <div className="stack">
        <section className="panel stack">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Team</h2>{eb('staff', 'new', 'Add team member')}</div>
          {et === 'staff' ? <PersonForm p={eid === 'new' ? null : L.people.get(eid) ?? null} kind="staff" L={L} rate={fin?.rates.get(eid)} owner={owner} viewer={v} /> : null}
          <div className="tw"><table>
            <thead><tr><th>Name</th><th>Role</th><th>Pod</th><th>Platforms</th><th className="num">Capacity</th>{owner ? <th className="num">Pay rate</th> : null}<th /></tr></thead>
            <tbody>{staff.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'muted'}>
                <td>{p.name}{p.active ? '' : ' (inactive)'}<div className="small muted">{p.email}</div></td><td>{ROLE_LBL[p.role]}</td>
                <td>{L.pods.get(p.podId ?? '')?.name ?? 'All'}</td><td>{p.platforms.join(', ')}</td><td className="num">{p.capacity}h</td>
                {owner ? <td className="num">{fin?.rates.has(p.id) ? `$${fin.rates.get(p.id)}` : 'Not set'}</td> : null}
                <td><div className="row" style={{ flexWrap: 'nowrap' }}>{eb('staff', p.id)}{p.active ? linkBtn(p) : null}</div></td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>

        <section className="panel stack">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Clients</h2>{eb('org', 'new', 'Add client')}</div>
          {et === 'org' ? (
            <form action={A.saveOrgAction} className="form panel" id="edit" style={{ borderColor: 'var(--ink)' }}>
              {hb}{org ? <input type="hidden" name="orgId" value={org.id} /> : null}
              <h3>{org ? `Edit ${org.name}` : 'Add a client'}</h3>
              <div className="three">
                <label className="f">Name<input type="text" name="name" required defaultValue={org?.name ?? ''} /></label>
                <label className="f">Platform<select name="platform" defaultValue={org?.platform ?? 'HubSpot'}>{PLATFORMS.map((x) => <option key={x}>{x}</option>)}</select></label>
                <label className="f">Pod<select name="podId" defaultValue={org?.podId ?? ''}><option value="">No pod</option>{[...L.pods.values()].map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              </div>
              <div className="three">
                <label className="f">Plan<select name="plan" defaultValue={org?.plan ?? 'Growth'}>{['Starter', 'Growth', 'Scale', 'Custom'].map((x) => <option key={x}>{x}</option>)}</select></label>
                <label className="f">Monthly credits<input type="number" name="monthlyCredits" min={0} defaultValue={org?.monthlyCredits ?? 35} /></label>
                {org ? <label className="f">Credits left now<input type="number" name="credits" min={0} defaultValue={org.credits} /></label> : <div />}
              </div>
              <div className="two">
                {owner ? <label className="f">Monthly price, $ (only you see this)<input type="number" name="price" min={0} defaultValue={org ? fin?.prices.get(org.id) ?? '' : ''} /></label> : <div />}
                {org ? <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', alignSelf: 'end' }}><input type="checkbox" name="active" defaultChecked={org.active} /> Active client</label> : <div />}
              </div>
              <div className="row"><Submit>Save</Submit><Link className="btn ghost" href={BACK}>Cancel</Link></div>
            </form>
          ) : null}
          <div className="tw"><table>
            <thead><tr><th>Client</th><th>Platform</th><th>Pod</th><th>Plan</th>{owner ? <th className="num">Price</th> : null}<th className="num">Credits</th><th /></tr></thead>
            <tbody>{orgList.map((o) => (
              <tr key={o.id} className={o.active ? '' : 'muted'}>
                <td>{o.name}{o.active ? '' : ' (inactive)'}</td><td>{o.platform}</td><td>{L.pods.get(o.podId ?? '')?.name ?? 'None'}</td><td>{o.plan}</td>
                {owner ? <td className="num">{fin?.prices.get(o.id) ? money(Number(fin.prices.get(o.id))) : 'Not set'}</td> : null}
                <td className="num">{o.credits} / {o.monthlyCredits}</td>
                <td><div className="row" style={{ flexWrap: 'nowrap' }}>{eb('org', o.id)}<form action={A.resetCreditsAction} className="inline"><input type="hidden" name="orgId" value={o.id} />{hb}<Submit className="btn ghost sm" confirmText={`Reset ${o.name} to ${o.monthlyCredits} credits?`}>Reset credits</Submit></form></div></td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>

        <section className="panel stack">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Client portal users</h2>{eb('contact', 'new', 'Add portal user')}</div>
          <p className="small muted" style={{ margin: 0 }}>These people sign in to the client portal. They can submit requests, answer questions and approve work for their own company only.</p>
          {et === 'contact' ? <PersonForm p={eid === 'new' ? null : L.people.get(eid) ?? null} kind="client" L={L} rate={undefined} owner={owner} viewer={v} /> : null}
          <div className="tw"><table>
            <thead><tr><th>Name</th><th>Email</th><th>Client</th><th /></tr></thead>
            <tbody>
              {contacts.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'muted'}>
                  <td>{p.name}{p.active ? '' : ' (inactive)'}</td><td>{p.email}</td><td>{L.orgs.get(p.orgId ?? '')?.name}</td>
                  <td><div className="row" style={{ flexWrap: 'nowrap' }}>{eb('contact', p.id)}{p.active ? linkBtn(p) : null}</div></td>
                </tr>
              ))}
              {!contacts.length ? <tr><td colSpan={4} className="muted">No portal users yet. Add a client first, then add the people who will submit requests.</td></tr> : null}
            </tbody>
          </table></div>
        </section>

        <section className="panel stack">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Pods</h2>{eb('pod', 'new', 'Create pod')}</div>
          {et === 'pod' ? (
            <form action={A.savePodAction} className="form panel" id="edit" style={{ borderColor: 'var(--ink)' }}>
              {hb}{pod ? <input type="hidden" name="podId" value={pod.id} /> : null}
              <div className="two">
                <label className="f">Pod name<input type="text" name="name" required defaultValue={pod?.name ?? ''} /></label>
                <label className="f">CSM<select name="csmId" defaultValue={pod?.csmId ?? ''}><option value="">Assign later</option>{staff.filter((p) => p.active && p.role !== 'implementer').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              </div>
              <div className="row"><Submit>Save</Submit><Link className="btn ghost" href={BACK}>Cancel</Link></div>
            </form>
          ) : null}
          <div className="tw"><table>
            <thead><tr><th>Pod</th><th>CSM</th><th className="num">Clients</th><th>Implementers</th><th /></tr></thead>
            <tbody>{[...L.pods.values()].map((x) => (
              <tr key={x.id}><td>{x.name}</td><td>{L.people.get(x.csmId ?? '')?.name ?? 'Unassigned'}</td><td className="num">{orgList.filter((o) => o.podId === x.id && o.active).length}</td>
                <td>{staff.filter((p) => p.podId === x.id && p.role === 'implementer' && p.active).map((p) => p.name).join(', ') || 'None'}</td><td>{eb('pod', x.id)}</td></tr>
            ))}</tbody>
          </table></div>
        </section>

        <section className="panel stack">
          <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Service catalog</h2>{eb('sku', 'new', 'Add service')}</div>
          {et === 'sku' ? (
            <form action={A.saveSkuAction} className="form panel" id="edit" style={{ borderColor: 'var(--ink)' }}>
              {hb}{sku ? <input type="hidden" name="skuId" value={sku.id} /> : null}
              <div className="three">
                <label className="f">Name<input type="text" name="name" required defaultValue={sku?.name ?? ''} /></label>
                <label className="f">Platform<select name="platform" defaultValue={sku?.platform ?? 'HubSpot'}>{['Any', ...PLATFORMS].map((x) => <option key={x}>{x}</option>)}</select></label>
                <label className="f">Category<input type="text" name="category" defaultValue={sku?.category ?? ''} /></label>
              </div>
              <div className="three">
                <label className="f">Credits<input type="number" name="credits" min={0} defaultValue={sku?.credits ?? 2} /></label>
                <label className="f">Estimated hours<input type="number" name="estHours" min={0} step={0.5} defaultValue={sku?.estHours ?? 3} /></label>
                <label className="f">Turnaround SLA (hours)<input type="number" name="slaHours" min={1} defaultValue={sku?.slaHours ?? 16} /></label>
              </div>
              <label className="f">Description clients see<input type="text" name="description" defaultValue={sku?.description ?? ''} /></label>
              <label className="f">QA checklist, one item per line<textarea name="qa" defaultValue={(sku?.qa ?? []).join('\n')} /></label>
              {sku ? <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="active" defaultChecked={sku.active} /> Offered to clients</label> : null}
              <div className="row"><Submit>Save</Submit><Link className="btn ghost" href={BACK}>Cancel</Link></div>
            </form>
          ) : null}
          <div className="tw"><table>
            <thead><tr><th>Service</th><th>Platform</th><th className="num">Credits</th><th className="num">Est. hours</th><th className="num">SLA</th><th className="num">QA items</th><th /></tr></thead>
            <tbody>{[...L.skus.values()].map((k) => (
              <tr key={k.id} className={k.active ? '' : 'muted'}><td><strong>{k.name}</strong>{k.active ? '' : ' (off)'}<div className="small muted">{k.category}</div></td><td>{k.platform}</td>
                <td className="num">{k.credits}</td><td className="num">{k.estHours}</td><td className="num">{k.slaHours}h</td><td className="num">{k.qa.length}</td><td>{eb('sku', k.id)}</td></tr>
            ))}</tbody>
          </table></div>
        </section>

        <section className="panel">
          <form action={A.saveSettingsAction} className="form">
            {hb}
            <h2 style={{ margin: 0 }}>Workspace settings</h2>
            <div className="three">
              <label className="f">SLA clock<select name="slaMode" defaultValue={s.slaMode}><option value="business">Business hours (Mon to Fri, Eastern)</option><option value="calendar">Around the clock</option></select></label>
              <label className="f">Business day starts (hour, 24h)<input type="number" name="bizStart" min={0} max={23} defaultValue={s.bizStart} /></label>
              <label className="f">Business day ends (hour, 24h)<input type="number" name="bizEnd" min={1} max={24} defaultValue={s.bizEnd} /></label>
            </div>
            <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="autoReset" defaultChecked={s.autoReset} /> Reset every client&apos;s credits to their monthly amount on the 1st (unused credits do not roll over)</label>
            <p className="small muted" style={{ margin: 0 }}>Email alerts: {emailEnabled() ? 'on' : 'off (add a Resend API key to turn them on)'}. Slack alerts: {process.env.SLACK_WEBHOOK_URL ? 'on' : 'off (add a Slack webhook URL to turn them on)'}.</p>
            <div><Submit>Save settings</Submit></div>
          </form>
        </section>
      </div>
    </>
  );
}
