/** One-time database setup the deployed app can run on itself: migrations, catalog and first owner. Idempotent. */
import { sql, eq } from 'drizzle-orm';
import type { DB } from './db';
import { MIGRATIONS } from './migrations.generated';
import { CATALOG } from './catalog';
import { pods, profiles, settings, skus } from './db/schema';
import { rowsOf } from './workflow';

export async function applyMigrations(db: DB): Promise<string[]> {
  await db.execute(sql`create table if not exists _mainline_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set(rowsOf<{ name: string }>(await db.execute(sql`select name from _mainline_migrations`)).map((r) => r.name));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    await db.transaction(async (tx) => {
      for (const stmt of m.sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) await tx.execute(sql.raw(stmt));
      await tx.execute(sql`insert into _mainline_migrations (name) values (${m.name})`);
    });
    applied.push(m.name);
  }
  await db.execute(sql`alter table _mainline_migrations enable row level security`);
  return applied;
}

export async function seedBasics(db: DB): Promise<void> {
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  for (const k of CATALOG) await db.insert(skus).values(k).onConflictDoNothing();
  const [pod] = await db.select().from(pods).limit(1);
  if (!pod) await db.insert(pods).values({ name: 'Pod 1' });
}

export async function ensureOwner(db: DB, id: string, email: string, name: string): Promise<boolean> {
  const [existing] = await db.select().from(profiles).where(eq(profiles.role, 'owner')).limit(1);
  if (existing) return false;
  await db.insert(profiles).values({ id, email: email.toLowerCase(), name, role: 'owner', platforms: ['HubSpot', 'Salesforce', 'Monday'], capacity: 10 }).onConflictDoNothing();
  return true;
}
