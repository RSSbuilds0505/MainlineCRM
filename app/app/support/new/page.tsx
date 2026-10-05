import { redirect } from 'next/navigation';

/** Old address for logging a support ticket. */
export default function OldStaffSupport({ searchParams }: { searchParams: Record<string, string | undefined> }): never {
  redirect(`/app/new/support${searchParams.org ? `?org=${encodeURIComponent(searchParams.org)}` : ''}`);
}
