/**
 * End-to-end tests against a real embedded Postgres (PGlite): migrations, the full request
 * lifecycle for client- and team-submitted tickets, permissions, SLA sweep, and Row Level Security.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../lib/db/schema';
import type { DB } from '../lib/db';
import * as wf from '../lib/workflow';
import { visibleRequests, requestDetail } from '../lib/queries';
import { CATALOG } from '../lib/catalog';
import { bizMs, addBiz, H } from '../lib/core';
import { projectSummary } from '../lib/projects';
import { projectBudget, projectValue } from '../lib/project-budget';
import { csvField } from '../lib/csv';
import { memoryStore, setStoreForTests } from '../lib/storage';
import { videoEmbed, safeName, checkLink } from '../lib/media';

let pass = 0, fail = 0;
function ok(cond: unknown, name: string): void {
  if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name); }
}
async function throws(p: Promise<unknown>, name: string, match?: RegExp): Promise<void> {
  try { await p; ok(false, name + ' (expected an error)'); } catch (e) { ok(!match || match.test(String((e as Error).message)), `${name}: ${(e as Error).message}`); }
}

async function main(): Promise<void> {
  const pg = new PGlite();
  // Emulate the pieces of Supabase the RLS migration relies on.
  await pg.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
  `);
  const db = drizzle(pg, { schema }) as unknown as DB;
  await migrate(drizzle(pg), { migrationsFolder: './drizzle' });
  ok(true, 'migrations applied');

  // Seed
  for (const k of CATALOG) await db.insert(schema.skus).values(k);
  const [podA] = await db.insert(schema.pods).values({ name: 'Pod A' }).returning();
  const [podB] = await db.insert(schema.pods).values({ name: 'Pod B' }).returning();
  const mk = async (name: string, role: schema.Role, extra: Partial<schema.Profile> = {}): Promise<schema.Profile> => {
    const [p] = await db.insert(schema.profiles).values({ id: randomUUID(), email: `${name.toLowerCase().replace(/\s/g, '')}@x.co`, name, role, platforms: ['HubSpot'], ...extra }).returning();
    return p;
  };
  const owner = await mk('Josh Rogers', 'owner');
  const lead = await mk('Dana Lead', 'lead');
  const csm = await mk('Marcus CSM', 'csm', { podId: podA.id });
  const imp1 = await mk('Priya Impl', 'implementer', { podId: podA.id, platforms: ['HubSpot', 'Salesforce'] });
  const imp2 = await mk('Tom Impl', 'implementer', { podId: podA.id });
  const impB = await mk('Other Pod Impl', 'implementer', { podId: podB.id });
  await db.update(schema.pods).set({ csmId: csm.id }).where(eq(schema.pods.id, podA.id));
  const orgA = (await wf.saveOrg(db, lead, { name: 'Harbor Dental', platform: 'HubSpot', podId: podA.id, plan: 'Growth', monthlyCredits: 10 })).value;
  const orgB = (await wf.saveOrg(db, lead, { name: 'Ridgeview', platform: 'HubSpot', podId: podB.id, plan: 'Starter', monthlyCredits: 5 })).value;
  const clientA = await mk('Amy Client', 'client', { orgId: orgA, platforms: [] });
  const clientB = await mk('Ben Client', 'client', { orgId: orgB, platforms: [] });

  console.log('\nClient-submitted ticket');
  const created = await wf.createRequest(db, clientA, { orgId: orgA, skuId: 'hs-workflow', title: 'Lead routing', description: 'Route by region', priority: 'normal' });
  const rid = created.value;
  let [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, rid));
  ok(r.status === 'submitted' && r.source === 'Client portal' && r.submittedBy === clientA.id, 'client request lands as Submitted from the portal');
  ok(created.out.email.some((e) => e.to === csm.email), 'pod CSM is emailed about the new ticket');
  ok(created.out.email.some((e) => e.to === clientA.email && /received/i.test(e.subject)), 'client gets a receipt email');
  const [n1] = await db.select().from(schema.notifications).where(eq(schema.notifications.toId, csm.id));
  ok(!!n1, 'CSM gets an inbox notification');
  await throws(wf.createRequest(db, clientA, { orgId: orgB, skuId: 'hs-workflow', title: 'x', description: '', priority: 'normal' }), 'client cannot submit for another company');
  await throws(wf.createRequest(db, clientA, { orgId: orgA, skuId: 'sf-flow', title: 'x', description: '', priority: 'normal' }), 'client cannot pick a service for another platform');

  console.log('\nIsolation');
  ok((await visibleRequests(db, clientB)).length === 0, 'other client sees none of Harbor Dental tickets');
  ok((await requestDetail(db, clientB, rid)) === null, 'other client cannot open the ticket by id');
  await throws(wf.comment(db, clientB, rid, 'hi'), 'other client cannot comment');
  ok((await visibleRequests(db, impB)).length === 0, 'implementer in another pod cannot see it');
  ok((await visibleRequests(db, imp1)).length === 1, 'implementer in the client pod can see it');
  await throws(wf.triage(db, clientA, rid, 'hs-workflow', 'high'), 'client cannot triage');
  await throws(wf.triage(db, imp1, rid, 'hs-workflow', 'high'), 'implementer cannot triage');

  console.log('\nTeam workflow');
  await wf.triage(db, csm, rid, 'hs-workflow', 'high');
  await throws(wf.scope(db, csm, rid, { credits: 99, slaHours: 12, estHours: 4 }), 'scoping more credits than the balance is refused', /Not enough credits/);
  const sc = await wf.scope(db, csm, rid, { credits: 3, slaHours: 12, estHours: 4 });
  [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, rid));
  const [oa] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgA));
  ok(r.status === 'assigned' && [imp1.id, imp2.id].includes(r.assigneeId ?? ''), `routed to an implementer in the client pod (${r.assigneeId === imp1.id ? 'Priya' : 'Tom'})`);
  ok(r.qaId && r.qaId !== r.assigneeId, 'a different person is QA reviewer');
  ok(oa.credits === 7, 'credits debited from 10 to 7');
  ok(sc.out.email.some((e) => e.to === clientA.email && /scheduled/.test(e.subject)), 'client told the ticket is scheduled');
  const assignee = [imp1, imp2].find((x) => x.id === r.assigneeId)!;
  const reviewer = [imp1, imp2, lead].find((x) => x.id === r.qaId)!;
  await throws(wf.start(db, reviewer.id === assignee.id ? csm : reviewer, rid), 'non-assignee cannot start work');
  await wf.start(db, assignee, rid);
  const ask = await wf.askClient(db, assignee, rid, 'Which regions?');
  [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, rid));
  ok(r.status === 'waiting' && !!r.pausedAt, 'question pauses the ticket');
  ok(ask.out.email.some((e) => e.to === clientA.email), 'client emailed the question');
  const reply = await wf.comment(db, clientA, rid, 'East and West');
  [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, rid));
  ok(r.status === 'in_progress' && r.pausedAt === null, 'client reply in the portal resumes work');
  ok(reply.out.email.some((e) => e.to === assignee.email), 'assignee emailed the answer');
  await wf.comment(db, assignee, rid, 'Using round robin', { internal: true });
  const dClient = await requestDetail(db, clientA, rid);
  ok(!!dClient && dClient.comments.every((c) => !c.internal) && dClient.events.length === 0, 'client never sees internal notes or the activity log');
  await wf.logTime(db, assignee, rid, { hours: 2.5, note: 'built', workDate: '2026-09-28' });
  await throws(wf.logTime(db, clientA, rid, { hours: 1, note: '', workDate: '2026-09-28' }), 'client cannot log time');
  await wf.submitQa(db, assignee, rid);
  await throws(wf.passQa(db, reviewer, rid, 1, ''), 'QA cannot pass with unchecked items', /Check every QA item/);
  await wf.failQa(db, reviewer, rid, 'Missing suppression list');
  [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, rid));
  ok(r.status === 'in_progress' && r.qaFails === 1, 'QA return goes back to the implementer');
  await wf.submitQa(db, assignee, rid);
  const pq = await wf.passQa(db, reviewer, rid, 4, 'Done, see video');
  [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, rid));
  ok(r.status === 'delivered' && !!r.autoAcceptAt, 'passing QA delivers to the client');
  ok(pq.out.email.some((e) => e.to === clientA.email && /ready for your review/.test(e.subject)), 'client emailed that it is ready');
  await throws(wf.accept(db, clientB, rid), 'other client cannot accept');
  await wf.revise(db, clientA, rid, 'Add the South region too');
  [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, rid));
  ok(r.status === 'in_progress' && r.revisions === 1 && r.deliveredAt === null, 'client revision reopens the work');
  await wf.submitQa(db, assignee, rid);
  await wf.passQa(db, reviewer, rid, 4, '');
  await wf.accept(db, clientA, rid);
  [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, rid));
  ok(r.status === 'closed', 'client accepts and the ticket closes');

  console.log('\nTeam-submitted ticket and cancellation');
  const t2 = await wf.createRequest(db, csm, { orgId: orgA, skuId: 'hs-report', title: 'Pipeline report', description: 'Weekly', priority: 'normal', source: 'Phone call', contact: 'Amy', triageNow: true });
  let [r2] = await db.select().from(schema.requests).where(eq(schema.requests.id, t2.value));
  ok(r2.status === 'triaged' && r2.source === 'Phone call', 'CSM-logged ticket skips triage and records the source');
  ok((await visibleRequests(db, clientA)).some((x) => x.id === r2.id), 'client sees tickets the team logged for them');
  await wf.scope(db, csm, r2.id, { credits: 2, slaHours: 16, estHours: 3 });
  await wf.cancel(db, clientA, r2.id);
  [r2] = await db.select().from(schema.requests).where(eq(schema.requests.id, t2.value));
  const [oa2] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgA));
  ok(r2.status === 'cancelled' && oa2.credits === 7, 'client cancels before work starts and credits are refunded');
  await throws(wf.createRequest(db, imp1, { orgId: orgA, skuId: 'hs-report', title: 'x', description: '', priority: 'normal', triageNow: true }).then(async (res) => {
    const [x] = await db.select().from(schema.requests).where(eq(schema.requests.id, res.value));
    if (x.status !== 'submitted') throw new Error('implementer skipped triage');
    throw new Error('implementer ticket stays Submitted');
  }), 'implementer can log a ticket but cannot skip triage', /stays Submitted/);

  console.log('\nSLA sweep');
  const old = await wf.createRequest(db, clientA, { orgId: orgA, skuId: 'hs-property', title: 'Old one', description: '', priority: 'urgent' });
  await db.update(schema.requests).set({ createdAt: new Date(Date.now() - 10 * 24 * H) }).where(eq(schema.requests.id, old.value));
  const sw = await wf.sweep(db, { force: true });
  ok(sw.value.escalated === 1, 'overdue ticket escalated once');
  const lvl3 = await db.select().from(schema.notifications).where(eq(schema.notifications.toId, owner.id));
  ok(lvl3.some((x) => x.kind === 'escalation'), 'level 3 reaches the owner');
  const sw2 = await wf.sweep(db, { force: true });
  ok(sw2.value.escalated === 0, 'running the sweep again does not repeat alerts');

  console.log('\nBusiness-hours clock');
  const c = { slaMode: 'business', bizStart: 9, bizEnd: 18 };
  const fri5pm = Date.parse('2026-10-02T21:00:00Z'); // Fri 5pm Eastern
  const mon10am = Date.parse('2026-10-05T14:00:00Z'); // Mon 10am Eastern
  ok(Math.round(bizMs(fri5pm, mon10am, c) / H) === 2, 'Friday 5pm to Monday 10am counts as 2 business hours');
  ok(addBiz(fri5pm, 2 * H, c) === mon10am, 'adding 2 business hours from Friday 5pm lands Monday 10am');

  console.log('\nSetup permissions');
  await throws(wf.saveOrg(db, csm, { name: 'X', platform: 'HubSpot', podId: null, plan: 'Growth', monthlyCredits: 1 }), 'CSM cannot change setup');
  await throws(wf.setRate(db, lead, imp1.id, 30), 'lead cannot see or set pay rates');
  await wf.setRate(db, owner, imp1.id, 30);
  await throws(wf.saveProfile(db, lead, { id: owner.id, email: owner.email, name: 'x', role: 'implementer', orgId: null, podId: null, platforms: [], capacity: 1, active: false }, false), 'lead cannot demote the owner');

  console.log('\nSupport tickets');
  const creditsBefore = (await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgA)))[0].credits;
  const tk = await wf.createSupportTicket(db, clientA, { orgId: orgA, category: 'broken', title: 'Form not submitting', description: 'The demo form throws an error since this morning.', priority: 'high' });
  let [t] = await db.select().from(schema.requests).where(eq(schema.requests.id, tk.value));
  ok(t.skuId === 'support' && t.category === 'broken', 'ticket is stored as a support ticket with its category');
  ok(t.status === 'assigned' && [imp1.id, imp2.id].includes(t.assigneeId ?? ''), 'ticket skips triage and scoping and routes to an implementer in the client pod');
  ok(t.qaId === null && t.credits === 0 && t.slaHours === 8 && !!t.scopedAt, 'no QA reviewer, no credits, 8-hour target for High, clock started');
  ok((await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgA)))[0].credits === creditsBefore, 'client credits are untouched');
  const tAssignee = [imp1, imp2].find((p) => p.id === t.assigneeId)!;
  ok(tk.out.email.some((e) => e.to === tAssignee.email), 'assigned implementer is emailed');
  ok(tk.out.email.some((e) => e.to === clientA.email && /support ticket/i.test(e.subject)), 'client gets a receipt');
  ok(tk.out.slack.some((m) => /High support ticket/.test(m)), 'high-priority ticket is posted to Slack');
  const low = await wf.createSupportTicket(db, clientA, { orgId: orgA, category: 'question', title: 'How do I export?', description: 'Where is the export button?', priority: 'low' });
  ok(!low.out.slack.length, 'low-priority ticket does not ping Slack');
  await throws(wf.createSupportTicket(db, clientA, { orgId: orgA, category: 'nonsense', title: 'x', description: 'y', priority: 'normal' }), 'unknown category is rejected');
  await throws(wf.createSupportTicket(db, clientA, { orgId: orgA, category: 'broken', title: 'x', description: '', priority: 'normal' }), 'a description is required');
  await throws(wf.createSupportTicket(db, clientB, { orgId: orgA, category: 'broken', title: 'x', description: 'y', priority: 'normal' }), 'client cannot open a ticket for another company');
  await throws(wf.createRequest(db, clientA, { orgId: orgA, skuId: 'support', title: 'x', description: '', priority: 'normal' }), 'support cannot be ordered as a paid service');
  ok((await requestDetail(db, clientB, t.id)) === null, 'other client cannot open the ticket');
  const other = t.assigneeId === imp1.id ? imp2 : imp1;
  await wf.start(db, tAssignee, t.id);
  await throws(wf.submitQa(db, tAssignee, t.id), 'tickets do not go through QA');
  await throws(wf.resolveTicket(db, tAssignee, t.id, '  '), 'resolving needs a note for the client');
  await throws(wf.resolveTicket(db, other, t.id, 'fixed'), 'another implementer cannot resolve it');
  const res = await wf.resolveTicket(db, tAssignee, t.id, 'Reconnected the form to the workflow.');
  [t] = await db.select().from(schema.requests).where(eq(schema.requests.id, t.id));
  ok(t.status === 'delivered' && !!t.autoAcceptAt, 'resolved ticket waits for the client to confirm');
  ok(res.out.email.some((e) => e.to === clientA.email && /resolved/i.test(e.subject)), 'client is emailed that it is resolved');
  await wf.revise(db, clientA, t.id, 'Still failing on mobile.');
  [t] = await db.select().from(schema.requests).where(eq(schema.requests.id, t.id));
  ok(t.status === 'in_progress' && t.revisions === 1, 'client can reopen a ticket that is not fixed');
  await wf.resolveTicket(db, tAssignee, t.id, 'Fixed the mobile layout too.');
  await wf.accept(db, clientA, t.id);
  [t] = await db.select().from(schema.requests).where(eq(schema.requests.id, t.id));
  ok(t.status === 'closed', 'client confirms the fix and the ticket closes');
  const orgC = (await wf.saveOrg(db, lead, { name: 'Monday Co', platform: 'Monday', podId: podB.id, plan: 'Starter', monthlyCredits: 5 })).value;
  const logged = await wf.createSupportTicket(db, csm, { orgId: orgC, category: 'access', title: 'User locked out', description: 'Called in, cannot log in.', priority: 'urgent', contact: 'Sam by phone' });
  const [tc] = await db.select().from(schema.requests).where(eq(schema.requests.id, logged.value));
  ok(tc.source === 'Logged by team' && tc.contact === 'Sam by phone' && tc.slaHours === 4, 'CSM can log a ticket for a client, with a 4-hour target for Urgent');
  ok(tc.assigneeId === impB.id, 'when no one knows the platform, routing falls back to anyone with capacity in the pod');
  await throws(wf.createSupportTicket(db, imp1, { orgId: orgA, category: 'broken', title: 'x', description: 'y', priority: 'normal' }), 'implementers cannot open tickets on a client\'s behalf')

  console.log('\nAttachments');
  const mem = memoryStore(); setStoreForTests(mem);
  const up = await wf.prepareUpload(db, clientA, { requestId: rid }, { name: 'Screen Shot 1.png', size: 2048, type: 'image/png' });
  ok(up.path.startsWith(`req/${rid}/`) && up.path.endsWith('Screen-Shot-1.png') && !!up.token, 'upload is scoped to the request with a safe file name');
  await throws(wf.prepareUpload(db, clientA, { requestId: rid }, { name: 'x.html', size: 10, type: 'text/html' }), 'web pages cannot be uploaded');
  await throws(wf.prepareUpload(db, clientA, { requestId: rid }, { name: 'big.mp4', size: 60 * 1024 * 1024, type: 'video/mp4' }), 'files over 50 MB are refused');
  await throws(wf.prepareUpload(db, clientB, { requestId: rid }, { name: 'a.png', size: 10, type: 'image/png' }), 'another company cannot upload to this request');
  await throws(wf.addFiles(db, clientA, rid, [{ path: up.path, name: 'Screen Shot 1.png' }]), 'a file that never finished uploading is not recorded', /did not finish/);
  mem.put(up.path, 2048, 'image/png');
  const af = await wf.addFiles(db, clientA, rid, [{ path: up.path, name: 'Screen Shot 1.png' }]);
  ok(af.value === 1, 'finished upload is recorded');
  ok(af.out.email.some((e) => /attached 1 file/.test(e.subject)), 'the team is emailed when a client attaches a screenshot');
  const [otherReq] = await db.select().from(schema.requests).where(eq(schema.requests.orgId, orgB));
  const stray = `req/${otherReq?.id ?? randomUUID()}/x.png`; mem.put(stray, 10, 'image/png');
  await throws(wf.addFiles(db, clientA, rid, [{ path: stray, name: 'x.png' }]), 'a file uploaded for a different request cannot be claimed', /does not belong/);
  const draftB = `draft/${clientB.id}/y.png`; mem.put(draftB, 10, 'image/png');
  await throws(wf.addFiles(db, clientA, rid, [{ path: draftB, name: 'y.png' }]), "someone else's draft upload cannot be claimed", /does not belong/);
  const sneaky = `req/${rid}/evil.png`; mem.put(sneaky, 10, 'text/html');
  await throws(wf.addFiles(db, clientA, rid, [{ path: sneaky, name: 'evil.png' }]), 'the stored type is checked, not the file name', /not supported/);
  ok(!(await mem.info(sneaky)), 'a rejected file is deleted from storage');
  const loom = await wf.addLink(db, clientA, rid, 'https://www.loom.com/share/0123456789abcdef0123456789abcdef');
  ok(loom.value === 1, 'Loom link is attached');
  await throws(wf.addLink(db, clientA, rid, 'javascript:alert(1)'), 'script links are refused');
  await throws(wf.addLink(db, clientA, rid, 'not a link'), 'text that is not a link is refused');
  await wf.addLink(db, csm, rid, 'https://drive.google.com/file/d/abc/view', true);
  const clientView = await requestDetail(db, clientA, rid);
  const staffView = await requestDetail(db, csm, rid);
  ok(clientView!.attachments.length === 2 && staffView!.attachments.length === 3, 'internal attachments are hidden from the client');
  ok(clientView!.attachments.some((a) => a.name === 'Loom video'), 'Loom link gets a readable name');
  const du = await wf.prepareUpload(db, clientA, { draft: true }, { name: 'form-error.png', size: 500, type: 'image/png' });
  ok(du.path.startsWith(`draft/${clientA.id}/`), 'uploads on a new-request form go to the person\'s draft area');
  mem.put(du.path, 500, 'image/png');
  const tk2 = await wf.createSupportTicket(db, clientA, { orgId: orgA, category: 'broken', title: 'Report blank', description: 'Dashboard shows nothing.', priority: 'normal' });
  const at2 = await wf.attachToNew(db, clientA, tk2.value, [{ path: du.path, name: 'form-error.png' }], ['https://youtu.be/dQw4w9WgXcQ', '']);
  ok(at2.value === 2 && !at2.out.email.length, 'files and links from the form attach to the new ticket without extra emails');
  const mine = clientView!.attachments.find((a) => a.kind === 'file')!;
  await throws(wf.removeAttachment(db, clientB, mine.id), 'another company cannot remove it');
  await throws(wf.removeAttachment(db, imp2, mine.id), 'a teammate who did not add it cannot remove it');
  const rm = await wf.removeAttachment(db, clientA, mine.id);
  ok(rm.value === up.path, 'the person who added it can remove it');
  ok(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.provider === 'YouTube' && videoEmbed('https://vimeo.com/123456789')?.provider === 'Vimeo' && videoEmbed('http://www.loom.com/share/0123456789abcdef') === null, 'video links are recognized, and only over https');
  ok(safeName('../../etc/passwd') === 'etcpasswd' && safeName('   ') === 'file', 'file names cannot climb out of their folder');
  ok(checkLink('ftp://x.com/a') === null, 'only web links are accepted');

  console.log('\nProject allocations and owner-only pricing');
  await throws(wf.saveOrg(db, lead, { name: 'Blocked project', platform: 'LeadSquared', podId: podA.id, plan: 'Project', monthlyCredits: 0, billingModel: 'project', contractedHours: 100, projectRate: 100 }), 'lead cannot create financial contract terms', /Only the owner/);
  await throws(wf.saveOrg(db, owner, { name: 'Invalid project', platform: 'LeadSquared', podId: podA.id, plan: 'Project', monthlyCredits: 0, billingModel: 'project', contractedHours: NaN }), 'nonfinite budget is rejected');
  await throws(wf.saveOrg(db, owner, { name: 'Invalid rate', platform: 'LeadSquared', podId: podA.id, plan: 'Project', monthlyCredits: 0, billingModel: 'project', contractedHours: 100, projectRate: -1 }), 'negative rate is rejected');
  const projectId = (await wf.saveOrg(db, owner, { name: 'Isolated project', platform: 'LeadSquared', podId: podA.id, plan: 'Project', monthlyCredits: 999, billingModel: 'project', contractedHours: 100, projectRate: 100 })).value;
  const projectClient = await mk('Project Client', 'client', { orgId: projectId });
  const projectReq = (await wf.createRequest(db, owner, { orgId: projectId, skuId: 'any-custom', title: 'Project delivery', description: 'Isolated acceptance test', priority: 'normal', triageNow: true })).value;
  await wf.scope(db, owner, projectReq, { credits: 999, slaHours: 40, estHours: 10 });
  const [scopedProject] = await db.select().from(schema.requests).where(eq(schema.requests.id, projectReq));
  ok(scopedProject.credits === 0, 'project scoping ignores monthly credit input');
  const [projectOrg] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, projectId));
  ok(projectOrg.monthlyCredits === 0 && projectOrg.credits === 0, 'project account never receives monthly credits');
  await wf.logTime(db, owner, projectReq, { hours: 2.5, note: 'Project work', workDate: '2026-10-01' });
  const budget = await projectSummary(db, owner, projectId);
  ok(budget?.financial?.value === 10000 && budget.financial.loggedValue === 250 && budget.remaining === 97.5, 'fictional 100 hours at $100 produces $10,000 and tracks logged/remaining hours');
  ok((await projectSummary(db, lead, projectId))?.financial === null, 'lead summary omits all project pricing');
  ok((await projectSummary(db, projectClient, projectId))?.financial === null, 'own client sees operational allocation only');
  ok(await projectSummary(db, clientA, projectId) === null && await projectSummary(db, impB, projectId) === null, 'other client and pod cannot access project summary');
  ok(await projectSummary(db, { ...owner, active: false }, projectId) === null, 'inactive owner cannot access project summary');
  await throws(wf.resetCredits(db, lead, projectId), 'manual credit resets are blocked for projects');
  await throws(wf.setPrice(db, owner, projectId, 500), 'project account cannot be assigned monthly subscription pricing');
  await db.update(schema.orgs).set({ creditsPeriod: '2000-01' }).where(eq(schema.orgs.id, projectId));
  await db.update(schema.settings).set({ autoReset: true, lastSweepAt: null });
  await wf.sweep(db, { force: true });
  const [afterReset] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, projectId));
  ok(afterReset.contractedHours === 100 && afterReset.creditsPeriod === '2000-01', 'monthly sweep leaves project allocation and period untouched');
  await throws(wf.saveOrg(db, lead, { id: projectId, name: 'Isolated project', platform: 'LeadSquared', podId: podA.id, plan: 'Project', monthlyCredits: 0, contractedHours: 200 }), 'lead cannot change contracted budget');
  await throws(wf.saveOrg(db, owner, { id: projectId, name: 'Isolated project', platform: 'LeadSquared', podId: podA.id, plan: 'Project', monthlyCredits: 0, billingModel: 'retainer' }), 'cannot switch billing model over existing history');
  ok(projectBudget(100, 80).warning !== null && projectBudget(100, 100).warning === 'Allocation exhausted' && projectBudget(100, 101).remaining === -1, '80 percent, exhausted, and over-budget warnings');
  ok(projectValue(1.25, 125.55) === 156.94, 'money is rounded to cents');
  ok(csvField('=HYPERLINK("x")').startsWith('"\'') && csvField(-1) === '"-1"', 'CSV neutralizes text formulas while preserving numeric values');

  console.log('\nRow Level Security (direct database access with the public key)');
  const asUser = async <T>(uid: string, q: string): Promise<T[]> => {
    await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
    try { return (await pg.query<T>(q)).rows; } finally { await pg.exec(`reset role;`); }
  };
  ok((await asUser(clientB.id, 'select * from requests')).length === 0, 'Ridgeview contact reads zero Harbor Dental requests');
  ok((await asUser(clientA.id, 'select * from requests')).length === (await visibleRequests(db, clientA)).length, 'Harbor Dental contact reads exactly its own requests');
  ok((await asUser<{ internal: boolean }>(clientA.id, 'select * from comments')).every((x) => !x.internal), 'client cannot read internal notes');
  ok((await asUser(clientA.id, 'select * from request_events')).length === 0, 'client cannot read the activity log');
  ok((await asUser(clientA.id, 'select * from timelogs')).length === 0, 'client cannot read time entries');
  ok((await asUser<{ internal: boolean }>(clientA.id, 'select * from attachments')).every((x) => !x.internal) && (await asUser(clientA.id, 'select * from attachments')).length > 0, 'client reads its own attachments but never internal ones');
  ok((await asUser(clientB.id, 'select * from attachments')).length === 0, 'another company reads none of them');
  ok((await asUser(clientA.id, 'select * from orgs')).length === 1, 'client reads only its own company record');
  ok((await asUser(lead.id, 'select * from staff_rates')).length === 0, 'lead cannot read pay rates');
  ok((await asUser(owner.id, 'select * from staff_rates')).length === 1, 'owner can read pay rates');
  ok((await asUser(lead.id, 'select * from project_prices')).length === 0 && (await asUser(projectClient.id, 'select * from project_prices')).length === 0, 'RLS hides project pricing from leads and clients');
  ok((await asUser(owner.id, 'select * from project_prices')).length === 1, 'RLS allows owner project pricing');
  const total = (await db.select().from(schema.requests)).length;
  ok((await asUser(imp1.id, 'select * from requests')).length === total, `staff can read all ${total} requests`);
  let blocked = false;
  try { await asUser(clientA.id, `update orgs set credits = 999`); } catch { blocked = true; }
  ok(blocked, 'client cannot write to the database directly');
  blocked = false;
  try { await asUser(owner.id, `insert into pods (name) values ('x')`); } catch { blocked = true; }
  ok(blocked, 'even the owner cannot write directly; all writes go through the server');
  ok((await asUser('00000000-0000-0000-0000-000000000000', 'select * from skus')).length === 0, 'unknown users read nothing');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
