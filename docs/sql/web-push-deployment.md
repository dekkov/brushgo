# Turn on Web Push in Brushy

Push is optional. The existing app, in-app prompts, and Friends work without it.
Do these steps in a test project first; the SQL runs only when a project owner
applies it.

1. **Apply the database update.** In Supabase SQL Editor, run the entire
   [`20261127_web_push.sql`](20261127_web_push.sql) file once, after Friends,
   check-in timing, and selfie hearts. Stop if it errors. Existing check-ins
   seed the reminder ledger; previously deleted check-ins and removed hearts
   from before this migration cannot be reconstructed.
2. **Configure the Edge Function.** Generate one VAPID key pair (for example
   with `npx web-push@3.6.7 generate-vapid-keys`). Generate a separate long,
   random scheduler token. In Supabase **Edge Functions → Secrets**, set
   `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` (a
   `mailto:` contact), and `PUSH_DISPATCH_TOKEN`. Do not put the private key,
   token, or service-role key in Vercel, browser config, Git, or chat. Save the
   VAPID pair securely; replacing it requires devices to resubscribe.
3. **Deploy the sender.** From this repository, with the Supabase CLI signed in:

   ```sh
   supabase functions deploy push-dispatch --project-ref YOUR_PROJECT_REF --no-verify-jwt
   ```

   The job is authenticated by the dedicated token checked inside the function,
   not by the public Supabase key. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
   are provided by the hosted Edge Function environment.
4. **Schedule the sender.** Enable Supabase Cron (`pg_cron`) and `pg_net`.
   In Vault, create `brushy_push_url` with the full Edge Function URL (ending in
   `/functions/v1/push-dispatch`) and `brushy_push_token` with the same token
   used in step 2. Run [`schedule_web_push.sql`](schedule_web_push.sql) once.
   The job should run every minute. Check the Edge Function invocation logs
   for successful responses; a cron job can run even if its HTTP call fails.
5. **Publish the web app.** In Vercel, set `VITE_WEB_PUSH_PUBLIC_KEY` to the
   public key from step 2 and redeploy. For sign-in after notification taps,
   add the production HTTPS origin with `/capture`, `/friends`, and
   `/selfie/*/*` to the Supabase Auth redirect allowlist. Keep entries scoped
   to origins you control. Reopen all installed-app windows to activate the
   new worker; reinstalling is not required.

## Acceptance and operations

Use Android Chrome and an iPhone or iPad Home Screen installation. Verify no
permission prompt until you press **Enable on this device** in **Settings**,
and verify that denying push leaves check-ins and Friends usable. Opt in on
one device only, then send a new friend request and heart a shared selfie from
another account. Inspect the generic text, tap destinations, and sign-in
return. Retake or delete a selfie and confirm its old link cannot show another
revision. Sign out and confirm that device stops receiving new alerts.

For reminders, verify a missed slot notifies within the catch-up window and a
logged slot stays quiet even if its check-in is deleted. Reminders use the
account time zone, catch up for at most 15 minutes, and expire after 30 minutes
or at slot end, whichever is earlier. Pending requests and first hearts expire
after 24 hours. An attempt isn't retried after it is claimed; delivery is
best-effort and already-delivered notifications cannot reliably be recalled.
Provider endpoints are limited to registered Chrome/FCM, Apple, and Mozilla
hosts. A provider returning 404 or 410 removes the subscription.

To pause delivery, unschedule `brushy-web-push` in Supabase Cron. To hide device
controls, also unset `VITE_WEB_PUSH_PUBLIC_KEY` and redeploy. Keep the database
ledger if planning to resume. These steps do not change sharing permissions.
