# Mainline CRM

Client and team portal for Rogers Systems Solutions' managed CRM service. Clients sign in to submit requests, answer questions and approve work. The team triages, scopes, routes, delivers, QAs and logs time on the same requests.

## Stack

Next.js 14 (App Router) on Vercel · Supabase Auth and Postgres · Drizzle ORM · Resend email (optional) · Anthropic for AI triage (optional) · Slack webhook alerts (optional).

## Who can do what

| Role | Can |
| --- | --- |
| Client (portal user) | Submit requests for their own company, reply to questions, accept or request revisions, cancel before work starts, flag a concern. Sees only their company's requests and never sees internal notes, time, or other clients. |
| Implementer | See their pod's requests and anything assigned to them, start work, ask the client a question, log time, submit for QA, review QA when assigned, log a request (goes to triage). |
| CSM | Everything an implementer can, plus triage, scope, assign, log a client's emailed answer, record sign-off. |
| Solutions Lead | Everything above for every pod, plus Setup and the Dashboard. |
| Owner | Everything, plus pay rates, client prices and margin. Only the owner can add or change another owner. |

Access is enforced three ways: every write goes through `lib/workflow.ts` role checks; every page and API checks the signed-in user server-side; and Postgres Row Level Security blocks anyone holding the public key from reading other companies' data or writing anything directly.

## Support tickets

Clients open tickets from **Get support** in the portal; CSMs, leads and the owner can log one for a client from **Log ticket**.
Tickets are separate from service requests:

- No credits, no triage and no scoping. The resolution clock starts immediately: Urgent 4, High 8, Normal 16, Low 24 hours (business hours by default).
- Routing assigns an implementer in the client's pod at once, preferring someone who knows the client's platform. If nobody has capacity, the ticket waits under **Needs assignment** and leads are emailed.
- No QA step. The implementer marks it resolved with a note; the client confirms the fix or reopens it. Unconfirmed tickets close after 5 days.
- Urgent and High tickets, and any ticket nobody could take, are posted to Slack.

Under the hood a ticket is a request on the built-in `support` service (hidden from the catalog) with a `category`.

## Screenshots, files and videos

Clients and the team can attach files to any request or support ticket: click to choose, drag and drop, or paste a screenshot anywhere on the page (Ctrl+V / Cmd+V). The new-request and support forms accept attachments and a Loom link too.

- Files go to a **private** Supabase Storage bucket named `attachments` (created by `/api/setup`). The browser uploads straight to storage with a one-time signed token, so large files never pass through Vercel. Pages show files through signed links that expire after an hour.
- Allowed: PNG, JPG, GIF, WebP, HEIC, MP4, MOV, WebM, PDF, TXT, CSV and Office files, up to 50 MB each (the Supabase free-plan limit). The server re-checks the stored file's real type and size before recording it.
- Loom, YouTube and Vimeo links play inline. Other links (Google Drive and so on) show as link cards.
- Staff can mark an attachment **Internal only**; clients never see those (enforced in code and by Row Level Security).
- The person who added an attachment, or a lead, can remove it.

## Environment variables

See `.env.example`. Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (Supabase transaction pooler URI), `APP_URL`, `OWNER_EMAIL`, `OWNER_NAME`, `CRON_SECRET`.

## First deploy

1. Set the environment variables in Vercel and deploy.
2. Run setup once (creates tables, access rules, the service catalog and the owner account, and returns a sign-in link):
   `curl -X POST https://YOUR-APP/api/setup -H "Authorization: Bearer $CRON_SECRET"`
3. In Supabase: **Authentication → URL Configuration**: set Site URL to `APP_URL` and add `APP_URL/auth/callback` to Redirect URLs. **Authentication → Sign In / Providers → Email**: turn off "Allow new users to sign up" (Mainline creates accounts itself).
4. Sign in as the owner, open **Setup**, add your team, clients and portal users.

## Email

Without Resend, sign-in emails come from Supabase's built-in mailer (low hourly limit) and Setup shows a copyable sign-in link for each new person. For production, add `RESEND_API_KEY` and a verified sending domain in `EMAIL_FROM`; Mainline then sends its own sign-in links and all notifications.

## Scheduled work

`vercel.json` runs `/api/cron/sweep` daily (escalations, auto-close after 5 days, monthly credit reset). Staff page loads also run the sweep at most every 5 minutes, so it stays current without a paid cron plan.

## Development

```
npm install
npm test            # workflow, permissions, SLA clock and Row Level Security on an embedded Postgres
npm run typecheck
npm run build
npm run db:generate # after editing lib/db/schema.ts; also re-embeds migrations for /api/setup
```

## Customer installations

Use a separate Supabase and Vercel project for each customer. Follow [the customer installation and acceptance guide](docs/customer-installation.md). Installation branding is configurable with `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_COMPANY_NAME` and `NEXT_PUBLIC_BRAND_ATTRIBUTION`; existing RSS branding remains the default. Rebuild after changing these values.

`npm run check:installation` validates the configuration in a local `.env` without printing credentials. GitHub Actions verifies types, workflows, database setup and the production build on pushes and pull requests. Separate customer installations do not require shared SaaS tenancy; subscription collection is not included.

## RSS pilot and project budgets

See [RSS pilot rollout](docs/rss-pilot-rollout.md) for deployment, migrations, email verification and role instructions. Project accounts track a lifetime hour allocation independently of monthly credits. Hourly rates and project values are Owner-only. After deploying this release, an Owner applies the additive migration at `/app/upgrade`. Set `EMAIL_DELIVERY_VERIFIED=true` only after receiving the verification email.
