import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { isCsmRole } from '@/lib/core';
import { Flash, Head } from '@/components/ui';
import { NewChooser } from '@/components/new-chooser';

export default async function NewItem({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireStaff();
  if (!isCsmRole(v.role)) redirect('/app');
  const query = searchParams.org ? `org=${encodeURIComponent(searchParams.org)}` : '';
  return (
    <>
      <Flash sp={searchParams} />
      <Head title="New" sub="Log something a client asked for by email, phone, Slack or in a meeting. What is it?" />
      <NewChooser base="/app/new" query={query} client={false} />
    </>
  );
}
