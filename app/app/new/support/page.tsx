import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getSettings, lookups } from '@/lib/queries';
import { clockWord, isCsmRole } from '@/lib/core';
import { Empty, Flash, Head } from '@/components/ui';
import { SupportForm } from '@/components/support-form';

export default async function StaffSupport({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireStaff();
  if (!isCsmRole(v.role)) redirect('/app');
  const db = getDb();
  const [L, s] = await Promise.all([lookups(db), getSettings(db)]);
  const orgs = [...L.orgs.values()].filter((o) => o.active);
  if (!orgs.length) return <Empty>Add a client in Setup before logging support tickets.</Empty>;
  return (
    <>
      <Link className="back" href="/app/new">New</Link>
      <Flash sp={searchParams} />
      <Head title="Something is broken, or a question" sub="For a client who called, emailed or messaged about a problem. It routes straight to an implementer in their pod, with no credits." />
      <section className="panel"><SupportForm back="/app/new/support" orgs={orgs} org={searchParams.org} clock={clockWord(s)} /></section>
    </>
  );
}
