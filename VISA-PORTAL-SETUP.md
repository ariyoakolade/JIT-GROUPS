# JIT Travels visa portal

This is a small, static Vanilla JavaScript application that uses the existing website hosting and Supabase. It adds these paths without replacing the corporate pages:

- Staff sign-in: `/visa-tracker/login/`
- Staff tracker: `/visa-tracker/staff/`
- Client progress: `/visa-tracker/portal/`

The Supabase connection is **not configured** in this repository yet. No Supabase project URL, key, database, or email service was supplied or connected. Until configuration is complete, the new portal shows a setup notice and does not load or store client data.

## What stays simple

- The pages use plain HTML, CSS, and JavaScript. No build step or frontend framework is required.
- Supabase handles staff passwords, sessions, the database, and email sign-in links.
- Resend sends client progress links and milestone messages from the verified JIT email address.
- An administrator invites staff from the staff portal; public staff sign-up is disabled and each invited person sets their own password.
- One client email address has one client record in this initial version.
- Clients can view their own checklist, status, and timeline, but cannot change records or see internal notes or payment amounts.
- The corporate website pages and current `CNAME` are left untouched.

## Connect Supabase

1. In Supabase, open **Project Settings → API** and copy the project URL and **publishable key**. Put them into `visa-tracker/supabase-config.js`.
   - These are public browser values. Never put a service-role key in this file.
2. Open **SQL Editor** and run both migrations in order: `supabase/migrations/20261106000100_visa_tracker.sql`, then `supabase/migrations/20261108000100_staff_invites.sql`. They create the tracker tables and permissions. Existing records are not imported.
3. In **Authentication → Settings**, disable public sign-ups. Set the site URL to `https://www.jitgroupofcompanies.com` and allow these redirects:
   - `https://www.jitgroupofcompanies.com/visa-tracker/login/`
   - `https://www.jitgroupofcompanies.com/visa-tracker/portal/`
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

## Connect Resend and email

1. Verify `jitgroupofcompanies.com` in Resend and publish the SPF/DKIM records Resend provides. Confirm the sender address `VISAAPPLICATION@jitgroupofcompanies.com` is permitted by the verified domain.
2. In Supabase **Authentication → SMTP Settings**, configure Resend SMTP with the verified sender. This is used for staff password recovery and client email sign-in.
3. In Supabase **Edge Functions**, create functions named `client-access` and `staff-invite`, copying in `supabase/functions/client-access/index.ts` and `supabase/functions/staff-invite/index.ts`.
4. Add these Edge Function secrets:
   - `RESEND_API_KEY` — secret Resend API key; server-side only.
   - `EMAIL_FROM` — `JIT Travels <VISAAPPLICATION@jitgroupofcompanies.com>`.
   - `APP_BASE_URL` — `https://www.jitgroupofcompanies.com`.
   - `EMAIL_SENDING_ENABLED` — leave unset/false until Resend verifies the sender domain and delivery has been tested; then set to `true`.
   Supabase supplies its own server-side project URL and service keys to Edge Functions. Do not copy them into the website.
5. Deploy both functions. Registration sends the client a one-use sign-in link. Progress changes send a milestone email. Staff can resend a link from the application page. Setting `clients.portal_enabled` to false revokes access immediately, including existing client sessions. Staff invitations use Supabase Auth email delivery.
6. Set the Supabase Auth email-link expiry to a short period (for example, one hour). The link is one-use; the database access flag is checked on every client data request.

## Host and deployment

The repository is a static website with a `CNAME` file. No Cloudflare Pages/Workers config, build script, or deployment workflow was present in the inspected project. These tracker pages need no build step and are placed under the existing site root; they will be available at the paths above when that root is published. The legacy `visa-tracker.html` entry links to the Supabase staff and client pages.

No hosting or Cloudflare setting was changed and nothing was deployed from this workspace. Before publishing, confirm the current hosting project serves the repository root and preview the three paths.

## Security boundaries

- Server-enforced Supabase RLS controls staff/client reads and writes. The client can read only a record whose email matches their verified Supabase sign-in and whose portal access is enabled.
- Internal notes and payment amounts use a staff-only table. Document comments are not exposed in the client portal.
- Staff roles live in `profiles`; a user cannot grant themselves a role from the browser.
- The client email function checks the caller's Supabase session and active staff profile before using the server-side service key or Resend key.
- No passport, bank statement, or uploaded document storage is included.

## Before using real records

Test with a few non-sensitive records: denied staff access, a valid staff login, staff password reset, a client's one-time email link, cross-client RLS denial, document progression gates, link revocation, progress refresh, and Resend delivery. Do not migrate existing clients until the Supabase configuration and tests are complete.
