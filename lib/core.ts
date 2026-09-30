/**
 * Pure business rules shared by every screen: status labels, the business-hours clock,
 * SLA math and the routing score. No database or framework imports here, so it is easy to test.
 */
import type { Priority, Request, Role, Settings, Sku, Status, Profile } from './db/schema';

export const H = 3_600_000;
export const DAY = 24 * H;
export const TZ = 'America/New_York';

export const LINE: Status[] = ['submitted', 'triaged', 'scoped', 'assigned', 'in_progress', 'qa', 'delivered', 'closed'];
export const LBL: Record<Status, string> = {
  submitted: 'Submitted', triaged: 'Triaged', scoped: 'Scoped', assigned: 'Assigned', in_progress: 'In progress',
  waiting: 'Waiting on client', qa: 'QA review', delivered: 'Delivered', closed: 'Closed', cancelled: 'Cancelled',
};
/** What a client sees: fewer internal stages. */
export const CLIENT_LBL: Record<Status, string> = {
  submitted: 'Received', triaged: 'Received', scoped: 'Scheduled', assigned: 'Scheduled', in_progress: 'In progress',
  waiting: 'Needs your reply', qa: 'Quality check', delivered: 'Ready for your review', closed: 'Complete', cancelled: 'Cancelled',
};
export const CLIENT_LINE: { key: string; label: string; statuses: Status[] }[] = [
  { key: 'received', label: 'Received', statuses: ['submitted', 'triaged'] },
  { key: 'scheduled', label: 'Scheduled', statuses: ['scoped', 'assigned'] },
  { key: 'progress', label: 'In progress', statuses: ['in_progress', 'waiting'] },
  { key: 'qa', label: 'Quality check', statuses: ['qa'] },
  { key: 'review', label: 'Your review', statuses: ['delivered'] },
  { key: 'done', label: 'Complete', statuses: ['closed'] },
];
export const ACTIVE: Status[] = ['submitted', 'triaged', 'scoped', 'assigned', 'in_progress', 'waiting', 'qa', 'delivered'];
export const WORKING: Status[] = ['assigned', 'in_progress', 'waiting', 'qa'];
export const PRI: Record<Priority, { label: string; firstResponse: number; mult: number }> = {
  urgent: { label: 'Urgent', firstResponse: 1, mult: 0.5 },
  high: { label: 'High', firstResponse: 4, mult: 0.75 },
  normal: { label: 'Normal', firstResponse: 8, mult: 1 },
  low: { label: 'Low', firstResponse: 16, mult: 1.5 },
};
export const ROLE_LBL: Record<Role, string> = {
  owner: 'Owner', lead: 'Solutions Lead', csm: 'CSM', implementer: 'Implementer', client: 'Client',
};
/* ---------------- support tickets ---------------- */

/** Built-in service id that marks a request as a support ticket (no credits, no scoping, no QA). */
export const SUPPORT_SKU = 'support';
export const isSupport = (r: Pick<Request, 'skuId'>): boolean => r.skuId === SUPPORT_SKU;
/** Services a client can order (everything except the built-in support ticket). */
export const isCatalogSku = (k: Pick<Sku, 'id'>): boolean => k.id !== SUPPORT_SKU;
export const SUPPORT_CATEGORIES = [
  { key: 'broken', label: 'Something is broken', hint: 'A workflow, form, sync or report stopped working.' },
  { key: 'data', label: 'Data looks wrong', hint: 'Missing, duplicated or incorrect records or numbers.' },
  { key: 'access', label: 'Access or login', hint: 'Someone cannot log in or cannot see what they need.' },
  { key: 'question', label: 'How do I...?', hint: 'A question about using your CRM.' },
  { key: 'other', label: 'Something else', hint: 'Anything that does not fit above.' },
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]['key'];
export const supportCategoryLabel = (k: string | null | undefined): string => SUPPORT_CATEGORIES.find((c) => c.key === k)?.label ?? 'Support';
/** Resolution target in the SLA clock's hours (business hours by default). */
export const SUPPORT_SLA: Record<Priority, number> = { urgent: 4, high: 8, normal: 16, low: 24 };
export const SUPPORT_URGENCY: Record<Priority, string> = {
  urgent: 'Your team is blocked right now',
  high: 'A key process is failing',
  normal: 'Something is off, but work continues',
  low: 'A question or minor issue',
};
/** Staff progress line for tickets. */
export const SUPPORT_LINE: Status[] = ['assigned', 'in_progress', 'delivered', 'closed'];
export const SUPPORT_LBL: Partial<Record<Status, string>> = { delivered: 'Resolved', closed: 'Closed' };
/** What a client sees for a ticket. */
export const SUPPORT_CLIENT_LBL: Record<Status, string> = {
  submitted: 'Received', triaged: 'Received', scoped: 'Received', assigned: 'Assigned', in_progress: 'Working on it',
  waiting: 'Needs your reply', qa: 'Working on it', delivered: 'Resolved, please confirm', closed: 'Closed', cancelled: 'Withdrawn',
};
export const SUPPORT_CLIENT_LINE: { key: string; label: string; statuses: Status[] }[] = [
  { key: 'received', label: 'Received', statuses: ['submitted', 'triaged', 'scoped'] },
  { key: 'assigned', label: 'Assigned', statuses: ['assigned'] },
  { key: 'progress', label: 'Working on it', statuses: ['in_progress', 'waiting', 'qa'] },
  { key: 'resolved', label: 'Resolved', statuses: ['delivered'] },
  { key: 'closed', label: 'Closed', statuses: ['closed'] },
];
/** Client-facing status label for any request. */
export const clientStatus = (r: Pick<Request, 'skuId' | 'status'>): string => (isSupport(r) ? SUPPORT_CLIENT_LBL : CLIENT_LBL)[r.status];

/** Minimum length for account passwords. */
export const MIN_PASSWORD = 10;

export const PLATFORMS = ['HubSpot', 'Salesforce', 'Monday', 'GoHighLevel'] as const;
export const SOURCES = ['Email', 'Phone call', 'Slack', 'Meeting', 'Text message', 'Other'] as const;

export const isStaffRole = (r: Role | null | undefined): boolean => !!r && r !== 'client';
export const isLeadRole = (r: Role | null | undefined): boolean => r === 'owner' || r === 'lead';
export const isCsmRole = (r: Role | null | undefined): boolean => isLeadRole(r) || r === 'csm';

type Clock = Pick<Settings, 'slaMode' | 'bizStart' | 'bizEnd'>;

const fmtNY = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
});
function nyOffset(t: number): number {
  const p: Record<string, string> = {};
  for (const x of fmtNY.formatToParts(new Date(t))) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}

/** Milliseconds of SLA clock between a and b (business hours Mon to Fri, Eastern, or wall clock). */
export function bizMs(a: number, b: number, c: Clock): number {
  if (!a || !b || b <= a) return 0;
  if (c.slaMode !== 'business') return b - a;
  const off = nyOffset(a), A = a + off, B = b + off;
  let tot = 0;
  for (let day = Math.floor(A / DAY) * DAY; day < B; day += DAY) {
    const w = new Date(day).getUTCDay();
    if (w === 0 || w === 6) continue;
    const s = Math.max(A, day + c.bizStart * H), e = Math.min(B, day + c.bizEnd * H);
    if (e > s) tot += e - s;
  }
  return tot;
}

/** The wall-clock time reached after spending ms of SLA clock starting at a. */
export function addBiz(a: number, ms: number, c: Clock): number {
  if (c.slaMode !== 'business') return a + ms;
  const off = nyOffset(a), L = a + off;
  let rem = ms;
  let day = Math.floor(L / DAY) * DAY;
  for (let i = 0; i < 1000; i++, day += DAY) {
    const w = new Date(day).getUTCDay();
    if (w === 0 || w === 6) continue;
    const s = Math.max(L, day + c.bizStart * H), e = day + c.bizEnd * H;
    if (e > s) { if (e - s >= rem) return s + rem - off; rem -= e - s; }
  }
  return L + rem - off;
}

export const clockWord = (c: Clock): string => (c.slaMode === 'business' ? 'business hours' : 'hours');

export function slaHoursFor(sku: Pick<Sku, 'slaHours'> | undefined, pri: Priority): number {
  const base = Number(sku?.slaHours) || 16;
  return Math.max(1, Math.round(base * PRI[pri].mult));
}

export type SlaState = {
  level: 0 | 1 | 2 | 3;
  frac: number;
  kind: 'First response' | 'Resolution' | 'Concern';
  text: string;
  cls: 'ok' | 'risk' | 'breach' | 'paused' | 'lvl3';
  due: number | null;
  done: boolean;
};

type SlaReq = Pick<Request, 'status' | 'unhappy' | 'scopedAt' | 'firstResponseAt' | 'createdAt' | 'priority' | 'slaHours' | 'deliveredAt' | 'pausedAt' | 'pausedBizMs'>;

export function dur(ms: number): string {
  ms = Math.abs(ms);
  if (ms < H) return Math.max(1, Math.round(ms / 60000)) + 'm';
  if (ms < 2 * DAY) return Math.round((ms / H) * 10) / 10 + 'h';
  return Math.round(ms / DAY) + 'd';
}

const t = (d: Date | null | undefined): number => (d ? new Date(d).getTime() : 0);

export function sla(r: SlaReq, c: Clock, now = Date.now()): SlaState | null {
  if (r.status === 'cancelled') return null;
  const concern = r.unhappy && r.status !== 'closed';
  if (!r.scopedAt) {
    if (r.firstResponseAt) return concern ? { level: 3, frac: 0, kind: 'Concern', text: 'Concern flagged', cls: 'lvl3', due: null, done: false } : null;
    const win = PRI[r.priority].firstResponse * H, el = bizMs(t(r.createdAt), now, c), frac = el / win;
    const level = (concern ? 3 : frac >= 2 ? 3 : frac >= 1 ? 2 : frac >= 0.75 ? 1 : 0) as SlaState['level'];
    return {
      level, frac, kind: 'First response', due: addBiz(t(r.createdAt), win, c), done: false,
      text: concern ? 'Concern flagged' : frac >= 1 ? 'Response overdue ' + dur(el - win) : 'Respond in ' + dur(win - el),
      cls: concern ? 'lvl3' : frac >= 1 ? 'breach' : frac >= 0.75 ? 'risk' : 'ok',
    };
  }
  const win = (Number(r.slaHours) || 16) * H;
  const done = !!r.deliveredAt && (r.status === 'delivered' || r.status === 'closed');
  const end = done ? t(r.deliveredAt) : r.status === 'waiting' ? t(r.pausedAt) || now : now;
  const el = Math.max(0, bizMs(t(r.scopedAt), end, c) - (r.pausedBizMs || 0)), frac = el / win;
  let level = (done ? 0 : frac >= 2 ? 3 : frac >= 1 ? 2 : frac >= 0.75 ? 1 : 0) as SlaState['level'];
  if (concern) level = 3;
  let text: string, cls: SlaState['cls'];
  if (done) { text = frac <= 1 ? 'Met SLA' : 'Missed SLA'; cls = frac <= 1 ? 'ok' : 'breach'; }
  else if (r.status === 'waiting') { text = 'SLA paused'; cls = 'paused'; }
  else if (frac >= 1) { text = 'Overdue ' + dur(el - win); cls = 'breach'; }
  else { text = dur(win - el) + ' left'; cls = frac >= 0.75 ? 'risk' : 'ok'; }
  if (concern) { text = 'Concern flagged'; cls = 'lvl3'; }
  return { level, frac, kind: 'Resolution', text, cls, due: done ? null : addBiz(now, Math.max(0, win - el), c), done };
}

export const riskScore = (r: SlaReq, c: Clock): number => (sla(r, c)?.frac ?? 0) + (r.unhappy ? 9 : 0);

/* ---------------- routing ---------------- */

export type RoutingInput = {
  sku: Pick<Sku, 'platform'>;
  orgId: string;
  podId: string | null;
  staff: Pick<Profile, 'id' | 'role' | 'podId' | 'platforms' | 'capacity' | 'active'>[];
  /** open estimated hours remaining per staff id */
  openHours: Record<string, number>;
  /** assignee ids of this org's last delivered requests, newest first */
  recentAssignees: string[];
};
export type RoutingResult = { assigneeId: string | null; qaId: string | null; overflow: boolean; reason: string };

export function route(inp: RoutingInput): RoutingResult {
  const fits = (s: RoutingInput['staff'][number]): boolean => inp.sku.platform === 'Any' || s.platforms.includes(inp.sku.platform);
  const util = (s: RoutingInput['staff'][number]): number => (inp.openHours[s.id] ?? 0) / (s.capacity || 30);
  const recent = inp.recentAssignees.slice(0, 10);
  const score = (s: RoutingInput['staff'][number]): number =>
    0.5 + 0.3 * (1 - Math.min(1, util(s))) + 0.2 * (recent.filter((x) => x === s.id).length / 10);
  const active = inp.staff.filter((s) => s.active);
  const impl = active.filter((s) => s.role === 'implementer' && fits(s) && util(s) <= 0.9);
  let pool = impl.filter((s) => s.podId === inp.podId);
  let overflow = false;
  if (!pool.length) { pool = impl; overflow = pool.length > 0; }
  pool.sort((a, b) => score(b) - score(a));
  const a = pool[0];
  if (!a) return { assigneeId: null, qaId: null, overflow: false, reason: `No implementer with capacity covers ${inp.sku.platform}.` };
  const qaPool = active
    .filter((s) => s.id !== a.id && (s.role === 'implementer' || s.role === 'lead') && fits(s))
    .sort((x, y) => Number(y.podId === inp.podId) - Number(x.podId === inp.podId) || score(y) - score(x));
  const lead = active.find((s) => s.role === 'lead') ?? active.find((s) => s.role === 'owner');
  return {
    assigneeId: a.id, qaId: (qaPool[0] ?? lead)?.id ?? null, overflow,
    reason: overflow ? "Routed to overflow: no capacity in the client's pod." : '',
  };
}

export const monthKey = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
