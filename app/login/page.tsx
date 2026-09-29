import type { ReactNode } from 'react';
import { requestLink, signInPassword } from '@/app/actions';
import { Mark } from '@/components/ui';
import { Submit } from '@/components/client';

const MSG: Record<string, string> = {
  email: 'Enter a valid email address.',
  bad: 'That email and password do not match. If you have not set a password yet, use the email link below.',
  expired: 'That sign-in link has expired or was already used. Request a new one below.',
  noaccess: 'Your account is not set up for Mainline yet. Ask your Mainline contact to add you.',
};

export default function Login({ searchParams }: { searchParams: Record<string, string | undefined> }): ReactNode {
  const sent = searchParams.sent === '1';
  const e = searchParams.e;
  const err = e === 'rate' ? `Too many sign-in attempts. Try again in about ${searchParams.retry ?? '15'} minutes.` : e ? MSG[e] : null;
  return (
    <main className="login">
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}><Mark /></div>
      <div className="panel stack">
        <div><h1 style={{ fontSize: 28 }}>Sign in</h1><p className="sub">Use your work email and password.</p></div>
        {err ? <div className="flash err" role="alert">{err}</div> : null}
        {sent ? (
          <div className="flash ok" role="status">Check your inbox. If this email has access to Mainline, a sign-in link is on its way. It expires in 1 hour.</div>
        ) : null}
        <form action={signInPassword} className="form">
          <label className="f">Work email<input type="email" name="email" required autoComplete="username" inputMode="email" /></label>
          <label className="f">Password<input type="password" name="password" required autoComplete="current-password" /></label>
          <Submit className="btn sig">Sign in</Submit>
        </form>
      </div>
      <details className="panel" style={{ marginTop: 14 }} open={sent || e === 'expired'}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Forgot your password, or haven&apos;t set one yet?</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <p className="small muted" style={{ margin: 0 }}>We will email you a one-time sign-in link. Once you are in, open Account to set a new password.</p>
          <form action={requestLink} className="form">
            <label className="f">Work email<input type="email" name="email" required autoComplete="email" inputMode="email" /></label>
            <Submit className="btn ghost">Email me a sign-in link</Submit>
          </form>
        </div>
      </details>
    </main>
  );
}
