import { redirect } from 'next/navigation';

/** The dashboard now lives on Home for the owner and leads. */
export default function OldDashboard({ searchParams }: { searchParams: Record<string, string | undefined> }): never {
  redirect(searchParams.m === '1' ? '/app?m=1#overview' : '/app#overview');
}
