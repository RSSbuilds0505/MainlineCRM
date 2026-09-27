import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from './schema';

// Any driver's query-result type is accepted so tests can pass an embedded Postgres (PGlite).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- driver HKT differs between postgres-js and PGlite
export type DB = PgDatabase<any, typeof schema>;

const g = globalThis as unknown as { __mainlineDb?: DB; __mainlineSql?: ReturnType<typeof postgres> };

/** Server-side database handle. Never import from a client component. */
export function getDb(): DB {
  if (g.__mainlineDb) return g.__mainlineDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // prepare:false is required by the Supabase transaction pooler.
  const sql = postgres(url, { prepare: false, max: Number(process.env.DB_POOL_MAX ?? 5) });
  g.__mainlineSql = sql;
  g.__mainlineDb = drizzle(sql, { schema }) as unknown as DB;
  return g.__mainlineDb;
}

/** Lets tests swap in an embedded database. */
export function setDbForTests(db: DB): void {
  g.__mainlineDb = db;
}

export { schema };
