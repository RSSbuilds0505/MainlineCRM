import { redirect } from 'next/navigation';

/** Old address for Get support. */
export default function OldPortalSupport(): never {
  redirect('/portal/new/support');
}
