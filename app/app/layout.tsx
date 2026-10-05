import type { ReactNode } from 'react';
import { hasPassword, requireStaff } from '@/lib/auth';
import { PasswordNudge } from '@/components/account';
import { getDb } from '@/lib/db';
import { unreadCount } from '@/lib/queries';
import { sweep } from '@/lib/workflow';
import { deliver } from '@/lib/notify';
import { ROLE_LBL, isCsmRole, isLeadRole } from '@/lib/core';
import { Mark } from '@/components/ui';
import { NavLinks, AutoRefresh, Menu } from '@/components/client';

export const dynamic = 'force-dynamic';

export default async function StaffLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const v = await requireStaff();
  const db = getDb();
  // Escalations and monthly resets also run here, at most every 5 minutes, so they happen even without a paid cron plan.
  try { const s = await sweep(db); await deliver(s.out); } catch (e) { console.error('[sweep]', e); }
  const [unread, pw] = await Promise.all([unreadCount(db, v), hasPassword()]);
  const lead = isLeadRole(v.role);
  const csm = isCsmRole(v.role);
  const items = [
    { href: '/app', label: 'Home', exact: true },
    { href: '/app/board', label: 'Board' },
    { href: '/app/clients', label: 'Clients' },
    ...(lead ? [{ href: '/app/setup', label: 'Setup' }] : []),
  ];
  const initials = v.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <>
      <header className="top">
        <div className="bar">
          <a href="/app" style={{ textDecoration: 'none' }}><Mark /></a>
          <div className="who">
            {csm ? <a className="btn sig sm" href="/app/new">+ New</a> : null}
            <a className="bell" href="/app/inbox" title={unread ? `Inbox, ${unread} unread` : 'Inbox'} aria-label={unread ? `Inbox, ${unread} unread` : 'Inbox'}>
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2z" /></svg>
              {unread ? <span className="count">{unread > 99 ? '99+' : unread}</span> : null}
            </a>
            <Menu label={<span className="me"><span className="av sm">{initials}</span>{v.name}</span>}>
              <span className="small muted menu-role">{ROLE_LBL[v.role]}</span>
              <a href="/app/inbox">Inbox{unread ? ` (${unread})` : ''}</a>
              <a href="/app/time">{lead ? 'Time' : 'My time'}</a>
              <a href="/app/account">Account</a>
              <form action="/auth/signout" method="post"><button type="submit">Sign out</button></form>
            </Menu>
          </div>
        </div>
        <NavLinks items={items} />
      </header>
      <main>{pw ? null : <PasswordNudge href="/app/account" />}{children}</main>
      <AutoRefresh seconds={45} />
    </>
  );
}
