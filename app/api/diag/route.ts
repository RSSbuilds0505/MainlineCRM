import { NextResponse } from 'next/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

/**
 * Database health check, protected by CRON_SECRET. Uses its own short-lived connection so it still
 * answers when the app's shared connection is stuck. POST with ?fix=1 also ends sessions that have
 * sat idle inside an open transaction for more than 30 seconds (they hold locks and stall the app).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const fix = new URL(req.url).searchParams.get('fix') === '1';
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 });
  const started = Date.now();
  try {
    await sql`set statement_timeout = '15s'`;
    const sessions = await sql`
      select pid, usename, application_name, state, wait_event_type, wait_event,
             now() - xact_start as xact_age, now() - state_change as state_age, left(query, 160) as query
      from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'
      order by xact_start nulls last`;
    const locks = await sql`
      select l.pid, l.mode, l.granted, c.relname
      from pg_locks l left join pg_class c on c.oid = l.relation
      where l.database = (select oid from pg_database where datname = current_database()) and c.relname not like 'pg_%'`;
    let ended: unknown[] = [];
    if (fix) {
      ended = await sql`
        select pid, pg_terminate_backend(pid) as ended from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid() and usename = current_user
          and state like 'idle in transaction%' and now() - state_change > interval '30 seconds'`;
    }
    const settings = await sql`select name, setting from pg_settings where name in ('idle_in_transaction_session_timeout','statement_timeout','lock_timeout')`;
    return NextResponse.json({ ms: Date.now() - started, sessions, locks, ended, settings });
  } catch (e) {
    return NextResponse.json({ ms: Date.now() - started, error: String(e) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}
