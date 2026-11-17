# Brushgo

Brushgo is a TanStack Start app for logging brushing check-ins. Brushing detection runs in the browser; captured selfies are uploaded directly to a private S3 bucket. Brushing records and authentication use Supabase.

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
