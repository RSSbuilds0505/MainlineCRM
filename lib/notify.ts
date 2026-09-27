import type { Outbox } from './workflow';
import { sendEmail } from './email';

async function slack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `*Mainline* ${text}` }) });
  } catch (e) {
    console.error('[slack] post failed', e);
  }
}

/** Delivers queued email and Slack messages after a transaction commits. Fail-soft by design. */
export async function deliver(out: Outbox): Promise<void> {
  await Promise.allSettled([...out.email.map((m) => sendEmail(m)), ...out.slack.map((t) => slack(t))]);
}
