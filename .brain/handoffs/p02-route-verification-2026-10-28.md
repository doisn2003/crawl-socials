# ADR-015 observed-route comparison — code ready

28/10/2026 Asia/Bangkok. P02.02 remains in progress. Worker LIVE reads0; shared dist/runtime/profile/.env/master/README/reviewer files unchanged. BrowserHost, DomTarget, IPC and benchmark contracts unchanged. Fixed search/current-post scripts retain the accepted performance hashes; current-post controller adds only a main-owned completion callback.

## Run after acceptance

New native item `Đối chiếu route bài nhóm vừa đọc: <profile>` / ID `csd-post-route-verify-<profileId>`; main method `startRouteVerification(profileId)`. On a newly activated process, lead must first run current-post successfully to create a fresh memory anchor, then invoke this item once on the same profile/view/document. Existing files are never imported as anchors. Only profile ID reaches the action; no URL/ID/file/script/payload input or `/posts/` construction.

The completion callback fires only after current-post payload+summary are durably written, for one readable sample/public-group signal/context hint, no caps/incomplete/barrier. Anchor stores redacted text+run hashes and binds profile/view/document; external navigation/loss or a new current-post start clears it. It is consumed once before verification. The main-owned observed route is revalidated, tracking removed, then loaded once in that owned WebContents. Main document commit counter must advance exactly once, with one expected start/commit and no redirect/in-page/extra navigation. After load resolves, one existing fixed current-post read runs. No readiness loop/retry. Navigation≤10s; read≤4s main/1s script/2500 steps/800 chars; shared3starts/process and native fence cover navigation and execution, including late settlement after Stop/timeout.

`REOPEN_MATCH` requires fresh qualifying completion, distinct fresh run, exact route/group/post strings, redacted text and SHA-256 equality, and unchanged text quality. Body change→REOPEN_MISMATCH/BODY_CHANGED; changed quality, absent evidence, barrier, redirect/owner/document race/Stop/timeout→INCONCLUSIVE with reason. Matching TRUNCATED snippets keep quality; full_text_verified is always false. Canonical permalink/source/context-hint verification stay UNVERIFIED, benchmark OFF, permission UNKNOWN, valid0.

Proof uses existing safe local diagnostic container `userData/public-candidate-diagnostics/candidate-*/{started,candidates,summary}.json`, same32KiB three-file cap/7day TTL/manual cleanup. Verification candidates.json holds owner/document context, two read refs/hashes and observed hints/body hashes; summary/return value contains enums/counts/hashes/run refs only. Original anchor payload is unchanged. Fresh fixed read has its own ordinary run artifact; references bind both. New controller hash scope POST_ROUTE_VERIFICATION_MODULE.

## Checks and frozen handoff

Isolated build PASS. **40 owner tests PASS**:18 search +11 current-post (new durable clean-anchor eligibility table) +11 verification. Focused cases cover same/changed/truncated text, anchors across profiles/owners/documents, redirect/in-page/extra/missing commit, auth/challenge/denied/missing data, old run ref, Stop/late nav/read and pending fence, elapsed wall/monotonic limits/clock reversal, disposal, sanitized output.

**Five native scenarios/15 outcomes PASS** (`--route-verification --route-case=match|body|barrier|redirect|stop`):

- Match: NO_ANCHOR first; clean anchor;1reopen/1fresh read/REOPEN_MATCH.
- Changed body:1reopen/1read/REOPEN_MISMATCH.
- Challenge:1reopen/1read/INCONCLUSIVE CHALLENGE.
- HTTP redirect:1reopen/0reads/INCONCLUSIVE ROUTE_CHANGED.
- Held navigation + Stop:1reopen/0reads, blocked concurrent action while native pending, late finish cannot recreate anchor; next action NO_ANCHOR.

All verify the shared start cap, exactly one requested observed route, immutable original anchor artifact, external network0 and windows/webContents0 after close. Evidence `p02-route-verification-{match,body,barrier,redirect,stop}-2026-10-28.json`; frozen manifest `p02-route-verification-files-2026-10-28.json`.

Next: independent review of memory-anchor boundary, main navigation/commit events and pending races; lead then activates and creates one new source anchor + runs one route comparison. Fixture match does not prove source capability, canonical identity, relevance, source AVAILABLE or a gate.
