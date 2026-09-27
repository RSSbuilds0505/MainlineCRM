/** Local stand-ins for Supabase: an embedded Postgres over TCP and a tiny auth API. For browser tests only. */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import * as schema from '../../lib/db/schema';
import { CATALOG } from '../../lib/catalog';

async function main(): Promise<void> {
  const pg = new PGlite();
  await pg.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
  await migrate(drizzle(pg), { migrationsFolder: './drizzle' });
  const db = drizzle(pg, { schema });
  for (const k of CATALOG) await db.insert(schema.skus).values(k);
  const [pod] = await db.insert(schema.pods).values({ name: 'Pod 1' }).returning();
  const people: Record<string, string> = {};
  const mk = async (key: string, name: string, role: schema.Role, extra: Partial<schema.Profile> = {}): Promise<void> => {
    const id = randomUUID(); people[key] = id;
    await db.insert(schema.profiles).values({ id, email: `${key}@example.com`, name, role, platforms: ['HubSpot', 'Salesforce'], ...extra });
  };
  await mk('owner', 'Josh Rogers', 'owner');
  await mk('csm', 'Marcus Hill', 'csm', { podId: pod.id });
  await mk('imp', 'Priya Shah', 'implementer', { podId: pod.id });
  await mk('imp2', 'Tom Becker', 'implementer', { podId: pod.id });
  await db.update(schema.pods).set({ csmId: people.csm }).where(eq(schema.pods.id, pod.id));
  const [org] = await db.insert(schema.orgs).values({ name: 'Harbor Dental', platform: 'HubSpot', podId: pod.id, plan: 'Growth', monthlyCredits: 35, credits: 35, creditsPeriod: new Date().toISOString().slice(0, 7) }).returning();
  const [org2] = await db.insert(schema.orgs).values({ name: 'Ridgeview Nonprofit', platform: 'HubSpot', podId: pod.id, plan: 'Starter', monthlyCredits: 15, credits: 15, creditsPeriod: new Date().toISOString().slice(0, 7) }).returning();
  await mk('client', 'Amy Carter', 'client', { orgId: org.id, platforms: [] });
  await mk('client2', 'Ben Ortiz', 'client', { orgId: org2.id, platforms: [] });
  await db.insert(schema.staffRates).values({ profileId: people.imp, hourlyRate: 30 });
  await db.insert(schema.orgPrices).values({ orgId: org.id, monthlyPrice: 4500 });
  writeFileSync('tests/e2e/people.json', JSON.stringify(people));

  const server = new PGLiteSocketServer({ db: pg, port: 5433, host: '127.0.0.1', maxConnections: 50 });
  await server.start();

  const byId = new Map(Object.entries(people).map(([k, id]) => [id, `${k}@example.com`]));
  http.createServer((req, res) => {
    const send = (code: number, body: unknown): void => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    let raw = ''; req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url?.startsWith('/auth/v1/user')) {
        const tok = (req.headers.authorization ?? '').replace('Bearer ', '');
        const email = byId.get(tok);
        return email ? send(200, { id: tok, email, aud: 'authenticated', role: 'authenticated' }) : send(401, { message: 'invalid' });
      }
      if (req.url?.startsWith('/auth/v1/admin/users') && req.method === 'POST') {
        const body = JSON.parse(raw || '{}') as { email: string };
        const id = randomUUID(); byId.set(id, body.email);
        return send(200, { id, email: body.email, aud: 'authenticated' });
      }
      if (req.url?.startsWith('/auth/v1/admin/generate_link')) return send(200, { hashed_token: 'test-token', action_link: 'x', email_otp: '1', redirect_to: '', verification_type: 'magiclink', id: 'u' });
      if (req.url?.startsWith('/auth/v1/logout')) return send(204, {});
      return send(404, { message: 'not mocked' });
    });
  }).listen(54321, '127.0.0.1');
  console.log('READY');
}
main().catch((e) => { console.error(e); process.exit(1); });
