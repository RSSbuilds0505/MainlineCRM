import type { ReactNode } from 'react';
import { setPasswordAction } from '@/app/actions';
import { MIN_PASSWORD, ROLE_LBL } from '@/lib/core';
import type { Profile } from '@/lib/db/schema';
import { Flash, Head } from '@/components/ui';
import { Submit } from '@/components/client';

/** Account details plus the form to set or change a password. Used by the staff app and the client portal. */
export function AccountPage({ v, hasPassword, sp }: { v: Profile; hasPassword: boolean; sp: Record<string, string | undefined> }): ReactNode {
  return (
    <>
      <Flash sp={sp} />
      <Head title="Account" sub="Your sign-in details." />
      <div className="grid2 even">
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>{hasPassword ? 'Change your password' : 'Set a password'}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {hasPassword
              ? 'Your new password replaces the old one right away.'
              : 'Once saved, you can sign in with your email and password instead of waiting for an email link.'}
          </p>
          <form action={setPasswordAction} className="form">
            <input type="text" name="username" value={v.email} autoComplete="username" readOnly hidden />
            <label className="f">New password<input type="password" name="password" required minLength={MIN_PASSWORD} autoComplete="new-password" /></label>
            <label className="f">Type it again<input type="password" name="confirm" required minLength={MIN_PASSWORD} autoComplete="new-password" /></label>
            <p className="small muted" style={{ margin: 0 }}>At least {MIN_PASSWORD} characters. A short phrase is easier to remember and harder to guess.</p>
            <div><Submit className="btn sig">Save password</Submit></div>
          </form>
        </section>
        <section className="panel">
          <dl className="facts">
            <div><dt>Name</dt><dd>{v.name}</dd></div>
            <div><dt>Email</dt><dd>{v.email}</dd></div>
            <div><dt>Role</dt><dd>{ROLE_LBL[v.role]}</dd></div>
            <div><dt>Password</dt><dd>{hasPassword ? 'Set' : 'Not set yet'}</dd></div>
          </dl>
        </section>
      </div>
    </>
  );
}

/** Nudge shown until the person sets a password. */
export function PasswordNudge({ href }: { href: string }): ReactNode {
  return <div className="banner" role="note">Set a password so you can sign in without an email link. <a href={href}>Set it now</a></div>;
}
