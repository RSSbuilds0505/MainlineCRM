import { requireViewer } from '@/lib/auth';
import { notFound } from 'next/navigation';
import { upgradeAction } from '@/app/actions';
import { Flash, Head } from '@/components/ui';
import { Submit } from '@/components/client';
export default async function Upgrade({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const viewer = await requireViewer();
  if (viewer.role !== 'owner') notFound();
  return <><Flash sp={searchParams}/><Head title="Database upgrade" sub="Apply the bundled migrations for this release."/><div className="panel stack"><p>Confirm your database recovery arrangements before upgrading. The project-budget migration adds columns and an Owner-only pricing table; it preserves existing accounts, requests and credits.</p><form action={upgradeAction}><Submit confirmText="Apply pending database migrations?">Apply pending migrations</Submit></form><a href="/app/setup">Return to Setup</a></div></>;
}
