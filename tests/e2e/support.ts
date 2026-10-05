/** Browser walkthrough of support tickets: client opens one, implementer resolves, client reopens and confirms, CSM logs one. */
import { chromium, type Page, type BrowserContext } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';

const people = JSON.parse(readFileSync('tests/e2e/people.json', 'utf8')) as Record<string, string>;
const BASE = 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? '/tmp/claude-0/shots-support';
mkdirSync(SHOTS, { recursive: true });
const problems: string[] = [];
let n = 0;

function cookieFor(id: string): string {
  const session = { access_token: id, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id } };
  return 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
}
async function as(ctx: BrowserContext, who: string): Promise<Page> {
  await ctx.clearCookies();
  await ctx.addCookies([{ name: 'sb-127-auth-token', value: cookieFor(people[who]), url: BASE }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(`[${who}] pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') problems.push(`[${who}] console ${m.text()}`); });
  p.on('response', (r) => { if (r.status() >= 500) problems.push(`[${who}] ${r.status()} ${r.url()}`); });
  p.on('dialog', (d) => d.accept());
  return p;
}
const shot = (p: Page, name: string): Promise<Buffer> => p.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
const flash = async (p: Page): Promise<string> => (await p.locator('.flash').first().textContent({ timeout: 3000 }).catch(() => '')) ?? '';
const fact = async (p: Page, label: string): Promise<string> => ((await p.locator(`dt:text-is("${label}") + dd`).first().textContent()) ?? '').trim();

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  let p = await as(ctx, 'client');
  await p.goto(`${BASE}/portal`); await shot(p, 'client-home');
  await p.goto(`${BASE}/portal/new`); await p.click('a.pick:has-text("broken")'); await p.waitForURL('**/portal/new/support'); await shot(p, 'client-support-form');
  await p.locator('label.choice', { hasText: 'Something is broken' }).click();
  await p.fill('input[name=title]', 'Demo request form is not creating contacts');
  await p.fill('textarea[name=description]', 'Since this morning, submissions on the website demo form show a thank-you page but no contact is created in HubSpot.');
  await p.locator('label.choice', { hasText: 'High' }).click();
  await p.click('button:has-text("Open support ticket")');
  await p.waitForURL('**/portal/requests/**');
  const id = p.url().split('/').pop()!.split('?')[0];
  console.log('client opened ticket:', await flash(p), '| status:', await fact(p, 'Status'), '| credits:', await fact(p, 'Credits'), '| specialist:', await fact(p, 'Specialist'));
  await shot(p, 'client-ticket-open');
  const specialist = await fact(p, 'Specialist');
  await p.close();

  const impKey = specialist === 'Priya Shah' ? 'imp' : 'imp2';
  p = await as(ctx, impKey);
  await p.goto(`${BASE}/app`); await shot(p, 'implementer-queue');
  console.log('implementer queue shows ticket:', (await p.locator('.reqs.todo .req', { hasText: 'Start this ticket' }).count()) === 1);
  await p.goto(`${BASE}/app/requests/${id}`);
  console.log('QA button present:', await p.locator('button:has-text("Submit for QA")').count());
  await p.click('button:has-text("Start on this ticket")'); await p.waitForLoadState('networkidle');
  await p.fill('#tl-hours', '0.75'); await p.fill('input[name=note]', 'Traced the form to a disconnected workflow');
  await p.click('button:has-text("Log time")'); await p.waitForLoadState('networkidle');
  await shot(p, 'implementer-ticket');
  await p.fill('form:has(button:has-text("Mark resolved")) textarea[name=body]', 'The form was disconnected from the lead workflow after a property rename. Reconnected it and replayed the 6 missed submissions.');
  await p.click('button:has-text("Mark resolved")'); await p.waitForLoadState('networkidle');
  console.log('resolve:', await flash(p), '| status:', await fact(p, 'Status'));
  await p.close();

  p = await as(ctx, 'client');
  await p.goto(`${BASE}/portal/requests/${id}`); await shot(p, 'client-confirm');
  await p.fill('form:has(button:has-text("Reopen the ticket")) textarea[name=body]', 'New submissions work, but the 6 replayed contacts have no owner.');
  await p.click('button:has-text("Reopen the ticket")'); await p.waitForLoadState('networkidle');
  console.log('client reopened:', await flash(p), '| status:', await fact(p, 'Status'));
  await p.close();

  p = await as(ctx, impKey);
  await p.goto(`${BASE}/app/requests/${id}`);
  await p.fill('form:has(button:has-text("Mark resolved")) textarea[name=body]', 'Assigned the 6 contacts to the right owners.');
  await p.click('button:has-text("Mark resolved")'); await p.waitForLoadState('networkidle');
  await p.close();

  p = await as(ctx, 'client');
  await p.goto(`${BASE}/portal/requests/${id}`);
  await p.click('button:has-text("Yes, it is fixed")'); await p.waitForLoadState('networkidle');
  console.log('client confirmed:', await flash(p), '| status:', await fact(p, 'Status'));
  await shot(p, 'client-closed');
  await p.close();

  p = await as(ctx, 'client2');
  await p.goto(`${BASE}/portal/requests/${id}`);
  console.log('other client sees:', (await p.locator('h1').first().textContent())?.trim(), '| leaked:', (await p.content()).includes('Demo request form'));
  await p.close();

  p = await as(ctx, 'csm');
  await p.goto(`${BASE}/app/new/support`); await shot(p, 'csm-log-ticket');
  await p.selectOption('select[name=orgId]', { label: 'Ridgeview Nonprofit' });
  await p.fill('input[name=contact]', 'Ben Ortiz, phone');
  await p.locator('label.choice', { hasText: 'Access or login' }).click();
  await p.fill('input[name=title]', 'Volunteer coordinator locked out');
  await p.fill('textarea[name=description]', 'Ben called: the coordinator gets a permissions error after the password reset.');
  await p.locator('label.choice', { hasText: 'Urgent' }).click();
  await p.click('button:has-text("Open support ticket")'); await p.waitForURL('**/app/requests/**');
  console.log('csm logged ticket:', await flash(p), '| type:', await fact(p, 'Type'), '| came in by:', await fact(p, 'Came in by'));
  await shot(p, 'csm-ticket');
  await p.goto(`${BASE}/app`); await shot(p, 'csm-queue');
  await p.close();

  p = await as(ctx, 'imp');
  const r = await p.goto(`${BASE}/app/new/support`); await p.waitForURL(/\/app$/, { timeout: 5000 }).catch(() => undefined);
  console.log('implementer visiting log-ticket page ends at', new URL(p.url()).pathname, r?.status());
  await p.close();

  p = await as(ctx, 'owner');
  await p.goto(`${BASE}/app`); await shot(p, 'owner-attention');
  await p.goto(`${BASE}/app/dashboard`); await p.waitForURL(/\/app#overview|\/app$/); await shot(p, 'owner-dashboard');
  await p.goto(`${BASE}/app/setup`);
  console.log('support service hidden from Setup catalog:', !(await p.content()).includes('>Support ticket<'));
  await p.close();

  p = await as(ctx, 'client');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${BASE}/portal/new/support`); await shot(p, 'mobile-client-support');
  await p.goto(`${BASE}/portal/new`);
  console.log('support hidden from paid service picker:', !(await p.content()).includes('value="support"'));
  await p.close();

  await browser.close();
  console.log('\nPROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
}
main().catch((e) => { console.error(e); process.exit(1); });
