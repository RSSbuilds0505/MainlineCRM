/** Browser walkthrough: attaching screenshots and Loom links from forms, the page, and the clipboard; plus the new click paths. */
import { chromium, type Page, type BrowserContext } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';

const people = JSON.parse(readFileSync('tests/e2e/people.json', 'utf8')) as Record<string, string>;
const BASE = 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? '/tmp/claude-0/shots-attach';
mkdirSync(SHOTS, { recursive: true });
const problems: string[] = [];
let n = 0;
const LOOM = 'https://www.loom.com/share/0123456789abcdef0123456789abcdef';

function cookieFor(id: string): string {
  const session = { access_token: id, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id } };
  return 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
}
async function as(ctx: BrowserContext, who: string): Promise<Page> {
  await ctx.clearCookies();
  await ctx.addCookies([{ name: 'sb-127-auth-token', value: cookieFor(people[who]), url: BASE }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push(`[${who}] pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/loom\.com|youtube|Failed to load resource|compute-pressure|Failed to fetch RSC payload/.test(m.text())) problems.push(`[${who}] console ${m.text()}`); });
  p.on('response', (r) => { if (r.status() >= 500) problems.push(`[${who}] ${r.status()} ${r.url()}`); });
  p.on('dialog', (d) => d.accept());
  return p;
}
const shot = (p: Page, name: string): Promise<Buffer> => p.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
const flash = async (p: Page): Promise<string> => (await p.locator('.flash').first().textContent({ timeout: 3000 }).catch(() => '')) ?? '';

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // A real PNG to upload: a picture of the login page.
  const lp = await ctx.newPage(); await lp.goto(`${BASE}/login`); const png = await lp.screenshot(); await lp.close();

  let p = await as(ctx, 'client');
  await p.goto(`${BASE}/portal/support/new`);
  await p.locator('label.choice', { hasText: 'Something is broken' }).click();
  await p.fill('input[name=title]', 'Lead form shows an error');
  await p.fill('textarea[name=description]', 'See the screenshot and the Loom. Details: https://example.com/form-page.');
  await p.locator('.attach input[type=file]').setInputFiles({ name: 'form-error.png', mimeType: 'image/png', buffer: png });
  await p.locator('.uploads li.done').first().waitFor({ timeout: 15000 });
  await p.fill('input[name=videoUrl]', LOOM);
  await shot(p, 'client-form-with-attachments');
  await p.click('button:has-text("Open support ticket")');
  await p.waitForURL('**/portal/requests/**');
  const id = p.url().split('/').pop()!.split('?')[0];
  const reqUrl = `${BASE}/portal/requests/${id}`;
  console.log('ticket with attachments:', await flash(p), '| images:', await p.locator('.gallery .thumb img').count(), '| embeds:', await p.locator('.gallery .embed iframe').count());
  console.log('description link clickable:', await p.locator('a.autolink[href="https://example.com/form-page"]').count() === 1);
  const imgOk = await p.locator('.gallery .thumb img').first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0);
  console.log('screenshot renders:', imgOk);

  // Paste a screenshot from the clipboard onto the ticket page.
  await p.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, png.toString('base64'));
  await p.waitForFunction(() => document.querySelectorAll('.gallery .thumb img').length >= 2, null, { timeout: 15000 });
  console.log('pasted screenshot attached; images now:', await p.locator('.gallery .thumb img').count(), '| name:', (await p.locator('.gallery figcaption .nm').nth(2).textContent())?.trim());
  // Upload with the picker on the page, plus a PDF.
  await p.locator('.attach input[type=file]').setInputFiles([{ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%test\n') }]);
  await p.waitForFunction(() => document.querySelectorAll('.gallery .att').length >= 4, null, { timeout: 15000 });
  // A file type we refuse.
  await p.locator('.attach input[type=file]').setInputFiles([{ name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<b>x</b>') }]);
  console.log('refused html shows:', (await p.locator('.attach .err-text').textContent())?.trim());
  await p.fill('form:has(button:has-text("Send")) textarea[name=body]', 'Here is the Zap run log: https://zapier.com/app/history/123');
  await p.click('button:has-text("Send")'); await p.waitForLoadState('networkidle');
  await shot(p, 'client-ticket-gallery');
  await p.close();

  p = await as(ctx, 'imp');
  await p.goto(`${BASE}/app/requests/${id}`);
  console.log('implementer sees attachments:', await p.locator('.gallery .att').count(), '| comment link clickable:', await p.locator('.thread a.autolink').count());
  await p.fill('form.linkform input[name=url]', 'https://drive.google.com/file/d/abc123/view');
  await p.locator('form.linkform input[name=internal]').check();
  await p.click('form.linkform button:has-text("Attach link")'); await p.waitForLoadState('networkidle');
  console.log('internal link:', await flash(p), '| staff count:', await p.locator('.gallery .att').count());
  await p.locator('.attach input[type=checkbox]').check();
  await p.locator('.attach input[type=file]').setInputFiles({ name: 'hubspot-settings.png', mimeType: 'image/png', buffer: png });
  await p.waitForFunction(() => document.querySelectorAll('.gallery .att').length >= 6, null, { timeout: 15000 });
  await shot(p, 'implementer-ticket-gallery');
  await p.close();

  p = await as(ctx, 'client');
  await p.goto(reqUrl);
  console.log('client sees (internal hidden):', await p.locator('.gallery .att').count(), '| internal tag visible:', await p.locator('.tag.int').count());
  await p.locator('.gallery figure', { hasText: 'notes.pdf' }).locator('button:has-text("Remove")').click(); await p.waitForLoadState('networkidle');
  console.log('client removed own file:', await flash(p), '| now:', await p.locator('.gallery .att').count());
  await p.close();

  p = await as(ctx, 'client2');
  const r2 = await p.goto(reqUrl);
  console.log('other client blocked:', (await p.locator('h1').first().textContent())?.trim(), r2?.status());
  const probe = await p.evaluate(async (rid) => (await fetch('/api/uploads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: rid, name: 'x.png', size: 10, type: 'image/png' }) })).status, id);
  console.log('other client cannot get an upload token for it:', probe);
  await p.close();

  // Click paths
  p = await as(ctx, 'owner');
  await p.goto(`${BASE}/app/dashboard`); await shot(p, 'owner-dashboard');
  await p.click('a.kpi:has-text("Open support tickets")'); await p.waitForURL('**/app/board?kind=support'); await p.locator('.board').waitFor(); await p.waitForLoadState('networkidle');
  console.log('dashboard tile -> board filtered to support:', await p.locator('.board .card').count(), 'cards');
  await shot(p, 'board-support-filter');
  await p.click('a.fchip:has-text("Mine")'); await p.waitForURL(/who=/); console.log('Mine chip keeps the support filter and adds me:', new URL(p.url()).search.includes('kind=support'));
  await p.goto(`${BASE}/app/clients`);
  await p.locator('tr.rowlink', { hasText: 'Harbor Dental' }).click({ position: { x: 320, y: 12 } });
  await p.waitForURL('**/app/clients/**'); console.log('clicking anywhere on a client row opens:', (await p.locator('h1').textContent())?.trim());
  await shot(p, 'client-account-page');
  await p.click('a.kpi:has-text("Open, view on board")'); await p.waitForURL(/board\?org=/); await p.locator('.fchip.on').first().waitFor(); console.log('client page -> board filter:', (await p.locator('.fchip.on').first().textContent())?.trim());
  await p.goto(`${BASE}/app/requests/${id}`);
  await p.click('.head a[href^="/app/clients/"]'); await p.waitForURL(/\/app\/clients\//); await p.locator('h1', { hasText: 'Harbor Dental' }).waitFor(); console.log('request header client name ->', (await p.locator('h1').textContent())?.trim());
  await p.close();

  p = await as(ctx, 'client');
  await p.goto(`${BASE}/portal/services`);
  await p.locator('a.sku').first().click(); await p.waitForURL('**/portal/new?sku=**'); await p.locator('form#nr').waitFor();
  console.log('service card -> request form with service preselected:', await p.locator('input[name=skuId]:checked').count() === 1);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(reqUrl); await shot(p, 'mobile-client-gallery');
  await p.close();

  await browser.close();
  console.log('\nPROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
}
main().catch((e) => { console.error(e); process.exit(1); });
