import type { ReactNode } from 'react';
import { requireClient } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getSettings } from '@/lib/queries';
import { clockWord } from '@/lib/core';
import { Flash, Head } from '@/components/ui';
import { SupportForm } from '@/components/support-form';

export default async function PortalSupport({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  await requireClient();
  const s = await getSettings(getDb());
  return (
    <>
      <Flash sp={searchParams} />
      <Head title="Get support" sub="Tell us what is wrong and an implementer on your team picks it up right away. Support tickets never use credits." />
      <section className="panel"><SupportForm back="/portal/support/new" clock={clockWord(s)} /></section>
    </>
  );
}
