# RSS pilot rollout

## Release sequence and recovery

The project budget migration is additive: all existing accounts default to retainers; request history and credits remain unchanged. Project pricing uses a separate Owner-only table. The app tracks one lifetime project allocation per client account. Use another account for a later contract; do not convert an account with existing request history between billing models.

Before applying migrations, confirm a current Supabase backup/export and the recovery process for the actual hosting plan. A restore rehearsal needs a separate test project; automated embedded-database tests do not establish production recovery readiness. Deploy the tested commit through the existing GitHub/Vercel integration, then sign in as Owner and open `/app/upgrade` to apply the bundled migrations. The upgrade action is Owner-only and serializes concurrent submissions. New pages require the migration; schedule this release during a quiet period. If needed, roll the Vercel deployment back to the preceding release. Its code ignores the new columns/table; retain the additive migration rather than deleting production data.

## Installation configuration

Keep installation-specific names, emails, client contract values and credentials in the application's authorized setup and provider interfaces, not in this public repository. Preserve existing Owner access. Add approved staff roles, platforms and weekly capacity without guessing pay rates or sending premature invitations. Configure project accounts with the approved total hours and rate, zero monthly credits, the correct platform and pod. Do not create portal contacts until their identities and access are confirmed.

Solutions Leads are not implementers. Automatic routing needs an authorized implementer with skills, pod and capacity; do not silently change a lead's role to satisfy the launch checklist. Owner/lead can assign work manually for a controlled pilot.

## Email activation

1. In the authorized Resend account, add the installation's sending domain and obtain the exact DKIM and sending-domain records generated for that domain/region. Do not guess DNS values.
2. Apply those records in the domain's DNS provider and verify the domain in Resend.
3. Configure `RESEND_API_KEY`, `EMAIL_FROM`, and `EMAIL_TEST_TO` with the approved verification recipient as server-only Vercel production variables. Leave `EMAIL_DELIVERY_VERIFIED=false`.
4. Redeploy. In Setup, send the verification email. Provider acceptance alone is not proof of inbox delivery; confirm receipt and inspect Resend delivery status.
5. Only after receipt, set `EMAIL_DELIVERY_VERIFIED=true` and redeploy. This enables invitations, sign-in email via Resend and workflow notifications. Sign-in falls back to the Supabase mailer while unverified, subject to its delivery limits.

Keep secret values out of source control, screenshots and chat. API keys are entered through secure provider interfaces. Domain records and delivered messages cannot be verified without authenticated provider access.

## Quick start by role

**Owner:** Configure accounts and contract terms in Setup. Use each client page and Dashboard for logged/remaining project hours and budget warnings. Export project budgets from Dashboard and time from Time. Set approved staff pay rates before relying on margin. Financial figures are estimates, not invoices or recorded payments.

**Solutions Lead:** Manage pods, team and clients; triage, scope and assign work. Monitor project hours and the board. Contract hours and pricing changes require Owner. Confirm an independent QA reviewer.

**Implementer:** Open assigned work, start it, ask questions, attach evidence, and log time against the correct request. Submit service work for QA. Resolve support tickets with a client-facing note. Budget warnings do not prevent honest logging of overrun time.

**Client:** After receiving authorized access, submit requests or support tickets, reply to questions, review delivered work, and accept or request revisions. Project clients see their own aggregate allocation; they do not see internal notes, individual time entries or pricing.

## Acceptance and launch gate

Use an isolated database/test accounts for lifecycle, role, cross-client and attachment checks. Run `npm run typecheck`, `npm test` and `npm run build`. Verify project scoping consumes zero monthly credits; monthly and manual resets preserve project allocations; 80%, exhausted and over-budget warnings work; rates/value are absent for non-Owners; exports honor role restrictions and escape spreadsheet formulas.

In production verify the exact Vercel commit, Owner session, migration success, approved profiles, project hours/value, dashboard, project CSV and time CSV. Test live private storage and invitation delivery with an authorized disposable account before inviting clients. The isolated in-memory storage test is not a live Supabase upload verification.

Before pilot rollout, obtain the implementer roster and pilot client portal contact, confirm operational SLAs/QA ownership, verify email delivery, and establish backup/restore readiness. Before commercial rollout, agree customer pricing, support/data ownership and a payment process. Provision separate Supabase and Vercel projects for each software customer. This release does not provide shared tenancy, invoices, payment collection or license management.
