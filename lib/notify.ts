import { brand } from './brand';
import type { Outbox } from './workflow';
import { sendEmail } from './email';

export const slackEnabled = (): boolean => !!process.env.SLACK_WEBHOOK_URL;

/** Posts to the team's Slack channel. Returns whether Slack accepted it. Never throws. */
export async function slack(text: string): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return false;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `*${brand.name}* ${text}` }) });
    if (!r.ok) console.error('[slack] post rejected', r.status, await r.text().catch(() => ''));
    return r.ok;
  } catch (e) {
    console.error('[slack] post failed', e);
    return false;
  }
}

/** Reads the public Supabase auth settings to confirm open sign-ups are turned off. Null if it cannot tell. */
export async function signupsDisabled(): Promise<boolean | null> {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, cache: 'no-store' });
    if (!r.ok) return null;
    return !!((await r.json()) as { disable_signup?: boolean }).disable_signup;
  } catch { return null; }
}

/** Delivers queued email and Slack messages after a transaction commits. Fail-soft by design. */
export async function deliver(out: Outbox): Promise<void> {
  await Promise.allSettled([...out.email.map((m) => sendEmail(m)), ...out.slack.map((t) => slack(t))]);
}
