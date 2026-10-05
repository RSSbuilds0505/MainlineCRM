import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireClient } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getSettings } from '@/lib/queries';
import { clockWord } from '@/lib/core';
import { Flash, Head } from '@/components/ui';
import { SupportForm } from '@/components/support-form';

export default async function PortalNewSupport({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  await requireClient();
  const s = await getSettings(getDb());
  return (
    <>
      <Link className="back" href="/portal/new">New</Link>
      <Flash sp={searchParams} />
      <Head title="Something is broken, or a question" sub="Tell us what is wrong and an implementer on your team picks it up right away. This never uses credits." />
      <section className="panel"><SupportForm back="/portal/new/support" clock={clockWord(s)} /></section>
    </>
  );
}
