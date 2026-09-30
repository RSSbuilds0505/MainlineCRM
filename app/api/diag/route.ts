import { NextResponse } from 'next/server';
import postgres from 'postgres';
import { BUCKET, store } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Database health check, protected by CRON_SECRET. Uses its own short-lived connection so it still
 * answers when the app's shared connection is stuck. POST with ?fix=1 also ends sessions that have
 * sat idle inside an open transaction, or stalled waiting on the client, for more than 60 seconds (they hold locks and stall the app).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const fix = new URL(req.url).searchParams.get('fix') === '1';
  if (new URL(req.url).searchParams.get('storage') === '1') return NextResponse.json(await storageCheck());
  if (new URL(req.url).searchParams.get('roles') === '1') {
    const c = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 });
    const out: Record<string, unknown> = {};
    try {
      out.who = await c`select current_user, session_user, (select rolsuper from pg_roles where rolname = current_user) as super, (select rolcreaterole from pg_roles where rolname = current_user) as createrole, (select datdba::regrole::text from pg_database where datname = current_database()) as db_owner`;
      out.roleconfig = await c`select rolname, rolconfig from pg_roles where rolname in (current_user, 'authenticator', 'anon', 'authenticated')`;
      for (const [k, q] of [['alterRole', `ALTER ROLE ${'"'}postgres${'"'} SET idle_session_timeout = '60s'`], ['alterDb', `ALTER DATABASE postgres SET idle_session_timeout = '60s'`]] as const) {
        try { await c.unsafe(q); out[k] = 'ok'; } catch (e) { out[k] = String(e); }
      }
    } catch (e) { out.error = String(e); } finally { await c.end({ timeout: 2 }).catch(() => undefined); }
    return NextResponse.json(out);
  }
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 });
  const started = Date.now();
  try {
    const before = await sql`select current_setting('statement_timeout') as statement_timeout, current_setting('lock_timeout') as lock_timeout, current_user as who, version() as v`;
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
    let ended: readonly unknown[] = [];
    if (fix) {
      ended = await sql`
        select pid, pg_terminate_backend(pid) as ended from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid() and usename = current_user
          and now() - state_change > interval '60 seconds'
          and (state like 'idle in transaction%' or (state = 'active' and wait_event = 'ClientRead'))`;
    }
    const settings = await sql`select name, setting from pg_settings where name in ('idle_in_transaction_session_timeout','statement_timeout','lock_timeout')`;
    return NextResponse.json({ ms: Date.now() - started, before, sessions, locks, ended, settings });
  } catch (e) {
    return NextResponse.json({ ms: Date.now() - started, error: String(e), where: (e as { query?: string }).query?.slice(0, 80) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

/** Uploads a tiny PNG through a signed upload token, reads its metadata, signs a download link, fetches it, then deletes it. */
async function storageCheck(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const path = `diag/${crypto.randomUUID()}.png`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  try {
    await store().ensureBucket(); out.bucket = 'ok';
    const { token } = await store().signUpload(path); out.signUpload = 'ok';
    const up = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}?token=${token}`, {
      method: 'PUT', headers: { 'content-type': 'image/png', apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, body: png,
    });
    out.upload = up.status;
    out.info = await store().info(path);
    const urls = await store().signedUrls([path], 60);
    const get = urls.get(path) ? await fetch(urls.get(path)!) : null;
    out.download = get ? `${get.status} ${get.headers.get('content-type')} ${(await get.arrayBuffer()).byteLength} bytes` : 'no signed url';
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  } finally {
    await store().remove([path]).catch(() => undefined);
    out.cleanedUp = !(await store().info(path).catch(() => null));
  }
  return out;
}
