import type { ReactNode } from 'react';
import type { Org, Sku } from '@/lib/db/schema';
import { PRI, SOURCES } from '@/lib/core';
import { createRequestAction } from '@/app/actions';
import { AiSuggest, Submit } from './client';

export function ClientRequestForm({ skus, aiOn }: { skus: Sku[]; aiOn: boolean }): ReactNode {
  const groups = new Map<string, Sku[]>();
  for (const k of skus) groups.set(k.category, [...(groups.get(k.category) ?? []), k]);
  return (
    <form id="nr" action={createRequestAction} className="stack">
      <input type="hidden" name="back" value="/portal/new" />
      <div className="panel form">
        <label className="f">Title<input type="text" name="title" required maxLength={160} placeholder="Build a lead routing workflow for the West region" /></label>
        <label className="f">What do you need?<textarea name="description" maxLength={8000} placeholder="What should change, where in your CRM, who is affected, and any deadline." /></label>
        <div className="two">
          <label className="f">Priority
            <select name="priority" defaultValue="normal">{(Object.keys(PRI) as (keyof typeof PRI)[]).map((k) => <option key={k} value={k}>{PRI[k].label}</option>)}</select>
          </label>
          <div />
        </div>
        {aiOn ? <AiSuggest formId="nr" /> : null}
      </div>
      <h2>Choose a service</h2>
      {[...groups.entries()].map(([g, ks]) => (
        <fieldset key={g} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend><h3 style={{ marginBottom: 8 }}>{g}</h3></legend>
          <div className="skus">
            {ks.map((k) => (
              <label key={k.id} className="sku">
                <input type="radio" name="skuId" value={k.id} required />
                <span className="nm">{k.name}</span>
                <span className="d">{k.description}</span>
                <span className="k"><span>{k.credits ? `${k.credits} credits` : 'Quoted after scoping'}</span><span>{k.platform}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {!skus.length ? <div className="empty">No services are set up for your CRM yet. Contact your Mainline team.</div> : null}
      <div className="row"><Submit className="btn sig">Submit request</Submit></div>
    </form>
  );
}

export function StaffRequestForm({ orgs, org, skus, aiOn, canTriage }: { orgs: Org[]; org: Org; skus: Sku[]; aiOn: boolean; canTriage: boolean }): ReactNode {
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <form method="get" className="panel row">
        <label className="f" style={{ flex: 1 }}>Client
          <select name="org" defaultValue={org.id}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.platform})</option>)}</select>
        </label>
        <button type="submit" className="btn ghost" style={{ alignSelf: 'end' }}>Switch client</button>
      </form>
      <form id="nr" action={createRequestAction} className="panel form">
        <input type="hidden" name="back" value="/app/new" />
        <input type="hidden" name="orgId" value={org.id} />
        <p className="small muted" style={{ margin: 0 }}>Logging for <strong>{org.name}</strong> on {org.platform}, {org.credits} credits left.</p>
        <div className="two">
          <label className="f">Came in by<select name="source" defaultValue="Email">{SOURCES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="f">Client contact who asked<input type="text" name="contact" maxLength={120} /></label>
        </div>
        <label className="f">Title<input type="text" name="title" required maxLength={160} /></label>
        <label className="f">Request details<textarea name="description" maxLength={8000} placeholder="Paste the client's email or summarize the ask." /></label>
        {aiOn ? <AiSuggest formId="nr" orgField="orgId" /> : null}
        <div className="two">
          <label className="f">Service
            <select name="skuId" required defaultValue=""><option value="" disabled>Pick a service</option>{skus.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.credits} cr)</option>)}</select>
          </label>
          <label className="f">Priority
            <select name="priority" defaultValue="normal">{(Object.keys(PRI) as (keyof typeof PRI)[]).map((k) => <option key={k} value={k}>{PRI[k].label}</option>)}</select>
          </label>
        </div>
        {canTriage ? <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="triageNow" defaultChecked /> I have confirmed the service and priority (skip triage)</label> : null}
        <div className="row"><Submit className="btn sig">Log request</Submit></div>
      </form>
    </div>
  );
}
