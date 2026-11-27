# Brushy feature map

Use this map to find feature entry points, data owners, and dependent areas before changing code. Read the relevant source and tests next; this is a navigation guide, not a complete specification or deployment status.

Product terms belong in the [glossary](../GLOSSARY.md). Setup and device acceptance belong in the [README](../README.md); Friends database contracts and rollout belong in the [deployment guide](sql/friends-deployment.md).

## Sign-in

- **Entry points:** [AppShell](../src/components/AppShell.tsx) gates signed-in pages; [AuthCard](../src/components/AuthCard.tsx) handles email and Google sign-in.
- **Core/data:** [useAuth](../src/hooks/useAuth.ts) observes Supabase sessions. [Auth middleware](../src/integrations/supabase/auth-middleware.ts) authenticates server functions; Supabase `auth.users` owns account identities. These integration files are generated.
- **Tests:** [AuthCard](../src/components/AuthCard.test.tsx) for OAuth wiring; [PrivateSelfie](../src/components/PrivateSelfie.test.tsx) for viewer/session isolation.
- **Dependencies:** [Friends](#friends) and [history](#history-and-feed) queries are account-scoped. [useSocial](../src/hooks/useSocial.ts) owns their query keys and account-change cleanup, mounted through [SocialSessionBoundary](../src/components/SocialSessionBoundary.tsx) in the [root route](../src/routes/__root.tsx).

## Capture

- **Entry point:** [/capture](../src/routes/capture.tsx) owns camera permissions, countdown, preview, detection, and save feedback.
- **Core/data:** [detector](../src/lib/detector.ts) lazy-loads browser-side TF.js/COCO-SSD. [AudiencePicker](../src/components/AudiencePicker.tsx) uses [social contracts/preferences](../src/lib/social.ts). Unsaved shots live in page memory; [selfie functions](../src/lib/selfie.functions.ts) authorize uploads to private S3, then [social functions](../src/lib/social.functions.ts) submit the check-in save.
- **Tests:** [Capture connection loss](../src/test/pwa-capture.test.tsx), [audience selection](../src/components/AudiencePicker.test.tsx), and [social payloads/preferences](../src/lib/social.test.ts).
- **Dependencies:** Saving crosses [check-ins](#check-ins-streaks-replacement-and-deletion), [Friends](#friends), and [photo storage](#photo-privacy-and-storage); availability and unsaved-shot handling cross [PWA](#pwa-and-offline-boundaries).

## Check-ins, streaks, replacement, and deletion

- **Entry points:** [Home](../src/routes/index.tsx) shows today's slots/streak; [SelfieDialog](../src/components/SelfieDialog.tsx) and [DeleteSelfieButton](../src/components/DeleteSelfieButton.tsx) expose deletion from personal history and own feed cards.
- **Core/data:** [streak](../src/lib/streak.ts) owns browser slot/date/streak rules. `public.brushings` owns the current check-in per user/date/slot; the [Friends SQL](sql/20261125_friends.sql) owns validated saves, replacement revisions, and aggregate friend streaks. [Deletion server](../src/lib/selfie-delete.server.ts) authorizes owner/revision, deletes storage first, then deletes that check-in.
- **Tests:** [Streak rules](../src/lib/streak.test.ts), [delete confirmation](../src/components/DeleteSelfieButton.test.tsx), [delete authorization/failures](../src/lib/selfie-delete.server.test.ts), and [SQL checks](../scripts/test-friends-db.ts) for replacement, permission cascades, and streak parity.
- **Dependencies:** Replacement/deletion affect [history](#history-and-feed) and [photo access](#photo-privacy-and-storage). Personal history uses [useBrushings](../src/hooks/useBrushings.ts) reloads, while feed/social data use Query caches; account for both refresh paths.

## History and feed

- **Entry points:** [Calendar](../src/routes/calendar.tsx), [home feed](../src/routes/index.tsx), and [friend history](../src/routes/friends.$userId.tsx).
- **Core/data:** [useBrushings](../src/hooks/useBrushings.ts) reads owner-only records and signed image URLs for personal views. [FriendsFeed](../src/components/FriendsFeed.tsx) reads paginated, authorized metadata via the social `feed` action and loads images through [PrivateSelfie](../src/components/PrivateSelfie.tsx). There is no persisted feed table.
- **Tests:** [Feed pagination/refresh/offline](../src/components/FriendsFeed.test.tsx), [image lifecycle](../src/components/PrivateSelfie.test.tsx), and [SQL checks](../scripts/test-friends-db.ts) for feed authorization and cursor ordering.
- **Dependencies:** [Friends](#friends) controls which records are visible; [photo privacy](#photo-privacy-and-storage) rechecks access when images load. [Check-in mutations](#check-ins-streaks-replacement-and-deletion) change calendar contents, feed ordering, and streaks.

## Friends

- **Entry points:** [/friends](../src/routes/friends.index.tsx) mounts [FriendsManager](../src/components/FriendsManager.tsx); the [parent route](../src/routes/friends.tsx) provides the signed-in shell.
- **Core/data:** [useSocial](../src/hooks/useSocial.ts) reads state; [social contracts](../src/lib/social.ts), [server functions](../src/lib/social.functions.ts), and [RPC transport](../src/lib/social-rpc.server.ts) bridge UI to `public.brushy_social`. The [SQL](sql/20261125_friends.sql) owns private profiles, invites/previews, requests, friendships, blocks, and graph enforcement. Consult the [deployment guide](sql/friends-deployment.md) for the exact contract.
- **Tests:** [Friends management](../src/components/FriendsManager.test.tsx), [RPC errors](../src/lib/social-rpc.server.test.ts), and [SQL checks](../scripts/test-friends-db.ts) for caps, invite resets, requests, blocks, and friendship identity.
- **Dependencies:** Relationship changes affect remembered [capture audiences](#capture), selected-photo permissions, and [feed/history access](#history-and-feed). Selected grants reference a friendship identity, not just a recipient account.

## Photo privacy and storage

- **Entry points:** [Selfie functions](../src/lib/selfie.functions.ts) authorize uploads, owner reads, and deletion. [/api/selfies/$id](../src/routes/api.selfies.$id.ts) serves feed images.
- **Core/data:** [Photo server](../src/lib/social-photo.server.ts) authorizes each image revision through the SQL `photo` action before streaming. [Storage adapter](../src/lib/selfie-storage.server.ts) owns S3 operations; [path helpers](../src/lib/selfie-path.ts) validate owned object paths. Image bytes live in private S3 or legacy Supabase Storage; SQL `photo_grants` and `used_photo_paths` own selected access and upload-reuse prevention.
- **Tests:** [Per-request authorization](../src/lib/social-photo.server.test.ts), [storage signing](../src/lib/selfie-storage.server.test.ts), [path validation](../src/lib/selfie-path.test.ts), and [deletion](../src/lib/selfie-delete.server.test.ts).
- **Dependencies:** Keep owner signed URLs separate from friend streaming; the [privacy ADR](adr/0001-authorize-shared-photos-per-request.md) explains why. Changes must account for [Friends revocation](#friends), [replacement/deletion](#check-ins-streaks-replacement-and-deletion), and [offline/cache boundaries](#pwa-and-offline-boundaries). Storage deletion and database deletion are separate operations; retry/retention limits belong in the [README](../README.md#delete-a-selfie).

## PWA and offline boundaries

- **Entry points:** [Root route](../src/routes/__root.tsx) mounts [PwaSupport](../src/components/PwaSupport.tsx) and app metadata. [Manifest](../public/manifest.webmanifest) supplies install metadata.
- **Core/data:** [useInstall](../src/hooks/useInstall.ts) handles installation guidance; [useOnline](../src/hooks/useOnline.ts) reports connectivity. [Registration](../src/lib/pwa.ts) loads the [service worker](../public/sw.js), whose Cache Storage contains only the public [offline page](../public/offline.html), not personal data.
- **Tests:** [Install state](../src/hooks/useInstall.test.ts), [PWA UI](../src/components/PwaSupport.test.tsx), [registration](../src/lib/pwa.test.ts), [assets/worker boundaries](../src/test/pwa-assets.test.ts), and [capture interruption](../src/test/pwa-capture.test.tsx).
- **Dependencies:** New page routes may need worker navigation-fallback coverage. [Capture](#capture), [Friends mutations](#friends), and [photo delivery](#photo-privacy-and-storage) remain network-dependent; device and update acceptance steps are in the [README](../README.md#pwa-deployment-and-acceptance-checks).
