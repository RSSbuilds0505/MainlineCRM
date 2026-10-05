/** Idempotent: safe to run more than once. Creates settings, the service catalog and the first owner account. */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import * as schema from '../lib/db/schema';
import { CATALOG } from '../lib/catalog';

async function main(): Promise<void> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const db = drizzle(sql, { schema });
  await db.insert(schema.settings).values({ id: 1 }).onConflictDoNothing();
  for (const k of CATALOG) await db.insert(schema.skus).values(k).onConflictDoNothing();
  const [pod] = await db.select().from(schema.pods).limit(1);
  if (!pod) await db.insert(schema.pods).values({ name: 'Pod 1' });

  const email = (process.env.OWNER_EMAIL ?? '').toLowerCase().trim();
  if (email) {
    const [existing] = await db.select().from(schema.profiles).where(eq(schema.profiles.email, email));
    if (!existing) {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      let id: string | undefined;
      const created = await admin.auth.admin.createUser({ email, email_confirm: true });
      id = created.data.user?.id;
      if (!id) {
        const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
        id = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
      }
      if (!id) throw new Error(`Could not create the owner account: ${created.error?.message}`);
      await db.insert(schema.profiles).values({ id, email, name: process.env.OWNER_NAME || 'Owner', role: 'owner', platforms: ['HubSpot', 'Salesforce', 'Monday'], capacity: 10 });
      console.log(`Owner account ready for ${email}.`);
    } else console.log(`Owner ${email} already exists.`);
  }
  await sql.end();
  console.log('Seed complete.');
}
main().catch((e) => { console.error(e); process.exit(1); });
