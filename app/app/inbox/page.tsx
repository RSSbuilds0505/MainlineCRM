import type { ReactNode } from 'react';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { inbox } from '@/lib/queries';
import { openNoteAction, readAllAction } from '@/app/actions';
import { Empty, Head, fmtWhen } from '@/components/ui';

export default async function Inbox(): Promise<ReactNode> {
  const v = await requireStaff();
  const ns = await inbox(getDb(), v);
  const unread = ns.filter((n) => !n.read).length;
  return (
    <>
      <Head title="Inbox" sub={`${unread} unread. Assignments, QA hand-offs, client messages and escalations land here.`}>
        {unread ? <form action={readAllAction}><button className="btn ghost sm" type="submit">Mark all read</button></form> : null}
      </Head>
      <div className="inbox">
        {ns.map((n) => (
          <form key={n.id} action={openNoteAction}>
            <input type="hidden" name="noteId" value={n.id} />
            <input type="hidden" name="requestId" value={n.requestId ?? ''} />
            <button type="submit" className={`note${n.read ? '' : ' unread'}`}>
              <span className="dot" />
              <span><span className="txt">{n.text}</span><br /><span className="small muted">{n.byName}</span></span>
              <span className="small muted">{fmtWhen(n.at)}</span>
            </button>
          </form>
        ))}
        {!ns.length ? <Empty>Nothing here yet.</Empty> : null}
      </div>
    </>
  );
}
