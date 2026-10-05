import { brand } from './brand';
import { eq } from 'drizzle-orm';
import type { DB } from './db';
import { profiles, type Role } from './db/schema';
import { supabaseAdmin } from './supabase/server';
import { UserError, saveProfile, type Result, type Viewer } from './workflow';
import { sendEmail, emailEnabled } from './email';

const appUrl = (): string => (process.env.APP_URL ?? '').replace(/\/$/, '');

/** Finds or creates the Supabase auth account for an email and returns its id. */
async function ensureAuthUser(email: string): Promise<string> {
  const admin = supabaseAdmin();
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.data.user) return created.data.user.id;
  // Already registered: find the existing account.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  throw new UserError(`Could not create a sign-in account for ${email}: ${created.error?.message ?? 'unknown error'}`);
}

/** A one-time sign-in URL for an existing account. */
export async function signInLink(email: string): Promise<string> {
  const { data, error } = await supabaseAdmin().auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !data.properties?.hashed_token) throw new UserError(`Could not create a sign-in link: ${error?.message ?? 'unknown error'}`);
  return `${appUrl()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink`;
}

export type PersonInput = {
  id?: string; email: string; name: string; role: Role; orgId: string | null; podId: string | null;
  platforms: string[]; capacity: number; active: boolean; sendInvite: boolean;
};

/** Adds or updates a team member or client contact. New people get an account and, optionally, an invite email. */
export async function savePerson(db: DB, v: Viewer, input: PersonInput): Promise<Result<{ id: string; link: string | null; emailed: boolean }>> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('Enter a valid email address.');
  if (!input.name.trim()) throw new UserError('Enter a name.');
  let id = input.id;
  const isNew = !id;
  if (!id) {
    const [dupe] = await db.select().from(profiles).where(eq(profiles.email, email));
    if (dupe) throw new UserError(`${email} is already set up as ${dupe.name}. Edit that person instead.`);
    id = await ensureAuthUser(email);
  }
  const res = await saveProfile(db, v, { ...input, id, email }, isNew);
  let link: string | null = null;
  let emailed = false;
  if (isNew && input.sendInvite) {
    link = await signInLink(email);
    if (emailEnabled()) {
      emailed = await sendEmail({
        to: email,
        subject: input.role === 'client' ? `Your ${brand.name} client portal is ready` : `You have been added to the ${brand.name} team`,
        text: `Hi ${input.name.trim()},\n\n${v.name} set you up on ${brand.name}${input.role === 'client' ? ', where you can submit CRM requests and track their progress' : ''}.\n\nSign in here (the link works once and expires in 1 hour):\n${link}\n\nAfter that, sign in any time at ${appUrl()}/login with this email address.`,
      });
    }
  }
  return { value: { id, link, emailed }, out: res.out };
}
