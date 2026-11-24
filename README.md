# Brushy

Brushy is a TanStack Start app for logging brushing check-ins. Brushing detection runs in the browser; captured selfies are uploaded directly to a private S3 bucket. Brushing records and authentication use Supabase.

## Install on your phone or tablet

Brushy is an optional, installable web app (PWA), not a separate app-store app. Use the same HTTPS address and account as the website.

- **Android:** Open Brushy in Chrome. Use the in-app **Install Brushy** button when available, or Chrome's menu > **Add to Home screen** / **Install app**.
- **iPhone/iPad:** Open Brushy in Safari, choose **Share > Add to Home Screen**, and leave **Open as Web App** on if offered.

Installation guidance is shown only on phones/tablets and can be dismissed for the browser session. It is hidden in the installed app. Desktop browser use is unchanged; desktop browsers may still offer their own installation option.

**Online only:** Sign-in, history, detection-model loading, and saving selfies require a connection. There are no offline check-ins, queued uploads, background sync, or reminders. After an online visit activates the service worker, a failed page navigation can show a generic offline screen. Reconnect and choose **Try again**. An open page shows a connection-loss notice without reloading: an unsaved selfie remains only in that page's memory, not in an upload queue. Closing or reloading the page loses it. A device reporting "online" does not guarantee that Brushy's services are reachable; normal save-error feedback still applies.

The production service worker stores only `/offline.html` in its own versioned cache. It never adds application bundles, authenticated pages, API responses, selfies, check-ins, or models to Cache Storage. Ordinary browser HTTP caching is separate. Auth callback query strings and non-page requests bypass the fallback. Updates follow the browser's normal worker lifecycle: no forced activation or reload during capture. Close all Brushy windows/tabs, then reopen to use a waiting update. A first-ever visit while offline cannot load the fallback.

### PWA deployment and acceptance checks

Serve `/manifest.webmanifest`, `/sw.js`, `/offline.html`, and `/icons/*` as public static files over HTTPS on the app's origin. Do not rewrite these URLs to an HTML app page or protect them with sign-in. Service workers are registered only in production builds on secure origins (localhost qualifies for local production testing).

For the default Cloudflare build output, preview locally after `npm run build` with `npx wrangler dev --local --config .output/server/wrangler.json`. This serves the actual built worker and public assets; `vite preview` may instead look for a TanStack `dist/server/server.js` entry that this preset does not produce.

Before release, check a production deployment on a real Android phone and iPhone/iPad:

1. Install from Chrome/Safari; verify the Brushy name, icon, standalone launch, safe-area spacing, and absence of install guidance when installed. Check that dismissing guidance lasts for the browser session and that desktop has no in-app install guidance.
2. Verify email and Google sign-in in standalone mode, including any external-browser handoff; browsers can keep standalone and browser login sessions separate. Test camera permissions, camera switching, detection, upload, calendar, and sign-out.
3. Visit online, close/reopen so the worker controls the app, then go offline and navigate to `/`, `/calendar`, and `/capture`. Confirm the generic fallback and successful retry after reconnecting. Auth callback/API requests must never receive the offline HTML.
4. With a captured selfie still unsaved, disconnect. Check that saving is disabled and the selfie remains; reconnect and save. No automatic reload or duplicate/queued save should occur.
5. Inspect Cache Storage: only the public offline page belongs in `brushy-offline-*`. Deploy a changed worker while capture is open; confirm no reload and that the update takes effect after closing all app tabs/windows and reopening.

When changing the offline page, increment `CACHE_NAME`'s version in `public/sw.js` so the offline asset change also triggers a worker update. The fallback reconstructs a 503 HTML response because static hosts may redirect `.html` paths; it does not reuse a redirected response as a navigation response.

Automated tests cover metadata, install state, offline UI, and worker request/cache boundaries. Browser emulation is not a substitute for real-device installation, camera, or OAuth acceptance checks.

## Local development

Install Node.js and dependencies, copy `.env.example` to `.env.local`, configure the non-secret values below, then run `npm run dev`. For local uploads, supply the AWS credentials through your shell or a secret manager, not a file in this repository. Never commit `.env.local` or put AWS credentials in variables prefixed with `VITE_`.

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | New Supabase project URL, available in the browser |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | New Supabase publishable key (or legacy anon key), available in the browser |
| `SUPABASE_URL` | Same project URL, for server-side authentication |
| `SUPABASE_PUBLISHABLE_KEY` | Same publishable key, for server-side authentication |
| `AWS_REGION` | Region of the private S3 bucket |
| `S3_SELFIES_BUCKET` | Private S3 bucket name |
| `AWS_ACCESS_KEY_ID` | Server-only IAM access key ID |
| `AWS_SECRET_ACCESS_KEY` | Server-only IAM secret access key |

Supabase secret/service-role keys are not needed. Store AWS credentials in Vercel's sensitive environment variables, not in Git or client-side variables.

## Setup and deployment

1. Create a general-purpose S3 bucket with ACLs disabled, Block Public Access enabled, and default encryption. Create a dedicated IAM user whose policy grants only `s3:GetObject` and `s3:PutObject` on `arn:aws:s3:::YOUR_BUCKET/*`. Create an access key for that user; AWS storage and request charges may apply.
2. Create a new Supabase project. This is a fresh start: accounts, streaks and selfies in Lovable Cloud are not migrated or deleted. Per the project rules in `AGENTS.md`, ask Lovable to create the `brushings` table and user-isolation RLS policies in the new project. The existing schema is documented in `drizzle/migrations/0000_create_brushings.sql`; do not apply the old Supabase Storage policies to the new project.
3. Configure the environment variables above in Vercel for production. The `VITE_` variables are public; the AWS credentials must be sensitive server-side variables. Link a Vercel project with `npx vercel link`, and deploy with `npx vercel --prod`. Vercel detects the app's TanStack Start and Nitro configuration.
4. Configure Supabase Auth's site URL and redirect allowlist for the exact production origin and trusted local/preview origins. In Google Cloud, configure the OAuth consent screen and a web OAuth client. Add the Supabase Google provider's callback URL as an authorized redirect URI, and enter the Google client ID and secret in Supabase's Google provider settings. Google may restrict sign-in to test users until the app is published.
5. In S3 bucket **Permissions → Cross-origin resource sharing (CORS)**, allow the exact origins that will upload. For example, replace the production origin and local port below:

   ```json
   [
     {
       "AllowedOrigins": ["https://your-app.vercel.app", "http://localhost:3000"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 300
     }
   ]
   ```

6. Redeploy after changing Vercel environment variables. Verify email and Google sign-in, capture, saving, reloading, calendar display and isolation between two user accounts.

Use only trusted preview origins in the Supabase redirect allowlist and S3 CORS. Do not expose a public bucket. The server verifies the signed-in user before generating upload URLs and looks up owned database records before generating read URLs. Upload URLs expire after five minutes and read URLs after one hour. Replacing a check-in or a failed database save can leave an unreferenced S3 object; automatic deletion is not implemented. Do not apply a blanket expiration policy unless deleting retained selfies is intended.
