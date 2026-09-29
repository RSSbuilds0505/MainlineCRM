import type { ReactNode } from 'react';
import { hasPassword, requireStaff } from '@/lib/auth';
import { AccountPage } from '@/components/account';

export default async function StaffAccount({ searchParams }: { searchParams: Record<string, string | undefined> }): Promise<ReactNode> {
  const v = await requireStaff();
  return <AccountPage v={v} hasPassword={await hasPassword()} sp={searchParams} />;
}
