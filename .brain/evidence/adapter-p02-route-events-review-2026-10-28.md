# P02.02 — Independent route-event review

## Frozen v16 behavior baseline

Read `lead-p02-route-verification-review-2026-10-28.md`, `p02-live-route-verification-v16-2026-10-28.json` and `../handoffs/lead-p02-route-events-dispatch-2026-10-28.md`. LIVE verification ended INCONCLUSIVE / ROUTE_CHANGED after a fresh document and one read had started; the reader was STOPPED. Lead's later independent diagnostic found matching body/context/quality. No causal event kind was recorded. These facts do not identify same-document history, redirect or another event as the LIVE cause, and do not turn the historical verification into REOPEN_MATCH.

Pre-change code observations:

- Frozen verifier rejects every SAME_DOCUMENT event, including unchanged exact URL and unchanged owner/generation.
- Reader target's `watchLoss` at the reviewed menu source hash `d934fc4102c5959e2d9fb4c963322b848e73f2cb39d2668aa573c1f48d59a506` calls its loss callback on every main-frame start and every in-page navigation. Fixing only verifier semantics would leave this independent cancellation path.
- The new dispatch permits a narrow same-document ownership no-op with event URL **and current URL exactly unchanged**, plus unchanged owner/document generation. It does not permit normalization by matching IDs or dropping new tracking parameters.

Added only three focused tests to reviewer-owned `tests/facebook-post-route-verification-review.test.ts`:

1. Exact same-document event after the fresh commit while navigation completion is pending may preserve comparison.
2. Exact same-document event during the fresh read may preserve comparison.
3. Different event URL, different current URL, or away-return must still cancel even when parsing produces the same post/group hint.

The existing post-callback navigation test now uses a changed raw URL for its SAME_DOCUMENT negative. The previous same-exact-URL fixture is retained by the new positive test with the dispatch's updated expectation; START/COMMIT/REDIRECT/OWNER_LOST still expect cancellation. This is an explicit contract adjustment, not relaxing actual route-change guards.

Executed these three tests against the **preserved accepted v16 compiled source**, copied only inside reviewer output `.test-build-adapter-candidate/route-events-baseline/src/`. No owner source/build was overwritten. Frozen verifier SHA-256 remains `ae9ef399f5eaa64d0683d7981e54ce5457e90dd52a1dff5330404926af6aaa6f`; reader remains `d2309718815267a5bbd4bddb5728f172a9c07d1f0b81d71c50403f4997eb5558`.

```powershell
node --test --test-name-pattern='review route events:' .test-build-adapter-candidate/route-events-baseline/tests/facebook-post-route-verification-review.test.js
```

Baseline: **two expected failures** (positive cases return INCONCLUSIVE instead of REOPEN_MATCH), **one negative test PASS**. This reproduces the old verifier's behavior against the new no-op requirement. These unit collaborators do not execute Electron history APIs or the fixed-reader menu watcher; native proof must cover both watchers using actual same-exact-URL history events.

Full test/compiled/evidence hashes: `adapter-p02-route-events-baseline-files-2026-10-28.json`. Scope remains local synthetic tests and clean evidence only; no UI/source read, credentials, runtime, shared dist, status or gate change.

Await owner freeze. Final review will check bounded 16-event trace and first cancellation cause, exact equality/owner/generation guards, native history events through reader and verifier, and unchanged Stop/late-result behavior. No broader framework or tests added.

## Final frozen review — PASS

Reviewed `../handoffs/p02-route-events-2026-10-28.md` and `p02-route-events-files-2026-10-28.json`. **23/23 owned hashes match before and after review; 65/65 isolated native build hashes matched before execution.** Source and fixed scripts remain frozen throughout this final review.

Both ownership paths were read:

- `resolveFacebookDomTarget(..., true)` is used only for current-post/verification. Its loss watcher requires the same owned WebContents object/view generation, unchanged document counter, exact event URL and exact current URL. It retains a sticky loss state; full navigation, owner loss and changed/subframe history still invoke loss. Search/metadata keep the strict default.
- Verifier applies exact event/current URL equality, same owner, and generation 0 before commit or 1 after its single expected commit. A no-op cannot replace the required START/COMMIT/new-generation proof. Full navigation during read, changed URL even with the same parsed hint, away-return, redirect and unexpected owner/generation remain cancellation paths.
- Schema 2 trace is built from whitelisted enums/equality results only. At most 16 entries are retained; event 17 cancels with EVENT_TRACE_LIMIT. First cancellation records a bounded reason/cause/phase/index once and survives later events, overflow or Stop. Later recorded events are marked AFTER_CANCEL. Raw event URLs/values are not serialized.

Added two narrow reviewer checks for the new trace contract: exactly 16 versus 17/50 events, and first URL cancellation followed by return/redirect/Stop. Extended the existing same-document negative table with generation/owner/subframe mismatch. The two baseline positive expectations stayed unchanged and now pass.

Fresh compilation output: `.test-build-adapter-candidate/route-events-final`. **45/45 related tests PASS**: 11 independent verification, 15 owner verification, 8 independent current-post and 11 owner current-post tests. The compiler options are the same strict options recorded in the route-verification review, applied to these four test files. Executed:

```powershell
node --test --test-reporter=dot .test-build-adapter-candidate/route-events-final/tests/facebook-post-route-verification-review.test.js .test-build-adapter-candidate/route-events-final/tests/facebook-post-route-verification.test.js .test-build-adapter-candidate/route-events-final/tests/facebook-current-post-review.test.js .test-build-adapter-candidate/route-events-final/tests/facebook-current-post.test.js
```

Independently ran seven native scenarios against the hash-checked isolated build, using actual Electron history/navigation events. The fixture uses local protocol responses; it injects history operations only into the synthetic test session. In same-read, the fixed reader has installed its loss watcher before the native history calls execute; then the original fixed script runs. This exercises both the reader and verifier rather than fabricating a verifier-only callback.

For each `CASE` in `same-loading`, `same-read`, `away-return`, `full-same`, `trace-overflow`, `redirect`, `stop`:

```powershell
node scripts/facebook-public-candidate-smoke.mjs --route-verification --route-case=CASE --output .brain/evidence/adapter-p02-route-events-CASE-2026-10-28.json
```

**7/7 scenarios, 21/21 recorded outcomes PASS.** Additional checks on those saved artifacts confirm:

| Scenario | Observed result/cause |
|---|---|
| Same URL during loading | REOPEN_MATCH; four real history events in NAVIGATING, exact event/current URL, same owner and generation 1; NO_OP |
| Same URL during read | REOPEN_MATCH; four real history events in READING with the same strict checks; NO_OP |
| Away-return | INCONCLUSIVE / URL_CHANGED; returning to the original URL does not erase the first change |
| Full navigation to same URL | INCONCLUSIVE / FULL_NAVIGATION_DURING_READ |
| Trace overflow | INCONCLUSIVE / TRACE_OVERFLOW; exactly 16 retained entries |
| Redirect | INCONCLUSIVE / REDIRECT; no fresh read |
| Stop | INCONCLUSIVE / STOP; pending navigation stays fenced and late settlement leaves no anchor |

Each scenario requested one observed-route reopen and closed with zero remaining windows/webContents. Fixture shared-budget and immutable-anchor assertions passed. Sanitized trace checks found no raw source URL/body/identity. No broad performance/source collection test was added or rerun.

Final hashes:

- Verifier source: `1185af95ea1a2811e5ec79eaf1b19453c210e46c613e78b7cf83ebc9af639712`.
- Verifier compiled: `e52e1e3749aec1d9b6e55e554c6e61dd6cb7d6010365622c8f3f744f1052f568`.
- Menu source: `08f69317f48759c07dd521c195aca267c0f7489895f03a117b443182307a7ad7`.
- Reader compiled unchanged: `d2309718815267a5bbd4bddb5728f172a9c07d1f0b81d71c50403f4997eb5558`.
- Reviewer verification test: `9395946285d4fa1f1c20b086d19b2b76dd671ad9958791fc88d73c5aa7963cec`.

Final receipt: `adapter-p02-route-events-final-files-2026-10-28.json`, including native artifact hashes and test breakdown.

**No blocker found; ready for lead activation and bounded LIVE anchor/verification with trace.** This confirms behavior of the supported same-document path and its guards. It does **not** identify the unrecorded event that cancelled LIVE v16, rewrite that result, verify source capability or promote a gate. Reviewer performed no real-source/UI/runtime action.
