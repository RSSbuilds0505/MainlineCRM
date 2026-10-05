import { eq, sql } from 'drizzle-orm';
import type { DB } from './db';
import { orgs, projectPrices, timelogs, type Profile } from './db/schema';
import { isLeadRole } from './core';
import { projectBudget, projectValue } from './project-budget';

/** Authorize before reading aggregates or owner-only pricing. */
export async function projectSummary(db: DB, viewer: Profile, orgId: string) {
  if (!viewer.active) return null;
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  if (!org || org.billingModel !== 'project') return null;
  const permitted = viewer.role === 'client' ? viewer.orgId === orgId : isLeadRole(viewer.role) || (!!viewer.podId && viewer.podId === org.podId);
  if (!permitted) return null;
  const [total] = await db.select({ hours: sql<string>`coalesce(sum(${timelogs.hours}), 0)` }).from(timelogs).where(eq(timelogs.orgId, orgId));
  const operational = projectBudget(Number(org.contractedHours), Number(total.hours));
  if (viewer.role !== 'owner') return { ...operational, financial: null };
  const [price] = await db.select().from(projectPrices).where(eq(projectPrices.orgId, orgId));
  return { ...operational, financial: price ? { rate: price.hourlyRate, value: projectValue(org.contractedHours, price.hourlyRate), loggedValue: projectValue(operational.logged, price.hourlyRate) } : null };
}
