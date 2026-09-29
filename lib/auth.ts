import { cache } from 'react';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import type { User } from '@supabase/supabase-js';
import { getDb } from './db';
import { profiles, type Profile } from './db/schema';
import { supabaseServer } from './supabase/server';
import { isLeadRole, isStaffRole } from './core';

/** The session's auth user, verified with Supabase. Cached so a layout and page share one lookup per request. */
export const authUser = cache(async (): Promise<User | null> => {
  const { data } = await supabaseServer().auth.getUser();
  return data.user ?? null;
});

/** True once the person has chosen a password (set when they save one on the Account page). */
export async function hasPassword(): Promise<boolean> {
  const u = await authUser();
  return !!u?.user_metadata?.password_set;
}

/** The signed-in person's profile, verified server-side from the session. Never trust a client-sent id. */
export const getViewer = cache(async (): Promise<Profile | null> => {
  const user = await authUser();
  if (!user) return null;
  const [p] = await getDb().select().from(profiles).where(eq(profiles.id, user.id));
  return p && p.active ? p : null;
});

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
