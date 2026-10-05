# Customer installation and handoff

Mainline serves one provider team and its client companies per installation. Each customer must receive a separate Supabase project and Vercel project. Never connect two independent customer installations to the same database or storage bucket. There is no shared SaaS signup or subscription billing in this version.

## Provision

1. Create a Supabase project in the customer's agreed account and region.
2. Create a Vercel project from this repository, using Node 22. Set the variables from `.env.example` in the production environment. Keep database credentials, the service-role key, notification credentials, and the cron secret server-side. Generate a unique random cron secret of at least 32 characters for each installation.
3. Set `APP_URL` to the final HTTPS origin. Set optional branding variables before deploying. Configure a verified transactional email sender for production.
4. Run `npm run check:installation` locally with the installation's `.env`. This validates configuration without printing secrets; it does not verify connections.
5. Deploy on Vercel. Set Supabase's Site URL to `APP_URL`, add `APP_URL/auth/callback` to the redirect allowlist, and disable public signup. Keep email confirmation enabled.
6. Call `POST /api/setup` using the installation's cron secret in the Authorization header. Treat the returned owner sign-in link as a credential: deliver it privately and never put it in logs, tickets, or source control. Setup creates migrations, the service catalog, private attachment storage, and the first owner. Repeating setup preserves existing data.

## Onboard

Use Setup to add pods, their CSMs, implementers, clients and client portal users. Confirm work emails and intended access before creating accounts. Record weekly capacity and platform skills for routing. Set client prices, monthly credits and staff pay rates with the owner. Do not use placeholder prices or invented compensation.

A Solutions Lead manages all pods. A CSM manages their pod. An Implementer works their pod and assigned requests. A client sees their own company. Only the owner sees financial data or manages other owners.

## Acceptance checks

- Owner sign-in and sign-out work. Verify a first-time invitation and expired-link recovery with a disposable, authorized test account.
- Client submits a request; CSM scopes it; routing assigns an implementer and a distinct QA reviewer; work passes QA and the client accepts it.
- A second client cannot see the first client's requests, comments or attachments. Client views hide internal notes, time logs and financial data.
- Support tickets skip scoping and QA, preserve credits, and can be resolved, reopened and confirmed.
- Upload a small screenshot and download it. Confirm internal attachments are hidden from clients.
- Send the Setup email and Slack tests to agreed destinations. Confirm real delivery, not merely configured keys.
- Verify business hours and SLA targets, the Vercel cron configuration and alerts. Confirm the hosting plan supports the scheduled job.
- Export time records as owner; verify worker access restrictions.
- Confirm backup and recovery arrangements for the customer's Supabase plan; perform a restore rehearsal in a separate test project.
- Confirm desktop and mobile usability using the customer branding.

## Release and operations

Run `npm run typecheck`, `npm test`, and `npm run build` before release. GitHub Actions runs these checks on pushes and pull requests. Vercel deployments remain managed by the existing Vercel project; this workflow does not create hosting accounts or deploy independently.

Before upgrades, back up the database and validate migrations on a separate test project. Review deploy logs and verify key workflows after upgrading. Use `/api/diag` only with the cron secret; its repair mode terminates database sessions and should be reserved for an identified incident.

Commercial onboarding still requires agreed pricing, support terms, data ownership, account ownership and an authorized payment process. Mainline does not collect subscriptions or manage licenses automatically.
