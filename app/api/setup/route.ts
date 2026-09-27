import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { applyMigrations, ensureOwner, seedBasics } from '@/lib/setup';
import { supabaseAdmin } from '@/lib/supabase/server';
import { signInLink } from '@/lib/people';

/**
 * One-time setup, protected by CRON_SECRET. Creates tables, seeds the catalog, creates the owner
 * account from OWNER_EMAIL and returns a first sign-in link. Safe to call again; it only fills gaps.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = getDb();
  const applied = await applyMigrations(db);
  await seedBasics(db);
  const email = (process.env.OWNER_EMAIL ?? '').trim().toLowerCase();
  let owner = 'skipped (OWNER_EMAIL not set)';
  let link: string | null = null;
  if (email) {
    const admin = supabaseAdmin();
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    let id = created.data.user?.id;
    if (!id) {
      const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
      id = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
    }
    if (!id) return NextResponse.json({ error: `could not create owner: ${created.error?.message}` }, { status: 500 });
    owner = (await ensureOwner(db, id, email, process.env.OWNER_NAME || 'Owner')) ? 'created' : 'already existed';
    link = await signInLink(email);
  }
  return NextResponse.json({ applied, owner, signInLink: link });
}
