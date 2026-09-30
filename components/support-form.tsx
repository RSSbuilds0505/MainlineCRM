import type { ReactNode } from 'react';
import { supportTicketAction } from '@/app/actions';
import { PRI, SUPPORT_CATEGORIES, SUPPORT_SLA, SUPPORT_URGENCY } from '@/lib/core';
import type { Org, Priority } from '@/lib/db/schema';
import { Submit } from '@/components/client';
import { AttachBox } from '@/components/attach';

const ORDER: Priority[] = ['urgent', 'high', 'normal', 'low'];

/** The support ticket form. Clients file for their own company; staff pick the client and can note who called. */
export function SupportForm({ back, orgs, clock, org }: { back: string; orgs?: Org[]; clock: string; org?: string }): ReactNode {
  return (
    <form action={supportTicketAction} className="form">
      <input type="hidden" name="back" value={back} />
      {orgs ? (
        <div className="two">
          <label className="f">Client<select name="orgId" required defaultValue={orgs?.some((o) => o.id === org) ? org : ''}>
            <option value="" disabled>Pick a client</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select></label>
          <label className="f">Who reported it<input type="text" name="contact" maxLength={120} placeholder="Name, and how they reached you" /></label>
        </div>
      ) : null}
      <fieldset className="choices">
        <legend>What do you need help with?</legend>
        <div className="opts">
          {SUPPORT_CATEGORIES.map((c) => (
            <label key={c.key} className="choice"><input type="radio" name="category" value={c.key} required /><b>{c.label}</b><span>{c.hint}</span></label>
          ))}
        </div>
      </fieldset>
      <label className="f">Short summary<input type="text" name="title" required maxLength={160} placeholder="Example: New leads are not being assigned to reps" /></label>
      <label className="f">What is happening?
        <textarea name="description" required rows={6} maxLength={8000}
          placeholder={'What did you expect, and what happened instead?\nWhen did it start? Which records, workflows or reports are involved?\nPaste links to the records or a screen recording if you have them.'} />
      </label>
      <div className="f"><span className="lbl">Screenshots or a screen recording (optional, but it speeds things up)</span><AttachBox draft /></div>
      <fieldset className="choices">
        <legend>How urgent is it?</legend>
        <div className="opts">
          {ORDER.map((p) => (
            <label key={p} className="choice">
              <input type="radio" name="priority" value={p} required defaultChecked={p === 'normal'} />
              <b>{PRI[p].label}</b><span>{SUPPORT_URGENCY[p]}. Target: {SUPPORT_SLA[p]} {clock}.</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div><Submit className="btn sig">Open support ticket</Submit></div>
      <p className="small muted" style={{ margin: 0 }}>Support tickets never use credits. For new builds or changes, submit a service request instead.</p>
    </form>
  );
}
