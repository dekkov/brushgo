# Turn on Friends in Brushy

Friends needs **two updates**: one in your Supabase database, then one to the
Brushy app. This guide is for updating your existing app, not setting it up again.
Your previously saved selfies stay private.

> **Important:** After the database update, the old app cannot save check-ins.
> Have the Friends app version ready to publish immediately afterward.
> Pushing code to GitHub alone does not confirm that your website has updated.

## Before you start

- Have a current database backup and a way to restore it. If you cannot make or
  restore a backup, stop before changing the live database.
- Have the Friends app update ready to deploy using your existing hosting setup.
  "Deploy" means publish the new version at your usual Brushy web address.
- Before a live release, have the developer checks below completed on a separate
  test database, including the privacy and simultaneous-request checks. The local
  automated tests have **not** verified your live Supabase project.

## Do these steps in order

1. **Pause check-ins.** Ask users to finish saving or discard any current selfie,
   then stop taking new ones until the update is finished. Reloading can lose an
   unsaved selfie; an upload already in progress may also fail during the update.
2. **Open the database update.** Sign in to the
   [Supabase dashboard](https://supabase.com/dashboard) with your project-owner
   account. Select the correct Brushy project, open **SQL Editor**, and create a
   new query.
3. **Run the Friends SQL once.** Open
   [`20261125_friends.sql`](20261125_friends.sql), copy the **entire file** into
   that query, and click **Run**. Do not use the old `0000_create_brushings.sql`
   file. A successful result may say "Success. No rows returned."
   **If you see an error, stop and share the error text, without passwords or
   keys.** Do not run individual pieces or rerun a successful update.
4. **Immediately publish the Friends app version.** Use your normal app
   deployment process. Keep check-ins paused until that deployment finishes.
5. **Reopen and check the app.** Close all Brushy tabs and installed-app windows,
   then reopen Brushy at its usual address. You should see **Friends** in the
   navigation. No reinstall is needed. Ask existing users to do the same before
   they start taking selfies again.

## Check it worked before inviting everyone

Use two test accounts in separate browsers or browser profiles. In both accounts,
choose a display name in **Friends**.

| Try this | What you should see |
| --- | --- |
| Share an invite, send a request, then accept it | Both accounts show the friendship. |
| Save an **Only me** selfie | Only its owner can see it. Previously saved selfies also remain private. |
| Save an **All friends** selfie. Check it, then repeat with **Selected friends** choosing the other account. | After each save and refresh, the other account can see the current shared selfie. |
| Retake a selfie in the same morning/evening slot | The new selfie replaces the old one; the old one disappears after refreshing. |
| Remove the friendship, then add it again | Old **Selected friends** selfies stay hidden from the re-added friend. |
| Block the friend and refresh both accounts | Shared history is no longer accessible in either direction. |

If anything fails, keep check-ins paused and share what happened. **Do not
delete tables, rerun the update, or loosen database permissions to fix it.**
Returning to the old app also needs a careful database rollback; it is not just
an app redeploy. Already-viewed photos or screenshots cannot be taken back.

## Check-in timing update

After Friends is installed, pause check-ins, run
[`20261127_check_in_timing.sql`](20261127_check_in_timing.sql) once, then publish
the app with **Settings** and have users reopen it before resuming check-ins.
The new app requires the timing RPC; an older app may submit a slot or date the
new database rejects.

Morning starts at 5 AM and evening at 2 PM in the account time zone. Before 5 AM,
an evening check-in belongs to the previous day. Existing check-in dates and
saved profile time zones are retained; accounts without an established time
zone start with the device's time zone. Changes in Settings take effect at the
next 5 AM in the previous zone. Verify the displayed zone, save a selfie in the
active slot, and confirm its date and slot in Calendar before ending the pause.

<details>
<summary>Developer reference: permissions, API, testing, and rollback</summary>

## Database and server requirements

Review the SQL against the actual `public.brushings` schema and owner-only
SELECT/INSERT/UPDATE/DELETE RLS policies before applying it. It assumes UUID ID,
`user_id`, `local_date`, `am`/`pm` slot, `photo_path`, `verified`, `confidence`,
`created_at`, and unique `(user_id, local_date, slot)`. It does not replace the
existing RLS policies. The update runs in a transaction that rolls back on any
error and deliberately fails instead of silently reapplying a partial/changed
schema.

Keep `brushy_private` out of PostgREST's exposed schemas. It has no
PUBLIC/anonymous/authenticated schema, table, or helper-function access.
Only `public.brushy_social(text,jsonb)` is granted to `authenticated`; no
service-role key is needed in the app.

Confirm that the RPC is available through the normal authenticated Supabase
client. PostgREST normally reloads its schema automatically; if needed, the SQL
editor owner can run `NOTIFY pgrst, 'reload schema';`. Missing schema/RPC errors
are deployment errors: do not fall back to direct writes, broad SELECT policies,
or fake success.

The compatible app must use the RPC for **all** brushing inserts/replacements.
The migration clears old PUBLIC/anonymous/authenticated table and column grants,
then grants authenticated SELECT and DELETE only. Existing brushing SELECT
stays owner-only and owner DELETE remains available. Direct authenticated
INSERT/UPDATE, TRUNCATE, REFERENCES and TRIGGER privileges are revoked; restoring
them for old clients would bypass the sharing rules.

Keep S3 private. The `photo` RPC returns an internal owned S3 path only; the
server must check this RPC on every image request and stream bytes with
`Cache-Control: private, no-store`, without redirecting to a signed URL. Bypass
service-worker/CDN image caching.

Existing captures receive `only_me`, independent revision UUIDs and capture
timestamps initialized from `created_at` (server time if it was null). There is
no automatic sharing of old captures. The private used-path ledger is seeded
from existing paths, including legacy non-S3 paths. New saves require the exact
`s3:<authenticated owner UUID>/<random v4 UUID>.jpg` format used by
`src/lib/selfie-path.ts`. Every path can be saved only once, including after
replacement or deletion, so recycling an old upload cannot edit its audience.

## Exact RPC contract

Call `supabase.rpc("brushy_social", { p_action, p_data })` with the viewer's
authenticated session. `p_data` defaults to `{}`. Unknown actions, unexpected or
missing fields, incorrect JSON scalar types, invalid UUIDs/dates/timezones and
unauthorized actions raise SQL exceptions; callers must surface a clear error.
Only explicitly listed fields are accepted.

| Action              | `p_data`                                                                             | Result                                                    |
| ------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `state`             | `{}`                                                                                 | `{profile, friends, incoming, outgoing, blocked, invite}` |
| `profile`           | `{display_name, time_zone}`                                                          | `{ok:true}`                                               |
| `reset_invite`      | `{}`                                                                                 | `{token}`                                                 |
| `preview`           | `{token}`                                                                            | `{user_id, display_name, relationship}`                   |
| `request`           | `{token}`                                                                            | `{id}` (request ID)                                       |
| `respond`           | `{request_id, accept:boolean}`                                                       | Accept: `{friendship_id}`; decline: `{ok:true}`           |
| `remove`            | `{friendship_id}`                                                                    | `{ok:true}`                                               |
| `block` / `unblock` | `{user_id}`                                                                          | `{ok:true}`                                               |
| `feed`              | `{owner_id?:uuid, cursor?:{captured_at,id}}`                                         | `{owner,items,next}`                                      |
| `photo`             | `{id,revision}`                                                                      | `{photo_path,owner_id}`                                   |
| `save`              | `{local_date,slot,photo_path,verified,confidence,audience,friendship_ids,time_zone}` | `{id,revision}`                                           |

- `profile` in `state` is
  `{id,display_name,last_audience,selected_friendship_ids:string[],time_zone}` or
  `null`. A private capture can create an **unnamed internal profile**. State
  still returns `profile:null` until `profile` sets a name; private capture works
  without onboarding. The stored timezone/preference is preserved when a name
  is later added. Names are trimmed, 1–40 characters, not unique. Timezones must
  appear in PostgreSQL `pg_timezone_names`; the initial timezone is `UTC`.
- `friends` is `[{friendship_id,user_id,display_name,streak:number}]`.
  `incoming` and `outgoing` are `[{id,user_id,display_name}]`.
  `blocked` is `[{user_id,display_name}]`. `invite` is the owner's reusable
  token or `null` until reset/created. Raw invite material is kept only in the
  inaccessible owner-state table; lookup also uses a token hash. Each token
  combines two cryptographically random UUIDs (64 lowercase hexadecimal
  characters, 244 random bits). The hash is an index, not password storage.
- Friends graph actions, including preview/reset, require a display name.
  `preview.relationship` is `self|friend|incoming|outgoing|none`; preview exposes
  no streak or history. Invalid/reset/blocked invites all raise
  `Invite unavailable`. Reset preserves existing relationships and requests.
- `request` never auto-accepts crossed requests. One pending request is allowed
  per unordered pair. There is no cancel action. Decline permits an immediate
  retry, limited to five created requests per sender in a rolling minute across
  recipients. Declined/accepted/ended request audit rows are retained; removing,
  blocking, or declining does not clear this rate limit.
- `respond` is recipient-only. Both users must have fewer than five accepted
  friends; a full-list error leaves the request pending. Pending requests do
  not reserve slots. Every graph write locks stable per-user rows in UUID order,
  including first-use profile insertion, before checking/mutating relationships.
  Saving locks just the capture owner, before checking active selections or
  writing grants/preferences. Removal/blocking needs that same owner lock, so
  either the save completes first and removal clears its grants/selections, or
  removal completes first and the save rejects the ended selection. Saves never
  acquire a second user lock after the first, avoiding lock-order inversion.
- `block` requires a current friendship, pending request, own existing block,
  or identity obtained from a legitimate invite preview/request. It is not a
  user-ID lookup. Either direction denies invites, feed and photos. Removal or
  blocking deletes the active friendship identity and selected grants, clears
  its remembered selections, and ends pending requests. `unblock` requires an
  own existing block and restores nothing.
- `feed.owner` is `null` for the combined own+friends feed; with `owner_id` it
  is `{user_id,display_name,streak}`. Owner-filtered history requires self or an
  active unblocked friendship, **even if history is empty**. Unnamed self
  profiles have a null display name.
- `feed.items` is `[{id,revision,owner_id,display_name,streak:number,local_date,
slot,verified,captured_at,audience}]`, newest first. Only authorized captures
  appear. It never includes photo paths, invite secrets or private brushing
  dates belonging to friends. Page size is 20. `next` is the last returned
  `{captured_at,id}` only if another item exists, otherwise `null`. Pass the
  cursor unchanged. Ordering compares timestamp and UUID together.
- Friend streaks include private slots but only expose an aggregate integer.
  SQL matches `computeStreak`: consecutive days with both AM and PM, ending
  today or yesterday if today is incomplete, using the owner's stored timezone.
- `save.local_date` is an actual date in `YYYY-MM-DD` form; `slot` is `am|pm`;
  `verified` is boolean; `confidence` is a finite JSON number from 0 to 1.
  `audience` is `only_me|all_friends|selected_friends`. `friendship_ids` must be
  `[]` except for selected sharing, which requires 1–5 distinct active
  friendships belonging to the caller. Shared captures require a name.
- `all_friends` includes future accepted friends and prior All friends history.
  Selected sharing binds to the current **friendship UUID**, not the user ID.
  Re-adding a friend creates a new UUID and never revives old selected access.
  Remembered audience and selections are saved atomically with the capture.
  Removal can leave `last_audience:"selected_friends"` with `[]`; the UI must
  require a new audience choice, not silently broaden it.
  State returns only currently active, unblocked selected friendship IDs, even
  when an account-deletion cascade ended a friendship outside the graph RPC.
- Every `save`, including replacing the same AM/PM slot, requires a new owned
  upload path and atomically changes revision and server capture time. The
  brushing ID remains stable on replacement; the old revision immediately
  fails `photo`. Capture time is not client-supplied. Existing `created_at` is
  retained on replacement; feed sorting uses `captured_at`.
- `photo` authorizes current revision, audience, active friendship and absence
  of either-direction blocks on every request. Owners can use it too. Missing
  and unauthorized items both raise `Photo unavailable`. There is no signed
  read URL in any RPC output.
  Photo authorization and path selection share one SQL statement snapshot.
  Owner-filtered feed aggregates likewise recheck authorization in the same
  statement that reads the owner's name/streak; a preceding history check
  alone is insufficient if removal commits between statements. Already in-flight
  reads/bytes cannot be recalled.

## Isolated SQL validation

Run `npm run test:db` with Node supporting `--experimental-strip-types` (Node
22.18+ or current Node 24/26), after installing the project's dependencies.
`npx bun run test:db` also runs the package script in the existing toolchain.
The runner starts an extension-free, in-memory PGlite PostgreSQL engine,
creates disposable Supabase-like roles/auth/RLS, applies the **actual SQL file**,
and runs real role-switched queries. It never accepts a database URL or touches
a live database.

Coverage includes anonymous/outsider denials, table/column grants, helper ACLs,
owner RLS, legacy privacy, unnamed private capture, explicit acceptance,
duplicates/crossed requests, decline/retry throttling, both sides of the
five-friend cap, no pending-slot reservations, all/selected/private audiences,
future-friend history, remove/re-add identity, blocks, invite reset, new-path
requirements, old revisions, cursor ties/pagination, strict direct-call payload
validation, and SQL streak comparison against `src/lib/streak.ts` in multiple
timezones. Additional guard tests leave an intentionally stale friendship beside
a block, exercise account-deletion cascades, shadow `pg_timezone_names` with an
attacker-owned temporary table, compare S3 path handling with the actual reader,
and inspect every helper's authenticated/anonymous/PUBLIC execute ACL.

**Concurrency limitation:** PGlite has one connection. Deterministic cap tests
and inspection of actual ordered `FOR UPDATE` user locks are not proof of
concurrent scheduling. Before a production rollout, use a disposable real
PostgreSQL database with two independent sessions and race accepts sharing a
user at four friends; exactly one may succeed, the other must remain pending at
the cap. Repeat with the shared user as sender, and with remove/block versus
accept/save. Never run these fixtures in production. No multi-session race or
live Supabase check is claimed by this runner.
A PostgreSQL-protocol server in front of PGlite would still multiplex a single
backend/connection; it would not create independent concurrent PostgreSQL
transactions or strengthen this claim. No protocol wrapper was added.

## Rollback and operations

The script is additive but privacy-sensitive. The safest rollback is to disable
Friends UI/server entry points while preserving database enforcement and data.
Do **not** restore direct upsert privileges to support an old binary: doing so
lets clients bypass immutable audience/revision/capture rules. Do not drop the
private schema, audit, used-path ledger, grants or added brushing columns
without a separate reviewed export/retention and rollback plan; doing so loses
graph history, invite resets, selections and per-photo privacy intent.

If restoring the old private-only app and its direct-write privileges is
unavoidable, treat it as a separate reviewed privacy rollback, in this order:
keep capture traffic paused; disable Friends UI, server photo/social endpoints
**and authenticated execution of the social RPC**; preserve/export social data
and apply a reviewed privacy reset that makes remaining captures private and
retires their shared grants; deploy the old private-only app; only then restore
the exact reviewed old privileges and require all open sessions to reload before
reopening capture traffic. Do not merely hide the Friends UI or restore writes
while shared audiences/revisions still depend on RPC-only enforcement. A later
Friends rollout requires another review of captures written by the old app,
not simply re-enabling the RPC against potentially stale sharing metadata.

Do not prune request audit rows younger than one minute. Retaining them longer
is intentional; establish retention/cleanup separately without weakening the
throttle. `used_photo_paths` deliberately outlives captures. User deletion
cascades private social state through `auth.users`; account-deletion/object
retention remains the existing application's responsibility.

</details>
