import assert from 'node:assert/strict';
import { emailConfigured, emailEnabled, sendEmail } from '../lib/email';
async function main(): Promise<void> {
const old = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM, verified: process.env.EMAIL_DELIVERY_VERIFIED };
try {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_DELIVERY_VERIFIED;
  assert.equal(emailConfigured(), false);
  assert.equal(emailEnabled(), false);
  process.env.RESEND_API_KEY = 'isolated-placeholder';
  process.env.EMAIL_FROM = 'Mainline <notifications@example.com>';
  assert.equal(emailConfigured(), true);
  assert.equal(emailEnabled(), false);
  assert.equal(await sendEmail({ to: 'test@example.com', subject: 'Must not send', text: 'Isolated gate test' }), false);
  process.env.EMAIL_DELIVERY_VERIFIED = 'true';
  assert.equal(emailEnabled(), true);
  delete process.env.EMAIL_FROM;
  assert.equal(emailEnabled(), false);
  console.log('EMAIL GATE OK: configuration alone cannot enable delivery. No external email sent.');
} finally {
  for (const [key, value] of [['RESEND_API_KEY', old.key], ['EMAIL_FROM', old.from], ['EMAIL_DELIVERY_VERIFIED', old.verified]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

}
main().catch((e) => { console.error(e); process.exitCode = 1; });
