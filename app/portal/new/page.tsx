import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireClient } from '@/lib/auth';
import { Flash, Head } from '@/components/ui';
import { NewChooser } from '@/components/new-chooser';

export default async function PortalNew({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  await requireClient();
  // A service picked from the Services page goes straight to the request form.
  if (searchParams.sku) redirect(`/portal/new/request?sku=${encodeURIComponent(searchParams.sku)}`);
  return (
    <>
      <Flash sp={searchParams} />
      <Head title="New" sub="Tell us what you need. Pick the one that fits best; your team can always move it." />
      <NewChooser base="/portal/new" client />
    </>
  );
}
