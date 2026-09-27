import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Request, Settings } from '@/lib/db/schema';
import { CLIENT_LBL, CLIENT_LINE, LBL, LINE, TZ, sla } from '@/lib/core';

export const fmtWhen = (d: Date | string | null | undefined): string =>
  d ? new Date(d).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
export const fmtDay = (d: Date | string | null | undefined): string =>
  d ? new Date(typeof d === 'string' && d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }) : '';
export const money = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');
export const hrs = (n: number): string => String(Math.round((n || 0) * 100) / 100);
export const initials = (n: string): string => n.split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase();

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }): ReactNode {
  const ok = typeof sp.ok === 'string' ? sp.ok : null;
  const err = typeof sp.err === 'string' ? sp.err : null;
  const link = typeof sp.link === 'string' ? sp.link : null;
  if (!ok && !err) return null;
  return (
    <div className={`flash ${err ? 'err' : 'ok'}`} role={err ? 'alert' : 'status'}>
      {err ?? ok}
      {link ? <code className="copy" style={{ marginTop: 8 }}>{link}</code> : null}
    </div>
  );
}

export function SlaChip({ r, s }: { r: Request; s: Settings }): ReactNode {
  const st = sla(r, s);
  if (!st) return null;
  return <span className={`chip ${st.cls}`} title={st.kind}>{st.text}</span>;
}

export function Line({ r, full }: { r: Request; full?: boolean }): ReactNode {
  if (r.status === 'cancelled') return <div className="cancelled">Cancelled</div>;
  const cur = r.status === 'waiting' ? 'in_progress' : r.status;
  const idx = LINE.indexOf(cur);
  return (
    <ol className={`line${full ? ' full' : ''}`} aria-label={`Progress: ${LBL[r.status]}`}>
      {LINE.map((st, i) => {
        const c = i < idx ? 'past' : i === idx ? `now${r.status === 'waiting' ? ' hold' : ''}` : 'next';
        const l = i === idx && r.status === 'waiting' ? LBL.waiting : LBL[st];
        return <li key={st} className={c}><span className="stop" /><span className="lbl">{l}</span></li>;
      })}
    </ol>
  );
}

export function ClientLine({ r, full }: { r: Request; full?: boolean }): ReactNode {
  if (r.status === 'cancelled') return <div className="cancelled">Cancelled</div>;
  const idx = CLIENT_LINE.findIndex((x) => x.statuses.includes(r.status));
  return (
    <ol className={`line${full ? ' full' : ''}`} aria-label={`Progress: ${CLIENT_LBL[r.status]}`}>
      {CLIENT_LINE.map((st, i) => {
        const c = i < idx ? 'past' : i === idx ? `now${r.status === 'waiting' ? ' hold' : ''}` : 'next';
        const l = i === idx ? CLIENT_LBL[r.status] : st.label;
        return <li key={st.key} className={c}><span className="stop" /><span className="lbl">{l}</span></li>;
      })}
    </ol>
  );
}

export function ReqRow({ r, href, meta, right, client }: { r: Request; href: string; meta: string; right: ReactNode; client?: boolean }): ReactNode {
  return (
    <Link className="req" href={href}>
      <span className="t">
        <span><span className="n">ML-{r.num}</span><br /><span className="title">{r.title}</span><br /><span className="meta">{meta}</span></span>
        <span style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>{right}</span>
      </span>
      {client ? <ClientLine r={r} /> : <Line r={r} />}
    </Link>
  );
}

export function Empty({ children }: { children: ReactNode }): ReactNode {
  return <div className="empty">{children}</div>;
}

export function Head({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }): ReactNode {
  return (
    <div className="head">
      <div><h1>{title}</h1>{sub ? <p className="sub">{sub}</p> : null}</div>
      {children}
    </div>
  );
}

export function Mark(): ReactNode {
  return (
    <div className="mark">
      <svg width="30" height="22" viewBox="0 0 30 22" aria-hidden="true"><rect x="0" y="6" width="30" height="3" rx="1.5" fill="currentColor" /><rect x="0" y="14" width="30" height="3" rx="1.5" fill="currentColor" /><circle cx="22" cy="11.5" r="5" fill="#D9960F" /></svg>
      <span>Mainline <small>by RSS</small></span>
    </div>
  );
}
