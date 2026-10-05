'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ACCEPT, MAX_UPLOAD_BYTES, allowedType, fmtBytes } from '@/lib/media';

let sb: SupabaseClient | null = null;
function storageClient(): SupabaseClient {
  sb ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  return sb;
}

type Item = { key: string; name: string; size: number; preview: string | null; status: 'uploading' | 'done' | 'error'; error?: string; path?: string };

function screenshotName(type: string): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1] ?? 'png';
  return `screenshot-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

/**
 * Attach screenshots, videos and files. Drag and drop, choose files, or paste a screenshot anywhere on the page.
 * On an existing request, files are saved as soon as they finish uploading. On a new-request form ("draft"),
 * finished uploads ride along with the form as hidden fields and are attached when the form is submitted.
 */
export function AttachBox({ requestId, canInternal = false, draft = false, compact = false, internalFrom }: { requestId?: string; canInternal?: boolean; draft?: boolean; compact?: boolean; internalFrom?: string }): ReactNode {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [over, setOver] = useState(false);
  const [internal, setInternal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const guardRef = useRef<HTMLInputElement>(null);
  const busy = items.some((i) => i.status === 'uploading');

  const patch = (key: string, p: Partial<Item>): void => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const uploadOne = async (file: File, name: string, key: string): Promise<{ path: string; name: string } | null> => {
    try {
      const res = await fetch('/api/uploads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: draft ? undefined : requestId, name, size: file.size, type: file.type }) });
      const body = (await res.json().catch(() => ({}))) as { path?: string; token?: string; bucket?: string; error?: string };
      if (!res.ok || !body.path || !body.token) throw new Error(body.error ?? 'Could not start the upload.');
      const { error } = await storageClient().storage.from(body.bucket ?? 'attachments').uploadToSignedUrl(body.path, body.token, await file.arrayBuffer(), { contentType: file.type });
      if (error) throw new Error(error.message || 'The upload did not finish.');
      patch(key, { status: 'done', path: body.path });
      return { path: body.path, name };
    } catch (e) {
      patch(key, { status: 'error', error: e instanceof Error ? e.message : 'Upload failed.' });
      return null;
    }
  };

  const handle = useCallback(async (list: File[], pasted = false): Promise<void> => {
    setMsg(null);
    const accepted: { file: File; name: string; key: string }[] = [];
    const rejected: string[] = [];
    for (const file of list.slice(0, 20)) {
      const name = pasted || !file.name || file.name === 'image.png' ? screenshotName(file.type) : file.name;
      if (!allowedType(file.type)) { rejected.push(`${name}: file type not supported`); continue; }
      if (file.size > MAX_UPLOAD_BYTES) { rejected.push(`${name}: over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Share longer videos as a Loom link.`); continue; }
      accepted.push({ file, name, key: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
    }
    if (rejected.length) setMsg({ ok: false, text: rejected.join(' ') });
    if (!accepted.length) return;
    setItems((xs) => [...xs, ...accepted.map((a) => ({ key: a.key, name: a.name, size: a.file.size, preview: a.file.type.startsWith('image/') ? URL.createObjectURL(a.file) : null, status: 'uploading' as const }))]);
    const done = (await Promise.all(accepted.map((a) => uploadOne(a.file, a.name, a.key)))).filter((x): x is { path: string; name: string } => !!x);
    if (draft || !done.length) return;
    const res = await fetch('/api/uploads/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId, files: done, internal: internal || (!!internalFrom && !!(document.getElementById(internalFrom) as HTMLInputElement | null)?.checked) }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string; count?: number };
    if (!res.ok) { setMsg({ ok: false, text: body.error ?? 'Could not save the attachment.' }); return; }
    setItems((xs) => xs.filter((x) => !done.some((d) => d.path === x.path)));
    setMsg({ ok: true, text: `${body.count ?? done.length} attached.` });
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, requestId, internal, internalFrom, router]);

  // Paste a screenshot anywhere on the page (Ctrl+V or Cmd+V).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
      if (!files.length) return;
      e.preventDefault();
      void handle(files, true);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [handle]);

  // In the compact message-box version, a file dropped anywhere on the page is attached.
  useEffect(() => {
    if (!compact) return;
    const over = (e: DragEvent): void => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setOver(true); } };
    const leave = (e: DragEvent): void => { if (!e.relatedTarget) setOver(false); };
    const drop = (e: DragEvent): void => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); setOver(false); void handle([...e.dataTransfer.files]); };
    document.addEventListener('dragover', over); document.addEventListener('dragleave', leave); document.addEventListener('drop', drop);
    return () => { document.removeEventListener('dragover', over); document.removeEventListener('dragleave', leave); document.removeEventListener('drop', drop); };
  }, [compact, handle]);

  // While uploads run, block the surrounding form from submitting half-finished.
  useEffect(() => { guardRef.current?.setCustomValidity(busy ? 'Wait for your files to finish uploading.' : ''); }, [busy]);
  useEffect(() => () => items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const list = items.length ? (
    <ul className="uploads">
      {items.map((i) => (
        <li key={i.key} className={i.status}>
          {i.preview ? <img src={i.preview} alt="" /> : <span className="ficon" aria-hidden="true">{i.name.split('.').pop()?.slice(0, 4).toUpperCase()}</span>}
          <span className="nm">{i.name}<br /><span className="small muted">{i.status === 'uploading' ? 'Uploading' : i.status === 'error' ? i.error : draft ? `Ready, ${fmtBytes(i.size)}` : 'Saving'}</span></span>
          {draft && i.status !== 'uploading' ? <button type="button" className="btn ghost sm" onClick={() => setItems((xs) => xs.filter((x) => x.key !== i.key))}>Remove</button> : null}
          {draft && i.status === 'done' ? <input type="hidden" name="file" value={JSON.stringify({ path: i.path, name: i.name })} /> : null}
        </li>
      ))}
    </ul>
  ) : null;

  if (compact) {
    return (
      <div className={`attach compact${over ? ' over' : ''}`}>
        <button type="button" className="btn ghost sm clip" onClick={() => inputRef.current?.click()} title="Attach screenshots or files. You can also paste a screenshot or drop files anywhere on the page.">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.5 6.5v10a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V6.5H9v9a3 3 0 0 0 6 0V5a4.5 4.5 0 0 0-9 0v11.5a6 6 0 0 0 12 0v-10z" /></svg>
          Attach
        </button>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { void handle([...(e.target.files ?? [])]); e.target.value = ''; }} />
        {over ? <span className="small" role="status">Drop to attach</span> : null}
        {list}
        {msg ? <p className={`small ${msg.ok ? 'ok-text' : 'err-text'}`} role={msg.ok ? 'status' : 'alert'} style={{ margin: 0 }}>{msg.text}</p> : null}
      </div>
    );
  }

  return (
    <div className="attach">
      <div
        className={`drop${over ? ' over' : ''}`}
        role="button" tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void handle([...e.dataTransfer.files]); }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.5 6.5v10a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V6.5H9v9a3 3 0 0 0 6 0V5a4.5 4.5 0 0 0-9 0v11.5a6 6 0 0 0 12 0v-10z" /></svg>
        <span><strong>Add screenshots or files</strong><br /><span className="small muted">Click to choose, drag them here, or paste a screenshot (Ctrl+V). Up to {MAX_UPLOAD_BYTES / 1024 / 1024} MB each.</span></span>
      </div>
      <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { void handle([...(e.target.files ?? [])]); e.target.value = ''; }} />
      {canInternal && !draft ? (
        <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal only (client can&apos;t see)</label>
      ) : null}
      {list}
      {draft ? <input ref={guardRef} className="guard" tabIndex={-1} aria-hidden="true" defaultValue="" /> : null}
      {draft ? (
        <label className="f">Loom or video link (optional)<input type="url" name="videoUrl" inputMode="url" placeholder="https://www.loom.com/share/..." /></label>
      ) : null}
      {msg ? <p className={`small ${msg.ok ? 'ok-text' : 'err-text'}`} role={msg.ok ? 'status' : 'alert'} style={{ margin: 0 }}>{msg.text}</p> : null}
    </div>
  );
}
