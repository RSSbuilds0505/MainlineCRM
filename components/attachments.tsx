import type { ReactNode } from 'react';
import type { Attachment, Comment, Profile } from '@/lib/db/schema';
import { fmtBytes, isImage, isVideo, typeLabel, videoEmbed } from '@/lib/media';
import { isLeadRole } from '@/lib/core';
import { store } from '@/lib/storage';
import { commentAction, removeAttachmentAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { AttachBox } from '@/components/attach';
import { Linkify, fmtWhen } from '@/components/ui';

/** Signed links for stored files, valid for an hour. Never throws: a storage hiccup should not break the page. */
async function signed(items: Attachment[]): Promise<Map<string, string>> {
  const paths = items.filter((a) => a.kind === 'file' && a.path).map((a) => a.path!);
  try { return await store().signedUrls(paths, 3600); } catch (e) { console.error('[attachments] signing failed', e); return new Map(); }
}

function Media({ a, url }: { a: Attachment; url: string | undefined }): ReactNode {
  if (a.kind === 'link') {
    const v = videoEmbed(a.url);
    if (v) {
      return (
        <div className="embed">
          <iframe src={v.embed} title={`${v.provider} video: ${a.name}`} loading="lazy" allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      );
    }
    return <a className="linkcard" href={a.url ?? '#'} target="_blank" rel="noopener noreferrer"><span className="ficon" aria-hidden="true">LINK</span><span>{a.url}</span></a>;
  }
  if (!url) return <div className="linkcard muted"><span className="ficon" aria-hidden="true">FILE</span><span>Preview unavailable. Refresh the page to try again.</span></div>;
  if (isImage(a.mime)) return <a className="thumb" href={url} target="_blank" rel="noopener noreferrer" title="Open full size"><img src={url} alt={a.name} loading="lazy" /></a>;
  if (isVideo(a.mime)) return <video className="vid" src={url} controls preload="metadata" />;
  return <a className="linkcard" href={url} target="_blank" rel="noopener noreferrer"><span className="ficon" aria-hidden="true">{typeLabel(a.mime).slice(0, 4).toUpperCase()}</span><span>Open {typeLabel(a.mime).toLowerCase()}</span></a>;
}

/** Screenshots, files and video players attached to a request. */
async function Gallery({ items, v, back }: { items: Attachment[]; v: Profile; back: string }): Promise<JSX.Element | null> {
  if (!items.length) return null;
  const urls = await signed(items);
  return (
    <div className="stack" style={{ gap: 8 }} id="attachments">
      <h3 style={{ margin: 0 }}>Files and videos <span className="muted" style={{ fontSize: 14 }}>{items.length}</span></h3>
      <div className="gallery">
        {items.map((a) => (
          <figure key={a.id} className="att">
            <Media a={a} url={a.path ? urls.get(a.path) : undefined} />
            <figcaption>
              <span className="nm">{a.kind === 'file' && a.path && urls.get(a.path) ? <a href={urls.get(a.path)} target="_blank" rel="noopener noreferrer">{a.name}</a> : a.kind === 'link' ? <a href={a.url ?? '#'} target="_blank" rel="noopener noreferrer">{a.name}</a> : a.name}</span>
              {a.internal ? <span className="tag int">Internal</span> : null}
              <br />
              <span className="small muted">{a.uploadedByName}, {fmtWhen(a.at)}{a.size ? `, ${fmtBytes(a.size)}` : ''}</span>
              {a.uploadedBy === v.id || isLeadRole(v.role) ? (
                <form action={removeAttachmentAction} className="rm">
                  <input type="hidden" name="attachmentId" value={a.id} /><input type="hidden" name="back" value={back} />
                  <Submit className="btn ghost sm" confirmText={`Remove "${a.name}"?`}>Remove</Submit>
                </form>
              ) : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/**
 * Everything said and shared on a request: files and videos, the message thread, and one message box.
 * The box takes attachments (paperclip, paste or drop) and, for the team, an internal-note option and a
 * "needs an answer" option that asks the client and pauses the clock.
 */
export async function Conversation({ v, requestId, back, comments, attachments, canComment, canAsk = false, canClientReply = false, placeholder }: {
  v: Profile; requestId: string; back: string; comments: Comment[]; attachments: Attachment[];
  canComment: boolean; canAsk?: boolean; canClientReply?: boolean; placeholder?: string;
}): Promise<JSX.Element> {
  const staff = v.role !== 'client';
  return (
    <section className="panel stack" id="conversation">
      <h2 style={{ margin: 0 }}>Conversation</h2>
      <Gallery items={attachments} v={v} back={back} />
      <div className="thread">
        {comments.map((c) => (
          <div key={c.id} className={`msg${c.internal ? ' internal' : ''}${c.fromClient ? ' client' : ''}`}>
            <div className="by">{c.authorName}, {fmtWhen(c.at)}{staff ? (c.internal ? ', internal note' : c.fromClient ? ', client' : '') : ''}</div>
            <p><Linkify text={c.body} /></p>
          </div>
        ))}
        {!comments.length ? <p className="muted" style={{ margin: 0 }}>{staff ? 'No messages yet.' : 'No messages yet. Your team will post updates here.'}</p> : null}
      </div>
      {canComment ? (
        <form action={commentAction} className="composer">
          <input type="hidden" name="id" value={requestId} /><input type="hidden" name="back" value={back} />
          <label className="sr" htmlFor={`msg-${requestId}`}>Message</label>
          <textarea id={`msg-${requestId}`} name="body" required placeholder={placeholder ?? (staff ? 'Write to the client, or tick Internal note for the team only. Paste a Loom link and it plays here.' : 'Message your team. Paste a Loom link and it plays here.')} />
          <div className="cbar">
            <AttachBox requestId={requestId} compact internalFrom={staff ? `int-${requestId}` : undefined} />
            {staff ? <label className="opt"><input type="checkbox" name="internal" id={`int-${requestId}`} /> Internal note</label> : null}
            {canAsk ? <label className="opt"><input type="checkbox" name="needsAnswer" /> Needs an answer from the client (pauses the clock)</label> : null}
            <span className="grow" />
            {canClientReply ? <Submit className="btn ghost" name="mode" value="clientAnswer">Log as the client&apos;s answer</Submit> : null}
            <Submit className="btn sig">Send</Submit>
          </div>
        </form>
      ) : null}
    </section>
  );
}
