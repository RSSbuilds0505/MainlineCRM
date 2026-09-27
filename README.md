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
