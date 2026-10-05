import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Home(): Promise<never> {
  const v = await getViewer();
  if (!v) redirect('/login?e=noaccess');
  redirect(v.role === 'client' ? '/portal' : '/app');
}
