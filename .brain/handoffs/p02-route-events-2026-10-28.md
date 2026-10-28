# Bounded route-event trace and exact-URL history no-op

28/10/2026 Asia/Bangkok. Code ready for independent review. Worker source reads0; shared dist/runtime10544/profile/.env/master/README/reviewer files unchanged. LIVE v16 remains historically INCONCLUSIVE; its actual cancellation event was not recorded. The offline reproduction below establishes a supported event path, not the proven cause of that LIVE failure.

## Change and trace contract

Both verifier and the current-post reader's native watchLoss now allow a same-document event only when event URL and current URL are **exact strings**, owner/view still match and the expected document generation is unchanged. Verifier allows the anchor generation before commit and exactly the reopened generation after its single commit; fresh read still requires that new commit. Anchor watch also retains same-exact-document no-ops. Tracking/query changes, away-return, redirects, full navigation even to the same URL, unexpected commit/generation, owner loss and Stop still cancel. Search/metadata resolver keeps its strict default. Fixed scripts and existing budgets unchanged; no retry/wait-loop/delay added.

Verification diagnostic schema **2** adds to local proof and sanitized summary:

- `event_trace`: ≤16 entries. Only kind/source event enum, phase, frame enum, event/current URL equality enums, owner equality, generation_delta `0|1|OTHER|UNKNOWN`, decision `EXPECTED|NO_OP|CANCEL|AFTER_CANCEL`.
- Relevant native sources distinguish did-start-navigation, did-navigate, did-navigate-in-page, did-redirect-navigation, destroyed/render-gone/devtools. No URL, ID, account, body or arbitrary event strings are copied. Subframe in-page events retain the prior conservative loss behavior and are identifiable.
- `event_trace_overflow`: event17 cancels INCONCLUSIVE/EVENT_TRACE_LIMIT; array stays16. Native pending fence remains until execution settles.
- `first_cancellation`: bounded reason/cause/phase/event index (or null). First cause is sticky; later events/Stop cannot replace it. Event cause distinguishes URL change, redirect, full navigation during read, generation mismatch, owner loss and overflow. A reader-returned failure without outer cancellation is marked READER_RESULT.

REOPEN_MATCH remains only technical route/redacted snippet comparison. Full text false, hints/permalink/source UNVERIFIED, permission UNKNOWN, benchmark OFF, valid0. Same safe local output/7day/manual cleanup; no benchmark schema or BrowserHost/IPC change.

## Proof

Baseline native fixture was run before production edits against accepted v16 verifier/menu. Real history.replaceState/pushState of the same exact URL during fixed read yielded INCONCLUSIVE/ROUTE_CHANGED,1nav/1read, matching the failure class. Evidence `p02-route-events-v16-baseline-2026-10-28.json`; baseline module hashes refer to the accepted previous manifest. The baseline-only CLI case was removed after recording it; current fixture uses the same history injection with `--route-case=same-read`.

**44 owner tests PASS** (18 search +11 current-post +15 verifier). Four new focused tables cover exact no-op before/after commit/during read; event/current URL, owner/generation/subframe negatives; sticky first cause through away-return/full nav/redirect/Stop;16-event bound/redaction. Existing Stop/late result, freshness, identity, barrier and timing checks remain PASS.

**Seven current native scenarios/21 outcomes PASS**, plus the separate historical baseline:

- same-read:4 real main history events during READING; all exact/current-exact/same-owner/generation1 NO_OP;1nav/1read/REOPEN_MATCH. This exercises both reader watchLoss and outer verifier.
- same-loading:4 real history events during NAVIGATING after commit; same technical match.
- away-return: first event URL differs while current URL has already returned exact; INCONCLUSIVE/ROUTE_CHANGED, cause URL_CHANGED.
- full-same: START in READING to exact same URL still cancels, cause FULL_NAVIGATION_DURING_READ.
- trace-overflow:16 stored entries, overflow true, INCONCLUSIVE/EVENT_TRACE_LIMIT/TRACE_OVERFLOW.
- redirect:0fresh reads, explicit REDIRECT first cause.
- pending navigation + Stop:0reads, STOP first cause and late-settlement fence/consumed anchor unchanged.

Each synthetic scenario uses the shared3starts cap, one observed-route request, immutable original anchor proof, network0 and windows/webContents0 after close. Relevant commands: isolated build; `node scripts/facebook-public-candidate-smoke.mjs --route-verification --route-case=<case> --output <summary.json>`. History injection exists only in the offline fixture; production reads use the unchanged fixed script.

Evidence `p02-route-events-{same-read,same-loading,away-return,full-same,trace-overflow,redirect,stop}-2026-10-28.json`; frozen manifest `p02-route-events-files-2026-10-28.json`. Next: reviewer checks trace bounds/redaction and exact no-op ownership in both layers; lead activates, creates one new current-post anchor and performs one verification. No continuation/scale or gate claim.
