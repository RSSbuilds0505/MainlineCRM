import type { ReactNode } from 'react';
import type { Attachment, Profile } from '@/lib/db/schema';
import { fmtBytes, isImage, isVideo, typeLabel, videoEmbed } from '@/lib/media';
import { isLeadRole } from '@/lib/core';
import { store } from '@/lib/storage';
import { addLinkAction, removeAttachmentAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { AttachBox } from '@/components/attach';
import { fmtWhen } from '@/components/ui';

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

/** The "Screenshots and videos" panel on a request, for staff and clients. */
export async function AttachmentsPanel({ items, v, requestId, back, canAdd }: { items: Attachment[]; v: Profile; requestId: string; back: string; canAdd: boolean }): Promise<JSX.Element> {
  const urls = await signed(items);
  const staff = v.role !== 'client';
  return (
    <section className="panel stack" id="attachments">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Screenshots and videos</h2>
        <span className="small muted">{items.length ? `${items.length} attached` : ''}</span>
      </div>
      {items.length ? (
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
      ) : (
        <p className="muted small" style={{ margin: 0 }}>{canAdd ? 'Nothing attached yet. A screenshot or a short Loom usually saves a round of questions.' : 'Nothing attached.'}</p>
      )}
      {canAdd ? (
        <div className="stack" style={{ gap: 10 }}>
          <AttachBox requestId={requestId} canInternal={staff} />
          <form action={addLinkAction} className="linkform">
            <input type="hidden" name="id" value={requestId} /><input type="hidden" name="back" value={back} />
            <label className="f" style={{ flex: 1 }}>Loom or video link<input type="url" name="url" required inputMode="url" placeholder="https://www.loom.com/share/..." /></label>
            {staff ? <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" name="internal" /> Internal</label> : null}
            <div style={{ alignSelf: 'end' }}><Submit className="btn ghost">Attach link</Submit></div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
