# Authorize shared photos on every request

Status: accepted.

## Context

Friends must lose photo access when a friendship ends or a selfie is replaced. Existing owner-only photo views use signed URLs, which remain usable until expiry and cannot meet this rule for friend views. All friends includes future friendships; Selected friends must not revive grants after re-friending.

## Decision

The shared feed receives safe metadata and photo revisions, never reusable S3 read URLs. An authenticated endpoint checks the current photo revision, active friendship, blocks, and audience on each request, then streams private S3 bytes with private no-store headers.

Selected audience grants reference immutable friendship identities. A new friendship after removal has a new identity. Retaking the same morning/evening slot creates a new photo revision and capture time atomically.

## Consequences

Friend photo delivery incurs application-host bandwidth and an authorization lookup on every fetch. Cached browser metadata and already-rendered photos are removed on refresh or relationship mutations, but screenshots and bytes already delivered cannot be recalled.

Owner-only calendar URLs remain a separate capability: they are never returned to friends. No public object access, client service-role key, CDN photo cache, or offline photo cache is introduced.
