/**
 * Every write the app makes goes through this module. Each function checks the viewer's role,
 * performs the change in one transaction, records an event, and queues notifications.
 * Email and Slack delivery happens after the transaction commits (see lib/notify.ts).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from './db';
import {
  attachments, comments, escalations, notifications, orgPrices, projectPrices, orgs, pods, profiles, requestEvents, requests, settings, skus, staffRates, timelogs,
  type AiTriage, type Org, type Priority, type Profile, type Request, type Role, type Settings, type Status,
} from './db/schema';
import {
  ACTIVE, DAY, PRI, SUPPORT_CATEGORIES, SUPPORT_SKU, SUPPORT_SLA, WORKING, bizMs, clockWord, isCsmRole, isLeadRole, isStaffRole, isSupport,
  monthKey, route, sla, slaHoursFor, supportCategoryLabel,
} from './core';
import { SUPPORT_SKU_ROW } from './catalog';
import { MAX_ATTACHMENTS_PER_REQUEST, MAX_UPLOAD_BYTES, allowedType, checkLink, safeName, typeLabel } from './media';
import { store } from './storage';

export class UserError extends Error {}

export type Viewer = Profile;
export type Outbox = { email: { to: string; subject: string; text: string }[]; slack: string[] };
const newOutbox = (): Outbox => ({ email: [], slack: [] });

/* ---------------- permissions ---------------- */

export type Action =
  | 'triage' | 'scope' | 'assign' | 'reassign' | 'start' | 'ask' | 'submitqa' | 'resume' | 'qa' | 'accept' | 'revise'
  | 'autoclose' | 'cancel' | 'flag' | 'clearflag' | 'internal' | 'logtime' | 'comment' | 'clientReply' | 'resolve';

export function allowed(action: Action, r: Pick<Request, 'status' | 'assigneeId' | 'qaId' | 'unhappy' | 'autoAcceptAt' | 'orgId' | 'skuId'>, v: Viewer): boolean {
  if (!v.active) return false;
  const staff = isStaffRole(v.role), lead = isLeadRole(v.role), csm = isCsmRole(v.role);
  const client = v.role === 'client' && v.orgId === r.orgId;
  const mine = r.assigneeId === v.id;
  const support = isSupport(r);
  switch (action) {
    case 'triage': return r.status === 'submitted' && csm;
    case 'scope': return r.status === 'triaged' && csm;
    case 'assign': return r.status === 'scoped' && csm;
    case 'reassign': return WORKING.includes(r.status) && csm;
    case 'start': return r.status === 'assigned' && (mine || lead);
    case 'ask': return r.status === 'in_progress' && (mine || lead);
    case 'submitqa': return !support && r.status === 'in_progress' && (mine || lead);
    case 'resolve': return support && r.status === 'in_progress' && (mine || lead);
    case 'clientReply': return r.status === 'waiting' && csm;
    case 'resume': return r.status === 'waiting' && staff;
    case 'qa': return !support && r.status === 'qa' && (r.qaId === v.id || lead);
    case 'accept': case 'revise': return r.status === 'delivered' && (client || csm);
    case 'autoclose': return r.status === 'delivered' && csm && !!r.autoAcceptAt && Date.now() >= new Date(r.autoAcceptAt).getTime();
    case 'cancel': return ['submitted', 'triaged', 'scoped', 'assigned'].includes(r.status) && (client || csm);
    case 'flag': return ACTIVE.includes(r.status) && !r.unhappy && (client || csm);
    case 'clearflag': return lead && r.unhappy;
    case 'internal': return staff;
    case 'logtime': return staff && r.status !== 'cancelled';
    case 'comment': return r.status !== 'cancelled' && (staff || client);
  }
}

function must(ok: boolean, msg = 'You do not have access to do that.'): void {
  if (!ok) throw new UserError(msg);
}

/* ---------------- reads used by writes ---------------- */

export async function getSettings(db: DB): Promise<Settings> {
  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  return s ?? { id: 1, slaMode: 'business', bizStart: 9, bizEnd: 18, autoReset: true, lastSweepAt: null };
}

/** Pod-scoped visibility for CSMs and implementers; leads and owners see everything; clients see their org. */
export async function canSeeRequest(db: DB, v: Viewer, r: Pick<Request, 'orgId' | 'assigneeId' | 'qaId'>): Promise<boolean> {
  if (!v.active) return false;
  if (v.role === 'client') return v.orgId === r.orgId;
  if (isLeadRole(v.role)) return true;
  if (r.assigneeId === v.id || r.qaId === v.id) return true;
  const [o] = await db.select({ podId: orgs.podId }).from(orgs).where(eq(orgs.id, r.orgId));
  return !!o && !!v.podId && o.podId === v.podId;
}

async function loadRequest(db: DB, v: Viewer, id: string): Promise<Request> {
  const [r] = await db.select().from(requests).where(eq(requests.id, id));
  if (!r || !(await canSeeRequest(db, v, r))) throw new UserError('That request was not found.');
  return r;
}

async function activeStaff(db: DB): Promise<Profile[]> {
  return db.select().from(profiles).where(and(eq(profiles.active, true), sql`${profiles.role} <> 'client'`));
}

async function csmFor(db: DB, orgId: string): Promise<string | null> {
  const rows = await db.select({ csmId: pods.csmId }).from(orgs).leftJoin(pods, eq(pods.id, orgs.podId)).where(eq(orgs.id, orgId));
  return rows[0]?.csmId ?? null;
}
async function leadIds(db: DB): Promise<string[]> {
  const rows = await db.select({ id: profiles.id, role: profiles.role }).from(profiles)
    .where(and(eq(profiles.active, true), inArray(profiles.role, ['lead', 'owner'])));
  return [...rows.filter((r) => r.role === 'lead'), ...rows.filter((r) => r.role === 'owner')].map((r) => r.id);
}
async function ownerIds(db: DB): Promise<string[]> {
  const rows = await db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.active, true), eq(profiles.role, 'owner')));
  return rows.map((r) => r.id);
}
async function clientContacts(db: DB, orgId: string): Promise<Profile[]> {
  return db.select().from(profiles).where(and(eq(profiles.orgId, orgId), eq(profiles.role, 'client'), eq(profiles.active, true)));
}

/* ---------------- effects ---------------- */

const appUrl = (): string => (process.env.APP_URL ?? '').replace(/\/$/, '');
const ref = (r: Pick<Request, 'num' | 'title'>): string => `ML-${r.num} "${r.title}"`;

async function event(db: DB, v: Viewer | null, r: Pick<Request, 'id'>, type: string, text: string, from?: Status, to?: Status): Promise<void> {
  await db.insert(requestEvents).values({
    requestId: r.id, actorId: v?.id ?? null, actorName: v ? actorName(v) : 'Mainline', type, text, fromStatus: from ?? null, toStatus: to ?? null,
  });
}

export function actorName(v: Viewer): string {
  return v.name;
}

/** In-app notification plus an email to each staff recipient (never to the actor). */
async function notifyStaff(db: DB, out: Outbox, v: Viewer | null, to: (string | null | undefined)[], text: string, r: Pick<Request, 'id' | 'num' | 'title'>, kind: string, email = false): Promise<void> {
  const ids = [...new Set(to.filter((x): x is string => !!x))].filter((id) => id !== v?.id);
  if (!ids.length) return;
  const people = await db.select().from(profiles).where(and(inArray(profiles.id, ids), eq(profiles.active, true)));
  for (const p of people) {
    await db.insert(notifications).values({ toId: p.id, text, requestId: r.id, kind, byName: v ? actorName(v) : 'Mainline' });
    if (email) out.email.push({ to: p.email, subject: `Mainline: ${text}`.slice(0, 140), text: `${text}\n\nOpen it: ${appUrl()}/app/requests/${r.id}` });
  }
}

async function notifyClient(db: DB, out: Outbox, v: Viewer | null, orgId: string, subject: string, body: string, r: Pick<Request, 'id'>, includeActor = false): Promise<void> {
  const contacts = await clientContacts(db, orgId);
  for (const c of contacts) {
    if (c.id === v?.id && !includeActor) continue;
    await db.insert(notifications).values({ toId: c.id, text: subject, requestId: r.id, kind: 'client', byName: v ? actorName(v) : 'Mainline' });
    out.email.push({ to: c.email, subject, text: `${body}\n\nView the request: ${appUrl()}/portal/requests/${r.id}` });
  }
}

async function patch(db: DB, r: Request, values: Partial<Request>): Promise<void> {
  await db.update(requests).set({ ...values, updatedAt: new Date() }).where(eq(requests.id, r.id));
}

export type Result<T = void> = { value: T; out: Outbox };

async function tx<T>(db: DB, fn: (q: DB, out: Outbox) => Promise<T>): Promise<Result<T>> {
  const out = newOutbox();
  const value = await db.transaction(async (q) => fn(q as unknown as DB, out));
  return { value, out };
}

/* ---------------- request lifecycle ---------------- */

export type NewRequest = {
  orgId: string; skuId: string; title: string; description: string; priority: Priority;
  source?: string; contact?: string; triageNow?: boolean; ai?: AiTriage | null;
};

export async function createRequest(db: DB, v: Viewer, input: NewRequest): Promise<Result<string>> {
  const title = input.title.trim();
  if (!title) throw new UserError('Give the request a short title.');
  if (title.length > 160) throw new UserError('Keep the title under 160 characters.');
  if (input.description.length > 8000) throw new UserError('The description is too long. Keep it under 8,000 characters.');
  if (!PRI[input.priority]) throw new UserError('Pick a priority.');
  if (v.role === 'client') must(v.orgId === input.orgId);
  else must(isStaffRole(v.role) && v.active);
  return tx(db, async (q, out) => {
    const [org] = await q.select().from(orgs).where(eq(orgs.id, input.orgId));
    if (!org || !org.active) throw new UserError('That client account is not active.');
    const [sku] = await q.select().from(skus).where(eq(skus.id, input.skuId));
    if (!sku || !sku.active || sku.id === SUPPORT_SKU || (sku.platform !== 'Any' && sku.platform !== org.platform)) throw new UserError('Pick a service from the catalog.');
    const client = v.role === 'client';
    const triageNow = !client && !!input.triageNow && isCsmRole(v.role);
    const now = new Date();
    const [r] = await q.insert(requests).values({
      orgId: org.id, skuId: sku.id, title, description: input.description.trim(), priority: input.priority,
      status: triageNow ? 'triaged' : 'submitted', source: client ? 'Client portal' : input.source || 'Email',
      contact: client ? v.name : (input.contact ?? '').slice(0, 120), submittedBy: v.id, submittedByName: v.name,
      firstResponseAt: triageNow ? now : null, ai: input.ai ?? null,
    }).returning();
    await event(q, v, r, 'status', client ? 'Submitted from the client portal' : `Logged from ${r.source}${r.contact ? ` (${r.contact})` : ''}`, undefined, 'submitted');
    if (triageNow) await event(q, v, r, 'status', 'Triaged at entry', 'submitted', 'triaged');
    if (!triageNow) {
      const csm = await csmFor(q, org.id);
      await notifyStaff(q, out, v, [csm ?? (await leadIds(q))[0]], `New request from ${org.name}: ${ref(r)}`, r, 'new', true);
      out.slack.push(`New request from ${org.name}: ML-${r.num} ${r.title} (${PRI[r.priority].label})`);
    }
    if (client) {
      await notifyClient(q, out, v, org.id, `We received ML-${r.num}: ${r.title}`, `Thanks, ${org.name}. Your request "${r.title}" is in. Your team will confirm the scope shortly.`, r, true);
    }
    return r.id;
  });
}

export type NewTicket = { orgId: string; category: string; title: string; description: string; priority: Priority; contact?: string };

/**
 * Opens a support ticket. Tickets skip triage and scoping: no credits are charged, the resolution
 * clock starts right away, and routing assigns an implementer in the client's pod immediately.
 */
export async function createSupportTicket(db: DB, v: Viewer, input: NewTicket): Promise<Result<string>> {
  const title = input.title.trim();
  if (!title) throw new UserError('Give the issue a short summary.');
  if (title.length > 160) throw new UserError('Keep the summary under 160 characters.');
  if (!input.description.trim()) throw new UserError('Describe what is happening so the team can start right away.');
  if (input.description.length > 8000) throw new UserError('The description is too long. Keep it under 8,000 characters.');
  if (!PRI[input.priority]) throw new UserError('Pick how urgent this is.');
  if (!SUPPORT_CATEGORIES.some((c) => c.key === input.category)) throw new UserError('Pick what kind of help you need.');
  if (v.role === 'client') must(v.orgId === input.orgId);
  else must(isCsmRole(v.role) && v.active, 'Only a CSM, lead or the owner can log a ticket for a client.');
  const s = await getSettings(db);
  return tx(db, async (q, out) => {
    const [org] = await q.select().from(orgs).where(eq(orgs.id, input.orgId));
    if (!org || !org.active) throw new UserError('That client account is not active.');
    await q.insert(skus).values(SUPPORT_SKU_ROW).onConflictDoNothing();
    const client = v.role === 'client';
    const staff = await activeStaff(q);
    const recent = await q.select({ a: requests.assigneeId }).from(requests)
      .where(and(eq(requests.orgId, org.id), inArray(requests.status, ['delivered', 'closed']))).orderBy(desc(requests.deliveredAt)).limit(10);
    const routing = { orgId: org.id, podId: org.podId, staff, openHours: await openHoursByStaff(q), recentAssignees: recent.map((x) => x.a).filter((x): x is string => !!x) };
    // Prefer someone who knows the client's platform; fall back to anyone with capacity.
    let rt = route({ ...routing, sku: { platform: org.platform } });
    if (!rt.assigneeId) rt = route({ ...routing, sku: { platform: 'Any' } });
    const now = new Date();
    const hours = SUPPORT_SLA[input.priority];
    const [r] = await q.insert(requests).values({
      orgId: org.id, skuId: SUPPORT_SKU, category: input.category, title, description: input.description.trim(), priority: input.priority,
      status: rt.assigneeId ? 'assigned' : 'scoped', source: client ? 'Client portal' : 'Logged by team',
      contact: client ? v.name : (input.contact ?? '').slice(0, 120), submittedBy: v.id, submittedByName: v.name,
      credits: 0, slaHours: hours, estHours: 1, scopedAt: now, firstResponseAt: now,
      assigneeId: rt.assigneeId, qaId: null, needsLead: !rt.assigneeId,
    }).returning();
    const cat = supportCategoryLabel(input.category);
    const assignee = staff.find((p) => p.id === rt.assigneeId);
    await event(q, v, r, 'status', `${client ? 'Support ticket opened from the portal' : 'Support ticket logged by the team'}: ${cat}, ${PRI[r.priority].label} priority`, undefined, 'submitted');
    const csm = await csmFor(q, org.id);
    if (assignee) {
      await event(q, null, r, 'status', `Routed to ${assignee.name}. Resolve within ${hours} ${clockWord(s)}. ${rt.reason}`.trim(), 'submitted', 'assigned');
      await notifyStaff(q, out, v, [assignee.id], `Support ticket for you: ${ref(r)} from ${org.name} (${PRI[r.priority].label})`, r, 'assigned', true);
      await notifyStaff(q, out, v, [csm], `New support ticket from ${org.name}: ${ref(r)}, routed to ${assignee.name}`, r, 'new');
    } else {
      await event(q, null, r, 'status', `No implementer with capacity. Waiting for a lead to assign. ${rt.reason}`.trim(), 'submitted', 'scoped');
      await notifyStaff(q, out, v, [csm, ...(await leadIds(q))], `Support ticket needs an owner: ${ref(r)} from ${org.name}`, r, 'needs-lead', true);
    }
    if (r.priority === 'urgent' || r.priority === 'high' || !assignee) {
      out.slack.push(`${PRI[r.priority].label} support ticket from ${org.name}: ML-${r.num} ${r.title} (${cat})${assignee ? `, assigned to ${assignee.name}` : ', needs an owner'}`);
    }
    if (client) {
      await notifyClient(q, out, v, org.id, `We received your support ticket ML-${r.num}`,
        `Thanks, ${org.name}. Your support ticket "${r.title}" is in${assignee ? ` and ${assignee.name.split(' ')[0]} is on it` : ''}. Our target is to resolve it within ${hours} ${clockWord(s)}. Support tickets never use credits.`, r, true);
    }
    return r.id;
  });
}

/** The implementer marks a ticket resolved with a note for the client, who confirms or reopens it. */
export async function resolveTicket(db: DB, v: Viewer, id: string, note: string): Promise<Result> {
  const body = note.trim();
  if (!body) throw new UserError('Tell the client what you fixed or answered.');
  if (body.length > 8000) throw new UserError('That note is too long.');
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('resolve', r, v));
    const now = new Date();
    await q.insert(comments).values({ requestId: r.id, authorId: v.id, authorName: v.name, body, internal: false });
    await patch(q, r, { status: 'delivered', deliveredAt: now, autoAcceptAt: new Date(now.getTime() + 5 * DAY) });
    await event(q, v, r, 'status', 'Resolved. Waiting for the client to confirm.', 'in_progress', 'delivered');
    await notifyStaff(q, out, v, [await csmFor(q, r.orgId)], `Resolved: ${ref(r)}`, r, 'delivered');
    await notifyClient(q, out, v, r.orgId, `ML-${r.num} is resolved`,
      `${v.name} resolved your support ticket "${r.title}":\n\n${body}\n\nIf it is fixed, confirm in the portal. If not, tell us and we will pick it right back up. It closes automatically in 5 days.`, r);
  });
}

export async function triage(db: DB, v: Viewer, id: string, skuId: string, priority: Priority): Promise<Result> {
  return tx(db, async (q) => {
    const r = await loadRequest(q, v, id);
    must(allowed('triage', r, v));
    const [sku] = await q.select().from(skus).where(eq(skus.id, skuId));
    if (!sku) throw new UserError('Pick a service.');
    await patch(q, r, { status: 'triaged', skuId, priority, firstResponseAt: new Date() });
    await event(q, v, r, 'status', `Confirmed ${sku.name}, ${PRI[priority].label} priority`, 'submitted', 'triaged');
  });
}

export async function openHoursByStaff(db: DB): Promise<Record<string, number>> {
  const rows = await db.execute(sql`
    select r.assignee_id as id,
      sum(greatest(0, coalesce(r.est_hours, s.est_hours, 0) - coalesce((select sum(t.hours) from timelogs t where t.request_id = r.id), 0))) as open
    from requests r left join skus s on s.id = r.sku_id
    where r.assignee_id is not null and r.status in ('assigned','in_progress','waiting','qa')
    group by r.assignee_id`);
  const out: Record<string, number> = {};
  for (const row of rowsOf<{ id: string; open: string | number }>(rows)) out[row.id] = Number(row.open) || 0;
  return out;
}

/** Normalizes raw query results across drivers (postgres-js returns an array, PGlite returns {rows}). */
export function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const r = res as { rows?: T[] };
  return r.rows ?? [];
}

export async function routeFor(db: DB, r: Request): Promise<ReturnType<typeof route>> {
  const [sku] = await db.select().from(skus).where(eq(skus.id, r.skuId));
  const [org] = await db.select().from(orgs).where(eq(orgs.id, r.orgId));
  const staff = await activeStaff(db);
  const recent = await db.select({ a: requests.assigneeId }).from(requests)
    .where(and(eq(requests.orgId, r.orgId), inArray(requests.status, ['delivered', 'closed'])))
    .orderBy(desc(requests.deliveredAt)).limit(10);
  return route({
    sku: sku ?? { platform: 'Any' }, orgId: r.orgId, podId: org?.podId ?? null, staff,
    openHours: await openHoursByStaff(db), recentAssignees: recent.map((x) => x.a).filter((x): x is string => !!x),
  });
}

export async function scope(db: DB, v: Viewer, id: string, input: { credits: number; slaHours: number; estHours: number }): Promise<Result> {
  const s = await getSettings(db);
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('scope', r, v));
    const [account] = await q.select().from(orgs).where(eq(orgs.id, r.orgId));
    const credits = account?.billingModel === 'project' ? 0 : Math.max(0, Math.round(input.credits)), hours = Math.max(1, Math.round(input.slaHours)), est = Math.max(0, input.estHours);
    const debited = await q.update(orgs).set({ credits: sql`${orgs.credits} - ${credits}` })
      .where(and(eq(orgs.id, r.orgId), sql`${orgs.credits} >= ${credits}`)).returning({ credits: orgs.credits });
    if (!debited.length) {
      const [o] = await q.select().from(orgs).where(eq(orgs.id, r.orgId));
      throw new UserError(`Not enough credits: ${credits} needed, ${o?.credits ?? 0} left. Top up in Setup first.`);
    }
    const now = new Date();
    const rt = await routeFor(q, r);
    const allocation = account?.billingModel === 'project' ? 'project hours (no monthly credits)' : `${credits} credits`;
    const base: Partial<Request> = { credits, slaHours: hours, estHours: est, scopedAt: now, pausedBizMs: 0 };
    const [org] = await q.select().from(orgs).where(eq(orgs.id, r.orgId));
    if (rt.assigneeId) {
      await patch(q, r, { ...base, status: 'assigned', assigneeId: rt.assigneeId, qaId: rt.qaId, needsLead: false });
      const names = await q.select({ id: profiles.id, name: profiles.name }).from(profiles).where(inArray(profiles.id, [rt.assigneeId, rt.qaId ?? rt.assigneeId]));
      const nm = (x: string | null): string => names.find((n) => n.id === x)?.name ?? 'Unassigned';
      await event(q, v, r, 'status', `Scoped against ${allocation}, ${hours} ${clockWord(s)} SLA. Routed to ${nm(rt.assigneeId)}, QA by ${nm(rt.qaId)}. ${rt.reason}`.trim(), 'triaged', 'assigned');
      await notifyStaff(q, out, v, [rt.assigneeId], `Assigned to you: ${ref(r)} for ${org?.name ?? 'a client'}, due in ${hours} ${clockWord(s)}`, r, 'assigned', true);
      await notifyStaff(q, out, v, [rt.qaId], `You are QA reviewer on ${ref(r)}`, r, 'qa-assigned');
    } else {
      await patch(q, r, { ...base, status: 'scoped', needsLead: true });
      await event(q, v, r, 'status', `Scoped against ${allocation}. Routing found no one: ${rt.reason}`, 'triaged', 'scoped');
      await notifyStaff(q, out, v, await leadIds(q), `Needs assignment: no one with capacity for ${ref(r)}`, r, 'needs-lead', true);
    }
    await notifyClient(q, out, v, r.orgId, `ML-${r.num} is scheduled`, `"${r.title}" is scoped against ${allocation} and scheduled with your team. Target turnaround: ${hours} ${clockWord(s)}.`, r);
  });
}

export async function assign(db: DB, v: Viewer, id: string, assigneeId: string, qaId: string | null): Promise<Result> {
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('assign', r, v) || allowed('reassign', r, v));
    const staff = await activeStaff(q);
    const a = staff.find((s) => s.id === assigneeId && (s.role === 'implementer' || isLeadRole(s.role)));
    if (!a) throw new UserError('Pick an implementer.');
    const qa = qaId && qaId !== assigneeId ? staff.find((s) => s.id === qaId) : null;
    const newQa = qa?.id ?? (r.qaId !== assigneeId ? r.qaId : null);
    await patch(q, r, { assigneeId, qaId: newQa, status: r.status === 'scoped' ? 'assigned' : r.status, needsLead: false });
    await event(q, v, r, 'assign', `Assigned to ${a.name}${qa ? `, QA by ${qa.name}` : ''}`);
    if (assigneeId !== r.assigneeId) await notifyStaff(q, out, v, [assigneeId], `Assigned to you: ${ref(r)}`, r, 'assigned', true);
    if (newQa && newQa !== r.qaId) await notifyStaff(q, out, v, [newQa], `You are QA reviewer on ${ref(r)}`, r, 'qa-assigned');
  });
}

export async function autoAssign(db: DB, v: Viewer, id: string): Promise<Result> {
  const r = await loadRequest(db, v, id);
  must(allowed('assign', r, v));
  const rt = await routeFor(db, r);
  if (!rt.assigneeId) throw new UserError(`${rt.reason} Assign someone manually.`);
  return assign(db, v, id, rt.assigneeId, rt.qaId);
}

export async function start(db: DB, v: Viewer, id: string): Promise<Result> {
  return tx(db, async (q) => {
    const r = await loadRequest(q, v, id);
    must(allowed('start', r, v));
    await patch(q, r, { status: 'in_progress', startedAt: r.startedAt ?? new Date() });
    await event(q, v, r, 'status', 'Started work', 'assigned', 'in_progress');
  });
}

export async function askClient(db: DB, v: Viewer, id: string, question: string): Promise<Result> {
  const body = question.trim();
  if (!body) throw new UserError('Write the question for the client first.');
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('ask', r, v));
    await q.insert(comments).values({ requestId: r.id, authorId: v.id, authorName: v.name, body, internal: false });
    await patch(q, r, { status: 'waiting', pausedAt: new Date() });
    await event(q, v, r, 'status', 'Asked the client a question. SLA paused.', 'in_progress', 'waiting');
    await notifyStaff(q, out, v, [await csmFor(q, r.orgId)], `Waiting on a client answer: ${ref(r)}`, r, 'ask');
    await notifyClient(q, out, v, r.orgId, `Your team has a question about ML-${r.num}`, `${v.name} asked:\n\n${body}\n\nReply in the portal and work continues right away.`, r);
  });
}

async function resumeFromWait(q: DB, r: Request, s: Settings): Promise<Partial<Request>> {
  const now = Date.now(), from = r.pausedAt ? new Date(r.pausedAt).getTime() : now;
  return { status: 'in_progress', pausedBizMs: (r.pausedBizMs || 0) + bizMs(from, now, s), pausedAt: null };
}

export async function resume(db: DB, v: Viewer, id: string): Promise<Result> {
  const s = await getSettings(db);
  return tx(db, async (q) => {
    const r = await loadRequest(q, v, id);
    must(allowed('resume', r, v));
    await patch(q, r, await resumeFromWait(q, r, s));
    await event(q, v, r, 'status', 'Resumed work. SLA running.', 'waiting', 'in_progress');
  });
}

/** Posts a comment. A client reply to a waiting request resumes work; a CSM can log a client's emailed answer. */
export async function comment(db: DB, v: Viewer, id: string, bodyIn: string, opts: { internal?: boolean; asClientAnswer?: boolean } = {}): Promise<Result> {
  const body = bodyIn.trim();
  if (!body) throw new UserError('Write a message first.');
  if (body.length > 8000) throw new UserError('That message is too long.');
  const s = await getSettings(db);
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('comment', r, v));
    const client = v.role === 'client';
    const internal = !client && !!opts.internal;
    const logged = !client && !!opts.asClientAnswer;
    if (logged) must(allowed('clientReply', r, v));
    const [org] = await q.select().from(orgs).where(eq(orgs.id, r.orgId));
    await q.insert(comments).values({
      requestId: r.id, authorId: v.id, authorName: logged ? `${org?.name ?? 'Client'} (logged by ${v.name})` : v.name,
      body, internal, fromClient: client || logged,
    });
    if ((client || logged) && r.status === 'waiting') {
      await patch(q, r, await resumeFromWait(q, r, s));
      await event(q, v, r, 'status', 'Client answered. SLA running.', 'waiting', 'in_progress');
      await notifyStaff(q, out, v, [r.assigneeId], `Client answered on ${ref(r)}`, r, 'reply', true);
      return;
    }
    await event(q, v, r, 'comment', internal ? 'Added an internal note' : 'Commented');
    if (client) {
      await notifyStaff(q, out, v, [r.assigneeId, await csmFor(q, r.orgId)], `${org?.name ?? 'Client'} commented on ${ref(r)}: ${body.slice(0, 120)}`, r, 'comment', true);
    } else {
      await notifyStaff(q, out, v, [r.assigneeId, r.qaId, await csmFor(q, r.orgId)], `${v.name} commented on ${ref(r)}: ${body.slice(0, 120)}`, r, 'comment');
      if (!internal) await notifyClient(q, out, v, r.orgId, `New message on ML-${r.num}`, `${v.name} wrote:\n\n${body}`, r);
    }
  });
}

export async function submitQa(db: DB, v: Viewer, id: string): Promise<Result> {
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('submitqa', r, v));
    await patch(q, r, { status: 'qa' });
    await event(q, v, r, 'status', 'Submitted for QA review', 'in_progress', 'qa');
    await notifyStaff(q, out, v, [r.qaId ?? (await leadIds(q))[0]], `Ready for QA: ${ref(r)}`, r, 'qa', true);
  });
}

export async function passQa(db: DB, v: Viewer, id: string, checkedCount: number, note: string): Promise<Result> {
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('qa', r, v));
    const [sku] = await q.select().from(skus).where(eq(skus.id, r.skuId));
    if (checkedCount < (sku?.qa.length ?? 0)) throw new UserError('Check every QA item before passing.');
    const now = new Date();
    if (note.trim()) await q.insert(comments).values({ requestId: r.id, authorId: v.id, authorName: v.name, body: note.trim(), internal: false });
    await patch(q, r, { status: 'delivered', deliveredAt: now, autoAcceptAt: new Date(now.getTime() + 5 * DAY) });
    await event(q, v, r, 'status', 'Passed QA. Delivered to the client.', 'qa', 'delivered');
    await notifyStaff(q, out, v, [await csmFor(q, r.orgId), r.assigneeId], `Delivered: ${ref(r)} passed QA`, r, 'delivered');
    await notifyClient(q, out, v, r.orgId, `ML-${r.num} is ready for your review`,
      `"${r.title}" is done and passed our quality check.${note.trim() ? `\n\n${note.trim()}` : ''}\n\nPlease accept it or request a change within 5 days. After that it closes automatically.`, r);
  });
}

export async function failQa(db: DB, v: Viewer, id: string, note: string): Promise<Result> {
  if (!note.trim()) throw new UserError('Say what needs fixing, then return it.');
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('qa', r, v));
    await q.insert(comments).values({ requestId: r.id, authorId: v.id, authorName: v.name, body: note.trim(), internal: true });
    await patch(q, r, { status: 'in_progress', qaFails: r.qaFails + 1 });
    await event(q, v, r, 'status', 'Returned from QA with notes', 'qa', 'in_progress');
    await notifyStaff(q, out, v, [r.assigneeId], `QA returned ${ref(r)}: ${note.trim().slice(0, 120)}`, r, 'qa-fail', true);
  });
}

export async function accept(db: DB, v: Viewer, id: string): Promise<Result> {
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('accept', r, v));
    await patch(q, r, { status: 'closed', closedAt: new Date() });
    await event(q, v, r, 'status', v.role === 'client' ? 'Client accepted the work' : `Client sign-off recorded by ${v.name}`, 'delivered', 'closed');
    if (v.role === 'client') await notifyStaff(q, out, v, [r.assigneeId, await csmFor(q, r.orgId)], `Accepted by the client: ${ref(r)}`, r, 'accepted');
  });
}

export async function revise(db: DB, v: Viewer, id: string, note: string): Promise<Result> {
  if (!note.trim()) throw new UserError('Describe what should change.');
  const s = await getSettings(db);
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('revise', r, v));
    const [org] = await q.select().from(orgs).where(eq(orgs.id, r.orgId));
    const client = v.role === 'client';
    await q.insert(comments).values({
      requestId: r.id, authorId: v.id, authorName: client ? v.name : `${org?.name ?? 'Client'} (logged by ${v.name})`, body: note.trim(), fromClient: true,
    });
    const now = Date.now(), from = r.deliveredAt ? new Date(r.deliveredAt).getTime() : now;
    await patch(q, r, { status: 'in_progress', revisions: r.revisions + 1, pausedBizMs: r.pausedBizMs + bizMs(from, now, s), deliveredAt: null, autoAcceptAt: null });
    await event(q, v, r, 'status', 'Client requested a revision', 'delivered', 'in_progress');
    await notifyStaff(q, out, v, [r.assigneeId, await csmFor(q, r.orgId)], `Revision requested on ${ref(r)}: ${note.trim().slice(0, 120)}`, r, 'revision', true);
  });
}

export async function autoClose(db: DB, v: Viewer | null, id: string): Promise<Result> {
  return tx(db, async (q) => {
    const [r] = await q.select().from(requests).where(eq(requests.id, id));
    if (!r) throw new UserError('That request was not found.');
    if (v) must(allowed('autoclose', r, v));
    else if (r.status !== 'delivered' || !r.autoAcceptAt || new Date(r.autoAcceptAt).getTime() > Date.now()) return;
    await patch(q, r, { status: 'closed', closedAt: new Date() });
    await event(q, v, r, 'status', 'Closed after 5 days with no client response', 'delivered', 'closed');
  });
}

export async function cancel(db: DB, v: Viewer, id: string): Promise<Result> {
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('cancel', r, v));
    if (r.credits) await q.update(orgs).set({ credits: sql`${orgs.credits} + ${r.credits}` }).where(eq(orgs.id, r.orgId));
    await patch(q, r, { status: 'cancelled', cancelledAt: new Date(), credits: 0 });
    await event(q, v, r, 'status', `Cancelled${r.credits ? `, refunded ${r.credits} credits` : ''}`, r.status, 'cancelled');
    await notifyStaff(q, out, v, [r.assigneeId, await csmFor(q, r.orgId)], `Cancelled: ${ref(r)}`, r, 'cancel');
  });
}

export async function flag(db: DB, v: Viewer, id: string, note: string): Promise<Result> {
  if (!note.trim()) throw new UserError('Describe the concern first.');
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('flag', r, v));
    await q.insert(comments).values({ requestId: r.id, authorId: v.id, authorName: v.name, body: note.trim(), internal: v.role !== 'client', fromClient: v.role === 'client' });
    await patch(q, r, { unhappy: true });
    await event(q, v, r, 'escalation', 'Concern flagged. Escalated to leadership.');
    await notifyStaff(q, out, v, [...(await ownerIds(q)), ...(await leadIds(q))], `Client concern on ${ref(r)}: ${note.trim().slice(0, 120)}`, r, 'concern', true);
    out.slack.push(`Level 3: client concern on ML-${r.num} ${r.title}`);
  });
}

export async function clearFlag(db: DB, v: Viewer, id: string): Promise<Result> {
  return tx(db, async (q) => {
    const r = await loadRequest(q, v, id);
    must(allowed('clearflag', r, v));
    await patch(q, r, { unhappy: false });
    await event(q, v, r, 'escalation', 'Concern resolved');
  });
}

/* ---------------- time ---------------- */

/* ---------------- attachments ---------------- */

export type UploadTarget = { requestId: string } | { draft: true };
export type FileRef = { path: string; name: string };

/** Checks the file and returns a one-time upload token. The browser then uploads straight to storage. */
export async function prepareUpload(db: DB, v: Viewer, target: UploadTarget, file: { name: string; size: number; type: string }): Promise<{ path: string; token: string }> {
  must(v.active);
  if (!allowedType(file.type)) throw new UserError('That file type is not supported. Use a screenshot (PNG or JPG), a video (MP4, MOV or WebM), a PDF, or an Office file.');
  if (!(file.size > 0)) throw new UserError('That file is empty.');
  if (file.size > MAX_UPLOAD_BYTES) throw new UserError(`That file is over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. For longer videos, record a Loom and paste the link instead.`);
  let prefix: string;
  if ('requestId' in target) {
    const r = await loadRequest(db, v, target.requestId);
    must(allowed('comment', r, v), 'Attachments are closed on this request.');
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(attachments).where(eq(attachments.requestId, r.id));
    if (Number(n) >= MAX_ATTACHMENTS_PER_REQUEST) throw new UserError('This request has reached its attachment limit. Link a shared folder instead.');
    prefix = `req/${r.id}`;
  } else {
    prefix = `draft/${v.id}`;
  }
  const path = `${prefix}/${crypto.randomUUID()}-${safeName(file.name)}`;
  await store().ensureBucket();
  const { token } = await store().signUpload(path);
  return { path, token };
}

/** Verifies an uploaded file really exists in storage under a path this person may use, and reads its true size and type. */
async function verifyFile(v: Viewer, requestId: string, f: FileRef): Promise<{ path: string; name: string; size: number; mime: string }> {
  const okPrefix = f.path.startsWith(`req/${requestId}/`) || f.path.startsWith(`draft/${v.id}/`);
  if (!okPrefix || f.path.includes('..')) throw new UserError('That upload does not belong to this request.');
  const info = await store().info(f.path);
  if (!info) throw new UserError('The upload did not finish. Try attaching the file again.');
  const mime = info.mime ?? '';
  if (!allowedType(mime)) { await store().remove([f.path]); throw new UserError('That file type is not supported.'); }
  if (info.size > MAX_UPLOAD_BYTES) { await store().remove([f.path]); throw new UserError('That file is too large.'); }
  return { path: f.path, name: (f.name || f.path.split('/').pop() || 'file').slice(0, 160), size: info.size, mime };
}

type NewAttachment = { kind: 'file' | 'link'; name: string; mime?: string | null; size?: number | null; path?: string | null; url?: string | null };

async function insertAttachments(q: DB, out: Outbox, v: Viewer, r: Request, items: NewAttachment[], internalIn: boolean, notify: boolean): Promise<number> {
  if (!items.length) return 0;
  const client = v.role === 'client';
  const internal = !client && internalIn;
  const [{ n }] = await q.select({ n: sql<number>`count(*)::int` }).from(attachments).where(eq(attachments.requestId, r.id));
  if (Number(n) + items.length > MAX_ATTACHMENTS_PER_REQUEST) throw new UserError('This request has reached its attachment limit. Link a shared folder instead.');
  await q.insert(attachments).values(items.map((it) => ({
    requestId: r.id, kind: it.kind, name: it.name, mime: it.mime ?? null, size: it.size ?? null, path: it.path ?? null, url: it.url ?? null,
    internal, fromClient: client, uploadedBy: v.id, uploadedByName: v.name,
  })));
  const files = items.filter((i) => i.kind === 'file').length, links = items.length - files;
  const what = [files ? `${files} file${files > 1 ? 's' : ''}` : '', links ? `${links} video link${links > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ');
  await event(q, v, r, 'attachment', `Attached ${what}${internal ? ' (internal)' : ''}: ${items.map((i) => i.name).join(', ').slice(0, 300)}`);
  if (notify) {
    const [org] = await q.select().from(orgs).where(eq(orgs.id, r.orgId));
    if (client) {
      await notifyStaff(q, out, v, [r.assigneeId, await csmFor(q, r.orgId)], `${org?.name ?? 'Client'} attached ${what} to ${ref(r)}`, r, 'attachment', true);
    } else {
      await notifyStaff(q, out, v, [r.assigneeId, r.qaId, await csmFor(q, r.orgId)], `${v.name} attached ${what} to ${ref(r)}`, r, 'attachment');
      if (!internal) await notifyClient(q, out, v, r.orgId, `New ${files ? 'files' : 'video'} on ML-${r.num}`, `${v.name} attached ${what} to "${r.title}".`, r);
    }
  }
  return items.length;
}

/** Records uploaded files on a request after checking each one in storage. */
export async function addFiles(db: DB, v: Viewer, id: string, files: FileRef[], internal = false): Promise<Result<number>> {
  if (!files.length) throw new UserError('Choose a file first.');
  if (files.length > 20) throw new UserError('Attach up to 20 files at a time.');
  const r0 = await loadRequest(db, v, id);
  must(allowed('comment', r0, v), 'Attachments are closed on this request.');
  const checked: Awaited<ReturnType<typeof verifyFile>>[] = [];
  for (const f of files) checked.push(await verifyFile(v, r0.id, f));
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    return insertAttachments(q, out, v, r, checked.map((c) => ({ kind: 'file' as const, name: c.name, mime: c.mime, size: c.size, path: c.path })), internal, true);
  });
}

/** Adds a Loom, YouTube, Vimeo or other link to a request. */
export async function addLink(db: DB, v: Viewer, id: string, raw: string, internal = false): Promise<Result<number>> {
  const link = checkLink(raw);
  if (!link) throw new UserError('Paste a full link that starts with https://, for example a Loom share link.');
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('comment', r, v), 'Attachments are closed on this request.');
    return insertAttachments(q, out, v, r, [{ kind: 'link', name: link.name, url: link.url }], internal, true);
  });
}

/** Attaches files and links chosen on a new-request or new-ticket form. Creation already notified the team, so this stays quiet. */
export async function attachToNew(db: DB, v: Viewer, id: string, files: FileRef[], rawLinks: string[]): Promise<Result<number>> {
  const links = rawLinks.map((l) => l.trim()).filter(Boolean);
  if (!files.length && !links.length) return { value: 0, out: newOutbox() };
  if (files.length > 20) throw new UserError('Attach up to 20 files at a time.');
  const checkedLinks = links.map((l) => { const c = checkLink(l); if (!c) throw new UserError('One of the video links is not a full https:// link.'); return c; });
  const checked: Awaited<ReturnType<typeof verifyFile>>[] = [];
  for (const f of files) checked.push(await verifyFile(v, id, f));
  return tx(db, async (q, out) => {
    const r = await loadRequest(q, v, id);
    must(allowed('comment', r, v));
    return insertAttachments(q, out, v, r, [
      ...checked.map((c) => ({ kind: 'file' as const, name: c.name, mime: c.mime, size: c.size, path: c.path })),
      ...checkedLinks.map((c) => ({ kind: 'link' as const, name: c.name, url: c.url })),
    ], false, false);
  });
}

/** Removes an attachment. The person who added it, or a lead, can remove it. Returns the storage path to delete. */
export async function removeAttachment(db: DB, v: Viewer, attachmentId: string): Promise<Result<string | null>> {
  return tx(db, async (q) => {
    const [a] = await q.select().from(attachments).where(eq(attachments.id, attachmentId));
    if (!a) throw new UserError('That attachment was already removed.');
    const r = await loadRequest(q, v, a.requestId);
    if (v.role === 'client' && a.internal) throw new UserError('That attachment was not found.');
    must(a.uploadedBy === v.id || isLeadRole(v.role), 'Only the person who added it, or a lead, can remove it.');
    await q.delete(attachments).where(eq(attachments.id, a.id));
    await event(q, v, r, 'attachment', `Removed ${a.kind === 'file' ? typeLabel(a.mime).toLowerCase() : 'link'} "${a.name}"`);
    return a.path;
  });
}

export async function logTime(db: DB, v: Viewer, id: string, input: { hours: number; note: string; workDate: string; staffId?: string }): Promise<Result> {
  if (!(input.hours > 0) || input.hours > 24) throw new UserError('Enter hours between 0.25 and 24.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) throw new UserError('Pick a date.');
  return tx(db, async (q) => {
    const r = await loadRequest(q, v, id);
    must(allowed('logtime', r, v));
    const staffId = isLeadRole(v.role) && input.staffId ? input.staffId : v.id;
    await q.insert(timelogs).values({
      requestId: r.id, orgId: r.orgId, skuId: r.skuId, staffId, hours: Math.round(input.hours * 100) / 100,
      note: input.note.slice(0, 300), workDate: input.workDate, createdBy: v.id,
    });
  });
}

export async function deleteTime(db: DB, v: Viewer, timelogId: string): Promise<Result> {
  return tx(db, async (q) => {
    const [t] = await q.select().from(timelogs).where(eq(timelogs.id, timelogId));
    if (!t) return;
    must(isStaffRole(v.role) && (t.staffId === v.id || isLeadRole(v.role)));
    await q.delete(timelogs).where(eq(timelogs.id, timelogId));
  });
}

/* ---------------- setup (leads and owner) ---------------- */

function mustLead(v: Viewer): void { must(isLeadRole(v.role) && v.active, 'Only the owner or a Solutions Lead can change setup.'); }
function mustOwner(v: Viewer): void { must(v.role === 'owner' && v.active, 'Only the owner can see or change financial data.'); }

export async function saveOrg(db: DB, v: Viewer, input: { id?: string; name: string; platform: string; podId: string | null; plan: string; monthlyCredits: number; credits?: number; active?: boolean; billingModel?: string; contractedHours?: number; projectRate?: number }): Promise<Result<string>> {
  mustLead(v);
  if (!input.name.trim()) throw new UserError('Enter the client name.');
  return tx(db, async (q) => {
    const [existing] = input.id ? await q.select().from(orgs).where(eq(orgs.id, input.id)) : [];
    if (input.id && !existing) throw new UserError('Client not found.');
    const model = input.billingModel ?? existing?.billingModel ?? 'retainer';
    const budget = input.contractedHours ?? existing?.contractedHours ?? 0;
    if (!['retainer', 'project'].includes(model)) throw new UserError('Choose retainer or project billing.');
    if (!Number.isFinite(budget) || budget < 0 || budget > 1000000 || (model === 'project' && budget <= 0)) throw new UserError('Enter a positive project allocation up to 1,000,000 hours.');
    if (model !== (existing?.billingModel ?? 'retainer') || budget !== (existing?.contractedHours ?? 0) || input.projectRate !== undefined) mustOwner(v);
    if (existing && model !== existing.billingModel) {
      const [history] = await q.select({ id: requests.id }).from(requests).where(eq(requests.orgId, existing.id)).limit(1);
      if (history) throw new UserError('Create a separate client account for a new billing model when request history exists.');
    }
    if (input.projectRate !== undefined && (!Number.isFinite(input.projectRate) || input.projectRate < 0 || input.projectRate > 1000000)) throw new UserError('Enter a valid hourly rate up to $1,000,000.');
    const values = { name: input.name.trim(), platform: input.platform, podId: input.podId || null, plan: input.plan || 'Growth', billingModel: model, contractedHours: budget, monthlyCredits: model === 'project' ? 0 : Math.max(0, Math.round(input.monthlyCredits)) };
    const saveRate = async (id: string): Promise<void> => {
      if (model === 'project' && input.projectRate !== undefined) await q.insert(projectPrices).values({ orgId: id, hourlyRate: Math.round(input.projectRate * 100) / 100 }).onConflictDoUpdate({ target: projectPrices.orgId, set: { hourlyRate: Math.round(input.projectRate * 100) / 100 } });
    };
    if (input.id) {
      await q.update(orgs).set({ ...values, credits: model === 'project' ? 0 : Math.max(0, Math.round(input.credits ?? 0)), active: input.active ?? true }).where(eq(orgs.id, input.id));
      await saveRate(input.id);
      return input.id;
    }
    const [o] = await q.insert(orgs).values({ ...values, credits: values.monthlyCredits, creditsPeriod: monthKey() }).returning();
    await saveRate(o.id);
    return o.id;
  });
}

export async function resetCredits(db: DB, v: Viewer, orgId: string): Promise<Result> {
  mustLead(v);
  return tx(db, async (q) => {
    const [o] = await q.select().from(orgs).where(eq(orgs.id, orgId));
    if (!o || o.billingModel === 'project') throw new UserError('Monthly credit resets do not apply to project accounts.');
    await q.update(orgs).set({ credits: sql`${orgs.monthlyCredits}`, creditsPeriod: monthKey() }).where(eq(orgs.id, orgId));
  });
}

export async function savePod(db: DB, v: Viewer, input: { id?: string; name: string; csmId: string | null }): Promise<Result> {
  mustLead(v);
  if (!input.name.trim()) throw new UserError('Name the pod.');
  return tx(db, async (q) => {
    if (input.id) await q.update(pods).set({ name: input.name.trim(), csmId: input.csmId || null }).where(eq(pods.id, input.id));
    else await q.insert(pods).values({ name: input.name.trim(), csmId: input.csmId || null });
  });
}

export async function saveSku(db: DB, v: Viewer, input: { id?: string; name: string; platform: string; category: string; credits: number; estHours: number; slaHours: number; description: string; qa: string[]; active?: boolean }): Promise<Result> {
  mustLead(v);
  if (!input.name.trim()) throw new UserError('Name the service.');
  const values = {
    name: input.name.trim(), platform: input.platform, category: input.category.trim() || 'General', credits: Math.max(0, Math.round(input.credits)),
    estHours: Math.max(0, input.estHours), slaHours: Math.max(1, Math.round(input.slaHours)), description: input.description.trim(),
    qa: input.qa.map((x) => x.trim()).filter(Boolean), active: input.active ?? true,
  };
  return tx(db, async (q) => {
    if (input.id) await q.update(skus).set(values).where(eq(skus.id, input.id));
    else {
      const slug = values.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'service';
      await q.insert(skus).values({ ...values, id: `${slug}-${Math.random().toString(36).slice(2, 6)}` });
    }
  });
}

/** Creates or updates a person. Auth accounts are created by the caller (lib/people.ts) because they need Supabase admin access. */
export async function saveProfile(db: DB, v: Viewer, input: { id: string; email: string; name: string; role: Role; orgId: string | null; podId: string | null; platforms: string[]; capacity: number; active: boolean }, isNew: boolean): Promise<Result> {
  mustLead(v);
  if (input.role === 'owner' && v.role !== 'owner') throw new UserError('Only the owner can add another owner.');
  if (input.role === 'client' && !input.orgId) throw new UserError('Pick the client account this contact belongs to.');
  return tx(db, async (q) => {
    const [existing] = await q.select().from(profiles).where(eq(profiles.id, input.id));
    if (existing?.role === 'owner' && v.role !== 'owner') throw new UserError('Only the owner can change an owner.');
    const values = {
      email: input.email.toLowerCase(), name: input.name.trim(), role: input.role, orgId: input.role === 'client' ? input.orgId : null,
      podId: input.role === 'client' ? null : input.podId || null, platforms: input.role === 'client' ? [] : input.platforms,
      capacity: Math.max(1, Math.round(input.capacity || 30)), active: existing?.id === v.id ? true : input.active,
    };
    if (existing || !isNew) await q.update(profiles).set(values).where(eq(profiles.id, input.id));
    else await q.insert(profiles).values({ id: input.id, ...values });
    if (values.role === 'csm' && values.podId) {
      const [p] = await q.select().from(pods).where(eq(pods.id, values.podId));
      if (p && !p.csmId) await q.update(pods).set({ csmId: input.id }).where(eq(pods.id, p.id));
    }
  });
}

export async function setRate(db: DB, v: Viewer, profileId: string, rate: number): Promise<Result> {
  mustOwner(v);
  return tx(db, async (q) => {
    await q.insert(staffRates).values({ profileId, hourlyRate: Math.max(0, rate) })
      .onConflictDoUpdate({ target: staffRates.profileId, set: { hourlyRate: Math.max(0, rate) } });
  });
}
export async function setPrice(db: DB, v: Viewer, orgId: string, price: number): Promise<Result> {
  mustOwner(v);
  return tx(db, async (q) => {
    const [account] = await q.select().from(orgs).where(eq(orgs.id, orgId));
    if (!account || account.billingModel === 'project') throw new UserError('Monthly pricing does not apply to project accounts.');
    await q.insert(orgPrices).values({ orgId, monthlyPrice: Math.max(0, price) })
      .onConflictDoUpdate({ target: orgPrices.orgId, set: { monthlyPrice: Math.max(0, price) } });
  });
}

export async function saveSettings(db: DB, v: Viewer, input: { slaMode: string; bizStart: number; bizEnd: number; autoReset: boolean }): Promise<Result> {
  mustLead(v);
  const bs = Math.min(23, Math.max(0, Math.round(input.bizStart))), be = Math.min(24, Math.max(bs + 1, Math.round(input.bizEnd)));
  return tx(db, async (q) => {
    await q.insert(settings).values({ id: 1, slaMode: input.slaMode === 'calendar' ? 'calendar' : 'business', bizStart: bs, bizEnd: be, autoReset: input.autoReset })
      .onConflictDoUpdate({ target: settings.id, set: { slaMode: input.slaMode === 'calendar' ? 'calendar' : 'business', bizStart: bs, bizEnd: be, autoReset: input.autoReset } });
  });
}

export async function markRead(db: DB, v: Viewer, id: string | 'all'): Promise<void> {
  if (id === 'all') await db.update(notifications).set({ read: true }).where(and(eq(notifications.toId, v.id), eq(notifications.read, false)));
  else await db.update(notifications).set({ read: true }).where(and(eq(notifications.id, id), eq(notifications.toId, v.id)));
}

/* ---------------- sweep: escalations, auto-close, monthly credit reset ---------------- */

/** Safe to run often: every escalation level fires once per request, and resets happen once per month. */
export async function sweep(db: DB, opts: { force?: boolean } = {}): Promise<Result<{ escalated: number; closed: number; reset: number }>> {
  const s = await getSettings(db);
  const now = Date.now();
  if (!opts.force && s.lastSweepAt && now - new Date(s.lastSweepAt).getTime() < 5 * 60_000) return { value: { escalated: 0, closed: 0, reset: 0 }, out: newOutbox() };
  return tx(db, async (q, out) => {
    await q.update(settings).set({ lastSweepAt: new Date(now) }).where(eq(settings.id, 1));
    let escalated = 0, closed = 0, reset = 0;
    const open = await q.select().from(requests).where(inArray(requests.status, ACTIVE));
    const [orgRows, lead, owners] = [await q.select().from(orgs), await leadIds(q), await ownerIds(q)];
    for (const r of open) {
      if (r.status === 'delivered' && r.autoAcceptAt && new Date(r.autoAcceptAt).getTime() <= now) {
        await patch(q, r, { status: 'closed', closedAt: new Date(now) });
        await event(q, null, r, 'status', 'Closed after 5 days with no client response', 'delivered', 'closed');
        closed++;
        continue;
      }
      const st = sla(r, s, now);
      if (!st || !st.level) continue;
      const key = `${r.id}-L${st.level}`;
      const ins = await q.insert(escalations).values({ key, requestId: r.id, level: st.level }).onConflictDoNothing().returning();
      if (!ins.length) continue;
      escalated++;
      const orgName = orgRows.find((o) => o.id === r.orgId)?.name ?? 'a client';
      const to = st.level === 1 ? [r.assigneeId ?? (await csmFor(q, r.orgId))] : st.level === 2 ? lead : owners;
      const text = st.level === 1 ? `At risk: 75% of SLA used on ${ref(r)}`
        : st.level === 2 ? `SLA breached on ${ref(r)} for ${orgName}`
        : r.unhappy ? `Client concern on ${ref(r)}` : `Level 3: ${ref(r)} is at twice its SLA`;
      await notifyStaff(q, out, null, to, text, r, 'escalation', st.level >= 2);
      if (st.level >= 2) out.slack.push(`${text} (${orgName})`);
    }
    if (s.autoReset) {
      const mk = monthKey(new Date(now));
      const due = orgRows.filter((o: Org) => o.active && o.billingModel !== 'project' && o.creditsPeriod !== mk);
      for (const o of due) {
        await q.update(orgs).set({ credits: o.monthlyCredits, creditsPeriod: mk }).where(eq(orgs.id, o.id));
        reset++;
      }
    }
    return { escalated, closed, reset };
  });
}

export { slaHoursFor };
