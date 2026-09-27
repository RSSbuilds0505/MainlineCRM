import { sql } from 'drizzle-orm';
import type { DB } from './db';
import { rowsOf } from './workflow';

/** Fixed-window limiter backed by Postgres so it holds across serverless instances. */
export async function allow(db: DB, key: string, limit: number, windowSec: number): Promise<{ ok: boolean; retryAfter: number }> {
  const now = Math.floor(Date.now() / 1000);
  const start = now - (now % windowSec);
  const res = await db.execute(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${start}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`);
  const count = Number(rowsOf<{ count: number }>(res)[0]?.count ?? 1);
  if (Math.random() < 0.02) await db.execute(sql`delete from rate_limits where window_start < ${now - 86400}`);
  return { ok: count <= limit, retryAfter: start + windowSec - now };
}
