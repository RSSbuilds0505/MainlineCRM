import type { ReactNode } from 'react';
import { hasPassword, requireClient } from '@/lib/auth';
import { AccountPage } from '@/components/account';

export default async function PortalAccount({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireClient();
  return <AccountPage v={v} hasPassword={await hasPassword()} sp={searchParams} />;
}
