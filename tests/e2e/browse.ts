import { chromium, type Page, type BrowserContext } from 'playwright-core';
import { readFileSync } from 'node:fs';

const people = JSON.parse(readFileSync('tests/e2e/people.json', 'utf8')) as Record<string, string>;
const BASE = 'http://localhost:3000';
const SHOTS = '/tmp/claude-0/shots';
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
async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
}
async function flash(p: Page): Promise<string> {
  return (await p.locator('.flash').first().textContent({ timeout: 2000 }).catch(() => '')) ?? '';
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  let p = await as(ctx, 'client');
  await p.goto(`${BASE}/`); await p.waitForURL('**/portal'); await shot(p, 'client-home-empty');
  await p.goto(`${BASE}/portal/new`); await shot(p, 'client-new-chooser');
  await p.click('a.pick:has-text("built or changed")'); await p.waitForURL('**/portal/new/request'); await shot(p, 'client-new');
  await p.fill('input[name=title]', 'Route new leads by region');
  await p.fill('textarea[name=description]', 'New inbound leads should go to the East or West rep based on state.');
  await p.locator('label.sku', { hasText: 'Workflow build or fix' }).click();
  await p.click('button:has-text("Submit request")');
  await p.waitForURL('**/portal/requests/**');
  const reqId = p.url().split('/').pop()!.split('?')[0]; const reqUrl = `${BASE}/portal/requests/${reqId}`;
  console.log('client submitted:', await flash(p));
  await shot(p, 'client-request-received');
  await p.close();

  p = await as(ctx, 'csm');
  await p.goto(`${BASE}/app`); await shot(p, 'csm-queue');
  await p.goto(`${BASE}/app/requests/${reqId}`);
  await shot(p, 'csm-confirm');
  await p.click('button:has-text("Confirm and schedule")'); await p.waitForLoadState('networkidle'); console.log('confirm and schedule:', await flash(p));
  await shot(p, 'csm-after-scope');
  const assigneeName = (await p.locator('dt:has-text("Implementer") + dd').textContent())?.trim();
  const qaName = (await p.locator('dt:has-text("QA reviewer") + dd').textContent())?.trim();
  console.log('assigned to', assigneeName, 'qa', qaName);
  await p.goto(`${BASE}/app/new`); await shot(p, 'csm-new-chooser');
  await p.goto(`${BASE}/app/new/request`); await shot(p, 'csm-log-request');
  await p.fill('input[name=title]', 'Quarterly pipeline report');
  await p.selectOption('select[name=skuId]', 'hs-report');
  await p.fill('input[name=contact]', 'Amy Carter');
  await p.click('button:has-text("Log request")'); await p.waitForURL('**/app/requests/**'); console.log('csm logged:', await flash(p));
  await p.close();

  const implKey = assigneeName === 'Priya Shah' ? 'imp' : 'imp2';
  const qaKey = qaName === 'Priya Shah' ? 'imp' : qaName === 'Tom Becker' ? 'imp2' : 'owner';
  p = await as(ctx, implKey);
  await p.goto(`${BASE}/app`); await shot(p, 'implementer-queue');
  await p.goto(`${BASE}/app/requests/${reqId}`);
  await p.click('button:has-text("Start work")'); await p.waitForLoadState('networkidle');
  await p.fill('form.composer textarea[name=body]', 'Which states count as East?');
  await p.locator('form.composer input[name=needsAnswer]').check(); await shot(p, 'implementer-composer');
  await p.click('form.composer button:has-text("Send")'); await p.waitForLoadState('networkidle'); console.log('ask:', await flash(p));
  await p.close();

  p = await as(ctx, 'client');
  await p.goto(`${BASE}/portal`); await shot(p, 'client-needs-reply');
  await p.goto(reqUrl);
  await p.fill('textarea[name=body]', 'Everything east of the Mississippi.');
  await p.click('button:has-text("Send answer")'); await p.waitForLoadState('networkidle'); console.log('client answer:', await flash(p));
  await p.close();

  p = await as(ctx, implKey);
  await p.goto(`${BASE}/app/requests/${reqId}`);
  await p.fill('#tl-hours', '2.5'); await p.fill('input[name=note]', 'Built the workflow and tested');
  await p.click('button:has-text("Log time")'); await p.waitForLoadState('networkidle'); console.log('time:', await flash(p));
  await p.click('button:has-text("Submit for QA")'); await p.waitForLoadState('networkidle'); console.log('qa submit:', await flash(p));
  await shot(p, 'implementer-request');
  await p.close();

  p = await as(ctx, qaKey);
  await p.goto(`${BASE}/app/requests/${reqId}`);
  for (const c of await p.locator('input[name=qa]').all()) await c.check();
  await p.fill('form:has(button:has-text("Pass QA")) textarea[name=body]', 'Done. Walkthrough: loom.com/example');
  await p.click('button:has-text("Pass QA and deliver")'); await p.waitForLoadState('networkidle'); console.log('pass qa:', await flash(p));
  await p.close();

  p = await as(ctx, 'client');
  await p.goto(reqUrl); await shot(p, 'client-review');
  await p.click('button:has-text("Accept the work")'); await p.waitForLoadState('networkidle'); console.log('accept:', await flash(p));
  await p.goto(`${BASE}/portal?closed=1`); await shot(p, 'client-home-after');
  await p.goto(`${BASE}/portal/services`); await shot(p, 'client-services');
  const appAttempt = await p.goto(`${BASE}/app`); console.log('client visiting /app ends at', new URL(p.url()).pathname, appAttempt?.status());
  await p.close();

  p = await as(ctx, 'client2');
  await p.goto(reqUrl); console.log('other client opening the ticket sees:', (await p.locator('h1').first().textContent())?.trim(), '| title leaked:', (await p.content()).includes('Route new leads'));
  await p.close();

  p = await as(ctx, 'owner');
  for (const [path, name] of [['/app', 'owner-attention'], ['/app/dashboard', 'owner-dashboard'], ['/app/board', 'owner-board'], ['/app/time', 'owner-time'], ['/app/clients', 'owner-clients'], ['/app/inbox', 'owner-inbox'], ['/app/setup', 'owner-setup'], [`/app/requests/${reqId}`, 'owner-request']] as const) {
    await p.goto(`${BASE}${path}`); await shot(p, name);
  }
  await p.goto(`${BASE}/app/setup?edit=contact:new#edit`);
  await p.fill('#edit input[name=name]', 'Cara Nguyen'); await p.fill('#edit input[name=email]', 'cara@harbordental.com');
  await p.selectOption('#edit select[name=orgId]', { label: 'Harbor Dental' });
  await p.click('#edit button:has-text("Save")'); await p.waitForLoadState('networkidle'); console.log('invite:', await flash(p));
  await shot(p, 'owner-invite-link');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${BASE}/app`); await shot(p, 'mobile-owner');
  await p.close();

  p = await as(ctx, 'client');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${BASE}/portal/new`); await shot(p, 'mobile-client-new');
  await p.locator('details.menu summary').click(); await shot(p, 'mobile-client-menu');
  await p.close();

  const lp = await ctx.newPage(); await ctx.clearCookies();
  await lp.goto(`${BASE}/login`); await shot(lp, 'login');

  await browser.close();
  console.log('\nPROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
}
main().catch((e) => { console.error(e); process.exit(1); });
