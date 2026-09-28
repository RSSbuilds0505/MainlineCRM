import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { profiles, type Profile } from './db/schema';
import { supabaseServer } from './supabase/server';
import { isLeadRole, isStaffRole } from './core';

/** The signed-in person's profile, verified server-side from the session. Never trust a client-sent id. */
export async function getViewer(): Promise<Profile | null> {
  const t0 = Date.now();
  const { data } = await supabaseServer().auth.getUser();
  console.log(`[viewer] getUser ${data.user ? 'ok' : 'none'} +${Date.now() - t0}ms`);
  if (!data.user) return null;
  const [p] = await getDb().select().from(profiles).where(eq(profiles.id, data.user.id));
  console.log(`[viewer] profile ${p ? 'found' : 'missing'} +${Date.now() - t0}ms`);
  return p && p.active ? p : null;
}

export async function requireViewer(): Promise<Profile> {
  const v = await getViewer();
  if (!v) redirect('/login?e=noaccess');
  return v;
}
export async function requireStaff(): Promise<Profile> {
  const v = await requireViewer();
  if (!isStaffRole(v.role)) redirect('/portal');
  return v;
}
export async function requireLead(): Promise<Profile> {
  const v = await requireStaff();
  if (!isLeadRole(v.role)) redirect('/app');
  return v;
}
export async function requireClient(): Promise<Profile> {
  const v = await requireViewer();
  if (v.role !== 'client') redirect('/app');
  return v;
}
