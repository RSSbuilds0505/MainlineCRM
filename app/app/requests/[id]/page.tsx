import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { getSettings, lookups, requestDetail } from '@/lib/queries';
import { allowed, openHoursByStaff } from '@/lib/workflow';
import { LBL, PRI, TZ, clockWord, isLeadRole, sla, slaHoursFor } from '@/lib/core';
import { llmEnabled } from '@/lib/llm';
import type { Profile } from '@/lib/db/schema';
import { Flash, Line, SlaChip, fmtDay, fmtWhen, hrs } from '@/components/ui';
import { Submit, Timer } from '@/components/client';
import * as A from '@/app/actions';

function load(p: Profile, open: number): string {
  return `${p.name} (${Math.round((open / (p.capacity || 30)) * 100)}% loaded)`;
}

export default async function StaffRequest({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireStaff();
  const db = getDb();
  const d = await requestDetail(db, v, params.id);
  if (!d) notFound();
  const { r } = d;
  const [L, s, openRec] = await Promise.all([lookups(db), getSettings(db), openHoursByStaff(db)]);
  const org = L.orgs.get(r.orgId), sku = L.skus.get(r.skuId);
  const st = sla(r, s);
  const can = (a: Parameters<typeof allowed>[0]): boolean => allowed(a, r, v);
  const back = `/app/requests/${r.id}`;
  const staff = [...L.people.values()].filter((p) => p.active && p.role !== 'client');
  const implementers = staff.filter((p) => p.role === 'implementer' || isLeadRole(p.role));
  const reviewers = staff.filter((p) => p.role !== 'owner' || isLeadRole(p.role));
  // Remaining estimated hours per person, for the load percentages in pickers.
  const open = new Map<string, number>(Object.entries(openRec));
  const logged = d.timelogs.reduce((t, l) => t + Number(l.hours), 0);
  const est = Number(r.estHours ?? sku?.estHours ?? 0);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const hidden = (<><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} /></>);
  const people = (id: string | null): string => (id ? L.people.get(id)?.name ?? 'Unknown' : 'Not yet');

  const panels: ReactNode[] = [];
  if (r.status === 'waiting') panels.push(<p key="w" style={{ margin: 0 }}><strong>Waiting on the client.</strong> They can reply in their portal. If they answered by email or phone, paste it below and choose &quot;Log as the client&apos;s answer&quot;.</p>);
  if (r.status === 'delivered') panels.push(<p key="d" style={{ margin: 0 }}><strong>Delivered.</strong> The client can accept it in their portal. It closes on its own after {fmtWhen(r.autoAcceptAt)}.</p>);
  if (can('triage')) {
    const skuSel = r.ai?.skuId ?? r.skuId, priSel = r.ai?.priority ?? r.priority;
    panels.push(
      <div key="tri" className="form">
        <h3>Triage</h3>
        {r.ai ? (
          <div className="ai"><strong>AI suggests: {L.skus.get(r.ai.skuId ?? '')?.name ?? 'Custom scope'}</strong> <span className="muted small">({Math.round(r.ai.confidence * 100)}% match, {PRI[r.ai.priority].label})</span>
            {r.ai.summary ? <p style={{ margin: '6px 0 0' }}>{r.ai.summary}</p> : null}
            {r.ai.missing.length ? <ul>{r.ai.missing.map((q) => <li key={q}>{q}</li>)}</ul> : null}
          </div>
        ) : null}
        <form action={A.triageAction} className="form">
          {hidden}
          <div className="two">
            <label className="f">Service<select name="skuId" defaultValue={skuSel}>{[...L.skus.values()].filter((k) => k.active && (k.platform === 'Any' || k.platform === org?.platform)).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>
            <label className="f">Priority<select name="priority" defaultValue={priSel}>{(Object.keys(PRI) as (keyof typeof PRI)[]).map((k) => <option key={k} value={k}>{PRI[k].label}</option>)}</select></label>
          </div>
          <div className="row"><Submit>Confirm triage</Submit></div>
        </form>
        {llmEnabled() ? <form action={A.runAiAction}>{hidden}<Submit className="btn ghost sm">{r.ai ? 'Run AI triage again' : 'Run AI triage'}</Submit></form> : null}
      </div>,
    );
  }
  if (can('scope')) {
    panels.push(
      <form key="scope" action={A.scopeAction} className="form">
        {hidden}
        <h3>Scope and assign</h3>
        <p className="small muted" style={{ margin: 0 }}>Debits credits, starts the resolution clock ({clockWord(s)}) and routes to the best implementer. {org?.name} has {org?.credits ?? 0} credits.</p>
        <div className="three">
          <label className="f">Credits<input type="number" name="credits" min={0} defaultValue={sku?.credits ?? 0} /></label>
          <label className="f">SLA ({clockWord(s)})<input type="number" name="slaHours" min={1} defaultValue={slaHoursFor(sku, r.priority)} /></label>
          <label className="f">Estimated hours<input type="number" name="estHours" min={0} step={0.5} defaultValue={sku?.estHours ?? 0} /></label>
        </div>
        <div><Submit>Scope and assign</Submit></div>
      </form>,
    );
  }
  if (can('assign') || can('reassign')) {
    panels.push(
      <div key="assign" className="form">
        <h3>{r.status === 'scoped' ? 'Assign' : 'Reassign'}</h3>
        {r.needsLead ? <p className="small" style={{ margin: 0, color: 'var(--stop)' }}>Routing found no one with capacity. Pick someone or add capacity in Setup.</p> : null}
        <form action={A.assignAction} className="form">
          {hidden}
          <div className="two">
            <label className="f">Implementer<select name="assigneeId" defaultValue={r.assigneeId ?? ''} required><option value="" disabled>Pick someone</option>{implementers.map((p) => <option key={p.id} value={p.id}>{load(p, open.get(p.id) ?? 0)}</option>)}</select></label>
            <label className="f">QA reviewer<select name="qaId" defaultValue={r.qaId ?? ''}><option value="">Keep current</option>{reviewers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </div>
          <div className="row"><Submit>Save assignment</Submit></div>
        </form>
        {r.status === 'scoped' ? <form action={A.autoAssignAction}>{hidden}<Submit className="btn ghost sm">Try auto-assign</Submit></form> : null}
      </div>,
    );
  }
  const buttons: ReactNode[] = [];
  if (can('start')) buttons.push(<form key="start" action={A.startAction}>{hidden}<Submit>Start work</Submit></form>);
  if (can('submitqa')) buttons.push(<form key="qa" action={A.submitQaAction}>{hidden}<Submit confirmText={logged ? undefined : 'No time is logged on this request yet. Submit for QA anyway?'}>Submit for QA</Submit></form>);
  if (can('resume')) buttons.push(<form key="resume" action={A.resumeAction}>{hidden}<Submit className="btn ghost">Resume without an answer</Submit></form>);
  if (can('accept')) buttons.push(<form key="acc" action={A.acceptAction}>{hidden}<Submit className="btn sig">Record client sign-off</Submit></form>);
  if (can('autoclose')) buttons.push(<form key="ac" action={A.autoCloseAction}>{hidden}<Submit className="btn ghost">Close (no response in 5 days)</Submit></form>);
  if (can('clearflag')) buttons.push(<form key="cf" action={A.clearFlagAction}>{hidden}<Submit className="btn ghost">Mark concern resolved</Submit></form>);
  if (can('cancel')) buttons.push(<form key="cancel" action={A.cancelAction}>{hidden}<Submit className="btn warn" confirmText={`Cancel this request?${r.credits ? ` ${r.credits} credits go back to the client.` : ''}`}>Cancel request</Submit></form>);
  if (buttons.length) panels.push(<div key="btns" className="row">{buttons}</div>);
  if (can('qa')) {
    panels.push(
      <form key="qaf" action={A.passQaAction} className="form">
        {hidden}
        <h3>QA checklist</h3>
        <div className="checks">
          {(sku?.qa ?? []).map((q, i) => <label key={i}><input type="checkbox" name="qa" value={String(i)} /><span>{q}</span></label>)}
          {!sku?.qa.length ? <span className="muted small">No checklist on this service. Add one in Setup.</span> : null}
        </div>
        <label className="f">Delivery note for the client (optional)<textarea name="body" placeholder="What changed and where to find it. Include the walkthrough video link." /></label>
        <div className="row"><Submit className="btn sig">Pass QA and deliver</Submit></div>
      </form>,
      <form key="qafail" action={A.failQaAction} className="form">
        {hidden}
        <label className="f">Or return it with notes for the implementer<textarea name="body" /></label>
        <div><Submit className="btn warn">Return to implementer</Submit></div>
      </form>,
    );
  }

  return (
    <>
      <Link className="back" href="/app">Back to queue</Link>
      <Flash sp={searchParams} />
      <div className="head">
        <div><div className="muted" style={{ fontFamily: 'var(--display)', fontWeight: 600 }}>ML-{r.num}, {org?.name}</div><h1>{r.title}</h1></div>
        <div className="row"><SlaChip r={r} s={s} /></div>
      </div>
      <div className="panel" style={{ marginBottom: 14 }}><Line r={r} full /></div>
      <div className="grid2">
        <div className="stack">
          {panels.length ? <section className="panel stack">{panels}</section> : null}
          <section className="panel stack"><h2>Details</h2><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.description || 'No description provided.'}</p></section>
          <section className="panel stack">
            <h2>Conversation</h2>
            <div className="thread">
              {d.comments.map((c) => (
                <div key={c.id} className={`msg${c.internal ? ' internal' : ''}${c.fromClient ? ' client' : ''}`}>
                  <div className="by">{c.authorName}, {fmtWhen(c.at)}{c.internal ? ', internal note' : c.fromClient ? ', client' : ''}</div>
                  <p>{c.body}</p>
                </div>
              ))}
              {!d.comments.length ? <p className="muted" style={{ margin: 0 }}>No messages yet.</p> : null}
            </div>
            {can('comment') ? (
              <form action={A.commentAction} className="form">
                {hidden}
                <label className="f">Message<textarea name="body" required placeholder={r.status === 'waiting' ? "Paste the client's answer, or write a note" : 'Message the client, or add an internal note for the team'} /></label>
                <div className="row">
                  <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" name="internal" /> Internal note (client can&apos;t see)</label>
                  <Submit>Post</Submit>
                  {can('clientReply') ? <Submit className="btn sig" name="mode" value="clientAnswer">Log as the client&apos;s answer</Submit> : null}
                </div>
              </form>
            ) : null}
            {can('ask') ? (
              <form action={A.askAction} className="form">
                {hidden}
                <label className="f">Need something from the client?<textarea name="body" required placeholder="Ask your question. The client is emailed and the SLA pauses until they reply." /></label>
                <div><Submit className="btn ghost">Ask the client (pauses SLA)</Submit></div>
              </form>
            ) : null}
            {can('flag') ? (
              <form action={A.flagAction} className="form">
                {hidden}
                <label className="f">Client unhappy?<input type="text" name="body" required placeholder="What they said" /></label>
                <div><Submit className="btn warn sm">Flag a client concern to leadership</Submit></div>
              </form>
            ) : null}
          </section>
          <section className="panel stack">
            <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Time</h2><span className="small muted">{hrs(logged)}h logged{est ? ` of ${hrs(est)}h estimated` : ''}</span></div>
            {est ? <div className={`meter ${logged > est * 1.2 ? 'hot' : logged > est ? 'warm' : ''}`}><i style={{ width: `${Math.min(100, (logged / est) * 100)}%` }} /></div> : null}
            {can('logtime') ? (
              <form action={A.logTimeAction} className="form">
                {hidden}
                <div><Timer requestId={r.id} fieldId="tl-hours" /></div>
                <div className="three">
                  <label className="f">Hours<input id="tl-hours" type="number" name="hours" min={0.25} max={24} step={0.25} required placeholder="1.5" /></label>
                  <label className="f">Date<input type="date" name="workDate" defaultValue={today} required /></label>
                  {isLeadRole(v.role) ? <label className="f">Person<select name="staffId" defaultValue={v.id}>{staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : <div />}
                </div>
                <label className="f">What you did<input type="text" name="note" maxLength={300} /></label>
                <div><Submit>Log time</Submit></div>
              </form>
            ) : null}
            {d.timelogs.length ? (
              <div className="tw"><table><tbody>
                {d.timelogs.map((l) => (
                  <tr key={l.id}><td>{fmtDay(l.workDate)}</td><td>{people(l.staffId)}</td><td className="num">{hrs(Number(l.hours))}h</td><td className="small">{l.note}</td>
                    <td>{l.staffId === v.id || isLeadRole(v.role) ? <form action={A.deleteTimeAction}><input type="hidden" name="timelogId" value={l.id} /><input type="hidden" name="back" value={back} /><Submit className="btn ghost sm" confirmText="Delete this time entry?">Delete</Submit></form> : null}</td></tr>
                ))}
              </tbody></table></div>
            ) : null}
          </section>
        </div>
        <aside className="stack">
          <section className="panel">
            <dl className="facts">
              <div><dt>Service</dt><dd>{sku?.name}</dd></div>
              <div><dt>Priority</dt><dd>{PRI[r.priority].label}</dd></div>
              <div><dt>Status</dt><dd>{LBL[r.status]}</dd></div>
              <div><dt>Credits</dt><dd>{r.scopedAt ? r.credits : 'After scoping'}</dd></div>
              <div><dt>Implementer</dt><dd>{people(r.assigneeId)}</dd></div>
              <div><dt>QA reviewer</dt><dd>{people(r.qaId)}</dd></div>
              <div><dt>Came in by</dt><dd>{r.source}{r.contact ? `, ${r.contact}` : ''}</dd></div>
              <div><dt>Submitted by</dt><dd>{r.submittedByName}</dd></div>
              <div><dt>QA returns</dt><dd>{r.qaFails}</dd></div>
              <div><dt>Revisions</dt><dd>{r.revisions}</dd></div>
              {st?.due ? <div><dt>{st.kind} due</dt><dd>{fmtWhen(new Date(st.due))}</dd></div> : null}
              <div><dt>Submitted</dt><dd>{fmtWhen(r.createdAt)}</dd></div>
            </dl>
          </section>
          <section className="panel">
            <details><summary>Activity ({d.events.length})</summary>
              <ul className="log">{d.events.map((e) => <li key={e.id}><strong style={{ color: 'var(--ink)' }}>{e.actorName}</strong>: {e.text}<br />{fmtWhen(e.at)}</li>)}</ul>
            </details>
          </section>
        </aside>
      </div>
    </>
  );
}
