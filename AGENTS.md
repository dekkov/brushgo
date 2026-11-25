# Working on Brushy

- Database changes are reviewable SQL under `docs/sql/`, applied by the owner in Supabase; do not mutate a live database during development.
- For Friends schema changes or deployment, read `docs/sql/friends-deployment.md` before changing its RPC contract or privileges.
- Leave automatically generated files to their generators. Keep secrets server-side and out of Git.
- Preserve published Git history; push normal commits without force-pushing.
- Brushing detection runs in the browser (COCO-SSD via lazy-loaded TF.js in src/lib/detector.ts) — no server cost, photos only uploaded after capture.
- Streak/slot rules live in src/lib/streak.ts with tests; keep UI logic out of it.
