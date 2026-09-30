import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { requireClient } from '@/lib/auth';
import { lookups, requestDetail } from '@/lib/queries';
import { allowed } from '@/lib/workflow';
import { PRI, clientStatus, isSupport, supportCategoryLabel } from '@/lib/core';
import { ClientLine, Flash, fmtWhen } from '@/components/ui';
import { Submit } from '@/components/client';
import * as A from '@/app/actions';

export default async function PortalRequest({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireClient();
  const db = getDb();
  const d = await requestDetail(db, v, params.id);
  if (!d) notFound();
  const { r } = d;
  const L = await lookups(db);
  const sku = L.skus.get(r.skuId);
  const can = (a: Parameters<typeof allowed>[0]): boolean => allowed(a, r, v);
  const back = `/portal/requests/${r.id}`;
  const hidden = (<><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} />{isSupport(r) ? <input type="hidden" name="support" value="1" /> : null}</>);
  const lastQuestion = [...d.comments].reverse().find((c) => !c.fromClient);
  const support = isSupport(r);
  return (
    <>
      <Link className="back" href="/portal">Back to requests</Link>
      <Flash sp={searchParams} />
      <div className="head">
        <div><div className="muted" style={{ fontFamily: 'var(--display)', fontWeight: 600 }}>ML-{r.num}</div><h1>{r.title}</h1></div>
        <span className={`chip ${r.status === 'waiting' || r.status === 'delivered' ? 'risk' : 'plain'}`}>{clientStatus(r)}</span>
      </div>
      <div className="panel" style={{ marginBottom: 14 }}><ClientLine r={r} full /></div>
      <div className="grid2">
        <div className="stack">
          {r.status === 'waiting' ? (
            <section className="panel stack" style={{ borderColor: 'var(--signal-fill)' }}>
              <h2 style={{ margin: 0 }}>Your team needs a reply</h2>
              {lastQuestion ? <div className="msg"><div className="by">{lastQuestion.authorName}, {fmtWhen(lastQuestion.at)}</div><p>{lastQuestion.body}</p></div> : null}
              <form action={A.commentAction} className="form">
                {hidden}
                <label className="f">Your answer<textarea name="body" required /></label>
                <div><Submit className="btn sig">Send answer</Submit></div>
              </form>
              <p className="small muted" style={{ margin: 0 }}>Work picks up again as soon as you reply.</p>
            </section>
          ) : null}
          {can('accept') ? (
            <section className="panel stack" style={{ borderColor: 'var(--signal-fill)' }}>
              <h2 style={{ margin: 0 }}>{support ? 'Is it fixed?' : 'Ready for your review'}</h2>
              <p style={{ margin: 0 }}>{support
                ? `Your team marked this resolved. Confirm it's working, or tell us what is still wrong and we will pick it right back up.`
                : 'Your team finished this and it passed our quality check. Accept it, or tell us what to change.'} It closes automatically on {fmtWhen(r.autoAcceptAt)} if we don&apos;t hear back.</p>
              <form action={A.acceptAction}>{hidden}<Submit className="btn sig">{support ? 'Yes, it is fixed' : 'Accept the work'}</Submit></form>
              <form action={A.reviseAction} className="form">
                {hidden}
                <label className="f">{support ? 'Still not working?' : 'Or request a change'}<textarea name="body" required placeholder={support ? 'What is still happening?' : 'What should be different?'} /></label>
                <div><Submit className="btn ghost">{support ? 'Reopen the ticket' : 'Request a revision'}</Submit></div>
              </form>
            </section>
          ) : null}
          <section className="panel stack"><h2>Details</h2>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.description || 'No description provided.'}</p>
            {r.ai?.summary ? <div className="ai"><strong>Scope summary</strong><p style={{ margin: '4px 0 0' }}>{r.ai.summary}</p></div> : null}
          </section>
          <section className="panel stack">
            <h2>Conversation</h2>
            <div className="thread">
              {d.comments.map((c) => (
                <div key={c.id} className={`msg${c.fromClient ? ' client' : ''}`}><div className="by">{c.authorName}, {fmtWhen(c.at)}</div><p>{c.body}</p></div>
              ))}
              {!d.comments.length ? <p className="muted" style={{ margin: 0 }}>No messages yet. Your team will post updates here.</p> : null}
            </div>
            {can('comment') && r.status !== 'waiting' ? (
              <form action={A.commentAction} className="form">
                {hidden}
                <label className="f">Message your team<textarea name="body" required /></label>
                <div><Submit>Send</Submit></div>
              </form>
            ) : null}
          </section>
          {(can('cancel') || can('flag')) ? (
            <section className="panel stack">
              {can('cancel') ? <form action={A.cancelAction}>{hidden}<Submit className="btn warn" confirmText={support ? 'Withdraw this ticket?' : `Cancel this request?${r.credits ? ` Its ${r.credits} credits go back to your balance.` : ''}`}>{support ? 'Withdraw this ticket' : 'Cancel this request'}</Submit></form> : null}
              {can('flag') ? (
                <form action={A.flagAction} className="form">
                  {hidden}
                  <label className="f">Not happy with how this is going?<input type="text" name="body" required placeholder="Tell us what went wrong" /></label>
                  <div><Submit className="btn warn sm">Raise a concern with leadership</Submit></div>
                </form>
              ) : null}
            </section>
          ) : null}
        </div>
        <aside className="stack">
          <section className="panel">
            <dl className="facts">
              <div><dt>{support ? 'Type' : 'Service'}</dt><dd>{support ? `Support: ${supportCategoryLabel(r.category)}` : sku?.name}</dd></div>
              <div><dt>Priority</dt><dd>{PRI[r.priority].label}</dd></div>
              <div><dt>Status</dt><dd>{clientStatus(r)}</dd></div>
              <div><dt>Credits</dt><dd>{support ? 'None, support is included' : r.scopedAt ? r.credits : 'Confirmed at scoping'}</dd></div>
              <div><dt>Specialist</dt><dd>{r.assigneeId ? L.people.get(r.assigneeId)?.name : 'Being assigned'}</dd></div>
              <div><dt>Submitted by</dt><dd>{r.submittedByName}</dd></div>
              <div><dt>Submitted</dt><dd>{fmtWhen(r.createdAt)}</dd></div>
              {r.closedAt ? <div><dt>Completed</dt><dd>{fmtWhen(r.closedAt)}</dd></div> : null}
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}
