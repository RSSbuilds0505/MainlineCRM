import type { ReactNode } from 'react';
import { hasPassword, requireStaff } from '@/lib/auth';
import { PasswordNudge } from '@/components/account';
import { getDb } from '@/lib/db';
import { unreadCount } from '@/lib/queries';
import { sweep } from '@/lib/workflow';
import { deliver } from '@/lib/notify';
import { ROLE_LBL, isCsmRole, isLeadRole } from '@/lib/core';
import { Mark } from '@/components/ui';
import { NavLinks, AutoRefresh } from '@/components/client';

export const dynamic = 'force-dynamic';

export default async function StaffLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const v = await requireStaff();
  const db = getDb();
  // Escalations and monthly resets also run here, at most every 5 minutes, so they happen even without a paid cron plan.
  try { const s = await sweep(db); await deliver(s.out); } catch (e) { console.error('[sweep]', e); }
  const [unread, pw] = await Promise.all([unreadCount(db, v), hasPassword()]);
  const lead = isLeadRole(v.role);
  const items = [
    { href: '/app', label: v.role === 'owner' ? 'Needs attention' : 'My queue', exact: true },
    { href: '/app/board', label: 'Board' },
    ...(isCsmRole(v.role) ? [{ href: '/app/new', label: 'New request' }] : []),
    { href: '/app/inbox', label: 'Inbox', count: unread },
    { href: '/app/time', label: lead ? 'Time' : 'My time' },
    { href: '/app/clients', label: 'Clients' },
    ...(lead ? [{ href: '/app/dashboard', label: 'Dashboard' }, { href: '/app/setup', label: 'Setup' }] : []),
    { href: '/app/account', label: 'Account' },
  ];
  return (
    <>
      <header className="top">
        <div className="bar">
          <a href="/app" style={{ textDecoration: 'none' }}><Mark /></a>
          <div className="who">
            <span className="me"><span className="av sm">{v.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>{v.name}</span>
            <span>{ROLE_LBL[v.role]}</span>
            <form action="/auth/signout" method="post"><button className="btn ghost sm" type="submit">Sign out</button></form>
          </div>
        </div>
        <NavLinks items={items} />
      </header>
      <main>{pw ? null : <PasswordNudge href="/app/account" />}{children}</main>
      <AutoRefresh seconds={45} />
    </>
  );
}
