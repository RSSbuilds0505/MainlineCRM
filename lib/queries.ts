/** Read models for pages. All authorization is checked here or in lib/workflow.ts before data leaves the server. */
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { DB } from './db';
import {
  attachments,
  comments, notifications, orgPrices, orgs, pods, profiles, requestEvents, requests, skus, staffRates, timelogs,
  type Org, type Pod, type Profile, type Request, type Sku, type Timelog,
} from './db/schema';
import { isLeadRole } from './core';
import { canSeeRequest, getSettings } from './workflow';

export type Lookup = {
  orgs: Map<string, Org>; skus: Map<string, Sku>; people: Map<string, Profile>; pods: Map<string, Pod>;
};

export async function lookups(db: DB): Promise<Lookup> {
  const [o, k, p, pd] = await Promise.all([
    db.select().from(orgs).orderBy(asc(orgs.name)),
    db.select().from(skus).orderBy(asc(skus.category), asc(skus.name)),
    db.select().from(profiles).orderBy(asc(profiles.name)),
    db.select().from(pods).orderBy(asc(pods.name)),
  ]);
  return {
    orgs: new Map(o.map((x) => [x.id, x])), skus: new Map(k.map((x) => [x.id, x])),
    people: new Map(p.map((x) => [x.id, x])), pods: new Map(pd.map((x) => [x.id, x])),
  };
}

/** Requests the viewer may see: everything for leads, their pod plus assignments for CSMs and implementers, their org for clients. */
export async function visibleRequests(db: DB, v: Profile): Promise<Request[]> {
  if (v.role === 'client') {
    if (!v.orgId) return [];
    return db.select().from(requests).where(eq(requests.orgId, v.orgId)).orderBy(desc(requests.createdAt));
  }
  if (isLeadRole(v.role)) return db.select().from(requests).orderBy(desc(requests.createdAt));
  const podOrgIds = v.podId ? (await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.podId, v.podId))).map((x) => x.id) : [];
  return db.select().from(requests)
    .where(sql`${requests.assigneeId} = ${v.id} or ${requests.qaId} = ${v.id}${podOrgIds.length ? sql` or ${inArray(requests.orgId, podOrgIds)}` : sql``}`)
    .orderBy(desc(requests.createdAt));
}

export async function requestDetail(db: DB, v: Profile, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await db.select().from(requests).where(eq(requests.id, id));
  if (!r || !(await canSeeRequest(db, v, r))) return null;
  const client = v.role === 'client';
  const [cm, ev, tl, at] = await Promise.all([
    db.select().from(comments).where(client ? and(eq(comments.requestId, id), eq(comments.internal, false)) : eq(comments.requestId, id)).orderBy(asc(comments.at)),
    client ? Promise.resolve([]) : db.select().from(requestEvents).where(eq(requestEvents.requestId, id)).orderBy(desc(requestEvents.at)),
    client ? Promise.resolve([] as Timelog[]) : db.select().from(timelogs).where(eq(timelogs.requestId, id)).orderBy(desc(timelogs.workDate)),
    db.select().from(attachments).where(client ? and(eq(attachments.requestId, id), eq(attachments.internal, false)) : eq(attachments.requestId, id)).orderBy(asc(attachments.at)),
  ]);
  return { r, comments: cm, events: ev, timelogs: tl, attachments: at };
}

export async function unreadCount(db: DB, v: Profile): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.toId, v.id), eq(notifications.read, false)));
  return row?.n ?? 0;
}
export async function inbox(db: DB, v: Profile) {
  return db.select().from(notifications).where(eq(notifications.toId, v.id)).orderBy(desc(notifications.at)).limit(150);
}

export async function hoursByRequest(db: DB): Promise<Map<string, number>> {
  const rows = await db.select({ id: timelogs.requestId, h: sql<string>`sum(${timelogs.hours})` }).from(timelogs).groupBy(timelogs.requestId);
  return new Map(rows.map((x) => [x.id, Number(x.h) || 0]));
}

export async function timeRows(db: DB, v: Profile, from: string, to: string, who: string | null): Promise<Timelog[]> {
  const conds = [gte(timelogs.workDate, from), lt(timelogs.workDate, to)];
  if (!isLeadRole(v.role)) conds.push(eq(timelogs.staffId, v.id));
  else if (who) conds.push(eq(timelogs.staffId, who));
  return db.select().from(timelogs).where(and(...conds)).orderBy(desc(timelogs.workDate), desc(timelogs.createdAt));
}

export async function finance(db: DB, v: Profile) {
  if (v.role !== 'owner') return null;
  const [rates, prices] = await Promise.all([db.select().from(staffRates), db.select().from(orgPrices)]);
  return { rates: new Map(rates.map((r) => [r.profileId, r.hourlyRate])), prices: new Map(prices.map((p) => [p.orgId, p.monthlyPrice])) };
}

export { getSettings };
