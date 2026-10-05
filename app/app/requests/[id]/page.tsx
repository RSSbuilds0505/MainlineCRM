import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { getSettings, lookups, requestDetail } from '@/lib/queries';
import { allowed, openHoursByStaff } from '@/lib/workflow';
import { LBL, PRI, SUPPORT_LBL, TZ, WORKING, clockWord, isCatalogSku, isLeadRole, isSupport, sla, slaHoursFor, supportCategoryLabel } from '@/lib/core';
import { llmEnabled } from '@/lib/llm';
import type { Profile } from '@/lib/db/schema';
import { Flash, Line, Linkify, SlaChip, fmtDay, fmtWhen, hrs } from '@/components/ui';
import { Submit, Timer } from '@/components/client';
import * as A from '@/app/actions';
import { Conversation } from '@/components/attachments';

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
  const support = isSupport(r);
  const statusLbl = (support && SUPPORT_LBL[r.status]) || LBL[r.status];

  const project = org?.billingModel === 'project';
  const catalog = [...L.skus.values()].filter((k) => k.active && isCatalogSku(k) && (k.platform === 'Any' || k.platform === org?.platform));
  const assignForm = (title: string): ReactNode => (
    <div className="form" id="assign">
      <h3>{title}</h3>
      {r.needsLead ? <p className="small" style={{ margin: 0, color: 'var(--stop)' }}>Routing found no one with capacity. Pick someone, or add capacity in Setup.</p> : null}
      <form action={A.assignAction} className="form">
        {hidden}
        <div className="two">
          <label className="f">Implementer<select name="assigneeId" defaultValue={r.assigneeId ?? ''} required><option value="" disabled>Pick someone</option>{implementers.map((p) => <option key={p.id} value={p.id}>{load(p, open.get(p.id) ?? 0)}</option>)}</select></label>
          {support ? <div /> : <label className="f">QA reviewer<select name="qaId" defaultValue={r.qaId ?? ''}><option value="">Keep current</option>{reviewers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        </div>
        <div className="row"><Submit className="btn sig">Save assignment</Submit>{r.status === 'scoped' ? <Submit className="btn ghost" name="auto" value="1" skipChecks>Let Mainline pick</Submit> : null}</div>
      </form>
    </div>
  );

  // The one thing that moves this request forward, for this person, right now.
  let next: ReactNode = null;
  if (can('confirm')) {
    const skuSel = r.ai?.skuId && L.skus.has(r.ai.skuId) ? r.ai.skuId : r.skuId;
    const priSel = r.ai?.priority ?? r.priority;
    const base = L.skus.get(skuSel);
    next = (
      <div className="stack">
        <h2 style={{ margin: 0 }}>Confirm and schedule</h2>
        {r.ai ? (
          <div className="ai"><strong>AI suggests: {L.skus.get(r.ai.skuId ?? '')?.name ?? 'Custom scope'}</strong> <span className="muted small">({Math.round(r.ai.confidence * 100)}% match, {PRI[r.ai.priority].label})</span>
            {r.ai.summary ? <p style={{ margin: '6px 0 0' }}>{r.ai.summary}</p> : null}
            {r.ai.missing.length ? <ul>{r.ai.missing.map((q) => <li key={q}>{q}</li>)}</ul> : null}
          </div>
        ) : null}
        <form action={A.confirmAction} className="form">
          {hidden}
          <div className="two">
            <label className="f">Service<select name="skuId" defaultValue={skuSel}>{catalog.map((k) => <option key={k.id} value={k.id}>{k.name}{project ? '' : ` (${k.credits} cr)`}</option>)}</select></label>
            <label className="f">Priority<select name="priority" defaultValue={priSel}>{(Object.keys(PRI) as (keyof typeof PRI)[]).map((k) => <option key={k} value={k}>{PRI[k].label}</option>)}</select></label>
          </div>
          <details className="tweak">
            <summary>Adjust credits, turnaround or estimate (optional)</summary>
            <p className="small muted" style={{ margin: '6px 0' }}>Leave blank to use the service&apos;s standard numbers{base ? ` (${project ? '' : `${base.credits} credits, `}${slaHoursFor(base, priSel)} ${clockWord(s)}, ${base.estHours} estimated hours)` : ''}.</p>
            <div className="three">
              {project ? <input type="hidden" name="credits" value="0" /> : <label className="f">Credits<input type="number" name="credits" min={0} placeholder={String(base?.credits ?? '')} /></label>}
              <label className="f">Turnaround ({clockWord(s)})<input type="number" name="slaHours" min={1} placeholder={base ? String(slaHoursFor(base, priSel)) : ''} /></label>
              <label className="f">Estimated hours<input type="number" name="estHours" min={0} step={0.5} placeholder={String(base?.estHours ?? '')} /></label>
            </div>
          </details>
          <p className="small muted" style={{ margin: 0 }}>{project ? `Counts toward ${org?.contractedHours} total project hours.` : `${org?.name} has ${org?.credits ?? 0} credits.`} This starts the clock and routes the work to the best implementer and a QA reviewer.</p>
          <div className="row"><Submit className="btn sig">Confirm and schedule</Submit>{llmEnabled() ? <Submit className="btn ghost sm" name="ai" value="1" skipChecks>{r.ai ? 'Ask AI again' : 'Ask AI to suggest'}</Submit> : null}</div>
        </form>
      </div>
    );
  } else if (r.status === 'scoped' && can('assign')) {
    next = assignForm(support ? 'This ticket needs an owner' : 'This request needs an owner');
  } else if (can('start')) {
    next = (
      <div className="row nextrow">
        <div><h2 style={{ margin: 0 }}>Ready to start</h2><p className="small muted" style={{ margin: '4px 0 0' }}>{r.assigneeId === v.id ? 'This is assigned to you.' : `Assigned to ${people(r.assigneeId)}.`} Starting tells the client it is underway.</p></div>
        <form action={A.startAction}>{hidden}<Submit className="btn sig">{support ? 'Start on this ticket' : 'Start work'}</Submit></form>
      </div>
    );
  } else if (can('resolve')) {
    next = (
      <form action={A.resolveAction} className="form">
        {hidden}
        <h2 style={{ margin: 0 }}>Resolve this ticket</h2>
        <label className="f">What did you fix or answer? The client sees this.<textarea name="body" required placeholder="What was wrong, what you changed, and anything they should do now." /></label>
        <div className="row"><Submit className="btn sig" confirmText={logged ? undefined : 'No time is logged on this ticket yet. Resolve anyway?'}>Mark resolved</Submit></div>
      </form>
    );
  } else if (can('submitqa')) {
    next = (
      <div className="row nextrow">
        <div><h2 style={{ margin: 0 }}>When the work is done</h2><p className="small muted" style={{ margin: '4px 0 0' }}>{people(r.qaId)} reviews it against the checklist before the client sees it.</p></div>
        <form action={A.submitQaAction}>{hidden}<Submit className="btn sig" confirmText={logged ? undefined : 'No time is logged on this request yet. Submit for QA anyway?'}>Submit for QA</Submit></form>
      </div>
    );
  } else if (can('qa')) {
    next = (
      <div className="stack">
        <form action={A.passQaAction} className="form">
          {hidden}
          <h2 style={{ margin: 0 }}>QA review</h2>
          <div className="checks">
            {(sku?.qa ?? []).map((q, i) => <label key={i}><input type="checkbox" name="qa" value={String(i)} /><span>{q}</span></label>)}
            {!sku?.qa.length ? <span className="muted small">No checklist on this service. Add one in Setup.</span> : null}
          </div>
          <label className="f">Delivery note for the client (optional)<textarea name="body" placeholder="What changed and where to find it. Paste the walkthrough Loom link." /></label>
          <div className="row"><Submit className="btn sig">Pass QA and deliver</Submit></div>
        </form>
        <details className="tweak">
          <summary>Needs fixes? Return it to {people(r.assigneeId)}</summary>
          <form action={A.failQaAction} className="form" style={{ marginTop: 8 }}>
            {hidden}
            <label className="f">What needs fixing<textarea name="body" required /></label>
            <div><Submit className="btn warn">Return to implementer</Submit></div>
          </form>
        </details>
      </div>
    );
  } else if (r.status === 'waiting') {
    next = <p style={{ margin: 0 }}><strong>Waiting on the client.</strong> The clock is paused. They can reply in their portal; if they answered by email or phone, paste it in the message box and choose <em>Log as the client&apos;s answer</em>.</p>;
  } else if (r.status === 'delivered') {
    next = <p style={{ margin: 0 }}><strong>{support ? 'Resolved.' : 'Delivered.'}</strong> Waiting for the client to {support ? 'confirm the fix' : 'accept it'}. It closes on its own after {fmtWhen(r.autoAcceptAt)}.</p>;
  } else if (WORKING.includes(r.status) && r.assigneeId) {
    next = <p style={{ margin: 0 }}><strong>{statusLbl}</strong> with {people(r.assigneeId)}.</p>;
  }

  // Everything else lives under More actions.
  const more: ReactNode[] = [];
  if (can('reassign') && !(r.status === 'scoped')) more.push(<div key="re">{assignForm('Reassign')}</div>);
  if (can('resume')) more.push(<form key="resume" action={A.resumeAction}>{hidden}<Submit className="btn ghost">Resume without an answer</Submit></form>);
  if (can('accept')) more.push(<form key="acc" action={A.acceptAction}>{hidden}<Submit className="btn ghost">{support ? 'Client confirmed the fix' : 'Record client sign-off'}</Submit></form>);
  if (can('autoclose')) more.push(<form key="ac" action={A.autoCloseAction}>{hidden}<Submit className="btn ghost">Close (no response in 5 days)</Submit></form>);
  if (can('clearflag')) more.push(<form key="cf" action={A.clearFlagAction}>{hidden}<Submit className="btn ghost">Mark concern resolved</Submit></form>);
  if (can('flag')) more.push(
    <form key="flag" action={A.flagAction} className="form">
      {hidden}
      <label className="f">Client unhappy?<input type="text" name="body" required placeholder="What they said" /></label>
      <div><Submit className="btn warn sm">Flag a client concern to leadership</Submit></div>
    </form>,
  );
  if (can('cancel')) more.push(<form key="cancel" action={A.cancelAction}>{hidden}<Submit className="btn warn" confirmText={`Cancel this request?${r.credits ? ` ${r.credits} credits go back to the client.` : ''}`}>{support ? 'Withdraw ticket' : 'Cancel request'}</Submit></form>);

  return (
    <>
      <Link className="back" href="/app">Home</Link>
      <Flash sp={searchParams} />
      <div className="head">
        <div><div className="muted" style={{ fontFamily: 'var(--display)', fontWeight: 600 }}>ML-{r.num}, {org ? <Link href={`/app/clients/${org.id}`}>{org.name}</Link> : null}</div><h1>{r.title}</h1></div>
        <div className="row"><SlaChip r={r} s={s} /></div>
      </div>
      <div className="panel" style={{ marginBottom: 14 }}><Line r={r} full /></div>
      <div className="grid2">
        <div className="stack">
          {next ? <section className="panel stack next">{next}</section> : null}
          <section className="panel stack"><h2>Details</h2><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.description ? <Linkify text={r.description} /> : 'No description provided.'}</p></section>
          <Conversation v={v} requestId={r.id} back={back} comments={d.comments} attachments={d.attachments}
            canComment={can('comment')} canAsk={can('ask')} canClientReply={can('clientReply')}
            placeholder={r.status === 'waiting' ? "Paste the client's answer and choose Log as the client's answer, or write a note" : undefined} />
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
              <div><dt>{support ? 'Type' : 'Service'}</dt><dd>{support ? `Support: ${supportCategoryLabel(r.category)}` : sku?.name}</dd></div>
              <div><dt>Priority</dt><dd>{PRI[r.priority].label}</dd></div>
              <div><dt>Status</dt><dd>{statusLbl}</dd></div>
              <div><dt>Credits</dt><dd>{support ? 'None (support)' : r.scopedAt ? r.credits : 'After scoping'}</dd></div>
              <div><dt>Implementer</dt><dd>{r.assigneeId ? <Link href={`/app/board?who=${r.assigneeId}`}>{people(r.assigneeId)}</Link> : support && r.status === 'scoped' ? <a href="#assign">Needs an owner</a> : people(r.assigneeId)}</dd></div>
              {support ? null : <div><dt>QA reviewer</dt><dd>{r.qaId ? <Link href={`/app/board?who=${r.qaId}`}>{people(r.qaId)}</Link> : people(r.qaId)}</dd></div>}
              <div><dt>Came in by</dt><dd>{r.source}{r.contact ? `, ${r.contact}` : ''}</dd></div>
              <div><dt>Submitted by</dt><dd>{r.submittedBy && L.people.get(r.submittedBy)?.email ? <a href={`mailto:${L.people.get(r.submittedBy)!.email}`}>{r.submittedByName}</a> : r.submittedByName}</dd></div>
              {org ? <div><dt>Client</dt><dd><Link href={`/app/clients/${org.id}`}>{org.name}</Link></dd></div> : null}
              {support ? <div><dt>Reopened</dt><dd>{r.revisions}</dd></div> : <><div><dt>QA returns</dt><dd>{r.qaFails}</dd></div><div><dt>Revisions</dt><dd>{r.revisions}</dd></div></>}
              {st?.due ? <div><dt>{st.kind} due</dt><dd>{fmtWhen(new Date(st.due))}</dd></div> : null}
              <div><dt>Submitted</dt><dd>{fmtWhen(r.createdAt)}</dd></div>
            </dl>
          </section>
          {more.length ? (
            <details className="more"><summary>More actions</summary><div className="stack" style={{ marginTop: 12 }}>{more}</div></details>
          ) : null}
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
