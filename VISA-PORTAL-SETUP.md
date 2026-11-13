# JIT Travels visa portal

This is a small, static Vanilla JavaScript application that uses the existing website hosting and Supabase. It adds these paths without replacing the corporate pages:

- Staff sign-in: `/visa-tracker/login/`
- Staff tracker: `/visa-tracker/staff/`
- Client portal: `/visa-tracker/portal/` (temporarily unavailable)

The repository contains public Supabase browser settings. Database migrations, Edge Function deployment, secrets, and email delivery configuration must still be verified in the target Supabase project.

## What stays simple

- The pages use plain HTML, CSS, and JavaScript. No build step or frontend framework is required.
- Supabase handles staff passwords, sessions, and the database.
- Resend sends one welcome email when a new application is registered. Staff communicate subsequent updates manually.
- An administrator invites staff from the staff portal; public staff sign-up is disabled and each invited person sets their own password.
- One client email address has one client record in this initial version.
- Client portal access is temporarily disabled, including for previously enabled clients; staff access is unchanged.
- The corporate website pages and current `CNAME` are left untouched.

## Connect Supabase

1. In Supabase, open **Project Settings → API** and copy the project URL and **publishable key**. Put them into `visa-tracker/supabase-config.js`.
   - These are public browser values. Never put a service-role key in this file.
2. Open **SQL Editor** and run the migrations in order: `supabase/migrations/20261106000100_visa_tracker.sql`, `supabase/migrations/20261108000100_staff_invites.sql`, `supabase/migrations/20261111000100_visitor_checklist.sql`, and `supabase/migrations/20261113000100_welcome_email.sql`. For an existing deployment, run only the migrations not already applied. Back up the database first.
3. In **Authentication → Settings**, disable public sign-ups. Set the site URL to `https://www.jitgroupofcompanies.com` and allow these redirects:
   - `https://www.jitgroupofcompanies.com/visa-tracker/login/`
   - For local tests only, allow the matching `http://localhost:8000/visa-tracker/...` URLs.
4. Create the first administrator in **Authentication → Users** with a strong password. Then run this in the SQL Editor, replacing the email and name with the real administrator details:

   ```sql
   insert into public.profiles (id, email, full_name, role)
   select id, lower(email), 'Administrator name', 'admin'
   from auth.users
   where lower(email) = lower('ADMIN_EMAIL');
   ```

5. To add staff, sign into the tracker as an administrator, open **Staff**, and send an invitation. The staff member sets their password from the email link. Do not give out administrator access to ordinary staff. To disable staff access, set `profiles.status` to `disabled` and disable that Auth user.
6. To use the tracker locally, serve the repository root over HTTP (for example `python -m http.server 8000`) and open `/visa-tracker/login/`. ES modules and Supabase cannot be tested from a `file://` URL.

If a staff member is returned to sign-in, check that their Auth user has a matching `profiles` row with the same user ID, role `admin` or `staff`, and status `active`. Creating an Auth user alone does not grant tracker access. If the sign-in session is missing, check that browser storage and cookies are allowed for the website. Do not change access policies to bypass these checks.

## Connect Resend and email

1. Verify `jitgroupofcompanies.com` in Resend and publish the SPF/DKIM records Resend provides. Confirm the sender address `VISAAPPLICATION@jitgroupofcompanies.com` is permitted by the verified domain.
2. In Supabase **Authentication → SMTP Settings**, configure Resend SMTP with the verified sender for staff invitations and password recovery.
3. In Supabase **Edge Functions**, create functions named `client-access` and `staff-invite`, copying in `supabase/functions/client-access/index.ts` and `supabase/functions/staff-invite/index.ts`.
4. Add these Edge Function secrets:
   - `RESEND_API_KEY` — secret Resend API key; server-side only.
   - `APP_BASE_URL` — `https://www.jitgroupofcompanies.com`.
   - `EMAIL_SENDING_ENABLED` — leave unset/false until Resend verifies the sender domain and delivery has been tested; then set to `true`.
   - `WELCOME_WEBHOOK_SECRET` — a long random secret shared only with the Supabase database webhook.
   Supabase supplies its own server-side project URL and service keys to Edge Functions. Do not copy them into the website.
5. Deploy both functions. Deploy `client-access` with JWT verification disabled at the gateway as specified in `supabase/config.toml` so the database webhook can reach it. The function verifies staff sessions and roles or the database webhook secret itself.
6. Create a Supabase **Database Webhook** on `public.email_notifications`, for **INSERT**, using POST to `https://<project-ref>.supabase.co/functions/v1/client-access`. Set `Content-Type: application/json` and `x-welcome-secret` to the same value as `WELCOME_WEBHOOK_SECRET`. Protect the webhook configuration and secret. The function ignores non-welcome records. The staff page also requests sending immediately after registration; the database webhook covers registrations when the browser closes. Both use the same duplicate protection.
7. Test with non-sensitive records before enabling sending. A unique welcome record per application and a Resend idempotency key prevent duplicate welcome emails. `sent` means Resend accepted the message, not that it was delivered. If sending fails, active staff can retry on the application page. A retry more than 23 hours after the first provider request is blocked; check Resend before taking further action. Existing applications do not receive welcome emails automatically.

## Host and deployment

The repository is a static website with a `CNAME` file. No Cloudflare Pages/Workers config, build script, or deployment workflow was present in the inspected project. These tracker pages need no build step and are placed under the existing site root; they will be available at the paths above when that root is published. The legacy `visa-tracker.html` entry links to the Supabase staff and client pages.

No hosting or Cloudflare setting was changed and nothing was deployed from this workspace. Before publishing, confirm the current hosting project serves the repository root and preview the three paths.

## Security boundaries

- Server-enforced Supabase RLS controls staff reads and writes. The welcome migration temporarily blocks all client reads, including existing client sessions, without changing historical access flags.
- Internal notes and payment amounts use a staff-only table. Document comments are not exposed in the client portal.
- Staff roles live in `profiles`; a user cannot grant themselves a role from the browser.
- The welcome email function checks the caller's Supabase session and active staff profile, or the database webhook secret, before sending.
- No passport, bank statement, or uploaded document storage is included.

## Before using real records

Test with a few non-sensitive records: denied staff access, staff sign-in and password reset, disabled client access, welcome email content and duplicate prevention, document progression gates, and manual staff updates. Do not migrate existing clients until the Supabase configuration and tests are complete.

## UK visitor checklist update

For an existing deployment, run `supabase/migrations/20261111000100_visitor_checklist.sql` once in the Supabase SQL Editor before publishing the updated interface. It preserves existing checklist entries and statuses, adds optional case-specific guidance items to existing UK Standard Visitor applications, and updates the template for new applications. It also permits choosing Verified directly and prevents application-stage updates before the checklist is unlocked. The original migrations must already be applied; do not rerun them.

The checklist reflects the [UKVI supporting documents guidance](https://www.gov.uk/government/publications/visitor-visa-guide-to-supporting-documents/guide-to-supporting-documents-visiting-the-uk), checked 11 November 2026. A valid passport or other accepted travel document is required; other evidence varies by circumstances. The client information form is a JIT operational requirement, not a UKVI requirement. Staff should review each case and mark relevant evidence as required when appropriate. Existing requirements and progression gates remain unchanged.

Staff open a separate application page from the client list. The full checklist is shown first; application progress is shown only after the required, applicable documents are verified and staff click Proceed to visa application. Existing applications already marked as started remain unlocked.
