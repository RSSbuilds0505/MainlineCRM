import { brand } from './brand';
import { Resend } from 'resend';

let client: Resend | null | undefined;
function resend(): Resend | null {
  if (client !== undefined) return client;
  client = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  return client;
}

export const emailEnabled = (): boolean => !!process.env.RESEND_API_KEY;

/** The single path for transactional email. Never throws: a failed email must not fail the user's action. */
export async function sendEmail(msg: { to: string; subject: string; text: string }): Promise<boolean> {
  const r = resend();
  if (!r) return false;
  try {
    const from = process.env.EMAIL_FROM || `${brand.name} <onboarding@resend.dev>`;
    const { error } = await r.emails.send({ from, to: msg.to, subject: msg.subject, text: `${msg.text}\n\n${brand.name} by ${brand.company}` });
    if (error) { console.error('[email] send failed', error.message); return false; }
    return true;
  } catch (e) {
    console.error('[email] send threw', e);
    return false;
  }
}
