import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { randomUUID } from 'node:crypto';
import * as schema from '../lib/db/schema';
import type { DB } from '../lib/db';
import { applyMigrations, ensureOwner, seedBasics } from '../lib/setup';

async function main(): Promise<void> {
  const pg = new PGlite();
  await pg.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
  const db = drizzle(pg, { schema }) as unknown as DB;
  const a1 = await applyMigrations(db); await seedBasics(db);
  const a2 = await applyMigrations(db); await seedBasics(db);
  const id = randomUUID();
  const o1 = await ensureOwner(db, id, 'Josh@X.co', 'Josh'); const o2 = await ensureOwner(db, id, 'josh@x.co', 'Josh');
  const skus = await db.select().from(schema.skus);
  const ok = a1.length === 6 && a2.length === 0 && o1 && !o2 && skus.length === 12 && skus.some((k) => k.id === 'support');
  console.log({ first: a1, second: a2, ownerCreated: o1, ownerSecond: o2, skus: skus.length }, ok ? 'SETUP OK' : 'SETUP FAIL');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
