# Friends database deployment

## Apply before the app

1. Review `20261125_friends.sql` against your actual `public.brushings` schema and
   owner-only SELECT/INSERT/UPDATE/DELETE RLS policies. The script assumes the
   supplied UUID ID, `user_id`, `local_date`, `am`/`pm` slot, `photo_path`,
   `verified`, `confidence`, `created_at`, and unique
   `(user_id, local_date, slot)` constraint. It does not replace those policies.
2. Schedule a **coordinated maintenance/deploy window**, pause capture traffic,
   and warn users to finish or discard any capture before the window. Take a
   database backup. Run the entire SQL file **once**, as the SQL editor owner in
   Supabase, then **immediately deploy the compatible app**; do not leave the old
   app serving normally against the new privileges. This is a reviewable
   deployment script, not a generated migration or an instruction to mutate a
   live database automatically. Its transaction rolls back on any error; it
   deliberately fails instead of silently reapplying a partial/changed schema.
3. Keep `brushy_private` out of PostgREST's exposed schemas. It has no
   PUBLIC/anonymous/authenticated schema, table, or helper-function access
   regardless. Only `public.brushy_social(text,jsonb)` is granted to
   `authenticated`; no service-role key is needed in the app.
4. Confirm the RPC is available through the normal authenticated Supabase client.
   PostgREST normally reloads schema automatically; if needed, the SQL editor
   owner can run `NOTIFY pgrst, 'reload schema';`. Missing schema/RPC errors are
   deployment errors: do not fall back to direct writes, broad SELECT policies,
   or fake success.
5. Deploy the app using this RPC for **all** brushing inserts/replacements.
   Existing brushing SELECT stays owner-only and owner DELETE remains available.
   The migration clears old PUBLIC/anonymous/authenticated table and column
   grants, then deliberately grants authenticated SELECT and DELETE only.
   Direct authenticated INSERT/UPDATE, TRUNCATE, REFERENCES and TRIGGER
   privileges are revoked. Older app versions which
   directly upsert brushings must be updated/reloaded; do not restore these
   grants as a compatibility workaround. Already-open web tabs and installed
   PWA sessions can keep running that old code and will stop saving as soon as
   the SQL commits. Explicitly tell users to **reload after deployment** before
   resuming capture, and verify they receive the new app. There is **no
   loss-proof upgrade promise for an unsaved selfie**: a reload can discard an
   in-memory capture, and an in-flight save/upload may fail across the window.
6. Smoke-test using two dedicated accounts: request/accept, each audience,
   replacement, remove/re-add and block. Keep S3 private. The `photo` RPC returns
   an internal owned S3 path only; the server must check this RPC on every image
   request and stream bytes with `Cache-Control: private, no-store`, without
   redirecting to a signed URL. Bypass service-worker/CDN image caching.

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
