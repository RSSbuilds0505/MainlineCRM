'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb, type DB } from '@/lib/db';
import { orgs, profiles, requests, type Priority, type Role } from '@/lib/db/schema';
import { requireViewer } from '@/lib/auth';
import { deliver } from '@/lib/notify';
import { allow } from '@/lib/ratelimit';
import { aiTriage } from '@/lib/triage';
import { llmEnabled } from '@/lib/llm';
import { savePerson, signInLink } from '@/lib/people';
import { sendEmail, emailEnabled } from '@/lib/email';
import { supabaseServer } from '@/lib/supabase/server';
import { isLeadRole, isStaffRole, MIN_PASSWORD, PLATFORMS } from '@/lib/core';
import * as wf from '@/lib/workflow';

const s = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();
const n = (fd: FormData, k: string, d = 0): number => { const v = Number(fd.get(k)); return Number.isFinite(v) && fd.get(k) !== '' && fd.get(k) !== null ? v : d; };
const b = (fd: FormData, k: string): boolean => fd.get(k) === 'on' || fd.get(k) === 'true';

function safeBack(fd: FormData, fallback: string): string {
  const v = s(fd, 'back');
  return v.startsWith('/') && !v.startsWith('//') ? v.split('?')[0] : fallback;
}
function withFlash(path: string, flash: { ok?: string; err?: string }): string {
  const q = new URLSearchParams();
  if (flash.ok) q.set('ok', flash.ok);
  if (flash.err) q.set('err', flash.err);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

const FRIENDLY = 'That did not save. Try again, and tell your Mainline admin if it keeps happening.';

/** Runs a write, delivers its notifications, and returns to the page with a message. */
async function run(back: string, fn: (db: DB, v: wf.Viewer) => Promise<wf.Result<unknown>>, ok?: string, next?: (value: unknown) => string | undefined): Promise<never> {
  const v = await requireViewer();
  const db = getDb();
  let err: string | undefined;
  let dest = back;
  try {
    const r = await fn(db, v);
    await deliver(r.out);
    const nx = next?.(r.value);
    if (nx) dest = nx;
  } catch (e) {
    if (e instanceof wf.UserError) err = e.message;
    else { console.error(e); err = FRIENDLY; }
  }
  revalidatePath('/', 'layout');
  redirect(withFlash(err ? back : dest, err ? { err } : { ok }));
}

/* ---------------- sign in ---------------- */

export async function requestLink(fd: FormData): Promise<never> {
  const email = s(fd, 'email').toLowerCase();
  const done = '/login?sent=1';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect('/login?e=email');
  const db = getDb();
  const ip = (headers().get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  const [byEmail, byIp] = await Promise.all([allow(db, `link:${email}`, 5, 3600), allow(db, `linkip:${ip}`, 20, 3600)]);
  if (!byEmail.ok || !byIp.ok) redirect(`/login?e=rate&retry=${Math.ceil(Math.max(byEmail.retryAfter, byIp.retryAfter) / 60)}`);
  const [p] = await db.select().from(profiles).where(eq(profiles.email, email));
  // Same response whether or not the email has access, so the form does not reveal who is a client.
  if (!p || !p.active) redirect(done);
  try {
    if (emailEnabled()) {
      const link = await signInLink(email);
      await sendEmail({ to: email, subject: 'Your Mainline sign-in link', text: `Hi ${p.name},\n\nUse this link to sign in to Mainline. It works once and expires in 1 hour:\n${link}\n\nIf you did not ask for this, you can ignore this email.` });
    } else {
      await supabaseServer().auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${(process.env.APP_URL ?? '').replace(/\/$/, '')}/auth/callback` } });
    }
  } catch (e) {
    console.error('[login] link failed', e);
  }
  redirect(done);
}

export async function signInPassword(fd: FormData): Promise<never> {
  const email = s(fd, 'email').toLowerCase();
  const password = String(fd.get('password') ?? '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !password) redirect('/login?e=bad');
  const db = getDb();
  const ip = (headers().get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  const [byEmail, byIp] = await Promise.all([allow(db, `pw:${email}`, 10, 900), allow(db, `pwip:${ip}`, 40, 900)]);
  if (!byEmail.ok || !byIp.ok) redirect(`/login?e=rate&retry=${Math.ceil(Math.max(byEmail.retryAfter, byIp.retryAfter) / 60)}`);
  const { error } = await supabaseServer().auth.signInWithPassword({ email, password });
  // One message for every failure so the form never reveals which emails have accounts.
  if (error) redirect('/login?e=bad');
  redirect('/');
}

export async function setPasswordAction(fd: FormData): Promise<never> {
  const v = await requireViewer();
  const back = v.role === 'client' ? '/portal/account' : '/app/account';
  const password = String(fd.get('password') ?? '');
  const confirm = String(fd.get('confirm') ?? '');
  let err: string | null = null;
  if (password.length < MIN_PASSWORD) err = `Use at least ${MIN_PASSWORD} characters.`;
  else if (password !== confirm) err = 'The two passwords do not match.';
  else if (password.toLowerCase().includes(v.email.split('@')[0].toLowerCase())) err = 'Choose a password that does not contain your email name.';
  if (!err) {
    const lim = await allow(getDb(), `setpw:${v.id}`, 10, 3600);
    if (!lim.ok) err = 'Too many attempts. Try again later.';
    else {
      const { error } = await supabaseServer().auth.updateUser({ password, data: { password_set: true } });
      if (error) {
        console.error('[account] password update failed', error.message);
        err = /same/i.test(error.message) ? 'That is already your password.'
          : /weak|pwned|leaked/i.test(error.message) ? 'That password is too easy to guess. Try a longer one.'
          : 'Could not save the password. Try again.';
      }
    }
  }
  redirect(withFlash(back, err ? { err } : { ok: 'Password saved. Next time, sign in with your email and this password.' }));
}

/* ---------------- requests ---------------- */

export async function createRequestAction(fd: FormData): Promise<never> {
  const back = safeBack(fd, '/');
  return run(back, async (db, v) => {
    const orgId = v.role === 'client' ? v.orgId ?? '' : s(fd, 'orgId');
    const res = await wf.createRequest(db, v, {
      orgId, skuId: s(fd, 'skuId'), title: s(fd, 'title'), description: s(fd, 'description'), priority: (s(fd, 'priority') || 'normal') as Priority,
      source: s(fd, 'source'), contact: s(fd, 'contact'), triageNow: b(fd, 'triageNow'),
    });
    // Pre-compute the AI suggestion so triage is one click for the team. Fail-soft.
    if (llmEnabled()) {
      const lim = await allow(db, `ai:${v.id}`, 30, 3600);
      if (lim.ok) {
        const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
        const ai = org ? await aiTriage(db, org, `${s(fd, 'title')}\n\n${s(fd, 'description')}`) : null;
        if (ai) await db.update(requests).set({ ai }).where(eq(requests.id, res.value));
      }
    }
    return res;
  }, 'Request submitted.', (id) => (typeof id === 'string' ? `${isClientPath(back) ? '/portal' : '/app'}/requests/${id}` : undefined));
}
const isClientPath = (p: string): boolean => p.startsWith('/portal');

export async function triageAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), (db, v) => wf.triage(db, v, s(fd, 'id'), s(fd, 'skuId'), s(fd, 'priority') as Priority), 'Triaged. Next: scope and assign.');
}
export async function runAiAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), async (db, v) => {
    if (!isStaffRole(v.role)) throw new wf.UserError('Only the team can run AI triage.');
    if (!llmEnabled()) throw new wf.UserError('AI triage is not set up yet. Add an Anthropic API key in the app settings.');
    const lim = await allow(db, `ai:${v.id}`, 30, 3600);
    if (!lim.ok) throw new wf.UserError(`AI triage limit reached. Try again in ${Math.ceil(lim.retryAfter / 60)} minutes.`);
    const [r] = await db.select().from(requests).where(eq(requests.id, s(fd, 'id')));
    if (!r || !(await wf.canSeeRequest(db, v, r))) throw new wf.UserError('That request was not found.');
    const [org] = await db.select().from(orgs).where(eq(orgs.id, r.orgId));
    const ai = org ? await aiTriage(db, org, `${r.title}\n\n${r.description}`) : null;
    if (!ai) throw new wf.UserError('AI triage did not return a suggestion. Triage this one manually.');
    await db.update(requests).set({ ai }).where(eq(requests.id, r.id));
    return { value: undefined, out: { email: [], slack: [] } };
  }, 'AI suggestion added.');
}
export async function scopeAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), (db, v) => wf.scope(db, v, s(fd, 'id'), { credits: n(fd, 'credits'), slaHours: n(fd, 'slaHours', 16), estHours: n(fd, 'estHours') }), 'Scoped and routed.');
}
export async function assignAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), (db, v) => wf.assign(db, v, s(fd, 'id'), s(fd, 'assigneeId'), s(fd, 'qaId') || null), 'Assignment saved.');
}
export async function autoAssignAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), (db, v) => wf.autoAssign(db, v, s(fd, 'id')), 'Auto-assigned.');
}
export async function startAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), (db, v) => wf.start(db, v, s(fd, 'id')), 'Work started.');
}
export async function askAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), (db, v) => wf.askClient(db, v, s(fd, 'id'), s(fd, 'body')), 'Question sent. The SLA is paused until the client answers.');
}
export async function resumeAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), (db, v) => wf.resume(db, v, s(fd, 'id')), 'Work resumed.');
}
export async function commentAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/'), (db, v) => wf.comment(db, v, s(fd, 'id'), s(fd, 'body'), { internal: b(fd, 'internal'), asClientAnswer: s(fd, 'mode') === 'clientAnswer' }), 'Posted.');
}
export async function submitQaAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), (db, v) => wf.submitQa(db, v, s(fd, 'id')), 'Sent to QA.');
}
export async function passQaAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), (db, v) => wf.passQa(db, v, s(fd, 'id'), fd.getAll('qa').length, s(fd, 'body')), 'Delivered to the client.');
}
export async function failQaAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), (db, v) => wf.failQa(db, v, s(fd, 'id'), s(fd, 'body')), 'Returned to the implementer.');
}
export async function acceptAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/'), (db, v) => wf.accept(db, v, s(fd, 'id')), 'Accepted. Thank you.');
}
export async function reviseAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/'), (db, v) => wf.revise(db, v, s(fd, 'id'), s(fd, 'body')), 'Revision requested. Your team has been notified.');
}
export async function autoCloseAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), (db, v) => wf.autoClose(db, v, s(fd, 'id')), 'Closed.');
}
export async function cancelAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/'), (db, v) => wf.cancel(db, v, s(fd, 'id')), 'Request cancelled.');
}
export async function flagAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/'), (db, v) => wf.flag(db, v, s(fd, 'id'), s(fd, 'body')), 'Concern flagged. Leadership has been alerted.');
}
export async function clearFlagAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), (db, v) => wf.clearFlag(db, v, s(fd, 'id')), 'Concern marked resolved.');
}

/* ---------------- time ---------------- */

export async function logTimeAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app'), (db, v) => wf.logTime(db, v, s(fd, 'id'), { hours: n(fd, 'hours'), note: s(fd, 'note'), workDate: s(fd, 'workDate'), staffId: s(fd, 'staffId') || undefined }), 'Time logged.');
}
export async function deleteTimeAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app/time'), (db, v) => wf.deleteTime(db, v, s(fd, 'timelogId')), 'Entry deleted.');
}

/* ---------------- inbox ---------------- */

export async function openNoteAction(fd: FormData): Promise<never> {
  const v = await requireViewer();
  await wf.markRead(getDb(), v, s(fd, 'noteId'));
  const req = s(fd, 'requestId');
  revalidatePath('/', 'layout');
  redirect(req ? `${v.role === 'client' ? '/portal' : '/app'}/requests/${req}` : '/app/inbox');
}
export async function readAllAction(): Promise<never> {
  const v = await requireViewer();
  await wf.markRead(getDb(), v, 'all');
  revalidatePath('/', 'layout');
  redirect('/app/inbox');
}

/* ---------------- setup ---------------- */

export async function savePersonAction(fd: FormData): Promise<never> {
  const back = safeBack(fd, '/app/setup');
  return run(back, async (db, v) => {
    const role = s(fd, 'role') as Role;
    if (!['owner', 'lead', 'csm', 'implementer', 'client'].includes(role)) throw new wf.UserError('Pick a role.');
    const res = await savePerson(db, v, {
      id: s(fd, 'personId') || undefined, email: s(fd, 'email'), name: s(fd, 'name'), role,
      orgId: s(fd, 'orgId') || null, podId: s(fd, 'podId') || null,
      platforms: PLATFORMS.filter((p) => b(fd, `p_${p}`)), capacity: n(fd, 'capacity', 30),
      active: s(fd, 'personId') ? b(fd, 'active') : true, sendInvite: b(fd, 'sendInvite'),
    });
    if (v.role === 'owner' && fd.get('rate') !== null && s(fd, 'rate') !== '' && isStaffRole(role)) await wf.setRate(db, v, res.value.id, n(fd, 'rate'));
    return res;
  }, undefined, (val) => {
    const x = val as { id: string; link: string | null; emailed: boolean };
    if (x.link && !x.emailed) return `${back}?ok=${encodeURIComponent('Saved. Email is not set up, so send this sign-in link yourself.')}&link=${encodeURIComponent(x.link)}`;
    return `${back}?ok=${encodeURIComponent(x.emailed ? 'Saved and invite emailed.' : 'Saved.')}`;
  });
}

export async function sendLinkAction(fd: FormData): Promise<never> {
  const back = safeBack(fd, '/app/setup');
  const v = await requireViewer();
  if (!isLeadRole(v.role)) redirect(back);
  let dest = back;
  try {
    const email = s(fd, 'email');
    const link = await signInLink(email);
    const sent = emailEnabled() && (await sendEmail({ to: email, subject: 'Your Mainline sign-in link', text: `Use this link to sign in to Mainline. It works once and expires in 1 hour:\n${link}` }));
    dest = sent ? withFlash(back, { ok: `Sign-in link emailed to ${email}.` }) : `${back}?ok=${encodeURIComponent('Copy this sign-in link and send it yourself.')}&link=${encodeURIComponent(link)}`;
  } catch (e) {
    dest = withFlash(back, { err: e instanceof wf.UserError ? e.message : FRIENDLY });
  }
  redirect(dest);
}

export async function saveOrgAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app/setup'), async (db, v) => {
    const res = await wf.saveOrg(db, v, {
      id: s(fd, 'orgId') || undefined, name: s(fd, 'name'), platform: s(fd, 'platform'), podId: s(fd, 'podId') || null,
      plan: s(fd, 'plan'), monthlyCredits: n(fd, 'monthlyCredits'), credits: n(fd, 'credits'), active: s(fd, 'orgId') ? b(fd, 'active') : true,
    });
    if (v.role === 'owner' && s(fd, 'price') !== '') await wf.setPrice(db, v, res.value, n(fd, 'price'));
    return res;
  }, 'Client saved.');
}
export async function resetCreditsAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app/setup'), (db, v) => wf.resetCredits(db, v, s(fd, 'orgId')), 'Credits reset to the monthly amount.');
}
export async function savePodAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app/setup'), (db, v) => wf.savePod(db, v, { id: s(fd, 'podId') || undefined, name: s(fd, 'name'), csmId: s(fd, 'csmId') || null }), 'Pod saved.');
}
export async function saveSkuAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app/setup'), (db, v) => wf.saveSku(db, v, {
    id: s(fd, 'skuId') || undefined, name: s(fd, 'name'), platform: s(fd, 'platform'), category: s(fd, 'category'), credits: n(fd, 'credits'),
    estHours: n(fd, 'estHours'), slaHours: n(fd, 'slaHours', 16), description: s(fd, 'description'), qa: s(fd, 'qa').split('\n'),
    active: s(fd, 'skuId') ? b(fd, 'active') : true,
  }), 'Service saved.');
}
export async function saveSettingsAction(fd: FormData): Promise<never> {
  return run(safeBack(fd, '/app/setup'), (db, v) => wf.saveSettings(db, v, { slaMode: s(fd, 'slaMode'), bizStart: n(fd, 'bizStart', 9), bizEnd: n(fd, 'bizEnd', 18), autoReset: b(fd, 'autoReset') }), 'Settings saved.');
}
