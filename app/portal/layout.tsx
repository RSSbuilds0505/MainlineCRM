import type { ReactNode } from 'react';
import { eq } from 'drizzle-orm';
import { hasPassword, requireClient } from '@/lib/auth';
import { PasswordNudge } from '@/components/account';
import { getDb } from '@/lib/db';
import { orgs } from '@/lib/db/schema';
import { unreadCount } from '@/lib/queries';
import { Mark } from '@/components/ui';
import { AutoRefresh, NavLinks } from '@/components/client';

export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const v = await requireClient();
  const db = getDb();
  const [[org], unread, pw] = await Promise.all([db.select().from(orgs).where(eq(orgs.id, v.orgId ?? '00000000-0000-0000-0000-000000000000')), unreadCount(db, v), hasPassword()]);
  if (!org || !org.active) {
    return (
      <main className="login"><div className="panel stack"><Mark /><h1 style={{ fontSize: 26 }}>Your account is paused</h1><p style={{ margin: 0 }}>Contact your Mainline team to reactivate access.</p>
        <form action="/auth/signout" method="post"><button className="btn ghost" type="submit">Sign out</button></form></div></main>
    );
  }
  return (
    <>
      <header className="top">
        <div className="bar">
          <a href="/portal" style={{ textDecoration: 'none' }}><Mark /></a>
          <div className="who">
            <span className="me">{org.name}</span>
            <span>{v.name}{unread ? ` (${unread} new)` : ''}</span>
            <form action="/auth/signout" method="post"><button className="btn ghost sm" type="submit">Sign out</button></form>
          </div>
        </div>
        <NavLinks items={[{ href: '/portal', label: 'My requests', exact: true }, { href: '/portal/new', label: 'New request' }, { href: '/portal/services', label: 'Services' }, { href: '/portal/account', label: 'Account' }]} />
      </header>
      <main>{pw ? null : <PasswordNudge href="/portal/account" />}{children}</main>
      <AutoRefresh seconds={60} />
    </>
  );
}
