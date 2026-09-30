import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, numeric, jsonb, bigint, serial, date, index, primaryKey,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['owner', 'lead', 'csm', 'implementer', 'client']);
export const statusEnum = pgEnum('request_status', [
  'submitted', 'triaged', 'scoped', 'assigned', 'in_progress', 'waiting', 'qa', 'delivered', 'closed', 'cancelled',
]);
export const priorityEnum = pgEnum('priority', ['urgent', 'high', 'normal', 'low']);

/** One row per person who can sign in. id equals the Supabase auth user id. */
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull(),
  orgId: uuid('org_id'),
  podId: uuid('pod_id'),
  platforms: text('platforms').array().notNull().default([]),
  capacity: integer('capacity').notNull().default(30),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pods = pgTable('pods', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  csmId: uuid('csm_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  platform: text('platform').notNull(),
  podId: uuid('pod_id'),
  plan: text('plan').notNull().default('Growth'),
  monthlyCredits: integer('monthly_credits').notNull().default(0),
  credits: integer('credits').notNull().default(0),
  creditsPeriod: text('credits_period'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const skus = pgTable('skus', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  platform: text('platform').notNull(),
  category: text('category').notNull().default('General'),
  credits: integer('credits').notNull().default(0),
  estHours: numeric('est_hours', { mode: 'number' }).notNull().default(0),
  slaHours: integer('sla_hours').notNull().default(16),
  description: text('description').notNull().default(''),
  qa: jsonb('qa').$type<string[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
});

export const requests = pgTable('requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  num: serial('num').notNull(),
  orgId: uuid('org_id').notNull(),
  skuId: text('sku_id').notNull(),
  /** Support tickets only: what kind of help the client needs (see SUPPORT_CATEGORIES). */
  category: text('category'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  priority: priorityEnum('priority').notNull().default('normal'),
  status: statusEnum('status').notNull().default('submitted'),
  source: text('source').notNull().default('Client portal'),
  contact: text('contact').notNull().default(''),
  submittedBy: uuid('submitted_by'),
  submittedByName: text('submitted_by_name').notNull().default(''),
  assigneeId: uuid('assignee_id'),
  qaId: uuid('qa_id'),
  credits: integer('credits').notNull().default(0),
  slaHours: integer('sla_hours'),
  estHours: numeric('est_hours', { mode: 'number' }),
  firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
  scopedAt: timestamp('scoped_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  pausedAt: timestamp('paused_at', { withTimezone: true }),
  pausedBizMs: bigint('paused_biz_ms', { mode: 'number' }).notNull().default(0),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  autoAcceptAt: timestamp('auto_accept_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  qaFails: integer('qa_fails').notNull().default(0),
  revisions: integer('revisions').notNull().default(0),
  unhappy: boolean('unhappy').notNull().default(false),
  needsLead: boolean('needs_lead').notNull().default(false),
  ai: jsonb('ai').$type<AiTriage | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byOrg: index('requests_org_idx').on(t.orgId),
  byStatus: index('requests_status_idx').on(t.status),
}));

export const requestEvents = pgTable('request_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull(),
  actorId: uuid('actor_id'),
  actorName: text('actor_name').notNull(),
  type: text('type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  text: text('text').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byReq: index('events_request_idx').on(t.requestId) }));

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull(),
  authorId: uuid('author_id'),
  authorName: text('author_name').notNull(),
  body: text('body').notNull(),
  internal: boolean('internal').notNull().default(false),
  fromClient: boolean('from_client').notNull().default(false),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byReq: index('comments_request_idx').on(t.requestId) }));

/** Screenshots, files and video links on a request. Files live in private storage; access is by short-lived signed link. */
export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull(),
  /** 'file' (stored upload) or 'link' (Loom, YouTube, Drive and so on). */
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  mime: text('mime'),
  size: integer('size'),
  path: text('path'),
  url: text('url'),
  internal: boolean('internal').notNull().default(false),
  fromClient: boolean('from_client').notNull().default(false),
  uploadedBy: uuid('uploaded_by'),
  uploadedByName: text('uploaded_by_name').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byReq: index('attachments_request_idx').on(t.requestId) }));

export const timelogs = pgTable('timelogs', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull(),
  orgId: uuid('org_id').notNull(),
  skuId: text('sku_id').notNull(),
  staffId: uuid('staff_id').notNull(),
  hours: numeric('hours', { mode: 'number' }).notNull(),
  note: text('note').notNull().default(''),
  workDate: date('work_date', { mode: 'string' }).notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byReq: index('timelogs_request_idx').on(t.requestId), byDate: index('timelogs_date_idx').on(t.workDate) }));

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  toId: uuid('to_id').notNull(),
  text: text('text').notNull(),
  requestId: uuid('request_id'),
  kind: text('kind').notNull(),
  byName: text('by_name').notNull().default('Mainline'),
  read: boolean('read').notNull().default(false),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byTo: index('notifications_to_idx').on(t.toId, t.read) }));

export const escalations = pgTable('escalations', {
  key: text('key').primaryKey(),
  requestId: uuid('request_id').notNull(),
  level: integer('level').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  slaMode: text('sla_mode').notNull().default('business'),
  bizStart: integer('biz_start').notNull().default(9),
  bizEnd: integer('biz_end').notNull().default(18),
  autoReset: boolean('auto_reset').notNull().default(true),
  lastSweepAt: timestamp('last_sweep_at', { withTimezone: true }),
});

/** Owner-only financial data. */
export const staffRates = pgTable('staff_rates', {
  profileId: uuid('profile_id').primaryKey(),
  hourlyRate: numeric('hourly_rate', { mode: 'number' }).notNull(),
});
export const orgPrices = pgTable('org_prices', {
  orgId: uuid('org_id').primaryKey(),
  monthlyPrice: numeric('monthly_price', { mode: 'number' }).notNull(),
});

/** Fixed-window rate limiter used by login links and AI triage. */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').notNull(),
  windowStart: bigint('window_start', { mode: 'number' }).notNull(),
  count: integer('count').notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.key, t.windowStart] }) }));

export type AiTriage = {
  skuId: string | null;
  confidence: number;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  priorityReason: string;
  missing: string[];
  summary: string;
  at: number;
};

export type Profile = typeof profiles.$inferSelect;
export type Org = typeof orgs.$inferSelect;
export type Pod = typeof pods.$inferSelect;
export type Sku = typeof skus.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type RequestEvent = typeof requestEvents.$inferSelect;
export type Timelog = typeof timelogs.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type Role = Profile['role'];
export type Status = Request['status'];
export type Priority = Request['priority'];
export type Attachment = typeof attachments.$inferSelect;
