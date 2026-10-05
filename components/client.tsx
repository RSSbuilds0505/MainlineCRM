'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';

/** Keeps a screen current while people work in parallel. Pauses while someone is typing. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }): ReactNode {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      const el = document.activeElement;
      if (el && el.matches('input,textarea,select')) return;
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

/** A submit button that disables itself while the form is saving. */
export function Submit({ children, className = 'btn', confirmText, name, value, skipChecks = false }: { children: ReactNode; className?: string; confirmText?: string; name?: string; value?: string; skipChecks?: boolean }): ReactNode {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit" className={className} disabled={pending} name={name} value={value} formNoValidate={skipChecks || undefined}
      onClick={(e) => { if (confirmText && !window.confirm(confirmText)) e.preventDefault(); }}
    >
      {pending ? 'Saving' : children}
    </button>
  );
}

const TIMER_KEY = 'mainline.timer';
type TimerState = { requestId: string; start: number } | null;
function readTimer(): TimerState {
  try { return JSON.parse(localStorage.getItem(TIMER_KEY) ?? 'null') as TimerState; } catch { return null; }
}

/** Start/stop timer for one request. Stopping fills the hours field; the person reviews and saves. */
export function Timer({ requestId, fieldId }: { requestId: string; fieldId: string }): ReactNode {
  const [state, setState] = useState<TimerState>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    setState(readTimer());
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const running = state?.requestId === requestId;
  const other = state && state.requestId !== requestId;
  const mins = running ? Math.floor((Date.now() - state.start) / 60000) : 0;
  const startIt = (): void => {
    if (other && !window.confirm('A timer is running on another request. Replace it?')) return;
    const s = { requestId, start: Date.now() };
    try { localStorage.setItem(TIMER_KEY, JSON.stringify(s)); } catch { /* storage blocked: timer lasts for this page only */ }
    setState(s);
  };
  const stopIt = (): void => {
    if (!state) return;
    const h = Math.max(0.25, Math.round(((Date.now() - state.start) / 3_600_000) * 4) / 4);
    const el = document.getElementById(fieldId) as HTMLInputElement | null;
    if (el) { el.value = String(h); el.focus(); }
    try { localStorage.removeItem(TIMER_KEY); } catch { /* ignore */ }
    setState(null);
  };
  return running ? (
    <span className="timer">Timer {Math.floor(mins / 60)}:{String(mins % 60).padStart(2, '0')}<button type="button" className="btn sm" onClick={stopIt}>Stop and fill hours</button></span>
  ) : (
    <button type="button" className="btn ghost sm" onClick={startIt}>{other ? 'Start timer (replaces the other one)' : 'Start timer'}</button>
  );
}

type Suggestion = { skuId: string | null; skuName: string; priority: string; summary: string; missing: string[]; confidence: number };

/** Asks the server for a service and priority suggestion, then fills the form. */
export function AiSuggest({ formId, orgField }: { formId: string; orgField?: string }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [s, setS] = useState<Suggestion | null>(null);
  const run = async (): Promise<void> => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const fd = new FormData(form);
    const text = `${fd.get('title') ?? ''}\n\n${fd.get('description') ?? ''}`.trim();
    if (text.length < 12) { setMsg('Describe the request first, then ask for a suggestion.'); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/triage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, orgId: orgField ? fd.get(orgField) : null }) });
      const body = (await res.json()) as { suggestion?: Suggestion; error?: string };
      if (!res.ok || !body.suggestion) { setMsg(body.error ?? 'No suggestion this time. Pick the service yourself.'); return; }
      const sug = body.suggestion;
      setS(sug);
      if (sug.skuId) {
        const radio = form.querySelector<HTMLInputElement>(`input[name="skuId"][value="${CSS.escape(sug.skuId)}"]`);
        if (radio) radio.checked = true;
        const sel = form.querySelector<HTMLSelectElement>('select[name="skuId"]');
        if (sel) sel.value = sug.skuId;
      }
      const pri = form.querySelector<HTMLSelectElement>('select[name="priority"]');
      if (pri) pri.value = sug.priority;
    } catch {
      setMsg('No suggestion this time. Pick the service yourself.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div><button type="button" className="btn ghost" onClick={run} disabled={busy}>{busy ? 'Matching the request' : 'Suggest a service'}</button></div>
      {msg ? <p className="small muted" style={{ margin: 0 }}>{msg}</p> : null}
      {s ? (
        <div className="ai">
          <strong>Suggested: {s.skuName}</strong> <span className="muted small">({Math.round(s.confidence * 100)}% match, {s.priority} priority)</span>
          {s.summary ? <p style={{ margin: '6px 0 0' }}>{s.summary}</p> : null}
          {s.missing.length ? <div style={{ marginTop: 6 }}><span className="small muted">Helpful details to add:</span><ul>{s.missing.map((q) => <li key={q}>{q}</li>)}</ul></div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Tab bar that marks the current section. */
export function NavLinks({ items }: { items: { href: string; label: string; count?: number; exact?: boolean }[] }): ReactNode {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Main">
      {items.map((it) => {
        const on = it.exact ? path === it.href : path === it.href || path.startsWith(it.href + '/');
        return (
          <a key={it.href} href={it.href} aria-current={on ? 'page' : undefined}>
            {it.label}{it.count ? <span className="count" aria-label={`${it.count} unread`}>{it.count}</span> : null}
          </a>
        );
      })}
    </nav>
  );
}

/** A dropdown under the person's name. Closes on an outside click, Escape, or after picking a page. */
export function Menu({ label, children }: { label: ReactNode; children: ReactNode }): ReactNode {
  const path = usePathname();
  useEffect(() => {
    const close = (e: Event): void => {
      document.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach((d) => {
        if (e.type === 'keydown' ? (e as KeyboardEvent).key === 'Escape' : !d.contains(e.target as Node)) d.open = false;
      });
    };
    document.addEventListener('click', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', close); };
  }, []);
  return <details className="menu" key={path}><summary>{label}</summary><div className="menu-list">{children}</div></details>;
}
